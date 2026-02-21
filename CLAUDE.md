# CathVision-3D (Coronary Viewer)

## Critical: Coordinate Transforms
- STL files from 3D Slicer use RAS (Right-Anterior-Superior)
- RAS → Three.js mapping: `(rx, rz, -ry)` — NOT `(-rx, rz, ry)`
- DO NOT patch individual coordinate signs downstream. Fix at the source (stlParser.js)
- Use debug readout (theta/phi) to empirically diagnose orientation issues

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
