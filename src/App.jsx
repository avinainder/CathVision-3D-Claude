import { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import Viewport from './components/Viewport';
import TopBar from './components/TopBar';
import AngleHUD from './components/AngleHUD';
import AngleCompass from './components/AngleCompass';
import PresetBar from './components/PresetBar';
import SettingsPanel from './components/SettingsPanel';
import ToolStatusBar from './components/ToolStatusBar';
import DropOverlay from './components/DropOverlay';
import { parseSTL, centerAndScale } from './engine/stlParser';
import { presetToSpherical } from './utils/carmAngles';
import { captureScreenshot } from './utils/screenshot';

const DEFAULT_COLOR = '#cc3333';
const DEFAULT_BG = '#08080d';

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

  // No demo tree — app starts empty, user loads STL

  // Load STL file
  const loadSTLFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const engine = engineRef.current;
      if (!engine) return;

      // Remove existing model
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

      // Clear labels and measurements
      engine.labelManager.dispose();
      engine.measureManager.dispose();
      setLabels([]);
      setMeasurements([]);

      // Parse STL
      const { geometry, triCount: tc } = parseSTL(e.target.result);
      centerAndScale(geometry);

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
      setFileName(file.name);
      setTriCount(tc);

      // Reset camera
      const ctrl = engine.controller;
      ctrl.resetTarget();
      ctrl.animateTo(0, Math.PI / 2, 30);
    };
    reader.readAsArrayBuffer(file);
  }, [activeColor, opacity, wireframe]);

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
    if (engine) engine.labelManager.setVisible(val);
  }, []);

  // Color change
  const handleColorChange = useCallback((color, bg) => {
    setActiveColor(color);
    applyMaterialSettings(color, opacity, wireframe);
    const engine = engineRef.current;
    if (engine) engine.scene.background = new THREE.Color(bg);
  }, [opacity, wireframe, applyMaterialSettings]);

  // Preset select
  const handlePresetSelect = useCallback((preset) => {
    const engine = engineRef.current;
    if (!engine) return;
    const { theta, phi } = presetToSpherical(preset.rao, preset.cra);
    engine.controller.animateTo(theta, phi, engine.controller.state.radius);
  }, []);

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
    engine.controller.resetTarget();
    engine.controller.animateTo(0, Math.PI / 3, 30);
  }, []);

  // Tool toggles
  const handleToggleLabels = useCallback(() => {
    setActiveTool((prev) => (prev === 'label' ? null : 'label'));
    setMeasureStep(0);
    setMeasureP1(null);
  }, []);

  const handleToggleMeasure = useCallback(() => {
    setActiveTool((prev) => (prev === 'measure' ? null : 'measure'));
    setMeasureStep(0);
    setMeasureP1(null);
  }, []);

  const handleToolDone = useCallback(() => {
    setActiveTool(null);
    setMeasureStep(0);
    setMeasureP1(null);
    setLabelInput(null);
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
      engine.measureManager.addMeasurement(measureP1, point.clone());
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

  return (
    <div
      className="app"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Viewport
        engineRef={engineRef}
        onAnglesChange={(a) => {
          setAngles(a);
          if (engineRef.current?.controller) {
            setDebugSpherical(engineRef.current.controller.getSpherical());
          }
        }}
        activeTool={activeTool}
        measureStep={measureStep}
        onMeasurePoint={handleMeasurePoint}
        onLabelClick={handleLabelClick}
      />

      <TopBar
        fileName={fileName}
        triCount={triCount}
        activeTool={activeTool}
        onLoadSTL={loadSTLFile}
        onToggleLabels={handleToggleLabels}
        onToggleMeasure={handleToggleMeasure}
        onScreenshot={handleScreenshot}
        onResetView={handleResetView}
        onToggleSettings={() => setSettingsOpen(!settingsOpen)}
      />

      <AngleHUD angles={angles} />
      <AngleCompass angles={angles} />
      {/* Debug: raw spherical coords */}
      <div style={{
        position: 'fixed', bottom: 60, left: 12,
        background: 'rgba(0,0,0,0.7)', color: '#0f0',
        fontFamily: 'monospace', fontSize: 11, padding: '6px 10px',
        borderRadius: 6, zIndex: 999,
      }}>
        T={debugSpherical.theta.toFixed(4)} P={debugSpherical.phi.toFixed(4)}
      </div>
      <PresetBar onSelect={handlePresetSelect} />

      <ToolStatusBar
        tool={activeTool}
        measureStep={measureStep}
        onDone={handleToolDone}
        onCancel={handleToolDone}
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
