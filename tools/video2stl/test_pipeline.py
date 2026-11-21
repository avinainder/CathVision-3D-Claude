"""Tests for video2stl against synthetic phantoms with known ground truth.

    python -m unittest discover -s tools/video2stl -p "test_*.py"

These score the pipeline on images it was not tuned to flatter: the phantom's
plaque is denser than its soft tissue (the pipeline assumes they match), the
vessel arises from an equally bright aorta, calcium sits on the lesion, and
the video is lossily compressed. They still cannot stand in for real scans.
"""
import json
import os
import struct
import sys
import tempfile
import unittest

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_phantom  # noqa: E402
import video2stl  # noqa: E402

_VOLUMES = {}


def phantom(stenosis=40):
    """The phantom volume and its ground truth (built once per severity)."""
    if stenosis not in _VOLUMES:
        lesions = [dict(l) for l in make_phantom.LESIONS]
        lesions[0]["reduction"] = stenosis / 100
        _VOLUMES[stenosis] = make_phantom.build(lesions=lesions)
    vol8, truth = _VOLUMES[stenosis]
    return vol8, dict(truth)


def write(folder, vol8, **options):
    path = os.path.join(folder, "phantom.mp4")
    return path, make_phantom.write_video(vol8, path, **options)


def quiet(*_):
    pass


def truth_centerline_lps():
    """The phantom's true centerline and lumen radius, in LPS millimetres."""
    pts, _ = make_phantom.dense_centerline()
    return pts * [1, 1, -1]


def pieces(faces):
    """Number of connected pieces in a triangle mesh."""
    parent = np.arange(faces.max() + 1)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in faces:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[rc] = ra
    return len({find(i) for i in np.unique(faces)})


