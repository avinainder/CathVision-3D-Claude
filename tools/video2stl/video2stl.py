#!/usr/bin/env python3
"""video2stl — turn an axial-sweep CT coronary angiography video into a 3D model.

A video that scrolls through consecutive axial slices is a volume in disguise:
each frame is a slice. This tool stacks the frames, segments one contrast-filled
vessel, measures it along its centerline and writes

  * a binary STL (tagged SPACE=LPS, so CathVision orients it correctly), and
  * a findings JSON (length, diameter profile, stenoses, calcium) that the
    CathVision report panel can import as unverified suggestions.

    python video2stl.py sweep.mp4 -o rca.stl --findings rca.json --qa rca_qa.png

EDUCATIONAL USE ONLY. A video carries no physical scale, no Hounsfield units
and has been lossily compressed. Unless you pass --pixel-mm, every millimetre
below follows from the reference diameter you assume (--ref-diameter-mm).
Percent stenosis is a ratio and is less sensitive to that assumption, but is
still an estimate from degraded data. Nothing produced here is a measurement
or a diagnosis.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure
from skimage.filters import threshold_multiotsu, threshold_otsu
from skimage.graph import MCP_Geometric

FULL = np.ones((3, 3, 3), bool)
# The CT image is first reduced to about this many pixels a side, so
# behaviour (and memory) does not depend on how large the video was saved.
# If the vessel turns out too small at that size, the analysis is repeated at
# finer resolution: a full-slice video needs every pixel it has.
WORKING_SIZE = 256
MIN_WORKING_RADIUS = 3.0
# A coronary artery is never a large fraction of the image; a bright
# structure thicker than this is a chamber or the aorta.
MAX_VESSEL_RADIUS_FRACTION = 0.08
LESION_MIN_PERCENT = 15.0
END_TRIM_MM = 4.0
# Smoothing along the vessel, in centerline samples (half a pixel each): of
# the sampled image before fitting, and of the fitted diameters after.
RAY_SMOOTH = 1.0
PROFILE_MEDIAN = 3
PROFILE_SMOOTH = 1.0
DISCLAIMER = ("Estimated geometry from a compressed video. Educational demonstration only - "
              "not a measurement, not a diagnosis.")


class PipelineError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Video → volume
# ---------------------------------------------------------------------------

def read_video(path):
    """Decode a video to a (frames, height, width) uint8 grayscale array."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    if probe.returncode != 0 or not probe.stdout.strip():
        raise PipelineError(f"could not read video: {path}\n{probe.stderr.strip()}")
    w, h = (int(v) for v in probe.stdout.strip().split(",")[:2])
    # Passthrough timing: never let ffmpeg invent or drop frames to hit a rate.
    raw = b""
    for timing in (["-fps_mode", "passthrough"], ["-vsync", "0"]):
        done = subprocess.run(
            # -noautorotate: decode at the coded size ffprobe reported, even
            # if the file carries a rotation flag.
            ["ffmpeg", "-v", "error", "-noautorotate", "-i", path, *timing,
             "-f", "rawvideo", "-pix_fmt", "gray", "-"],
            capture_output=True)
        if done.returncode == 0:
            raw = done.stdout
            break
    n = len(raw) // (w * h)
    if n < 8:
        raise PipelineError(f"video has only {n} frames; an axial sweep needs many more")
    return np.frombuffer(raw, np.uint8, n * w * h).reshape(n, h, w)


