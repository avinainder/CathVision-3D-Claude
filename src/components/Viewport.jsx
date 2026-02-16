import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { createScene, createCamera, createRenderer, createFloorGrid } from '../engine/scene';
import { createCameraController } from '../engine/controls';
import { createLabelManager } from '../engine/labelManager';
import { createMeasureManager } from '../engine/measureManager';
import { computeAngles } from '../utils/carmAngles';

export default function Viewport({
  engineRef,
  onAnglesChange,
  activeTool,
  measureStep,
  onMeasurePoint,
  onLabelClick,
}) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = createScene();
    const camera = createCamera(canvas.clientWidth / canvas.clientHeight);
    const renderer = createRenderer(canvas);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const grid = createFloorGrid();
    scene.add(grid);

    const controller = createCameraController(camera, canvas);
    controller.attach();

    const labelManager = createLabelManager(scene);
    const measureManager = createMeasureManager(scene);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // Store engine refs
    const engine = {
      scene,
      camera,
      renderer,
      controller,
      labelManager,
      measureManager,
      raycaster,
      modelMesh: null,
      modelGroup: null,
    };
    engineRef.current = engine;

    // Render loop
    function animate() {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);

      // Update angles
      const angles = computeAngles(camera.position, controller.state.target);
      onAnglesChange(angles);
    }
    animate();

    // Resize
    function onResize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // Click handler for tools
    function onClick(e) {
      if (!engine.modelMesh && !engine.modelGroup) return;

      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // Collect meshes for raycasting
      const meshes = [];
      if (engine.modelMesh) meshes.push(engine.modelMesh);
      if (engine.modelGroup) {
        engine.modelGroup.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });
      }

      const intersects = raycaster.intersectObjects(meshes, false);
      if (intersects.length === 0) return;

      const point = intersects[0].point;

      if (activeTool === 'label') {
        onLabelClick(point);
      } else if (activeTool === 'measure') {
        onMeasurePoint(point);
      }
    }

    canvas.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      controller.detach();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      renderer.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  // Update click handler when tool changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    function onClick(e) {
      // Ignore if this was a drag (mouse moved significantly)
      if (!engine.modelMesh && !engine.modelGroup) return;
      if (!activeTool) return;

      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      engine.raycaster.setFromCamera(mouse, engine.camera);

      const meshes = [];
      if (engine.modelMesh) meshes.push(engine.modelMesh);
      if (engine.modelGroup) {
        engine.modelGroup.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });
      }

      const intersects = engine.raycaster.intersectObjects(meshes, false);
      if (intersects.length === 0) return;

      const point = intersects[0].point;

      if (activeTool === 'label') {
        onLabelClick(point);
      } else if (activeTool === 'measure') {
        onMeasurePoint(point);
      }
    }

    canvas.addEventListener('click', onClick);
    return () => canvas.removeEventListener('click', onClick);
  }, [activeTool, measureStep, onMeasurePoint, onLabelClick, engineRef]);

  return <canvas ref={canvasRef} className="viewport-canvas" />;
}
