# video2stl

Turns a video that scrolls through consecutive **axial CT coronary angiography slices** into a 3D
model you can open in CathVision, plus a findings file the report panel can import.

> **Educational use only.** A video has no physical scale and no Hounsfield units, and it has been
> lossily compressed. The output is estimated geometry: a teaching aid, never a measurement or a
> diagnosis. Grade stenosis from the source CCTA, not from this.

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/video2stl/requirements.txt   # needs ffmpeg on PATH
.venv/bin/python tools/video2stl/video2stl.py sweep.mp4 -o rca.stl --findings rca.json --qa rca_qa.png
```

- `rca_qa.png` — the straightened vessel with its diameter profile. **Look at this first:** it shows
  what was actually traced, and whether it is the artery you meant.
- `rca.stl` — drop it into CathVision. The header is tagged `SPACE=LPS`, so it loads in the correct
  orientation, and `ESTIMATED`, so the viewer labels it as video-derived.
- `rca.json` — import it from the report panel (**Report → Import findings or report**). Lesions
  arrive as *unverified suggestions* that you accept or discard one by one.

No sample video is bundled. `make_phantom.py out_dir` writes a synthetic one with known ground truth.

## What it does

1. **Stack** — decodes every frame, drops held (repeated) frames, and finds the CT image inside any
   letterboxing or static captions. It works at a reduced size (about 256 px a side) when the vessel
   is still wide enough there, so an enlarged capture costs nothing extra, and at full size when it
   is not — a full-slice video needs every pixel it has.
2. **Segment** — keeps bright (contrast-filled) structures, removes thick ones (aorta, chambers), and
   picks the long thin one. An image with nothing clearly brighter than soft tissue is refused.
3. **Reconnect** — if a tight stenosis dims the lumen until the trace stops, it looks ahead and
   rejoins the vessel, so the narrowing is measured rather than mistaken for the end of the artery.
4. **Centerline** — the path through the middle of the vessel between its two far ends.
5. **Measure** — in each cross-section, fits the image with two blurred concentric discs (lumen
   inside vessel wall). The blur is estimated from the video itself. This matters because a thin
   plaque rim is usually finer than the video can resolve, and a simple threshold counts part of it
   as lumen.
6. **Report** — percent diameter stenosis against a tapering healthy reference, CAD-RADS stenosis
   band, where calcium was seen, and warnings.
7. **Model** — the STL is a tube of the *measured* lumen diameter along the traced centerline, so
   the model shows exactly what the findings report. Side branches are not drawn.

### Choosing the vessel

Automatic selection picks the most tubular bright structure, which on a real video — ribs, several
arteries, veins, overlay text — may well not be the artery you meant. Pass `--seed x,y,frame`
(a point inside the vessel, in video pixel and frame coordinates) to choose it. Which artery it is
cannot be detected: pass `--vessel RCA|LAD|LCx`, otherwise the findings are labelled RCA and
flagged as an assumption.

## The assumptions, stated plainly

| What | How it is set | If it is wrong |
|---|---|---|
| **Scale (mm per pixel)** | `--pixel-mm` or `--fov-mm` if you know it. Otherwise from `--ref-diameter-mm` (default 3.0): the healthy proximal lumen is *assumed* to be that wide. | Every length and diameter scales with it. Percent stenosis does not. |
| **Slice spacing** | Estimated from the vessel: where it runs in-plane, its cross-section must be round. `--z-ratio` overrides. | Lengths along the scan axis stretch or shrink. |
| **Which end is proximal** | Trusted only on two agreeing signs: exactly one end sits on a thick structure (taken as the aorta) *and* it is clearly the wider end. Otherwise the wider end is used, with a warning. `--reverse` swaps. | Lesion positions are measured from the wrong end. |
| **Sweep direction** | Inferred only when the proximal end was identified: a coronary ostium lies superior to the rest of the vessel. Otherwise head-to-feet is assumed, with a warning. `--sweep s2i\|i2s` overrides. | The model is a **mirror image** of the anatomy. Rotating or Flip R/L cannot repair that — rerun with the other direction. |
| **Plaque density** | Non-calcified plaque is assumed to be as bright as soft tissue. | Denser plaque → stenosis under-read; lipid-rich plaque → over-read. |
| **Segment** | Thirds of the traced length (proximal / mid / distal), not anatomical landmarks. | A lesion can be filed under the neighbouring segment. |

Every assumption actually used is written into the findings file and printed, along with warnings
such as “trace reconnected across a gap” or “trace stops abruptly”.

## How accurate is it?

Measured on the synthetic phantom (3.2 → 2.6 mm tapering vessel arising from an equally bright aorta,
calcium on the lesion, a side branch, 0.7 mm FWHM scanner blur, 0.4 × 0.4 × 0.5 mm voxels, H.264
CRF 26). The pipeline is told only the 3.2 mm reference diameter.

Lesions 10 mm long (tapering in and out; the stated stenosis is the narrowest point):

| True stenosis | Plaque as bright as soft tissue | Plaque denser than soft tissue |
|---:|---:|---:|
| 25 % | 21 % | 22 % |
| 40 % | 35 % | 31 % |
| 50 % | 46 % | 42 % |
| 70 % | 67 % | 55 % |

Shorter lesions, plaque as bright as soft tissue:

| True stenosis | 10 mm long | 5 mm long | 3 mm long |
|---:|---:|---:|---:|
| 50 % | 46 % | 41 % | 35 % |
| 70 % | 67 % | 59 % | 47 % |

Pixel size came out at 0.39–0.40 mm (true 0.40). The slice-spacing ratio came out at 1.15–1.18
(true 1.25) in every run — a consistent under-estimate of about 7 %, which is why the vessel
measures 117 mm against a true 124.

Read those tables as: **it under-reads, always.** By a few points for a long lesion of
soft-tissue-density plaque; by 15 for denser plaque; by 20 or more for a focal lesion a few
millimetres long, which the video simply does not resolve. A reading near a category boundary
(49/50, 69/70) says nothing about which side the truth is on, and a low reading does not exclude a
tight focal stenosis. A phantom is also a best case — round lumens, concentric plaque, uniform
contrast. Real scans add motion, eccentric plaque, stents and neighbouring veins, none of which are
modelled here, and no real video has been tested.

## Known limits

- One vessel per run, no branches.
- The first and last 4 mm of the trace are not examined, so an ostial lesion is missed.
- A lumen under about 1.5 pixels wide cannot be sized. It is reported as “not resolved”, with only a
  lower bound on the narrowing (“at least 40 %”); it may be anything from that to an occlusion. The
  report panel offers to mark such a segment non-diagnostic.
- Calcium is reported as the places it was seen. An 8-bit video cannot support a volume or a score,
  and if the display window clips the lumen to white, calcium cannot be told from contrast at all.
- Heavily calcified stretches are interpolated rather than measured.
- Eccentric lesions are fitted as if concentric.
- Held frames are removed reliably up to about four per slice. A heavily compressed capture that
  holds each slice for five or more frames can keep many duplicates; check `slices_used` in the
  findings against the number of slices you expect, and re-export the video if it is far off.
- A full-slice video (the whole chest, vessel only a few pixels wide) is analysed at full size,
  which is slow and memory-hungry: minutes and several gigabytes for 512 px. `--crop` to the heart
  first if you can.
- A rotation flag in the video file is ignored, with a warning; re-encode the video upright first.

## Tests

```bash
.venv/bin/python -m unittest discover -s tools/video2stl -p "test_*.py"   # about 5 minutes
```

They run the pipeline on phantom videos and check it against ground truth: scale, slice spacing,
length, lesion position and severity, that the model sits one lumen radius from the true centerline
and is not mirrored for either sweep direction, that a severe lesion is bridged and measured, that a
chamber touching the far end is not mistaken for the aorta, that a small vessel in a large slice is
still measured, and that bad input (no contrast, a seed in a chamber or outside the image) is
refused with a message.
