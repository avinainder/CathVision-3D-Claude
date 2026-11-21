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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_phantom  # noqa: E402
import video2stl  # noqa: E402


def make_case(folder, stenosis=40, repeat=1):
    os.makedirs(folder, exist_ok=True)
    lesions = [dict(l) for l in make_phantom.LESIONS]
    lesions[0]["reduction"] = stenosis / 100
    vol8, truth = make_phantom.build(lesions=lesions)
    truth["video"] = make_phantom.write_video(vol8, os.path.join(folder, "phantom.mp4"), repeat=repeat)
    return os.path.join(folder, "phantom.mp4"), truth


def quiet(*_):
    pass


class PhantomPipeline(unittest.TestCase):
    """The default phantom: a 40% lesion 40 mm from the ostium."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.video, cls.truth = make_case(cls.tmp.name)
        cls.result = video2stl.run(cls.video, ref_diameter_mm=cls.truth["reference_diameter_mm"], log=quiet)
        cls.findings = cls.result["findings"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_image_region_is_found_inside_the_letterbox(self):
        x, y, w, h = self.findings["source"]["image_box_xywh"]
        tx, ty, tw, th = self.truth["video"]["image_box"]
        for got, want in ((x, tx), (y, ty), (w, tw), (h, th)):
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

    def test_sweep_direction_inferred_from_ostium(self):
        self.assertEqual(self.findings["assumptions"]["sweep"], "superior-to-inferior")
        self.assertTrue(self.findings["assumptions"]["sweep_source"].startswith("inferred"))

    def test_main_lesion_located_and_graded(self):
        target = self.truth["lesions"][0]
        lesion = min(self.findings["lesions"], key=lambda l: abs(l["s_mm"] - target["s_mm"]))
        self.assertLessEqual(abs(lesion["s_mm"] - target["s_mm"]), 6)
        # Documented behaviour: under-reads, never by more than 15 points here.
        self.assertGreaterEqual(lesion["percent_stenosis"], target["percent_stenosis"] - 15)
        self.assertLessEqual(lesion["percent_stenosis"], target["percent_stenosis"] + 5)
        self.assertEqual(lesion["segment"], "pRCA")
        self.assertFalse(lesion["unresolved"])

    def test_calcium_is_not_read_as_lumen(self):
        # Blooming would show as the lumen exceeding its healthy reference.
        profile = self.findings["profile"]
        ratio = np.array(profile["diameter_mm"]) / np.array(profile["reference_mm"])
        s = np.array(profile["s_mm"])
        inner = (s > 5) & (s < s[-1] - 5)
        self.assertLess(ratio[inner].max(), 1.12)
        self.assertTrue(self.findings["calcium"]["distinguishable"])
        self.assertGreater(self.findings["calcium"]["volume_mm3"], 1)

    def test_mesh_is_in_patient_lps_millimetres(self):
        verts = self.result["verts"]
        ostium = np.array(self.truth["ostium_mm"]) * [1, 1, -1]       # x=L, y=P, z=-inferior
        distal = np.array(self.truth["distal_end_mm"]) * [1, 1, -1]
        # Superior end of the mesh is the ostium, inferior end the distal vessel.
        self.assertAlmostEqual(verts[:, 2].max(), ostium[2], delta=8)
        self.assertAlmostEqual(verts[:, 2].min(), distal[2], delta=8)
        top = verts[verts[:, 2] > verts[:, 2].max() - 3].mean(axis=0)
        bottom = verts[verts[:, 2] < verts[:, 2].min() + 3].mean(axis=0)
        self.assertLess(np.linalg.norm(top[:2] - ostium[:2]), 12)
        self.assertLess(np.linalg.norm(bottom[:2] - distal[:2]), 12)

    def test_mesh_normals_point_outward(self):
        tri = self.result["verts"][self.result["faces"]].astype(np.float64)
        volume = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6
        self.assertGreater(volume, 0)

    def test_stl_file_is_tagged_for_cathvision(self):
        path = os.path.join(self.tmp.name, "out.stl")
        video2stl.write_stl(path, self.result["verts"], self.result["faces"], self.result["stl_note"])
        with open(path, "rb") as f:
            header = f.read(80)
            (count,) = struct.unpack("<I", f.read(4))
        self.assertIn(b"SPACE=LPS", header)
        self.assertIn(b"ESTIMATED", header)
        self.assertFalse(header.startswith(b"solid"))
        self.assertEqual(count, len(self.result["faces"]))
        self.assertEqual(os.path.getsize(path), 84 + 50 * count)

    def test_findings_are_json_and_carry_the_disclaimer(self):
        text = json.dumps(self.findings)
        self.assertIn("not a diagnosis", text)
        self.assertEqual(self.findings["schema"], "cathvision.video2stl.findings/v1")

    def test_known_pixel_size_overrides_the_assumed_scale(self):
        result = video2stl.run(self.video, pixel_mm=self.truth["px_mm"], z_ratio=self.truth["z_ratio"], log=quiet)
        assumptions = result["findings"]["assumptions"]
        self.assertEqual(assumptions["scale_source"], "user")
        self.assertIsNone(assumptions["reference_diameter_mm"])
        self.assertIn("SCALE=USER", result["stl_note"])
        # With the true scale, the healthy proximal diameter comes out right.
        self.assertAlmostEqual(result["findings"]["profile"]["reference_mm"][0],
                               self.truth["reference_diameter_mm"], delta=0.35)


class SevereLesion(unittest.TestCase):
    """A 70% lesion dims the lumen enough to break a threshold-based trace."""

    def test_trace_is_reconnected_and_lesion_reported_as_significant(self):
        with tempfile.TemporaryDirectory() as tmp:
            video, truth = make_case(tmp, stenosis=70)
            findings = video2stl.run(video, ref_diameter_mm=truth["reference_diameter_mm"], log=quiet)["findings"]
        self.assertAlmostEqual(findings["length_mm"], truth["length_mm"], delta=0.12 * truth["length_mm"])
        lesion = min(findings["lesions"], key=lambda l: abs(l["s_mm"] - truth["lesions"][0]["s_mm"]))
        self.assertIn(lesion["grade"], ("50-69", "70-99"))
        self.assertTrue(lesion["bridged_gap"])
        self.assertTrue(any("reconnected" in w for w in findings["warnings"]))


class DuplicatedFrames(unittest.TestCase):
    """A capture that holds every slice for two frames must not stretch the volume."""

    def test_duplicates_are_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            video, truth = make_case(tmp, repeat=2)
            findings = video2stl.run(video, ref_diameter_mm=truth["reference_diameter_mm"], log=quiet)["findings"]
        self.assertEqual(findings["source"]["frames"], 2 * make_phantom.NZ)
        self.assertAlmostEqual(findings["source"]["slices_used"], make_phantom.NZ, delta=3)
        self.assertAlmostEqual(findings["assumptions"]["z_ratio"], truth["z_ratio"], delta=0.15 * truth["z_ratio"])


class Units(unittest.TestCase):
    def test_stenosis_grade_bands(self):
        cases = {0: "0", 0.9: "0", 1: "1-24", 24.9: "1-24", 25: "25-49", 49.9: "25-49",
                 50: "50-69", 69.9: "50-69", 70: "70-99", 99: "70-99", 100: "100"}
        for percent, grade in cases.items():
            self.assertEqual(video2stl.stenosis_grade(percent), grade, percent)

    def test_lumen_below_resolution_is_not_given_a_number(self):
        s = np.arange(0, 60, 0.2)
        reference = np.full_like(s, 3.0)
        diameter = reference.copy()
        diameter[(s > 28) & (s < 32)] = 0.3
        lesions = video2stl.find_lesions(s, diameter, reference, np.zeros(len(s), bool), resolution_mm=0.6)
        self.assertEqual(len(lesions), 1)
        self.assertTrue(lesions[0]["unresolved"])
        self.assertIsNone(lesions[0]["percent_stenosis"])
        self.assertEqual(lesions[0]["grade"], "70-99")

    def test_no_lesion_in_a_smooth_taper(self):
        s = np.arange(0, 80, 0.2)
        reference = 3.2 - 0.008 * s
        lesions = video2stl.find_lesions(s, reference * 0.97, reference, np.zeros(len(s), bool), resolution_mm=0.6)
        self.assertEqual(lesions, [])

    def test_disc_fit_recovers_a_lumen_hidden_inside_unresolved_plaque(self):
        # Lumen radius 2 inside a wall of radius 4, blurred well past the 2-voxel rim.
        r = np.arange(0, 12.5, 0.5)
        radii = np.arange(0, 12.25, 0.25)
        table = video2stl.disc_profiles(radii, r, sigma=1.2)
        lumen, wall, dark = 190.0, 85.0, 30.0
        profile = dark + (wall - dark) * table[16] + (lumen - wall) * table[8]
        ia, ib, _ = video2stl.fit_discs(profile[None], np.ones((1, len(r))), np.array([dark]), lumen, wall, table)
        self.assertAlmostEqual(radii[ia[0]], 2.0, delta=0.25)
        self.assertAlmostEqual(radii[ib[0]], 4.0, delta=0.25)


if __name__ == "__main__":
    unittest.main()
