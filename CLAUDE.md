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
- `src/engine/stlParser.js` — RAS transform (the critical orientation fix)
- `src/engine/scene.js` — lighting (ambient 1.4 + 4x directional 0.3), background #1a1a2e
- `src/App.jsx` — main app, debug T/P readout at bottom-left

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