def video_rotation(path):
    """Degrees of display rotation the file asks for (0 if none)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream_side_data=rotation:stream_tags=rotate", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True)
    for token in probe.stdout.split():
        try:
            degrees = int(float(token))
        except ValueError:
            continue
        if degrees % 360:
            return degrees
    return 0


def drop_duplicate_frames(frames):
    """Remove repeated frames (a capture often holds each slice for several).

    Frame-to-frame change is either a new slice (large) or compression
    flicker on a repeated one (small). Frames are dropped only when those two
    groups are clearly separate; otherwise every frame is kept.
    Returns the kept frames and their original indices.
    """
    sub = frames[:, ::2, ::2].astype(np.int16)
    diff = np.abs(np.diff(sub, axis=0)).mean(axis=(1, 2))
    if not (diff > 0).any():
        raise PipelineError("every frame is identical; this is not a sweep")
    keep = np.ones(len(diff), bool)
    log_diff = np.log(diff + 1e-3)
    if log_diff.max() - log_diff.min() > np.log(3):
        repeated = log_diff < threshold_otsu(log_diff)
        if repeated.any() and not repeated.all() \
                and np.median(diff[~repeated]) >= 3 * max(np.median(diff[repeated]), 1e-3):
            keep = ~repeated
    keep = np.concatenate([[True], keep])
    return frames[keep], np.flatnonzero(keep)


def detect_image_box(frames):
    """Find the part of the frame that changes over time (the CT image itself),
    ignoring static borders, captions and UI. Returns (x, y, w, h)."""
    step = max(1, len(frames) // 60)
    std = frames[::step].astype(np.float32).std(axis=0)
    # Anything that flickers at all counts: image noise alone moves a CT
    # pixel by several grey levels, a static border by almost none.
    active = std > max(1.5, 0.05 * np.percentile(std, 99))
    active = ndimage.binary_opening(active, iterations=2)
    labels, n = ndimage.label(active)
    if n == 0:
        return 0, 0, frames.shape[2], frames.shape[1]
    sizes = ndimage.sum(active, labels, range(1, n + 1))
    ys, xs = np.nonzero(labels == 1 + int(np.argmax(sizes)))
    return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

def intensity_classes(vol):
    """Three-class split of the smoothed volume: dark (fat/air), soft tissue,
    contrast. Returns (bright threshold, dark level, soft-tissue level).

    Refuses images with no contrast-filled structures: a three-way split can
    always be computed, even on noise, so the classes must also stand clearly
    apart.
    """
    sample = vol[::2, ::2, ::2]
    noise = 1.4826 * np.median(np.abs(sample - ndimage.gaussian_filter(sample, 2.0)))
    sample = sample.ravel()
    try:
        t_low, t_high = threshold_multiotsu(sample, classes=3)
    except ValueError as exc:
        raise PipelineError("image has too little contrast to segment") from exc
    low = sample[sample <= t_low]
    dark = float(np.median(low)) if low.size else float(sample.min())
    middle = sample[(sample > t_low) & (sample < t_high)]
    tissue = float(np.median(middle)) if middle.size else 0.5 * (t_low + t_high)
    high = sample[sample >= t_high]
    contrast = float(np.median(high)) if high.size else tissue
    if contrast - tissue < max(25.0, 8.0 * noise):
        raise PipelineError("no contrast-filled structures found: nothing in the image is clearly "
                            "brighter than soft tissue")
    return float(t_high), dark, tissue


def remove_thick(bright, dt, radius):
    """Drop everything a ball of `radius` voxels fits inside (aorta, chambers),
    with a small margin, leaving only thin bright structures."""
    core = dt > radius
    if not core.any():
        return bright.copy(), np.zeros_like(bright)
    thick = ndimage.distance_transform_edt(~core) <= radius + 2
    return bright & ~thick, thick & bright


def pick_vessel(bright, dt, seed=None):
    """Choose the vessel: the bright connected structure that is thin and long.

    With a seed, the structure under the seed. Without one, the most tubular
    component over a range of candidate vessel radii.
    Returns (vessel mask, thick-structure mask, all thin structures).
    """
    max_radius = MAX_VESSEL_RADIUS_FRACTION * min(bright.shape[1:])
    if seed is not None:
        z, y, x = seed
        near = (slice(max(z - 3, 0), z + 4), slice(max(y - 6, 0), y + 7), slice(max(x - 6, 0), x + 7))
        if not bright[near].any():
            raise PipelineError("no contrast-filled structure at the seed point")
        if dt[near].max() > max_radius:
            raise PipelineError("the structure at the seed is too thick to be a coronary artery "
                                "(is the seed in a chamber or the aorta?)")
        radius = int(np.ceil(1.8 * dt[near].max() + 1))
        thin, thick = remove_thick(bright, dt, radius)
        labels, _ = ndimage.label(thin, FULL)
        ids = labels[near][labels[near] > 0]
        if ids.size == 0:
            raise PipelineError("the structure at the seed is too thick to be a coronary artery")
        return labels == np.bincount(ids).argmax(), thick, thin

    best = None
    for radius in (2, 3, 4, 6, 8, 11, 15, 20):
        if radius > max(max_radius, 4):
            break
        thin, thick = remove_thick(bright, dt, radius)
        labels, n = ndimage.label(thin, FULL)
        if n == 0:
            continue
        sizes = np.bincount(labels.ravel())[1:]
        boxes = ndimage.find_objects(labels)
        for lab in 1 + np.argsort(sizes)[::-1][:6]:
            if sizes[lab - 1] < 150:
                break
            box = boxes[lab - 1]
            comp = labels[box] == lab
            diag = float(np.linalg.norm(comp.shape))
            r_est = 3.0 * float(dt[box][comp].mean())  # mean EDT of a cylinder is r/3
            if r_est > radius:
                continue
            score = diag / (2 * r_est)
            # Prefer the smallest radius that already yields the long vessel.
            if best is None or score > 1.05 * best[0]:
                best = (score, labels == lab, thick, thin)
    if best is None or best[0] < 6:
        raise PipelineError("no tubular contrast-filled structure found; try --seed x,y,frame")
    return best[1], best[2], best[3]


def bridge_gaps(mask, thin, thick, vol, lumen_level, dark_level):
    """Reconnect the vessel across stretches too narrow to threshold.

    A tight stenosis can dim the lumen until the trace simply stops there,
    which would report a short, healthy vessel and miss the lesion entirely.
    From each free end of the trace, look ahead for another thin bright
    structure in line with the vessel and join it along the brightest route,
    so the narrowing gets measured. An end that sits on a thick structure
    (the ostium) is where the vessel starts, not a gap, and is left alone.
    Returns (mask, bridge locations).
    """
    mask = mask.copy()
    labels, _ = ndimage.label(thin & ~ndimage.binary_dilation(mask, FULL), FULL)
    reach = 10 * 3.0 * ndimage.distance_transform_edt(mask)[mask].mean() + 6
    to_thick = ndimage.distance_transform_edt(~thick) if thick.any() else None
    shape = np.array(mask.shape)
    bridges = []
    for _ in range(4):
        path = trace_centerline(mask)
        grew = False
        for end, inner in ((path[0], path[min(12, len(path) - 1)]), (path[-1], path[max(len(path) - 13, 0)])):
            if to_thick is not None and to_thick[tuple(end.astype(int))] <= 4:
                continue
            heading = end - inner
            heading /= np.linalg.norm(heading) + 1e-9
            candidates = np.argwhere(labels > 0)
            if not len(candidates):
                break
            offset = candidates - end
            dist = np.linalg.norm(offset, axis=1)
            ahead = (dist < reach) & (offset @ heading > 0.5 * dist)
            target = None
            for j in np.flatnonzero(ahead)[np.argsort(dist[ahead])]:
                lab = labels[tuple(candidates[j])]
                if (labels == lab).sum() >= 80:
                    target = candidates[j]
                    break
            if target is None:
                continue
            lo = np.maximum(np.minimum(end, target).astype(int) - 4, 0)
            hi = np.minimum(np.maximum(end, target).astype(int) + 5, shape)
            box = tuple(slice(a, b) for a, b in zip(lo, hi))
            brightness = np.clip((vol[box] - dark_level) / (lumen_level - dark_level), 0, 1)
            mcp = MCP_Geometric(1.0 / (0.05 + brightness) ** 2, fully_connected=True)
            start = tuple(np.round(end).astype(int) - lo)
            goal = tuple(target - lo)
            mcp.find_costs([start], [goal])
            route = np.array(mcp.traceback(goal))
            link = np.zeros(mask[box].shape, bool)
            link[tuple(route.T)] = True
            mask[box] |= ndimage.binary_dilation(link, FULL)
            mask |= labels == lab
            labels[labels == lab] = 0
            bridges.append(route.mean(axis=0) + lo)
            grew = True
        if not grew:
            break
    return mask, bridges


# ---------------------------------------------------------------------------
# Centerline
# ---------------------------------------------------------------------------

def farthest(mask, start):
    costs = np.where(mask, 1.0, -1.0)
    cum, _ = MCP_Geometric(costs, fully_connected=True).find_costs([start])
    cum[~mask | ~np.isfinite(cum)] = -1
    return tuple(int(v) for v in np.unravel_index(np.argmax(cum), cum.shape))


def trace_centerline(mask):
    """Path between the two geodesically farthest points of the mask that
    stays in its middle (cost falls with distance from the wall)."""
    box = ndimage.find_objects(mask.astype(np.uint8))[0]
    offset = np.array([s.start for s in box], float)
    sub = mask[box]
    start = tuple(int(v) for v in np.argwhere(sub)[0])
    a = farthest(sub, start)
    b = farthest(sub, a)
    dt = ndimage.distance_transform_edt(sub)
    costs = np.where(sub, 1.0 / (dt + 0.25) ** 2, -1.0)
    mcp = MCP_Geometric(costs, fully_connected=True)
    mcp.find_costs([a], [b])
    return np.array(mcp.traceback(b), float) + offset


def smooth_resample(path, step=0.5, sigma=4.0):
    """Smooth a voxel-stepped path and resample it at even arc length."""
    sm = ndimage.gaussian_filter1d(path, sigma, axis=0, mode="nearest")
    seg = np.linalg.norm(np.diff(sm, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    s_new = np.arange(0, s[-1], step)
    return np.column_stack([np.interp(s_new, s, sm[:, i]) for i in range(3)])


def estimate_z_ratio(mask, path):
    """Slice spacing relative to pixel size, from the vessel's own shape.

    A coronary lumen is close to circular in cross-section. Where the vessel
    runs in-plane, its extent across slices and its extent across pixels must
    describe the same circle, which fixes the ratio. Vessel portions that run
    straight through the slices carry no information and are ignored.

    Returns the ratio, or None if the vessel never runs in-plane enough to tell.
    """
    coords = np.argwhere(mask).astype(float)  # z, y, x
    _, nearest = cKDTree(path).query(coords)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    r_est = 3.0 * ndimage.distance_transform_edt(mask)[mask].mean()
    window = max(6.0 * r_est, 12.0)

    covs = []
    for s0 in np.arange(0, s[-1] - window, window / 2):
        idx = np.flatnonzero((s >= s0) & (s < s0 + window))
        pts = coords[np.isin(nearest, idx)]
        if len(pts) < 60:
            continue
        tangent = path[idx[-1]] - path[idx[0]]
        tangent /= np.linalg.norm(tangent) + 1e-9
        if abs(tangent[0]) > 0.75:      # mostly through-plane: uninformative
            continue
        covs.append(np.cov(pts.T))
    if len(covs) < 3:
        return None

    ratios = np.exp(np.linspace(np.log(0.25), np.log(4.0), 121))
    cost = np.zeros_like(ratios)
    for i, zr in enumerate(ratios):
        scale = np.diag([zr, 1.0, 1.0])
        for c in covs:
            ev = np.linalg.eigvalsh(scale @ c @ scale)   # ascending
            cost[i] += min(np.log(ev[1] / ev[0]) ** 2, 1.0)
    best = int(np.argmin(cost))
    if best in (0, len(ratios) - 1):
        return None
    return float(ratios[best])


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def frames_along(path):
    """Tangent and a twist-free pair of normals at every centerline point."""
    tangent = np.gradient(path, axis=0)
    tangent = ndimage.gaussian_filter1d(tangent, 3.0, axis=0, mode="nearest")
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    u = np.zeros_like(tangent)
    ref = np.eye(3)[np.argmin(np.abs(tangent[0]))]
    u[0] = np.cross(tangent[0], ref)
    u[0] /= np.linalg.norm(u[0])
    for i in range(1, len(tangent)):
        v = u[i - 1] - tangent[i] * np.dot(u[i - 1], tangent[i])
        u[i] = v / np.linalg.norm(v)
    return tangent, u, np.cross(tangent, u)


def disc_profiles(radii, r, sigma):
    """Radial intensity profile of a unit disc of each radius after a 2D
    Gaussian blur of `sigma` (all in voxels). Shape (len(radii), len(r))."""
    h = 0.25
    n = int(np.ceil((r.max() + 4 * sigma) / h))
    axis = np.arange(-n, n + 1) * h
    rho = np.hypot(*np.meshgrid(axis, axis))
    out = np.empty((len(radii), len(r)))
    for i, radius in enumerate(radii):
        disc = np.clip(0.5 + (radius - rho) / h, 0, 1)
        out[i] = np.interp(r, axis[n:], ndimage.gaussian_filter(disc, sigma / h)[n, n:])
    return out


def fit_discs(profile, weight, background, lumen_level, wall_level, table, shell=True):
    """Least-squares fit of each cross-section's radial profile to two blurred
    concentric discs: lumen (radius a) inside vessel wall (radius b >= a) on a
    uniform background. Returns (a index, b index, residual) per plane."""
    wall = np.maximum(wall_level, background)          # no shell if tissue is not darker
    alpha = (wall - background)[:, None]                # shell amplitude
    beta = (lumen_level - wall)[:, None]                # lumen amplitude over wall
    y = (profile - background[:, None]) * weight
    sy = y @ table.T                                    # (planes, radii)
    gram = np.einsum("nr,ar,br->nab", weight, table, table)
    diag = np.einsum("naa->na", gram)
    if not shell:
        sse = -2 * (lumen_level - background)[:, None] * sy + (lumen_level - background)[:, None] ** 2 * diag
        best = sse.argmin(axis=1)
        return best, best, sse.min(axis=1) + (y * (profile - background[:, None])).sum(axis=1)
    sse = (-2 * beta[:, :, None] * sy[:, :, None] - 2 * alpha[:, :, None] * sy[:, None, :]
           + beta[:, :, None] ** 2 * diag[:, :, None] + alpha[:, :, None] ** 2 * diag[:, None, :]
           + 2 * (alpha * beta)[:, :, None] * gram)
    sse[:, np.tril_indices(len(table), -1)[0], np.tril_indices(len(table), -1)[1]] = np.inf
    flat = sse.reshape(len(sse), -1).argmin(axis=1)
    ia, ib = np.unravel_index(flat, sse.shape[1:])
    return ia, ib, sse.reshape(len(sse), -1).min(axis=1) + (y * (profile - background[:, None])).sum(axis=1)


def measure_profile(vol, path, r_max, lumen_level, dark_level, wall_level, calcium_level, n_rays=32):
    """Lumen diameter (voxels) in the plane perpendicular to the centerline at
    each point, by fitting a blur-aware model to the image.

    Rays are cast outward from the centerline and averaged into one radial
    profile per cross-section. A thin plaque rim around a narrowed lumen is
    often finer than the image can resolve, so no threshold can separate it;
    instead the profile is fitted with two concentric discs blurred by the
    video's own point spread (estimated from the widest, healthiest
    stretches): contrast-filled lumen inside soft-tissue-density wall. Rays
    that hit calcium, or its halo, or that never leave bright contrast (a
    branch origin, the aorta) are left out.

    Returns (lumen diameter, outer vessel diameter, calcified flag per point,
    longitudinal image strip, fit details). Diameters are NaN where they could
    not be measured and 0 where the centerline crosses tissue with no lumen.
    """
    _, u, v = frames_along(path)
    step = 0.5
    r = np.arange(0, r_max + step, step)
    theta = np.linspace(0, 2 * np.pi, n_rays, endpoint=False)
    dirs = np.cos(theta)[None, :, None] * u[:, None, :] + np.sin(theta)[None, :, None] * v[:, None, :]
    pts = path[:, None, None, :] + r[None, None, :, None] * dirs[:, :, None, :]
    p = ndimage.map_coordinates(vol, pts.reshape(-1, 3).T, order=1, mode="nearest")
    p = ndimage.gaussian_filter1d(p.reshape(len(path), n_rays, len(r)), RAY_SMOOTH, axis=0, mode="nearest")
    smooth = ndimage.gaussian_filter1d(p, 1.0, axis=2, mode="nearest")
    span = lumen_level - dark_level

    # Each ray's background: its lowest point before it starts climbing into
    # some other structure.
    floor = np.minimum.accumulate(smooth, axis=2)
    climbing = smooth - floor > 0.1 * span
    i_far = np.where(climbing.any(axis=2), climbing.argmax(axis=2), len(r))
    within = np.arange(len(r))[None, None, :] < i_far[..., None]
    i_bg = np.where(within, smooth, np.inf).argmin(axis=2)
    ray_bg = np.take_along_axis(smooth, i_bg[..., None], axis=2)[..., 0]
    leaves_lumen = ray_bg < lumen_level - 0.3 * span

    calc = smooth > calcium_level
    first_calc = np.where(calc.any(axis=2), calc.argmax(axis=2), 10 * len(r))
    # Calcium blooms: its blurred halo passes through lumen-like intensities,
    # so a ray that meets calcium before reaching background over-reads.
    # Leave such rays out, with their neighbours.
    before_background = first_calc <= i_bg
    bloom = before_background.copy()
    for shift in (-2, -1, 1, 2):
        bloom |= np.roll(before_background, shift, axis=1)
    # Calcium in or just outside the wall (the ray dips through plaque or fat
    # and then climbs into it) marks the cross-section as calcified without
    # disturbing the lumen estimate.
    calcified = (first_calc <= np.minimum(i_far, i_bg + 8) + 4).any(axis=1)
    clean = leaves_lumen & ~bloom
    enough = clean.mean(axis=1) >= 0.4
    if not enough.any():
        raise PipelineError("the lumen could not be measured anywhere along the trace")

    with np.errstate(all="ignore"):
        counts = np.maximum(clean.sum(axis=1), 1)
        profile = (p * clean[..., None]).sum(axis=1) / counts[:, None]
        background = np.nanmedian(np.where(clean, ray_bg, np.nan), axis=1)
        reach = np.nanmedian(np.where(clean, i_bg, np.nan), axis=1)
    background = np.where(np.isfinite(background), background, dark_level)
    reach = np.where(np.isfinite(reach), reach, len(r) - 1)
    weight = (np.arange(len(r))[None, :] <= reach[:, None]).astype(float)

    # Blur: the sigma under which single discs best explain the widest planes.
    radii = np.arange(0, r_max + 0.25, 0.25)
    excess = ((profile - background[:, None]) * weight * r).sum(axis=1)
    healthy = enough & (excess >= np.percentile(excess[enough], 70)) & ~before_background.any(axis=1)
    if not healthy.any():
        healthy = enough
    best = None
    for sigma in (0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2.0, 2.5):
        table = disc_profiles(radii, r, sigma)
        _, _, residual = fit_discs(profile[healthy], weight[healthy], background[healthy],
                                   lumen_level, wall_level, table, shell=False)
        if best is None or residual.sum() < best[0]:
            best = (residual.sum(), sigma, table)
    _, sigma, table = best

    lumen = np.full(len(path), np.nan)
    outer = np.full(len(path), np.nan)
    for start in range(0, len(path), 64):
        sl = slice(start, start + 64)
        ia, ib, _ = fit_discs(profile[sl], weight[sl], background[sl], lumen_level, wall_level, table)
        lumen[sl], outer[sl] = 2 * radii[ia], 2 * radii[ib]
    lumen[~enough] = np.nan
    outer[~enough] = np.nan
    lumen[~enough & (p[:, :, 0].mean(axis=1) < lumen_level - 0.5 * span)] = 0.0

    strip = np.concatenate([smooth[:, n_rays // 2, ::-1], smooth[:, 0, 1:]], axis=1)
    return lumen, outer, calcified, strip, {"blur_sigma_px": sigma}


def fill_gaps(values):
    """Linear interpolation across NaNs (ends take the nearest valid value)."""
    ok = np.isfinite(values)
    if not ok.any():
        raise PipelineError("could not measure the vessel lumen anywhere")
    idx = np.arange(len(values))
    return np.interp(idx, idx[ok], values[ok])


def reference_curve(s, diameter, window):
    """Healthy-vessel diameter along the length: a straight-line taper fitted
    to the upper envelope, so focal narrowings don't pull it down."""
    half = max(1, int(round(window / (s[1] - s[0]) / 2)))
    envelope = ndimage.percentile_filter(diameter, 80, size=2 * half + 1, mode="nearest")
    slope, intercept = np.polyfit(s, envelope, 1)
    return np.maximum(slope * s + intercept, 1e-3)


