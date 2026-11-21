#!/usr/bin/env python3
"""Synthetic coronary CTA phantom rendered as an axial-sweep video.

Builds a volume with a known RCA-like vessel (taper, two stenoses, calcium,
a side branch) next to realistic distractors (an aorta it arises from, a
contrast-filled chamber, myocardium, epicardial fat), then writes it out the
way such data reaches social media: one axial slice per frame, 8-bit,
letterboxed, H.264-compressed.

The ground truth is saved alongside, so video2stl.py can be scored against
numbers that are actually known.

    python make_phantom.py out_dir [--crf 26] [--repeat 1] [--seed 7]
"""
import argparse
import json
import os
import subprocess

import numpy as np
from scipy import ndimage
from scipy.interpolate import splev, splprep
from scipy.spatial import cKDTree

# Voxel spacing of the simulated scan (mm). The pipeline is never told these.
PX_MM = 0.4
SLICE_MM = 0.5
NX, NY, NZ = 192, 192, 200

# 8-bit display values for a typical coronary window.
FAT, TISSUE, PLAQUE, LUMEN, CALCIUM = 32, 83, 100, 191, 255

# Vessel course, mm, (x=patient left, y=posterior, z=inferior): leaves the
# aorta rightward/anterior, descends in the AV groove, turns posterior.
CONTROL_POINTS = np.array([
    (44.0, 25.0, 14.0), (36.0, 21.0, 14.5), (28.0, 18.0, 16.0),
    (21.0, 18.0, 21.0), (17.0, 21.0, 30.0), (15.0, 25.0, 44.0),
    (14.5, 29.0, 58.0), (16.0, 34.0, 70.0), (21.0, 41.0, 79.0),
    (30.0, 48.0, 85.0), (41.0, 53.0, 88.0), (52.0, 56.0, 90.0),
])
AORTA_CENTER_XY = (52.0, 30.0)
AORTA_RADIUS = 14.0
AORTA_Z_MAX = 32.0
CHAMBER_CENTER = (42.0, 44.0, 52.0)
CHAMBER_RADII = (13.0, 10.0, 18.0)

# Lesions: position along the vessel measured from the ostium (mm), fractional
# diameter reduction, and half-length (mm) of the cos^2 taper.
LESIONS = [
    {"s_mm": 40.0, "reduction": 0.40, "half_length_mm": 5.0, "calcified": True},
    {"s_mm": 80.0, "reduction": 0.22, "half_length_mm": 4.0, "calcified": False},
]
RADIUS_PROXIMAL = 1.6
RADIUS_DISTAL = 1.3


def dense_centerline(step_mm=0.1):
    tck, _ = splprep(CONTROL_POINTS.T, s=0, k=3)
    u = np.linspace(0, 1, 6000)
    pts = np.array(splev(u, tck)).T
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    s_even = np.arange(0, s[-1], step_mm)
    pts_even = np.column_stack([np.interp(s_even, s, pts[:, i]) for i in range(3)])
    return pts_even, s_even


