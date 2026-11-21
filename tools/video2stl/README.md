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

- `rca.stl` — drop it into CathVision. The header is tagged `SPACE=LPS`, so it loads in the correct
  orientation, and `ESTIMATED`, so the viewer labels it as video-derived.
- `rca.json` — import it from the report panel (**Report → Import findings**). Lesions arrive as
  *unverified suggestions* that you accept or discard one by one.
- `rca_qa.png` — the straightened vessel with its diameter profile. Look at this first: it shows what
  was actually traced.

No sample video is bundled. `make_phantom.py out_dir` writes a synthetic one with known ground truth.

## What it does

1. **Stack** — decodes every frame, drops repeated frames, and finds the CT image inside any
   letterboxing or static captions.
2. **Segment** — keeps bright (contrast-filled) structures, removes thick ones (aorta, chambers), and
   picks the long thin one. Pass `--seed x,y,frame` to choose the vessel yourself; on a real video
   with ribs and several vessels in view you will usually want to.
3. **Reconnect** — if a tight stenosis dims the lumen until the trace stops, it looks ahead and
   rejoins the vessel, so the narrowing is measured rather than mistaken for the end of the artery.
4. **Centerline** — the path through the middle of the vessel between its two far ends.
5. **Measure** — in each cross-section, fits the image with two blurred concentric discs (lumen
   inside vessel wall). The blur is estimated from the video itself. This matters because a thin
   plaque rim is usually finer than the video can resolve, and a simple threshold counts part of it
   as lumen.
6. **Report** — percent diameter stenosis against a tapering healthy reference, CAD-RADS stenosis
   band, calcium, and warnings.

## The assumptions, stated plainly

| What | How it is set | If it is wrong |
|---|---|---|
| **Scale (mm per pixel)** | `--pixel-mm` or `--fov-mm` if you know it. Otherwise from `--ref-diameter-mm` (default 3.0): the healthy proximal lumen is *assumed* to be that wide. | Every length and diameter scales with it. Percent stenosis does not. |
| **Slice spacing** | Estimated from the vessel: where it runs in-plane, its cross-section must be round. `--z-ratio` overrides. | Lengths along the scan axis stretch or shrink. |
| **Sweep direction** | Inferred: a coronary ostium lies superior to the rest of the vessel. `--sweep s2i\|i2s` overrides. | The model is a **mirror image** of the anatomy. Rotating or Flip R/L cannot repair that — rerun with the other direction. |
| **Plaque density** | Non-calcified plaque is assumed to be as bright as soft tissue. | Denser plaque → stenosis under-read; lipid-rich plaque → over-read. |
| **Which end is proximal** | The end leaving a thick structure (the aorta), otherwise the wider end. `--reverse` swaps. | Lesion positions are measured from the wrong end. |

Every assumption that was actually used is written into the findings file, along with warnings such
as “trace reconnected across a gap” or “trace stops abruptly”.

## How accurate is it?

Measured on the synthetic phantom (3.2 → 2.6 mm tapering vessel arising from an equally bright aorta,
calcium on the lesion, a side branch, 0.7 mm FWHM scanner blur, 0.4 × 0.4 × 0.5 mm voxels, H.264
CRF 26). The pipeline is told only the 3.2 mm reference diameter.

| True stenosis | Plaque as bright as soft tissue | Plaque denser than soft tissue |
|---:|---:|---:|
| 25 % | 21 % | 22 % |
| 40 % | 35 % | 29 % |
| 50 % | 42 % | 40 % |
| 70 % | 65 % | 55 % |

Pixel size came out at 0.39 mm (true 0.40), slice-spacing ratio 1.18 (true 1.25), length 117 mm
(true 124; the trace starts a few millimetres past the ostium).

Read that table as: **it under-reads, by about 5 points at best and up to 15**, and a reading near a
category boundary (49/50, 69/70) says nothing about which side the truth is on. A phantom is also a
best case — round lumens, concentric plaque, uniform contrast. Real scans add motion, eccentric
plaque, stents and neighbouring veins, none of which are modelled here.

## Known limits

- One vessel per run, no branches. Auto-selection picks the most tubular bright structure, which
  may not be the artery you meant.
- Lumens under about 1.5 pixels wide are reported as “not resolved (severe stenosis or occlusion)”
  rather than given a number.
- If the display window clips the lumen to white, calcium cannot be told from contrast; the findings
  say so.
- Heavily calcified stretches are interpolated rather than measured.
- Eccentric lesions are fitted as if concentric.

## Tests

```bash
.venv/bin/python -m unittest discover -s tools/video2stl -p "test_*.py"   # ~90 s
```