def stenosis_grade(percent):
    """CAD-RADS stenosis band for a percent diameter stenosis."""
    for limit, grade in ((1, "0"), (25, "1-24"), (50, "25-49"), (70, "50-69"), (100, "70-99")):
        if percent < limit:
            return grade
    return "100"


def find_lesions(s_mm, diameter_mm, reference_mm, calcified, resolution_mm, trim_mm=END_TRIM_MM,
                 min_percent=LESION_MIN_PERCENT, min_length_mm=1.5, merge_mm=2.0):
    """Stretches where the lumen falls at least `min_percent` below reference.

    The first and last `trim_mm` are not examined: the trace starts and ends
    raggedly, so a narrowing there cannot be told from the vessel's end.
    """
    percent = 100 * (1 - diameter_mm / reference_mm)
    flag = (percent >= min_percent) & (s_mm >= trim_mm) & (s_mm <= s_mm[-1] - trim_mm)
    runs, start = [], None
    for i, f in enumerate(flag):
        if f and start is None:
            start = i
        if start is not None and (not f or i == len(flag) - 1):
            end = i if not f else i + 1
            if runs and s_mm[start] - s_mm[runs[-1][1] - 1] < merge_mm:
                runs[-1] = (runs[-1][0], end)
            else:
                runs.append((start, end))
            start = None

    lesions = []
    for a, b in runs:
        if s_mm[b - 1] - s_mm[a] < min_length_mm:
            continue
        worst = a + int(np.argmax(percent[a:b]))
        pct = float(percent[worst])
        # Below the resolving power of the video a lumen cannot be sized. All
        # that can be said is that it is narrower than the smallest lumen the
        # video could show: a lower bound on the stenosis, with no upper one.
        unresolved = bool(diameter_mm[worst] < resolution_mm)
        lesions.append({
            "s_mm": round(float(s_mm[worst]), 1),
            "start_mm": round(float(s_mm[a]), 1),
            "end_mm": round(float(s_mm[b - 1]), 1),
            "length_mm": round(float(s_mm[b - 1] - s_mm[a]), 1),
            "min_diameter_mm": None if unresolved else round(float(diameter_mm[worst]), 2),
            "reference_diameter_mm": round(float(reference_mm[worst]), 2),
            "percent_stenosis": None if unresolved else round(pct),
            "percent_at_least": max(0, round(100 * (1 - resolution_mm / float(reference_mm[worst])))) if unresolved else None,
            "grade": None if unresolved else stenosis_grade(pct),
            "unresolved": unresolved,
            "calcified": bool(np.any(calcified[a:b])),
        })
    return lesions


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def tube_field(shape, path, diameter):
    """A field that is positive inside a tube whose radius follows the
    measured lumen along the centerline; the surface is its zero level.

    The model is built from the measurements rather than from the
    segmentation mask, so what is drawn is what is reported. A lumen too
    narrow to measure is drawn as a thread.
    """
    radius = np.maximum(diameter / 2.0, 0.8)
    off_path = np.ones(shape, bool)
    cells = np.clip(np.round(path).astype(int), 0, np.array(shape) - 1)
    off_path[tuple(cells.T)] = False
    near = np.argwhere(ndimage.distance_transform_edt(off_path) <= radius.max() + 2.5)
    dist, nearest = cKDTree(path).query(near)
    field = np.full(shape, -2.5, np.float32)
    field[tuple(near.T)] = np.maximum(radius[nearest] - dist, -2.5)
    return ndimage.gaussian_filter(field, 0.5)


