# Coronary 3D Viewer — Project Specification

## Overview
A web application for viewing 3D models of the coronary arterial tree from STL files. Built for interventional cardiologists and cath lab teams to study coronary anatomy and plan procedures by visualizing vessels from different C-arm gantry angles.

The app should work seamlessly on iPad Safari, iPhone, and desktop browsers. No native app — pure web, deployed as a static site.

## Tech Stack
- **Framework**: React 18+ with Vite
- **3D Engine**: Three.js (latest)
- **Styling**: CSS-in-JS or Tailwind — dark theme, medical/clinical aesthetic
- **Deployment**: Static build, deployable to Vercel/Netlify

## Design Direction
- Dark UI (near-black backgrounds like `#08080d`, `#0a0a0f`)
- Frosted glass panels with `backdrop-filter: blur()`
- Monospaced/tabular numbers for angle readouts
- Subtle, non-distracting — the 3D model is the hero
- Color-coded angle displays (blue for LAO, red for RAO, green for cranial, orange for caudal)
- SF Pro / system font stack

---

## Core Features

### 1. STL File Loading
- **File picker button** in the top bar ("Load STL")
- **Drag-and-drop** anywhere on the viewport with a visual overlay
- Parse both **binary and ASCII STL** formats
- Auto-center and auto-scale the model to fit the viewport
- Show file name and triangle count in the header
- On first load, show a **procedurally generated demo coronary tree** (LAD, LCx, RCA, Left Main, Aortic root) so the app isn't empty

### 2. 3D Viewport with Zoom, Pan, Rotate
- **Rotate**: Mouse drag / 1-finger touch
- **Zoom**: Scroll wheel / pinch gesture
- **Pan**: Right-click drag / Shift+drag / 2-finger drag on touch
- Smooth camera movement using spherical coordinates (radius, theta, phi)
- Phong shading with multi-light setup (key light, fill light, rim light, ambient)
- Subtle floor grid for spatial reference

### 3. Real-Time C-Arm Gantry Angles (CRITICAL FEATURE)
As the user rotates the 3D view, display the equivalent C-arm fluoroscopy angles in real-time:

- **RAO / LAO** (Right Anterior Oblique / Left Anterior Oblique)
  - Calculated from the camera's horizontal rotation around the Y axis
  - `atan2(camera.position.x, camera.position.z)` → degrees
  - Positive = LAO, Negative = RAO

- **CRA / CAU** (Cranial / Caudal)
  - Calculated from the camera's elevation angle
  - `asin(camera.position.y / camera.distance)` → degrees
  - Positive = Cranial, Negative = Caudal

**Display as:**
- Two HUD panels in the top-left showing angle name + value + degree symbol
- Large numeric readout (24-26px) with color coding
- Full name subtitle (e.g., "Right Anterior Oblique")
- A small **compass/crosshair visualization** (SVG, ~80x80px) showing the current position as a dot on a RAO-LAO / CRA-CAU grid

### 4. Preset C-Arm Views
Standard angiographic views as clickable buttons along the bottom of the viewport:

| Preset | LAO/RAO | CRA/CAU | Notes |
|--------|---------|---------|-------|
| AP | 0° | 0° | Anteroposterior |
| RAO 30 | RAO 30° | 0° | Right Anterior Oblique |
| LAO 45 | LAO 45° | 0° | Left Anterior Oblique |
| RAO CRA | RAO 30° | CRA 25° | Good for mid-LAD |
| LAO CRA | LAO 45° | CRA 25° | Good for LM bifurcation |
| RAO CAU | RAO 30° | CAU 25° | Hepatoclavicular variant |
| Spider | LAO 45° | CAU 30° | LAO Caudal, for LM/bifurcation |
| Hepatocl. | RAO 25° | CAU 30° | Hepatoclavicular |

- Clicking a preset should **animate smoothly** to that view (ease-in-out, ~600ms)
- Show tooltip with full name on hover

### 5. Vessel Labeling Tool
- Toggle label mode via 🏷️ button in toolbar
- When active, clicking on the model surface places a label anchor point (using raycasting)
- A text input appears to name the label (e.g., "LAD", "D1", "OM1", "RCA", "PDA")
- Labels render as **3D sprites** (canvas-textured) that always face the camera
- Labels float slightly above the surface
- Labels listed in the settings panel with delete buttons
- Toggle label visibility on/off
- The demo coronary tree should come with pre-placed labels (LAD, LCx, RCA, LM, Aorta)