def build(seed=7, lesions=None, blur_mm=0.3, plaque_level=PLAQUE):
    """Returns (uint8 volume indexed [slice, row, column], ground truth).

    blur_mm is the Gaussian sigma of the simulated scanner; 0.3 mm (0.7 mm
    FWHM) is typical of conventional CT.
    """
    lesions = LESIONS if lesions is None else lesions
    rng = np.random.default_rng(seed)
    pts, s = dense_centerline()

    # Arc length is reported from the ostium: the first centerline point
    # outside the aortic lumen.
    in_aorta = (np.hypot(pts[:, 0] - AORTA_CENTER_XY[0], pts[:, 1] - AORTA_CENTER_XY[1])
                < AORTA_RADIUS) & (pts[:, 2] < AORTA_Z_MAX)
    ostium_idx = int(np.argmax(~in_aorta))
    s_ost = s - s[ostium_idx]
    length_mm = float(s_ost[-1])

    nominal = RADIUS_PROXIMAL + (RADIUS_DISTAL - RADIUS_PROXIMAL) * np.clip(s_ost / length_mm, 0, 1)
    lumen_r = nominal.copy()
    for lesion in lesions:
        w = np.clip(1 - np.abs(s_ost - lesion["s_mm"]) / lesion["half_length_mm"], 0, 1)
        lumen_r *= 1 - lesion["reduction"] * np.sin(0.5 * np.pi * w) ** 2

    zz, yy, xx = np.meshgrid(np.arange(NZ) * SLICE_MM, np.arange(NY) * PX_MM,
                             np.arange(NX) * PX_MM, indexing="ij")
    grid = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])
    dist, idx = cKDTree(pts).query(grid, distance_upper_bound=8.0)
    dist = dist.reshape(xx.shape)
    idx = np.minimum(idx, len(pts) - 1).reshape(xx.shape)

    def coverage(radius_field):
        # Partial-volume fraction of a voxel inside a tube of that radius.
        return np.clip(0.5 + (radius_field - dist) / PX_MM, 0, 1)

    vol = np.full(xx.shape, float(TISSUE))
    fat = np.clip(0.5 + (5.0 - dist) / PX_MM, 0, 1)
    vol = vol * (1 - fat) + FAT * fat
    wall = coverage(nominal[idx])
    vol = vol * (1 - wall) + plaque_level * wall
    lumen = coverage(lumen_r[idx])
    vol = vol * (1 - lumen) + LUMEN * lumen

    # Side branch (acute marginal): thin, leaves the mid vessel anteriorly.
    branch_origin = pts[np.argmin(np.abs(s_ost - 58.0))]
    t = np.linspace(0, 1, 200)[:, None]
    branch_pts = branch_origin + t * np.array([[-2.0, -12.0, 9.0]])
    bdist, _ = cKDTree(branch_pts).query(grid, distance_upper_bound=4.0)
    branch = np.clip(0.5 + (0.75 - bdist.reshape(xx.shape)) / PX_MM, 0, 1)
    vol = vol * (1 - branch) + LUMEN * branch

    # Aorta and a contrast-filled chamber: same brightness as the lumen.
    aorta = (np.hypot(xx - AORTA_CENTER_XY[0], yy - AORTA_CENTER_XY[1]) < AORTA_RADIUS) & (zz < AORTA_Z_MAX)
    vol[aorta] = LUMEN
    cx, cy, cz = CHAMBER_CENTER
    rx, ry, rz = CHAMBER_RADII
    chamber = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 + ((zz - cz) / rz) ** 2 < 1
    vol[chamber] = LUMEN

    # Calcium: nodules in the wall, on the side away from the lumen centre.
    calcium_truth = []
    calcium_sites = [(12.0, 0.9), (40.0, 1.0), (63.0, 0.8), (97.0, 1.1)]
    for s_c, rad in calcium_sites:
        i = int(np.argmin(np.abs(s_ost - s_c)))
        tangent = pts[min(i + 5, len(pts) - 1)] - pts[max(i - 5, 0)]
        tangent /= np.linalg.norm(tangent)
        normal = np.cross(tangent, rng.normal(size=3))
        normal /= np.linalg.norm(normal)
        centre = pts[i] + normal * (nominal[i] + 0.7 * rad)
        d = np.sqrt((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2 + ((zz - centre[2]) / 1.4) ** 2)
        nodule = np.clip(0.5 + (rad - d) / PX_MM, 0, 1)
        vol = vol * (1 - nodule) + CALCIUM * nodule
        calcium_truth.append({"s_mm": s_c, "radius_mm": rad})

    # Scanner blur, then correlated noise.
    vol = ndimage.gaussian_filter(vol, sigma=(blur_mm / SLICE_MM, blur_mm / PX_MM, blur_mm / PX_MM))
    noise = ndimage.gaussian_filter(rng.normal(size=vol.shape), sigma=0.6)
    vol += noise / noise.std() * 9.0
    vol8 = np.clip(np.round(vol), 0, 255).astype(np.uint8)

    truth = {
        "px_mm": PX_MM,
        "slice_mm": SLICE_MM,
        "z_ratio": SLICE_MM / PX_MM,
        "length_mm": length_mm,
        "reference_diameter_mm": 2 * RADIUS_PROXIMAL,
        "lesions": [
            {"s_mm": l["s_mm"], "percent_stenosis": 100 * l["reduction"],
             "length_mm": 2 * l["half_length_mm"], "calcified": l["calcified"]}
            for l in lesions
        ],
        "blur_sigma_mm": blur_mm,
        "plaque_level": plaque_level,
        "calcium": calcium_truth,
        "ostium_mm": pts[ostium_idx].tolist(),
        "distal_end_mm": pts[-1].tolist(),
        "sweep": "superior-to-inferior",
    }
    return vol8, truth


def write_video(vol8, path, crf=26, repeat=1, margin=(24, 40, 32, 32)):
    """Letterbox each slice with a static caption bar, like a screen capture."""
    top, bottom, left, right = margin
    ny, nx = vol8.shape[1:]
    h, w = ny + top + bottom, nx + left + right
    h += h % 2
    w += w % 2
    frames = np.zeros((vol8.shape[0], h, w), np.uint8)
    frames[:, top:top + ny, left:left + nx] = vol8
    frames[:, 6:14, left:left + 90] = 235  # static caption block
    if repeat > 1:
        frames = np.repeat(frames, repeat, axis=0)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray",
           "-s", f"{w}x{h}", "-r", "30", "-i", "-", "-c:v", "libx264",
           "-crf", str(crf), "-pix_fmt", "yuv420p", path]
    subprocess.run(cmd, input=frames.tobytes(), check=True)
    return {"frame_size": [w, h], "image_box": [left, top, nx, ny], "repeat": repeat}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out_dir")
    ap.add_argument("--crf", type=int, default=26, help="H.264 quality (higher = more lossy)")
    ap.add_argument("--repeat", type=int, default=1, help="frames shown per slice")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--blur-mm", type=float, default=0.3, help="scanner blur sigma (default 0.3)")
    ap.add_argument("--stenosis", type=float, help="percent diameter stenosis of the main lesion (default 40)")
    ap.add_argument("--plaque-level", type=float, default=PLAQUE,
                    help=f"grey level of non-calcified plaque (default {PLAQUE}; soft tissue is {TISSUE})")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    lesions = [dict(l) for l in LESIONS]
    if args.stenosis is not None:
        lesions[0]["reduction"] = args.stenosis / 100
    vol8, truth = build(args.seed, lesions, args.blur_mm, args.plaque_level)
    truth["video"] = write_video(vol8, os.path.join(args.out_dir, "phantom.mp4"), args.crf, args.repeat)
    with open(os.path.join(args.out_dir, "phantom_truth.json"), "w") as f:
        json.dump(truth, f, indent=2)
    print(f"phantom: {vol8.shape[0]} slices, vessel {truth['length_mm']:.1f} mm, "
          f"lesions {[l['percent_stenosis'] for l in truth['lesions']]} %")


if __name__ == "__main__":
    main()