class PhantomPipeline(unittest.TestCase):
    """The default phantom: a calcified 40% lesion 40 mm from the ostium."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        vol8, cls.truth = phantom()
        cls.video, cls.truth["video"] = write(cls.tmp.name, vol8)
        cls.result = video2stl.run(cls.video, ref_diameter_mm=cls.truth["reference_diameter_mm"], log=quiet)
        cls.findings = cls.result["findings"]
        # The same video with its true scale supplied, for checks of geometry.
        cls.scaled = video2stl.run(cls.video, pixel_mm=cls.truth["px_mm"], z_ratio=cls.truth["z_ratio"], log=quiet)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_image_region_is_found_inside_the_letterbox(self):
        for got, want in zip(self.findings["source"]["image_box_xywh"], self.truth["video"]["image_box"]):
            self.assertLessEqual(abs(got - want), 3)

    def test_scale_recovered_from_reference_diameter(self):
        self.assertAlmostEqual(self.findings["assumptions"]["mm_per_pixel"], self.truth["px_mm"], delta=0.04)

    def test_slice_spacing_estimated_from_vessel_shape(self):
        self.assertEqual(self.findings["assumptions"]["z_ratio_source"], "estimated from vessel shape")
        self.assertAlmostEqual(self.findings["assumptions"]["z_ratio"], self.truth["z_ratio"],
                               delta=0.12 * self.truth["z_ratio"])

    def test_vessel_length(self):
        self.assertAlmostEqual(self.findings["length_mm"], self.truth["length_mm"],
                               delta=0.12 * self.truth["length_mm"])
        # With the true scale, only the few ragged millimetres at each end are missing.
        self.assertAlmostEqual(self.scaled["findings"]["length_mm"], self.truth["length_mm"], delta=6)

    def test_origin_and_sweep_direction_are_inferred_from_the_aorta(self):
        assumptions = self.findings["assumptions"]
        self.assertIn("thick structure", assumptions["proximal_end"])
        self.assertEqual(assumptions["sweep"], "superior-to-inferior")
        self.assertTrue(assumptions["sweep_source"].startswith("inferred"))
        self.assertFalse(any("MIRROR" in w for w in self.findings["warnings"]))

    def test_main_lesion_located_and_graded(self):
        target = self.truth["lesions"][0]
        lesion = min(self.findings["lesions"], key=lambda l: abs(l["s_mm"] - target["s_mm"]))
        self.assertLessEqual(abs(lesion["s_mm"] - target["s_mm"]), 6)
        # Documented behaviour: under-reads, never by more than 15 points here.
        self.assertGreaterEqual(lesion["percent_stenosis"], target["percent_stenosis"] - 15)
        self.assertLessEqual(lesion["percent_stenosis"], target["percent_stenosis"] + 5)
        self.assertEqual(lesion["segment"], "pRCA")
        self.assertFalse(lesion["unresolved"])

    def test_calcium_is_seen_and_not_read_as_lumen(self):
        target = self.truth["lesions"][0]
        lesion = min(self.findings["lesions"], key=lambda l: abs(l["s_mm"] - target["s_mm"]))
        self.assertTrue(lesion["calcified"])
        # Most of the four nodules are located, each near where one was placed.
        sites = self.scaled["findings"]["calcium"]["sites_mm"]
        placed = [c["s_mm"] for c in self.truth["calcium"]]
        self.assertGreaterEqual(len(sites), 3)
        for site in sites:
            self.assertLess(min(abs(site - p) for p in placed), 7, sites)
        # Blooming would show as the lumen bulging past its healthy reference.
        profile = self.findings["profile"]
        ratio = np.array(profile["diameter_mm"]) / np.array(profile["reference_mm"])
        s = np.array(profile["s_mm"])
        self.assertLess(ratio[(s > 5) & (s < s[-1] - 5)].max(), 1.12)

    def test_model_is_the_measured_lumen_in_patient_lps_millimetres(self):
        # Every vertex should sit one lumen radius from the true centerline.
        verts, faces = self.scaled["verts"], self.scaled["faces"]
        distance, _ = cKDTree(truth_centerline_lps()).query(verts)
        self.assertAlmostEqual(float(np.median(distance)), 1.45, delta=0.25)
        self.assertLess(float(np.percentile(distance, 99)), 2.6)
        self.assertEqual(pieces(faces), 1)

    def test_model_normals_point_away_from_the_vessel_axis(self):
        verts, faces = self.scaled["verts"], self.scaled["faces"]
        tri = verts[faces].astype(np.float64)
        centroid = tri.mean(axis=1)
        normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        axis = truth_centerline_lps()
        outward = centroid - axis[cKDTree(axis).query(centroid)[1]]
        self.assertGreater(float((np.einsum("ij,ij->i", normal, outward) > 0).mean()), 0.97)

    def test_stl_file_is_tagged_for_cathvision(self):
        path = os.path.join(self.tmp.name, "out.stl")
        video2stl.write_stl(path, self.result["verts"], self.result["faces"], self.result["stl_note"])
        with open(path, "rb") as f:
            header = f.read(80)
            (count,) = struct.unpack("<I", f.read(4))
        self.assertIn(b"SPACE=LPS", header)
        self.assertIn(b"ESTIMATED", header)
        self.assertIn(b"SCALE=ASSUMED", header)
        self.assertFalse(header.startswith(b"solid"))
        self.assertEqual(count, len(self.result["faces"]))
        self.assertEqual(os.path.getsize(path), 84 + 50 * count)

    def test_findings_record_what_was_assumed(self):
        text = json.dumps(self.findings)
        self.assertIn("not a diagnosis", text)
        self.assertEqual(self.findings["schema"], "cathvision.video2stl.findings/v1")
        assumptions = self.findings["assumptions"]
        self.assertTrue(assumptions["vessel_label_source"].startswith("assumed"))
        self.assertTrue(assumptions["vessel_selection"].startswith("automatic"))
        for key in ("proximal_end", "segment_assignment", "lesion_threshold_percent", "ends_not_examined_mm", "model"):
            self.assertIn(key, assumptions)

    def test_known_pixel_size_overrides_the_assumed_scale(self):
        assumptions = self.scaled["findings"]["assumptions"]
        self.assertEqual(assumptions["scale_source"], "user")
        self.assertIsNone(assumptions["reference_diameter_mm"])
        self.assertIn("SCALE=USER", self.scaled["stl_note"])
        self.assertAlmostEqual(self.scaled["findings"]["profile"]["reference_mm"][0],
                               self.truth["reference_diameter_mm"], delta=0.35)

    def test_seed_selects_the_vessel_and_bad_seeds_are_refused(self):
        left, top = self.truth["video"]["image_box"][:2]
        # Mid vessel at (15, 25, 44) mm is voxel (37, 62) on slice 88.
        seeded = video2stl.run(self.video, seed=(left + 37, top + 62, 88),
                               ref_diameter_mm=self.truth["reference_diameter_mm"], log=quiet)["findings"]
        self.assertTrue(seeded["assumptions"]["vessel_selection"].startswith("user"))
        self.assertAlmostEqual(seeded["length_mm"], self.findings["length_mm"], delta=3)
        with self.assertRaisesRegex(video2stl.PipelineError, "outside"):
            video2stl.run(self.video, seed=(5, 5, 100), log=quiet)          # in the letterbox
        with self.assertRaisesRegex(video2stl.PipelineError, "too thick"):
            video2stl.run(self.video, seed=(left + 105, top + 110, 104), log=quiet)   # inside the chamber

    def test_a_sweep_that_misses_the_aorta_does_not_claim_to_know_its_direction(self):
        # Without the aorta in view nothing says which end is the origin, so
        # the direction must be reported as assumed and the mirror risk stated.
        findings = video2stl.run(self.video, frames=(70, 200), ref_diameter_mm=3.0, log=quiet)["findings"]
        self.assertEqual(findings["assumptions"]["sweep_source"], "assumed")
        self.assertIn("assumed", findings["assumptions"]["proximal_end"])
        self.assertTrue(any("MIRROR" in w for w in findings["warnings"]))


class ReversedSweep(unittest.TestCase):
    """The same scan scrolled feet-to-head must give the same, unmirrored model."""

    def test_direction_is_inferred_and_the_model_is_not_mirrored(self):
        vol8, truth = phantom()
        with tempfile.TemporaryDirectory() as tmp:
            video, _ = write(tmp, vol8[::-1])
            result = video2stl.run(video, pixel_mm=truth["px_mm"], z_ratio=truth["z_ratio"], log=quiet)
        self.assertEqual(result["findings"]["assumptions"]["sweep"], "inferior-to-superior")
        # Frame 0 is now the most inferior slice, so shift before comparing.
        verts = result["verts"] - [0, 0, (make_phantom.NZ - 1) * make_phantom.SLICE_MM]
        distance, _ = cKDTree(truth_centerline_lps()).query(verts)
        self.assertAlmostEqual(float(np.median(distance)), 1.45, delta=0.3)


class SevereLesion(unittest.TestCase):
    """A 70% lesion dims the lumen enough to break a threshold-based trace."""

    def test_trace_is_reconnected_and_the_lesion_measured(self):
        vol8, truth = phantom(70)
        with tempfile.TemporaryDirectory() as tmp:
            video, _ = write(tmp, vol8)
            result = video2stl.run(video, ref_diameter_mm=truth["reference_diameter_mm"], log=quiet)
        findings = result["findings"]
        self.assertAlmostEqual(findings["length_mm"], truth["length_mm"], delta=0.12 * truth["length_mm"])
        lesion = min(findings["lesions"], key=lambda l: abs(l["s_mm"] - truth["lesions"][0]["s_mm"]))
        self.assertFalse(lesion["unresolved"])
        self.assertGreaterEqual(lesion["percent_stenosis"], 50)
        self.assertLessEqual(lesion["percent_stenosis"], 75)
        self.assertTrue(lesion["bridged_gap"])
        self.assertTrue(any("reconnected" in w for w in findings["warnings"]))
        # The model narrows there but stays in one piece, as the report says.
        self.assertEqual(pieces(result["faces"]), 1)


class VideoVariants(unittest.TestCase):
    def test_held_frames_are_dropped(self):
        # A capture that holds each slice for three frames must not stretch the volume.
        vol8, truth = phantom()
        with tempfile.TemporaryDirectory() as tmp:
            video, _ = write(tmp, vol8, repeat=3, crf=30)
            findings = video2stl.run(video, ref_diameter_mm=truth["reference_diameter_mm"], log=quiet)["findings"]
        self.assertEqual(findings["source"]["frames"], 3 * make_phantom.NZ)
        # A few held frames at keyframe boundaries flicker enough to survive (under 4%).
        self.assertAlmostEqual(findings["source"]["slices_used"], make_phantom.NZ, delta=8)
        self.assertAlmostEqual(findings["assumptions"]["z_ratio"], truth["z_ratio"], delta=0.15 * truth["z_ratio"])

    def test_a_larger_video_of_the_same_scan_gives_the_same_answer(self):
        vol8, truth = phantom()
        big = np.repeat(np.repeat(vol8, 2, axis=1), 2, axis=2)       # 384 px: analysed at half size
        with tempfile.TemporaryDirectory() as tmp:
            video, _ = write(tmp, big)
            findings = video2stl.run(video, ref_diameter_mm=truth["reference_diameter_mm"], log=quiet)["findings"]
        self.assertEqual(findings["source"]["analysed_at_fraction_of_size"], "1/2")
        self.assertAlmostEqual(findings["assumptions"]["mm_per_pixel"], truth["px_mm"] / 2, delta=0.02)
        self.assertAlmostEqual(findings["length_mm"], truth["length_mm"], delta=0.12 * truth["length_mm"])
        lesion = min(findings["lesions"], key=lambda l: abs(l["s_mm"] - truth["lesions"][0]["s_mm"]))
        self.assertGreaterEqual(lesion["percent_stenosis"], 25)
        self.assertLessEqual(lesion["percent_stenosis"], 45)

    def test_an_image_with_no_contrast_is_refused(self):
        rng = np.random.default_rng(1)
        noise = np.clip(rng.normal(90, 9, (60, 96, 96)), 0, 255).astype(np.uint8)
        with tempfile.TemporaryDirectory() as tmp:
            video, _ = write(tmp, noise)
            with self.assertRaisesRegex(video2stl.PipelineError, "no contrast-filled"):
                video2stl.run(video, log=quiet)


class Units(unittest.TestCase):
    def test_stenosis_grade_bands(self):
        cases = {0: "0", 0.9: "0", 1: "1-24", 24.9: "1-24", 25: "25-49", 49.9: "25-49",
                 50: "50-69", 69.9: "50-69", 70: "70-99", 99: "70-99", 100: "100"}
        for percent, grade in cases.items():
            self.assertEqual(video2stl.stenosis_grade(percent), grade, percent)

    def test_a_lumen_below_resolution_gets_a_lower_bound_not_a_grade(self):
        s = np.arange(0, 60, 0.2)
        reference = np.full_like(s, 3.0)
        diameter = reference.copy()
        diameter[(s > 28) & (s < 32)] = 0.3
        lesions = video2stl.find_lesions(s, diameter, reference, np.zeros(len(s), bool), resolution_mm=0.6)
        self.assertEqual(len(lesions), 1)
        self.assertTrue(lesions[0]["unresolved"])
        self.assertIsNone(lesions[0]["percent_stenosis"])
        self.assertIsNone(lesions[0]["grade"])
        self.assertEqual(lesions[0]["percent_at_least"], 80)

    def test_a_small_vessel_is_not_called_severe_just_for_being_small(self):
        # A 45% narrowing of a vessel only 2.5 pixels wide falls below the
        # resolution floor; the honest statement is "at least 40%".
        s = np.arange(0, 60, 0.2)
        reference = np.full_like(s, 2.5)
        diameter = reference.copy()
        diameter[(s > 28) & (s < 32)] = 1.4
        (lesion,) = video2stl.find_lesions(s, diameter, reference, np.zeros(len(s), bool), resolution_mm=1.5)
        self.assertTrue(lesion["unresolved"])
        self.assertIsNone(lesion["grade"])
        self.assertEqual(lesion["percent_at_least"], 40)

    def test_no_lesion_in_a_smooth_taper(self):
        s = np.arange(0, 80, 0.2)
        reference = 3.2 - 0.008 * s
        lesions = video2stl.find_lesions(s, reference * 0.97, reference, np.zeros(len(s), bool), resolution_mm=0.6)
        self.assertEqual(lesions, [])

    def test_ends_of_the_trace_are_not_examined(self):
        s = np.arange(0, 60, 0.2)
        reference = np.full_like(s, 3.0)
        diameter = reference.copy()
        diameter[s < 3] = 1.2
        self.assertEqual(video2stl.find_lesions(s, diameter, reference, np.zeros(len(s), bool), resolution_mm=0.6), [])

    def test_disc_fit_recovers_a_lumen_hidden_inside_unresolved_plaque(self):
        # Lumen radius 2 inside a wall of radius 4, blurred well past the
        # 2-voxel rim, with noise, fitted with a table for a different blur.
        r = np.arange(0, 12.5, 0.5)
        radii = np.arange(0, 12.25, 0.25)
        lumen, wall, dark = 190.0, 85.0, 30.0
        truth = video2stl.disc_profiles(radii, r, sigma=1.2)
        rng = np.random.default_rng(3)
        profile = dark + (wall - dark) * truth[16] + (lumen - wall) * truth[8] + rng.normal(0, 2.0, len(r))
        table = video2stl.disc_profiles(radii, r, sigma=1.1)
        ia, ib, _ = video2stl.fit_discs(profile[None], np.ones((1, len(r))), np.array([dark]), lumen, wall, table)
        self.assertAlmostEqual(radii[ia[0]], 2.0, delta=0.5)
        self.assertAlmostEqual(radii[ib[0]], 4.0, delta=0.5)

    def test_duplicate_detection_keeps_everything_when_nothing_repeats(self):
        rng = np.random.default_rng(0)
        frames = rng.integers(0, 255, (40, 32, 32)).astype(np.uint8)
        kept, index = video2stl.drop_duplicate_frames(frames)
        self.assertEqual(len(kept), 40)
        doubled = np.repeat(frames, 2, axis=0)
        kept, index = video2stl.drop_duplicate_frames(doubled)
        self.assertEqual(len(kept), 40)
        self.assertEqual(list(index[:3]), [0, 2, 4])


if __name__ == "__main__":
    unittest.main()