### 6. Measurement Tool
- Toggle measure mode via 📏 button in toolbar
- Click two points on the model surface → shows a line between them with distance
- Distance displayed as a floating label in mm (using the model's original scale)
- Yellow color scheme for measurements (line + endpoint dots + distance label)
- Multiple measurements can coexist
- Clear individual measurements or clear all
- Measurements listed in settings panel

### 7. Display Controls (Settings Panel)
A slide-out panel on the right (toggled via ⚙️ button):

- **Opacity slider**: 0.05 → 1.0 (allows seeing through the vessel)
- **Wireframe toggle**: Solid ↔ wireframe rendering
- **Show Labels toggle**: Show/hide vessel labels
- **Color themes** (grid of options):
  - Arterial Red (#cc3333)
  - Warm Coral (#e8a87c)
  - Angio Blue (#44aadd)
  - Surgical Green (#55cc88)
  - Silver (#cccccc)
  - Gold (#ddaa44)
- Each theme also sets a matching dark background color
- Labels list with delete buttons
- Measurements list with delete buttons
- Controls reference (keyboard/mouse/touch shortcuts)

### 8. Screenshot Export
- 📸 button in toolbar
- Captures the current 3D viewport as PNG
- Auto-names the file with current angles: `coronary_LAO17.2_CRA21.1.png`
- Brief white flash animation for feedback
- Uses `preserveDrawingBuffer: true` on the WebGL renderer

### 9. Additional UI
- **Reset View button** (🎯): Resets camera to default position
- **Status bar** when a tool is active: Shows mode name + instructions + done/cancel buttons
- **Responsive layout**: Works on desktop, iPad (landscape + portrait), and iPhone

---

## Project Structure (Suggested)
```
coronary-viewer/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── Viewport.jsx          # Three.js canvas + interaction handlers
│   │   ├── TopBar.jsx            # Header with tools and file loader
│   │   ├── AngleHUD.jsx          # C-arm angle display panels
│   │   ├── AngleCompass.jsx      # SVG compass visualization
│   │   ├── PresetBar.jsx         # Preset view buttons
│   │   ├── SettingsPanel.jsx     # Slide-out settings
│   │   ├── ToolStatusBar.jsx     # Active tool instructions
│   │   ├── DropOverlay.jsx       # Drag-and-drop overlay
│   │   └── ui/
│   │       ├── Slider.jsx
│   │       └── Toggle.jsx
│   ├── engine/
│   │   ├── scene.js              # Three.js scene setup (lights, grid, camera)
│   │   ├── controls.js           # Mouse/touch orbit, pan, zoom
│   │   ├── stlParser.js          # Binary + ASCII STL parser
│   │   ├── labelManager.js       # 3D sprite labels
│   │   └── measureManager.js     # Measurement lines + distance sprites
│   ├── utils/
│   │   ├── carmAngles.js         # C-arm angle math
│   │   ├── demoTree.js           # Procedural coronary tree generator
│   │   └── screenshot.js         # Screenshot capture
│   └── styles/
│       └── global.css
```

## Key Implementation Notes

### STL Parser
- Check binary vs ASCII by comparing `header (80 bytes) + triangleCount (4 bytes) + triangleCount * 50` against file size
- Binary: read Float32LE for normals and vertices, skip 2-byte attribute count per triangle
- ASCII: parse line by line looking for `facet normal` and `vertex` lines

### Camera Math
- Store camera position in spherical coordinates: `{ radius, theta (azimuth), phi (polar) }`
- Convert to cartesian for Three.js camera position
- Clamp phi to avoid gimbal lock: `0.1 < phi < PI - 0.1`
- Clamp radius: `5 < radius < 80`

### Demo Coronary Tree
- Generate procedurally using tube geometry (cylinder segments along branch paths)
- Recursive branching with decreasing radius and random jitter
- Branches: LAD (left anterior descending), LCx (left circumflex), RCA (right coronary artery)
- Connected by Left Main trunk and Aortic root stubs
- ~8 radial segments per tube cross-section

### Touch Support
- 1-finger: rotate
- 2-finger: pinch zoom + pan simultaneously
- Tap (short press, minimal movement): triggers click for measure/label tools
- Prevent default on all touch events to avoid browser gestures
- Set `touch-action: none` on canvas

### Performance
- `devicePixelRatio` capped at 2
- Antialias enabled
- `depthTest: false` on labels and measurements so they render on top
- Double-sided rendering for STL models (some STLs have inconsistent normals)

---

## Deployment
Build with `vite build`, produces a static `dist/` folder. Deploy to:
- **Vercel**: `npx vercel` from project root
- **Netlify**: drag `dist/` folder to Netlify drop
- **GitHub Pages**: push `dist/` to gh-pages branch

No server-side code needed. Everything runs client-side.
