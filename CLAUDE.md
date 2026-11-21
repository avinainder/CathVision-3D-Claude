# CathVision-3D (Coronary Viewer)

## Critical: Coordinate Transforms
- World axis contract (single source of truth, enforced by test/):
  -X = patient Right, +X = Left, +Y = Superior, +Z = Anterior.
  Camera at theta=0 is on the Anterior side (AP view, patient Right on viewer's Left).
- STL files carry EITHER RAS or LPS coordinates. 3D Slicer >= 4.11 exports LPS by
  default and tags the header with `SPACE=LPS` / `SPACE=RAS`; stlParser.js
  auto-detects the tag and applies the matching transform:
  RAS → `(-x, z, y)`, LPS → `(x, z, -y)`. Untagged files are assumed LPS.
- The two transforms differ by 180° about Superior (R↔L and A↔P swap). Picking the
  wrong one shows the mirror image — this caused repeated sign-flip churn in v0.2–v0.5.
  Never hardcode one transform for all files; detect, and offer the Flip R/L toggle.
- DO NOT patch individual coordinate signs downstream. Fix at the source (stlParser.js)
- Run `npm test` after touching stlParser.js or carmAngles.js (round-trip + orientation fixtures)

## Files: DO NOT MODIFY (v0.4 Slicer-aligned, working)
- `src/utils/carmAngles.js` — C-arm angle computation + presets
- `src/engine/controls.js` — mouse/touch drag directions
- `src/components/AngleCompass.jsx` — compass display mapping

## Key Files
- `src/engine/stlParser.js` — coordinate-space detection + transform; returns `mmPerUnit` and the `estimated` flag
- `src/engine/scene.js` — lighting (ambient 1.4 + 4x directional 0.3), background #1a1a2e
- `src/App.jsx` — main app, debug T/P readout at bottom-left
- `src/components/Viewport.jsx` — canvas, render loop, tap detection, sizing
- `src/utils/cadrads.js` — CAD-RADS 2.0 logic (pure; covered by `test/cadrads.test.js`)
- `src/components/ReportPanel.jsx` — coronary map, segment editor, report text
- `src/engine/segmentMarkers.js` — 3D pins for report segments
- `tools/video2stl/` — Python: axial-sweep CT video → STL + findings JSON (see its README)

## Viewport conventions (each of these was a real bug)
- Recognise taps from pointer events, never `click`: controls.js cancels touch events,
  which suppresses `click` on phones. A drag must not count as a tap.
- Size the renderer from the canvas's container with `setSize(w, h, false)`. Measuring the
  canvas itself goes stale, because three writes pixel sizes into its style.
- Models are rescaled to fit the scene. Anything shown in mm must multiply scene distance
  by `engine.mmPerUnit`. STL units are assumed to be millimetres.
- Anything attached to the model (segment pins) is a child of the mesh in mesh-local
  coordinates, so it follows Flip R/L. Labels and measurements are still world-space.
- Push camera angles to React only when the camera moves, not every frame.

## Report panel
- Findings are entered by the reader from the source CCTA. The app classifies and formats;
  it never grades stenosis from the mesh. Keep that line: no "measured" or "detected" wording.
- `tools/video2stl` findings import as suggestions and must not change the classification
  until accepted. Meshes whose STL header says `ESTIMATED` are labelled as such in the UI.
- Reports persist per model in localStorage under a hashed key (file names can identify
  patients; do not store or export them).
- Panel sizes in `global.css` (`.report-panel`) are mirrored by the `REPORT_*` constants in App.jsx.

## C-arm Angle Math
- `presetToSpherical()`: theta = -raoDeg * DEG_TO_RAD, phi = PI/2 - craDeg * DEG_TO_RAD
- 9 presets: AP, RAO30, LAO30, RAO-CAU, RAO-CRA, AP-CRA, LAO-CRA, LAO-CAU, AP-CAU

## Deployment
- GitHub: github.com/avinainder/CathVision-3D-Claude
- Vercel: coronary-viewer.vercel.app (deploys from main branch)
- Deploy from ~/coronary-viewer (NOT the worktree) — worktree creates a separate Vercel project
- Kill old dev servers before starting new ones: multiple node processes on 5173/5174 cause stale builds

## Build
- `npm run dev` — Vite dev server on localhost:5173
- `npx vercel --prod --yes` — deploy to production
- React 18 + Vite + Three.js, no TypeScript

## Tests
- `npm test` — node tests in `test/` (angles round trip, STL orientation, CAD-RADS rules)
- `python -m unittest discover -s tools/video2stl -p "test_*.py"` — pipeline vs. phantoms (~5 min; needs
  ffmpeg and `tools/video2stl/requirements.txt`)
- `node scripts/e2e-report.mjs --stl … --findings …` — drives a running build in Chromium on desktop
  and phone (touch) viewports; needs Playwright. Run it after touching Viewport, App or the report panel.
