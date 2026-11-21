import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import Viewport from './components/Viewport';
import TopBar from './components/TopBar';
import AngleHUD from './components/AngleHUD';
import AngleCompass from './components/AngleCompass';
import PresetBar from './components/PresetBar';
import SettingsPanel from './components/SettingsPanel';
import ReportPanel from './components/ReportPanel';
import ToolStatusBar from './components/ToolStatusBar';
import DropOverlay from './components/DropOverlay';
import { parseSTL, centerAndScale } from './engine/stlParser';
import { isolateLargestComponent } from './engine/meshFilter';
import { presetToSpherical } from './utils/carmAngles';
import { captureScreenshot } from './utils/screenshot';
import {
  emptyReport,
  findingColor,
  findingFor,
  isEmptyReport,
  isReport,
  sanitizeReport,
  SEGMENTS,
  segmentUnderDominance,
  suggestionsFromVideoFindings,
  withDominance,
} from './utils/cadrads';

const DEFAULT_COLOR = '#cc3333';

// Space the docked report panel takes from the 3D view. These mirror the
// .report-panel rules in global.css.
const NARROW_SCREEN_PX = 760;
const REPORT_PANEL_WIDTH_PX = 372;
const REPORT_SHEET_FRACTION = 0.46;
const FLY_MS = 600;