def mesh_lps(field, origin_zyx, voxel_mm, superior_to_inferior):
    """Zero-level surface of `field` in patient LPS millimetres.

    Axial images are displayed viewed from the feet: image x → patient Left,
    image y → Posterior. Frame order gives Superior/Inferior.
    """
    if field.max() <= 0:
        raise PipelineError("the traced vessel is too thin to build a model from")
    verts, faces, _, _ = measure.marching_cubes(np.pad(field, 2, constant_values=-2.5), 0.0)
    verts = verts - 2 + np.asarray(origin_zyx)
    z, y, x = verts.T * voxel_mm
    lps = np.column_stack([x, y, -z if superior_to_inferior else z]).astype(np.float32)

    tri = lps[faces].astype(np.float64)
    signed = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum()
    if signed < 0:                      # keep normals pointing outward
        faces = faces[:, ::-1]
    return lps, faces


def write_stl(path, verts, faces, note="video2stl ESTIMATED SCALE=ASSUMED"):
    """Binary STL. The header carries the coordinate space CathVision reads,
    and marks the geometry as estimated."""
    tri = verts[faces]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12
    record = np.zeros(len(faces), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])
    record["n"] = normals
    record["v"] = tri
    header = f"CathVision {note} SPACE=LPS".encode("ascii")[:80].ljust(80, b" ")
    with open(path, "wb") as f:
        f.write(header)
        f.write(np.uint32(len(faces)).tobytes())
        f.write(record.tobytes())


def write_qa_image(path, strip, s_mm, diameter_mm, reference_mm, lesions):
    """Straightened vessel with the diameter profile underneath."""
    from PIL import Image, ImageDraw

    n = strip.shape[0]
    scale = max(1, int(round(900 / n)))
    lo, hi = np.percentile(strip, (1, 99.5))
    img = np.clip((strip.T - lo) / (hi - lo + 1e-6), 0, 1)
    img = np.kron(img, np.ones((2, scale)))
    w, mpr_h = img.shape[1], img.shape[0]
    plot_h, pad = 170, 26
    canvas = Image.new("RGB", (w, mpr_h + plot_h + 2 * pad), (10, 10, 16))
    canvas.paste(Image.fromarray((img * 255).astype(np.uint8)).convert("RGB"), (0, pad))
    draw = ImageDraw.Draw(canvas)

    def px(s):
        return float(s) / s_mm[-1] * (w - 1)

    top = mpr_h + pad + 12
    dmax = max(float(reference_mm.max()), float(diameter_mm.max())) * 1.15

    def py(d):
        return top + plot_h - 24 - float(d) / dmax * (plot_h - 24)

    for d in range(1, int(dmax) + 1):
        draw.line([(0, py(d)), (w, py(d))], fill=(38, 38, 52))
        draw.text((4, py(d) - 11), f"{d} mm", fill=(120, 120, 140))
    draw.line([(px(s), py(r)) for s, r in zip(s_mm, reference_mm)], fill=(90, 110, 150), width=1)
    draw.line([(px(s), py(d)) for s, d in zip(s_mm, diameter_mm)], fill=(232, 178, 80), width=2)
    for lesion in lesions:
        x0, x1 = px(lesion["start_mm"]), px(lesion["end_mm"])
        draw.rectangle([x0, pad - 8, x1, pad - 4], fill=(230, 70, 70))
        label = "?" if lesion["unresolved"] else f"{lesion['percent_stenosis']}%"
        depth = 0 if lesion["unresolved"] else lesion["min_diameter_mm"]
        draw.text((px(lesion["s_mm"]) - 12, min(py(depth) + 4, top + plot_h - 40)), label, fill=(240, 100, 100))
    draw.text((6, 4), f"straightened vessel, 0 - {s_mm[-1]:.0f} mm (proximal left)  |  "
                      "estimated geometry, not a diagnosis", fill=(160, 160, 180))
    draw.text((6, top + plot_h - 16), "lumen diameter (gold) vs healthy reference (blue)",
              fill=(160, 160, 180))
    canvas.save(path)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

SEGMENT_THIRDS = {
    "RCA": ("pRCA", "mRCA", "dRCA"),
    "LAD": ("pLAD", "mLAD", "dLAD"),
    "LCx": ("pCx", "pCx", "LCx"),
}