// Reports are kept per model in this browser only. The key is a hash of the
// file's contents: two different models never share a report however they
// are named, and no file name (which may identify a patient) is stored.
function reportStorageKey(buffer) {
  const bytes = new Uint8Array(buffer);
  const stride = Math.max(1, Math.floor(bytes.length / 200000));
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < bytes.length; i += stride) {
    a = Math.imul(a ^ bytes[i], 16777619);
    b = (Math.imul(b, 33) + bytes[i]) | 0;
  }
  return `cathvision.report.v2:${bytes.length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

function loadStoredReport(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeReport(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const engineRef = useRef(null);
  const [angles, setAngles] = useState(null);
  const [debugSpherical, setDebugSpherical] = useState({ theta: 0, phi: Math.PI / 2 });
  const [fileName, setFileName] = useState(null);
  const [triCount, setTriCount] = useState(null);
  const [activeTool, setActiveTool] = useState(null);
  const [measureStep, setMeasureStep] = useState(0);
  const [measureP1, setMeasureP1] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opacity, setOpacity] = useState(1.0);
  const [wireframe, setWireframe] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [activeColor, setActiveColor] = useState(DEFAULT_COLOR);
  const [labels, setLabels] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [dropping, setDropping] = useState(false);
  const [flash, setFlash] = useState(false);
  const [labelInput, setLabelInput] = useState(null); // { point, screenPos }
  const [isolating, setIsolating] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [stlSpace, setStlSpace] = useState(null); // 'LPS' | 'RAS' | null (no tag, assumed LPS)
  const [flipRL, setFlipRL] = useState(false);
  const [estimated, setEstimated] = useState(false); // model reconstructed from a video
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState(emptyReport);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [pinningSegment, setPinningSegment] = useState(null);
  const [reportNotes, setReportNotes] = useState([]);
  const [screen, setScreen] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const originalGeometryRef = useRef(null);
  const reportKeyRef = useRef(null);
  const reportRef = useRef(report);
  const targetTweenRef = useRef(null);
  reportRef.current = report;

  useEffect(() => {
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const inset = useMemo(() => {
    if (!reportOpen) return null;
    return screen.w <= NARROW_SCREEN_PX
      ? { bottom: Math.round(screen.h * REPORT_SHEET_FRACTION) }
      : { right: REPORT_PANEL_WIDTH_PX };
  }, [reportOpen, screen]);

  const handleAngles = useCallback((a) => {
    setAngles(a);
    if (engineRef.current?.controller) {
      setDebugSpherical(engineRef.current.controller.getSpherical());
    }
  }, []);

  // Load STL file
  const loadSTLFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const engine = engineRef.current;
      if (!engine) return;

      // Remove existing model
      cancelAnimationFrame(targetTweenRef.current);
      engine.segmentMarkers.detach();
      if (engine.modelMesh) {
        engine.scene.remove(engine.modelMesh);
        engine.modelMesh.geometry.dispose();
        engine.modelMesh.material.dispose();
        engine.modelMesh = null;
      }
      if (engine.modelGroup) {
        engine.scene.remove(engine.modelGroup);
        engine.modelGroup = null;
      }

      // Clear labels, measurements, and isolation state
      engine.labelManager.dispose();
      engine.measureManager.dispose();
      setLabels([]);
      setMeasurements([]);
      setIsolated(false);
      originalGeometryRef.current = null;

      // Parse STL — anatomical space is read from the Slicer header tag
      // (SPACE=LPS / SPACE=RAS); untagged files are assumed LPS.
      const parsed = parseSTL(e.target.result);
      const { geometry, triCount: tc, space } = parsed;
      const { mmPerUnit } = centerAndScale(geometry, 15, space || 'LPS');
      engine.mmPerUnit = mmPerUnit;
      engine.estimated = parsed.estimated;
      setStlSpace(space);
      setEstimated(parsed.estimated);
      setFlipRL(false);

      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(activeColor),
        side: THREE.DoubleSide,
        shininess: 60,
        transparent: true,
        opacity: opacity,
        wireframe: wireframe,
      });

      const mesh = new THREE.Mesh(geometry, material);
      engine.scene.add(mesh);
      engine.modelMesh = mesh;
      engine.segmentMarkers.attach(mesh);
      setFileName(file.name);
      setTriCount(tc);

      // The report belongs to the model: restore the one saved for it.
      // Findings typed in before any model was loaded carry over to a model
      // that has no saved report. If both exist, only the reader can say
      // which to keep, since keeping one discards the other.
      const key = reportStorageKey(e.target.result);
      const stored = loadStoredReport(key);
      const hasStored = !!stored && !isEmptyReport(stored);
      const typed = !reportKeyRef.current && !isEmptyReport(reportRef.current) ? reportRef.current : null;
      const keepTyped = typed && (!hasStored || !window.confirm(
        'This model already has a saved report.\n\n'
        + 'OK: open the saved report and discard the findings you just entered.\n'
        + 'Cancel: keep the findings you just entered and replace the saved report.'
      ));
      const notes = [];
      let next = emptyReport();
      if (keepTyped) {
        // Pins can only come from this model's own saved report.
        next = withDominance({ ...typed, pins: stored?.pins || {} }, typed.dominance);
        if (hasStored) notes.push('The findings you entered before loading were kept; they replace this model\'s saved report.');
      } else if (hasStored) {
        next = stored;
        notes.push('Restored the report saved for this model in this browser.');
      }
      reportKeyRef.current = key;
      setReport(next);
      setSelectedSegment(null);
      setPinningSegment(null);
      setReportNotes(notes);
      setActiveTool(null);

      // Reset camera
      const ctrl = engine.controller;
      ctrl.resetTarget();
      ctrl.animateTo(0, Math.PI / 2, 30);
    };
    reader.readAsArrayBuffer(file);
  }, [activeColor, opacity, wireframe]);

  // Keep the report saved for this model.
  useEffect(() => {
    if (!reportKeyRef.current) return;
    try {
      if (isEmptyReport(report)) localStorage.removeItem(reportKeyRef.current);
      else localStorage.setItem(reportKeyRef.current, JSON.stringify(report));
    } catch {
      // Storage can be unavailable (private browsing) or full; the report
      // then simply lasts for this session.
    }
  }, [report]);

  // Keep the 3D markers in step with the pins and the grades behind them.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.modelMesh) return;
    engine.segmentMarkers.sync(
      Object.entries(report.pins).map(([id, pin]) => ({
        id,
        local: pin.local,
        color: findingColor(findingFor(report, id)),
        text: SEGMENTS.find((s) => s.id === id)?.short || id,
        selected: id === selectedSegment,
      }))
    );
  }, [report, selectedSegment, fileName, triCount]);

  // Manual R/L flip — fallback for files with a missing or wrong header tag.
  // 180° about the Superior (Y) axis swaps Right↔Left and Anterior↔Posterior,
  // exactly the LPS↔RAS ambiguity.
  const handleFlipRLChange = useCallback((val) => {
    setFlipRL(val);
    const engine = engineRef.current;
    if (engine?.modelMesh) engine.modelMesh.rotation.y = val ? Math.PI : 0;
  }, []);

  // Isolate largest connected component
  const handleIsolate = useCallback(() => {
    const engine = engineRef.current;
    if (!engine?.modelMesh || isolating) return;

    // Store original geometry for undo
    originalGeometryRef.current = engine.modelMesh.geometry;
    setIsolating(true);

    // Run in next tick so the UI updates with the spinner
    setTimeout(() => {
      try {
        const { geometry, stats } = isolateLargestComponent(engine.modelMesh.geometry);

        // Swap geometry on the mesh (don't dispose original — we keep it for undo)
        engine.modelMesh.geometry = geometry;
        setTriCount(stats.kept);
        setIsolated(true);

        console.log(
          `Isolate: ${stats.components} components found. ` +
          `Kept ${stats.kept.toLocaleString()} tris (largest), ` +
          `removed ${stats.removed.toLocaleString()} tris.`
        );
      } catch (err) {
        console.error('Isolation failed:', err);
        originalGeometryRef.current = null;
      }
      setIsolating(false);
    }, 0);
  }, [isolating]);

  // Undo isolation — restore original geometry
  const handleUndoIsolate = useCallback(() => {
    const engine = engineRef.current;
    if (!engine?.modelMesh || !originalGeometryRef.current) return;

    // Dispose the filtered geometry, restore original
    const filteredGeometry = engine.modelMesh.geometry;
    engine.modelMesh.geometry = originalGeometryRef.current;
    filteredGeometry.dispose();

    const origTriCount = originalGeometryRef.current.getAttribute('position').array.length / 9;
    setTriCount(origTriCount);
    setIsolated(false);
    originalGeometryRef.current = null;
  }, []);

  // Apply material settings to model
  const applyMaterialSettings = useCallback((color, op, wf) => {
    const engine = engineRef.current;
    if (!engine) return;

    const applyToMesh = (mesh) => {
      if (!mesh?.material) return;
      mesh.material.color.set(color);
      mesh.material.opacity = op;
      mesh.material.wireframe = wf;
      mesh.material.transparent = op < 1;
    };

    if (engine.modelMesh) {
      applyToMesh(engine.modelMesh);
    }
    if (engine.modelGroup) {
      engine.modelGroup.traverse((child) => {
        if (child.isMesh) applyToMesh(child);
      });
    }
  }, []);

  // Opacity change
  const handleOpacityChange = useCallback((val) => {
    setOpacity(val);
    applyMaterialSettings(activeColor, val, wireframe);
  }, [activeColor, wireframe, applyMaterialSettings]);

  // Wireframe change
  const handleWireframeChange = useCallback((val) => {
    setWireframe(val);
    applyMaterialSettings(activeColor, opacity, val);
  }, [activeColor, opacity, applyMaterialSettings]);

  // Show labels change
  const handleShowLabelsChange = useCallback((val) => {
    setShowLabels(val);
    const engine = engineRef.current;
    if (engine) {
      engine.labelManager.setVisible(val);
      engine.segmentMarkers.setVisible(val);
    }
  }, []);

  // Color change
  const handleColorChange = useCallback((color, bg) => {
    setActiveColor(color);
    applyMaterialSettings(color, opacity, wireframe);
    const engine = engineRef.current;
    if (engine) engine.scene.background = new THREE.Color(bg);
  }, [opacity, wireframe, applyMaterialSettings]);

  // Animate the camera to a view. `target`, if given, is where to look.
  const flyTo = useCallback(({ theta, phi, radius, target }) => {
    const engine = engineRef.current;
    if (!engine) return;
    const ctrl = engine.controller;
    // The controller takes the short way round only when both angles lie
    // within one turn of each other.
    const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
    ctrl.state.theta = wrap(ctrl.state.theta);
    theta = wrap(theta);
    if (target) {
      cancelAnimationFrame(targetTweenRef.current);
      const from = ctrl.state.target.clone();
      const to = new THREE.Vector3().fromArray(target);
      const started = performance.now();
      const step = (now) => {
        const t = Math.min((now - started) / FLY_MS, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        ctrl.state.target.lerpVectors(from, to, ease);
        ctrl.updateCamera();
        if (t < 1) targetTweenRef.current = requestAnimationFrame(step);
      };
      targetTweenRef.current = requestAnimationFrame(step);
    }
    ctrl.animateTo(theta, phi, radius ?? ctrl.state.radius, FLY_MS);
  }, []);

  // Preset select
  const handlePresetSelect = useCallback((preset) => {
    flyTo(presetToSpherical(preset.rao, preset.cra));
  }, [flyTo]);

  // Screenshot
  const handleScreenshot = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !angles) return;
    // Force render before capture
    engine.renderer.render(engine.scene, engine.camera);
    captureScreenshot(engine.renderer, angles);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  }, [angles]);

  // Reset view
  const handleResetView = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    cancelAnimationFrame(targetTweenRef.current);
    engine.controller.resetTarget();
    engine.controller.animateTo(0, Math.PI / 3, 30);
  }, []);

  // Tool toggles
  const handleToggleLabels = useCallback(() => {
    setActiveTool((prev) => (prev === 'label' ? null : 'label'));
    setMeasureStep(0);
    setMeasureP1(null);
    setPinningSegment(null);
  }, []);

  const handleToggleMeasure = useCallback(() => {
    setActiveTool((prev) => (prev === 'measure' ? null : 'measure'));
    setMeasureStep(0);
    setMeasureP1(null);
    setPinningSegment(null);
  }, []);

  const handleToolDone = useCallback(() => {
    setActiveTool(null);
    setMeasureStep(0);
    setMeasureP1(null);
    setLabelInput(null);
    setPinningSegment(null);
  }, []);

  // Label click
  const handleLabelClick = useCallback((point) => {
    const engine = engineRef.current;
    if (!engine) return;

    // Project point to screen for input positioning
    const projected = point.clone().project(engine.camera);
    const canvas = engine.renderer.domElement;
    const x = (projected.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * canvas.clientHeight;

    setLabelInput({ point: point.clone(), screenPos: { x, y } });
  }, []);

  const handleLabelSubmit = useCallback((text) => {
    if (!text || !labelInput) return;
    const engine = engineRef.current;
    if (!engine) return;

    engine.labelManager.addLabel(text, labelInput.point);
    setLabels(engine.labelManager.getLabels());
    setLabelInput(null);
  }, [labelInput]);

  // Measure click
  const handleMeasurePoint = useCallback((point) => {
    if (measureStep === 0) {
      setMeasureP1(point.clone());
      setMeasureStep(1);
    } else {
      const engine = engineRef.current;
      if (!engine || !measureP1) return;
      engine.measureManager.addMeasurement(measureP1, point.clone(), engine.mmPerUnit, engine.estimated);
      setMeasurements(engine.measureManager.getMeasurements());
      setMeasureStep(0);
      setMeasureP1(null);
    }
  }, [measureStep, measureP1]);

  // Delete label
  const handleDeleteLabel = useCallback((id) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.labelManager.removeLabel(id);
    setLabels(engine.labelManager.getLabels());
  }, []);

  // Delete measurement
  const handleDeleteMeasurement = useCallback((id) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.measureManager.removeMeasurement(id);
    setMeasurements(engine.measureManager.getMeasurements());
  }, []);

  // Clear all measurements
  const handleClearMeasurements = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.measureManager.clearAll();
    setMeasurements([]);
  }, []);

  // --- Report panel -------------------------------------------------------

  const handleToggleReport = useCallback(() => {
    setReportOpen((open) => !open);
    setSettingsOpen(false);
    setPinningSegment(null);
    setActiveTool((tool) => (tool === 'pin' ? null : tool));
  }, []);

  const handleStartPin = useCallback((segmentId) => {
    setPinningSegment(segmentId);
    setActiveTool('pin');
    setMeasureStep(0);
    setMeasureP1(null);
  }, []);

  const handleCancelPin = useCallback(() => {
    setPinningSegment(null);
    setActiveTool((tool) => (tool === 'pin' ? null : tool));
  }, []);

  // Pin a segment where the model was tapped, remembering the current view.
  const handlePinPoint = useCallback((point) => {
    const engine = engineRef.current;
    if (!engine?.modelMesh || !pinningSegment) return;
    const { theta, phi, radius } = engine.controller.getSpherical();
    const pin = {
      local: engine.modelMesh.worldToLocal(point.clone()).toArray(),
      view: { theta, phi, radius, target: engine.controller.state.target.toArray() },
      flipped: flipRL,
    };
    setReport((r) => ({ ...r, pins: { ...r.pins, [pinningSegment]: pin } }));
    setPinningSegment(null);
    setActiveTool(null);
  }, [pinningSegment, flipRL]);

  const handleRemovePin = useCallback((segmentId) => {
    setReport((r) => {
      const pins = { ...r.pins };
      delete pins[segmentId];
      return { ...r, pins };
    });
  }, []);

  // A typical working projection for the segment, centred on its pin if it has one.
  const handleFlyToView = useCallback((segmentId, view) => {
    const engine = engineRef.current;
    if (!engine?.modelMesh) return;
    const pin = reportRef.current.pins[segmentId];
    const target = pin
      ? engine.modelMesh.localToWorld(new THREE.Vector3().fromArray(pin.local)).toArray()
      : undefined;
    flyTo({ ...presetToSpherical(view.rao, view.cra), target });
  }, [flyTo]);

  // Back to exactly the view the segment was pinned from. If the model has
  // been flipped since, the saved view turns with it.
  const handleFlyToPin = useCallback((segmentId) => {
    const pin = reportRef.current.pins[segmentId];
    if (!pin) return;
    const turned = pin.flipped !== flipRL;
    const [x, y, z] = pin.view.target;
    flyTo({
      theta: pin.view.theta + (turned ? Math.PI : 0),
      phi: pin.view.phi,
      radius: pin.view.radius,
      target: turned ? [-x, y, -z] : [x, y, z],
    });
  }, [flyTo, flipRL]);

  const handleSelectSegment = useCallback((segmentId) => {
    setSelectedSegment(segmentId);
    setPinningSegment(null);
    setActiveTool((tool) => (tool === 'pin' ? null : tool));
  }, []);

  const handleMarkerTap = useCallback((segmentId) => {
    setSelectedSegment(segmentId);
    setReportOpen(true);
    setSettingsOpen(false);
  }, []);

  // Import a report exported from the panel, or findings from tools/video2stl.
  const handleImportFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch {
        setReportNotes(['That file could not be read as JSON.']);
        return;
      }
      if (data?.schema === 'cathvision.video2stl.findings/v1') {
        let suggestions;
        let warnings;
        try {
          ({ suggestions, warnings } = suggestionsFromVideoFindings(data));
        } catch {
          setReportNotes(['That video2stl findings file is damaged and could not be imported.']);
          return;
        }
        // File each suggestion under the name its segment has in this report's dominance.
        const dominance = reportRef.current.dominance;
        const ids = Object.keys(suggestions).map((id) => segmentUnderDominance(id, dominance));
        setReport((r) => {
          const segments = { ...r.segments };
          for (const [id, suggestion] of Object.entries(suggestions)) {
            const target = segmentUnderDominance(id, r.dominance);
            segments[target] = { ...findingFor(r, target), suggestion };
          }
          return { ...r, segments };
        });
        if (ids.length) setSelectedSegment(ids[0]);
        setReportNotes([
          ids.length
            ? `Imported ${ids.length} video estimate${ids.length > 1 ? 's' : ''} as suggestions. Nothing is graded until you accept it.`
            : 'The video findings contain no stenosis to suggest.',
          ...warnings.map((w) => `Video trace: ${w}`),
        ]);
      } else if (isReport(data)) {
        // Pins belong to the model on screen, not to the imported findings.
        setReport((r) => {
          const imported = sanitizeReport(data);
          return withDominance({ ...imported, pins: r.pins }, imported.dominance);
        });
        setReportNotes(['Report imported.']);
      } else {
        setReportNotes(['That file is neither a CathVision report nor a video2stl findings file.']);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleClearReport = useCallback(() => {
    if (!window.confirm('Clear all findings and pins for this model?')) return;
    setReport(emptyReport());
    setSelectedSegment(null);
    setReportNotes([]);
  }, []);

  // Drag and drop
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDropping(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDropping(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDropping(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.stl')) {
      loadSTLFile(file);
    }
  }, [loadSTLFile]);

  const pinningName = pinningSegment ? SEGMENTS.find((s) => s.id === pinningSegment)?.name : null;

  return (
    <div
      className={`app ${reportOpen ? 'app--report' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Viewport
        engineRef={engineRef}
        onAnglesChange={handleAngles}
        activeTool={activeTool}
        onMeasurePoint={handleMeasurePoint}
        onLabelClick={handleLabelClick}
        onPinPoint={handlePinPoint}
        onMarkerTap={handleMarkerTap}
        inset={inset}
      />

      <TopBar
        fileName={fileName}
        triCount={triCount}
        activeTool={activeTool}
        onLoadSTL={loadSTLFile}
        onIsolate={handleIsolate}
        isolating={isolating}
        isolated={isolated}
        onUndoIsolate={handleUndoIsolate}
        onToggleLabels={handleToggleLabels}
        onToggleMeasure={handleToggleMeasure}
        onScreenshot={handleScreenshot}
        onResetView={handleResetView}
        reportOpen={reportOpen}
        onToggleReport={handleToggleReport}
        onToggleSettings={() => setSettingsOpen(!settingsOpen)}
      />

      <AngleHUD angles={angles} />
      <AngleCompass angles={angles} />
      {estimated && (
        <div className="estimate-badge glass-panel" role="note">
          Estimated from video · not for measurement
        </div>
      )}
      {/* Debug: raw spherical coords */}
      <div className="debug-readout">
        T={debugSpherical.theta.toFixed(4)} P={debugSpherical.phi.toFixed(4)}
        {fileName && ` | ${stlSpace ? `SPACE=${stlSpace}` : 'no SPACE tag (LPS assumed)'}${flipRL ? ' | R/L flipped' : ''}`}
      </div>
      <PresetBar onSelect={handlePresetSelect} />

      <ToolStatusBar
        tool={activeTool}
        measureStep={measureStep}
        pinningName={pinningName}
        onDone={handleToolDone}
        onCancel={handleToolDone}
      />

      <ReportPanel
        open={reportOpen}
        onClose={handleToggleReport}
        report={report}
        onChange={setReport}
        selected={selectedSegment}
        onSelect={handleSelectSegment}
        hasModel={!!fileName}
        estimated={estimated}
        notes={reportNotes}
        pinningSegment={pinningSegment}
        onStartPin={handleStartPin}
        onCancelPin={handleCancelPin}
        onRemovePin={handleRemovePin}
        onFlyToView={handleFlyToView}
        onFlyToPin={handleFlyToPin}
        onImportFile={handleImportFile}
        onClear={handleClearReport}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        opacity={opacity}
        onOpacityChange={handleOpacityChange}
        wireframe={wireframe}
        onWireframeChange={handleWireframeChange}
        showLabels={showLabels}
        onShowLabelsChange={handleShowLabelsChange}
        stlSpace={stlSpace}
        hasModel={!!fileName}
        flipRL={flipRL}
        onFlipRLChange={handleFlipRLChange}
        activeColor={activeColor}
        onColorChange={handleColorChange}
        labels={labels}
        onDeleteLabel={handleDeleteLabel}
        measurements={measurements}
        onDeleteMeasurement={handleDeleteMeasurement}
        onClearMeasurements={handleClearMeasurements}
      />

      <DropOverlay visible={dropping} />

      {flash && <div className="screenshot-flash" />}

      {labelInput && (
        <div
          className="label-input-overlay"
          style={{ left: labelInput.screenPos.x, top: labelInput.screenPos.y }}
        >
          <input
            autoFocus
            placeholder="Label name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLabelSubmit(e.target.value);
              if (e.key === 'Escape') setLabelInput(null);
            }}
            onBlur={(e) => {
              if (e.target.value) handleLabelSubmit(e.target.value);
              else setLabelInput(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