def run(video, ref_diameter_mm=3.0, pixel_mm=None, fov_mm=None, z_ratio=None, seed=None,
        crop=None, frames=None, sweep="auto", reverse=False, vessel=None, log=print,
        _decoded=None, _shrink=None):
    """Run the whole pipeline. Returns findings, mesh and QA data."""
    decoded = read_video(video) if _decoded is None else _decoded
    stack = decoded
    total_frames, frame_h, frame_w = stack.shape

    # Exactly what the caller asked for, before anything below refines it.
    asked = (ref_diameter_mm, pixel_mm, fov_mm, z_ratio, seed, crop, frames, sweep, reverse, vessel, log)

    def finer(shrink):
        """Start again one step finer (the video is not decoded twice)."""
        return run(video, *asked, _decoded=decoded, _shrink=shrink - 1)

    first = 0
    if frames:
        first, last = frames
        if not 0 <= first < last:
            raise PipelineError("--frames needs START < END")
        stack = stack[first:last]
        if len(stack) < 8:
            raise PipelineError("the frame range holds too few frames")
    stack, kept = drop_duplicate_frames(stack)
    kept = kept + first
    if crop:
        x0, y0, w, h = crop
        if min(w, h) < 16 or x0 < 0 or y0 < 0 or x0 + w > frame_w or y0 + h > frame_h:
            raise PipelineError(f"--crop must lie inside the {frame_w}x{frame_h} frame and be at least 16 px each way")
        box = tuple(crop)
    else:
        box = detect_image_box(stack)
    x0, y0, w, h = box
    if len(stack) < 20:
        raise PipelineError("too few distinct slices to build a volume")
    warnings = []
    rotation = video_rotation(video)
    if rotation:
        warnings.append(f"The video carries a {rotation} degree rotation flag, which was ignored: frames were "
                        "analysed as stored. If the picture is normally viewed rotated, left/right and "
                        "front/back in the model are wrong; re-encode the video upright first.")

    # Analyse at a bounded working resolution, whatever size the video is
    # (a pixel or two of slack, so a slightly generous box does not coarsen it).
    shrink = max(1, int(np.ceil((max(w, h) - 8) / WORKING_SIZE))) if _shrink is None else _shrink
    region = stack[:, y0:y0 + h, x0:x0 + w]
    if shrink > 1:
        hh, ww = (h // shrink) * shrink, (w // shrink) * shrink
        vol_raw = region[:, :hh, :ww].reshape(len(region), hh // shrink, shrink, ww // shrink, shrink)
        vol_raw = vol_raw.mean(axis=(2, 4), dtype=np.float32)
    else:
        vol_raw = region.astype(np.float32)
    log(f"volume: {len(stack)} slices of {w}x{h} px ({total_frames} frames in video)"
        + (f", analysed at 1/{shrink} size" if shrink > 1 else ""))
    if fov_mm and not pixel_mm:
        pixel_mm = fov_mm / w
        if not crop:
            warnings.append(f"--fov-mm was applied to the detected image region ({w} px wide). If that is not "
                            "the full CT image, the scale is off; give the region with --crop.")

    vol_seg = ndimage.gaussian_filter(vol_raw, (0.7, 1.0, 1.0))
    bright_level, dark_level, wall_level = intensity_classes(vol_seg)
    bright = vol_seg > bright_level
    dt = ndimage.distance_transform_edt(bright)

    seed_zyx = None
    if seed is not None:
        sx, sy, sf = seed
        if not (x0 <= sx < x0 + w and y0 <= sy < y0 + h and kept[0] <= sf <= kept[-1]):
            raise PipelineError("--seed lies outside the CT image region or the frames in use "
                                f"(image x {x0}-{x0 + w - 1}, y {y0}-{y0 + h - 1}, frames {kept[0]}-{kept[-1]})")
        seed_zyx = (int(np.argmin(np.abs(kept - sf))),
                    min((sy - y0) // shrink, vol_raw.shape[1] - 1), min((sx - x0) // shrink, vol_raw.shape[2] - 1))
    try:
        mask, thick, thin = pick_vessel(bright, dt, seed_zyx)
    except PipelineError:
        if shrink > 1:      # the vessel may simply be too small at this size
            return finer(shrink)
        raise
    core = mask & (dt >= np.percentile(dt[mask], 60))
    mask, bridges = bridge_gaps(mask, thin, thick, vol_seg, float(np.median(vol_seg[core])), dark_level)
    mask = ndimage.binary_fill_holes(mask)
    radius = 3.0 * float(ndimage.distance_transform_edt(mask)[mask].mean())
    if shrink > 1 and radius < MIN_WORKING_RADIUS:
        log(f"vessel is only {2 * radius:.0f} px wide at 1/{shrink} size; repeating at finer resolution")
        return finer(shrink)
    log(f"vessel: {int(mask.sum())} voxels, radius about {radius:.1f} px"
        + (f", reconnected across {len(bridges)} gap(s)" if bridges else ""))

    # Work in a padded box around the vessel from here on. The padding must
    # cover the reach of the measurement rays.
    pad = int(np.ceil(2.5 * max(radius, 2.0) + 8))
    sl = ndimage.find_objects(mask.astype(np.uint8))[0]
    roi = tuple(slice(max(s.start - p, 0), min(s.stop + p, n))
                for s, n, p in zip(sl, mask.shape, (3 * pad, pad, pad)))
    origin = np.array([s.start for s in roi], float)
    # What counts as fat and as soft tissue is judged around the vessel, not
    # over the whole image: a full slice is mostly lung, bone and chest wall.
    try:
        _, dark_level, wall_level = intensity_classes(vol_seg[roi])
    except PipelineError:
        pass
    mask, thick = mask[roi], thick[roi]
    vol_meas = ndimage.gaussian_filter(vol_raw, 0.4)[roi]

    z_source = "user"
    if z_ratio is None:
        z_ratio = estimate_z_ratio(mask, trace_centerline(mask))
        z_source = "estimated from vessel shape"
        if z_ratio is None:
            z_ratio, z_source = 1.0, "assumed"
            warnings.append("Slice spacing could not be estimated (the vessel never runs in-plane); "
                            "1.0 x pixel size was assumed. Lengths along the scan axis are unreliable. "
                            "Pass --z-ratio if you know it.")
    else:
        z_ratio = z_ratio / shrink      # given per video pixel; the working pixel is larger
    log(f"slice spacing / pixel size: {z_ratio * shrink:.2f} ({z_source})")

    # Resample to cubic voxels one working pixel on a side.
    zoom = (z_ratio, 1, 1)
    vol_iso = ndimage.zoom(vol_meas, zoom, order=1)
    mask_iso = ndimage.zoom(mask.astype(np.float32), zoom, order=1) > 0.5
    thick_iso = ndimage.zoom(thick.astype(np.float32), zoom, order=1) > 0.5
    labels, n = ndimage.label(mask_iso, FULL)
    if n > 1:
        mask_iso = labels == 1 + int(np.argmax(np.bincount(labels.ravel())[1:]))
    actual_zoom = np.array(vol_iso.shape) / np.array(vol_meas.shape)

    path = smooth_resample(trace_centerline(mask_iso))
    if len(path) < 40:
        raise PipelineError("vessel centerline is too short to measure")

    r_local = ndimage.map_coordinates(ndimage.distance_transform_edt(mask_iso), path.T, order=1)
    r_max = 2.5 * max(float(np.percentile(r_local, 95)), 2.0) + 4
    lumen_level = float(np.median(ndimage.map_coordinates(vol_iso, path.T, order=1)))
    # Calcium must stand clear of the lumen by more than noise: with the lumen
    # displayed near white there is no room left above it.
    calcium_visible = lumen_level <= 198
    calcium_level = lumen_level + 0.35 * (255.0 - lumen_level) if calcium_visible else 1e9
    if not calcium_visible:
        warnings.append("The lumen is displayed too bright to tell calcium apart from contrast.")
    raw_diameter, _, calcified, strip, fit_info = measure_profile(
        vol_iso, path, r_max, lumen_level, dark_level, wall_level, calcium_level)
    diameter_px = ndimage.gaussian_filter1d(
        ndimage.median_filter(fill_gaps(raw_diameter), PROFILE_MEDIAN, mode="nearest"), PROFILE_SMOOTH)

    # Which end is proximal. The trace is trusted to start at the aorta only
    # on two agreeing pieces of evidence: exactly one end sits on a thick
    # structure, and that end is clearly the wider one. A chamber touching
    # the distal vessel fails the second test; a vessel with no visible taper
    # is simply not decided, and says so.
    sixth = max(len(path) // 6, 4)
    first_d, last_d = float(diameter_px[:sixth].mean()), float(diameter_px[-sixth:].mean())
    flip, proximal_known = last_d > first_d, False
    proximal_source = "the wider end (assumed)"
    if thick_iso.any():
        gap = ndimage.distance_transform_edt(~thick_iso)
        on_thick = [float(ndimage.map_coordinates(gap, p[:, None], order=1)[0]) <= 4.0 for p in (path[0], path[-1])]
        if on_thick[0] != on_thick[1]:
            at_last = on_thick[1]
            wider = (last_d > 1.08 * first_d) if at_last else (first_d > 1.08 * last_d)
            if wider:
                flip, proximal_known = at_last, True
                proximal_source = "the wider end, which arises from a thick structure (taken as the aorta)"
    if reverse:
        flip, proximal_known, proximal_source = not flip, True, "user (--reverse)"
    if flip:
        path, diameter_px, calcified, strip = path[::-1], diameter_px[::-1], calcified[::-1], strip[::-1]
    if not proximal_known:
        warnings.append("The vessel origin was not identified; the wider end was taken as proximal. "
                        "Use --reverse if that is wrong.")

    # Sweep direction: a coronary ostium lies superior to the rest of the vessel.
    if sweep == "auto":
        z_origin, z_rest = path[:sixth, 0].mean(), path[:, 0].mean()
        if proximal_known and abs(z_rest - z_origin) > 2 * radius:
            superior_to_inferior = bool(z_origin < z_rest)
            sweep_source = "inferred (the ostium lies superior to the vessel)"
        else:
            superior_to_inferior, sweep_source = True, "assumed"
            warnings.append("Sweep direction (head-to-feet) was assumed. If it is wrong the model is a "
                            "MIRROR IMAGE of the anatomy, which rotating cannot fix: rerun with --sweep i2s.")
    else:
        superior_to_inferior, sweep_source = sweep == "s2i", "user"

    s_px = np.arange(len(path)) * 0.5
    reference_px = reference_curve(s_px, diameter_px, window=8 * np.median(diameter_px))
    if shrink > 1 and np.median(reference_px) < 2 * MIN_WORKING_RADIUS:
        log(f"vessel is only {np.median(reference_px):.0f} px wide at 1/{shrink} size; repeating at finer resolution")
        return finer(shrink)
    if pixel_mm:
        px_mm, scale_source = float(pixel_mm) * shrink, "user"
    else:
        px_mm = ref_diameter_mm / float(reference_px[: max(4, len(path) // 10)].mean())
        scale_source = "assumed reference diameter"
    s_mm, diameter_mm, reference_mm = s_px * px_mm, diameter_px * px_mm, reference_px * px_mm
    log(f"scale: {px_mm / shrink:.3f} mm per video pixel ({scale_source})")
    if np.median(reference_px) < 5:
        warnings.append(f"The vessel is only about {np.median(reference_px):.0f} pixels wide at the resolution "
                        "analysed. Stenosis estimates at this size are very rough.")

    lesions = find_lesions(s_mm, diameter_mm, reference_mm, calcified, resolution_mm=1.5 * px_mm)
    vessel_source = "user" if vessel else "assumed (default; pass --vessel)"
    vessel = vessel or "RCA"
    thirds = SEGMENT_THIRDS[vessel]
    for lesion in lesions:
        lesion["segment"] = thirds[min(int(lesion["s_mm"] / s_mm[-1] * 3), 2)]
        lesion["bridged_gap"] = False
    for bridge in bridges:
        at = float(s_mm[cKDTree(path).query((bridge - origin) * actual_zoom)[1]])
        for lesion in lesions:
            if lesion["start_mm"] - 3 <= at <= lesion["end_mm"] + 3:
                lesion["bridged_gap"] = True
        warnings.append(f"The trace was reconnected across a gap near {at:.0f} mm, where the lumen was too "
                        "narrow or too faint to follow. Confirm it is the same vessel.")

    # An abrupt stop at full calibre, away from the image border, is suspicious.
    end_voxel = path[-1] / actual_zoom + origin
    at_border = bool(np.any(end_voxel < 3) or np.any(end_voxel > np.array(vol_raw.shape) - 4))
    tail = diameter_px[-max(int(6 / 0.5), 4):-2].mean() / reference_px[-1]
    if not at_border and tail > 0.6:
        warnings.append(f"The trace stops abruptly at {s_mm[-1]:.0f} mm while still {100 * tail:.0f}% of "
                        "reference calibre. Do not read the end of the trace as the end of the vessel: "
                        "an occlusion or a stretch without contrast looks the same.")

    # Calcium: where along the vessel it was seen. An 8-bit video cannot
    # support a volume or a score.
    calcium_sites = []
    if calcium_visible:
        marked, count = ndimage.label(calcified)
        calcium_sites = [round(float(s_mm[np.flatnonzero(marked == i)].mean()), 1) for i in range(1, count + 1)]

    verts, faces = mesh_lps(tube_field(vol_iso.shape, path, diameter_px), origin * actual_zoom,
                            px_mm, superior_to_inferior)

    every = max(1, len(s_mm) // 300)
    findings = {
        "schema": "cathvision.video2stl.findings/v1",
        "disclaimer": DISCLAIMER,
        "source": {"video": os.path.basename(video), "frames": int(total_frames),
                   "frame_range": [int(kept[0]), int(kept[-1])] if frames else None,
                   "slices_used": int(len(stack)),
                   "image_box_xywh": [int(v) for v in box],
                   "image_box_source": "user (--crop)" if crop else "detected",
                   "analysed_at_fraction_of_size": f"1/{shrink}"},
        "assumptions": {
            "scale_source": scale_source,
            "reference_diameter_mm": None if pixel_mm else ref_diameter_mm,
            "mm_per_pixel": round(px_mm / shrink, 4),
            "z_ratio": round(float(z_ratio * shrink), 3),
            "z_ratio_source": z_source,
            "sweep": "superior-to-inferior" if superior_to_inferior else "inferior-to-superior",
            "sweep_source": sweep_source,
            "proximal_end": proximal_source,
            "vessel_selection": "user (--seed)" if seed else "automatic (most tubular bright structure)",
            "vessel_label_source": vessel_source,
            "segment_assignment": "approximate thirds of the traced length; not anatomical landmarks",
            "plaque_model": "non-calcified plaque assumed to have soft-tissue density",
            "image_blur_sigma_px": fit_info["blur_sigma_px"],
            "lesion_threshold_percent": LESION_MIN_PERCENT,
            "ends_not_examined_mm": END_TRIM_MM,
            "model": "tube of the measured lumen diameter along the traced centerline; branches are not shown",
        },
        "warnings": warnings,
        "vessel": vessel,
        "length_mm": round(float(s_mm[-1]), 1),
        "lesions": lesions,
        "calcium": {"distinguishable": calcium_visible, "sites_mm": calcium_sites},
        "profile": {"s_mm": np.round(s_mm[::every], 2).tolist(),
                    "diameter_mm": np.round(diameter_mm[::every], 3).tolist(),
                    "reference_mm": np.round(reference_mm[::every], 3).tolist()},
    }
    qa = {"strip": strip, "s_mm": s_mm, "diameter_mm": diameter_mm, "reference_mm": reference_mm}
    return {"findings": findings, "verts": verts, "faces": faces, "qa": qa,
            "stl_note": f"video2stl ESTIMATED SCALE={'USER' if pixel_mm else 'ASSUMED'}"}


def parse_ints(text, n, name):
    try:
        values = tuple(int(v) for v in text.replace(":", ",").split(","))
    except ValueError:
        values = ()
    if len(values) != n:
        raise argparse.ArgumentTypeError(f"{name} needs {n} integers")
    return values


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("-o", "--stl", help="output STL (default: <video>.stl)")
    ap.add_argument("--findings", help="write findings JSON for the CathVision report panel")
    ap.add_argument("--qa", help="write a straightened-vessel + diameter-profile PNG")
    ap.add_argument("--vessel", choices=sorted(SEGMENT_THIRDS),
                    help="which artery this is; it is not detected (default: labelled RCA, flagged as assumed)")
    scale = ap.add_argument_group("scale (a video has none; pick the best you know)")
    scale.add_argument("--pixel-mm", type=float, help="true pixel size of the CT image, if known")
    scale.add_argument("--fov-mm", type=float,
                       help="true width of the CT image region, if known (best given together with --crop)")
    scale.add_argument("--ref-diameter-mm", type=float, default=3.0,
                       help="otherwise: assumed healthy proximal lumen diameter (default 3.0)")
    scale.add_argument("--z-ratio", type=float,
                       help="slice spacing / video pixel size, if known (default: estimated from the vessel)")
    ap.add_argument("--seed", type=lambda t: parse_ints(t, 3, "--seed"), metavar="X,Y,FRAME",
                    help="a point inside the vessel, in video pixel/frame coordinates (default: auto)")
    ap.add_argument("--crop", type=lambda t: parse_ints(t, 4, "--crop"), metavar="X,Y,W,H",
                    help="CT image region within the frame (default: auto-detected)")
    ap.add_argument("--frames", type=lambda t: parse_ints(t, 2, "--frames"), metavar="START:END",
                    help="use only this frame range")
    ap.add_argument("--sweep", choices=["auto", "s2i", "i2s"], default="auto",
                    help="scroll direction: head-to-feet (s2i) or feet-to-head (i2s). "
                         "A wrong value mirrors the anatomy. Default: inferred from the vessel")
    ap.add_argument("--reverse", action="store_true", help="swap proximal and distal ends")
    args = ap.parse_args(argv)

    try:
        result = run(args.video, args.ref_diameter_mm, args.pixel_mm, args.fov_mm, args.z_ratio,
                     args.seed, args.crop, args.frames, args.sweep, args.reverse, args.vessel)
    except PipelineError as exc:
        print(f"video2stl: {exc}", file=sys.stderr)
        return 1

    stl = args.stl or os.path.splitext(args.video)[0] + ".stl"
    write_stl(stl, result["verts"], result["faces"], result["stl_note"])
    findings = result["findings"]
    print(f"wrote {stl}: {len(result['faces'])} triangles, vessel {findings['length_mm']} mm")
    if args.findings:
        with open(args.findings, "w") as f:
            json.dump(findings, f, indent=1)
        print(f"wrote {args.findings}")
    if args.qa:
        write_qa_image(args.qa, result["qa"]["strip"], result["qa"]["s_mm"],
                       result["qa"]["diameter_mm"], result["qa"]["reference_mm"], findings["lesions"])
        print(f"wrote {args.qa}")
    a = findings["assumptions"]
    print(f"  labelled {findings['vessel']} ({a['vessel_label_source']}); proximal end: {a['proximal_end']}; "
          f"sweep: {a['sweep']} ({a['sweep_source']})")
    for lesion in findings["lesions"]:
        if lesion["unresolved"]:
            print(f"  lesion at {lesion['s_mm']} mm: lumen too narrow for the video to resolve "
                  f"(at least {lesion['percent_at_least']}% narrowed; no upper bound)")
        else:
            print(f"  lesion at {lesion['s_mm']} mm: {lesion['min_diameter_mm']} vs "
                  f"{lesion['reference_diameter_mm']} mm = {lesion['percent_stenosis']}% "
                  f"({lesion['grade']}){', calcified' if lesion['calcified'] else ''}")
    if not findings["lesions"]:
        print(f"  no stenosis >= {LESION_MIN_PERCENT:.0f}% found (the first and last {END_TRIM_MM:.0f} mm are not examined)")
    if findings["calcium"]["sites_mm"]:
        print(f"  calcium seen near {', '.join(f'{v:.0f}' for v in findings['calcium']['sites_mm'])} mm")
    for warning in findings["warnings"]:
        print(f"WARNING: {warning}")
    print(f"NOTE: {DISCLAIMER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
