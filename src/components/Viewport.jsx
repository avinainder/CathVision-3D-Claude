import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createScene, createCamera, createRenderer, createFloorGrid } from '../engine/scene';
import { createCameraController } from '../engine/controls';
import { createLabelManager } from '../engine/labelManager';
import { createMeasureManager } from '../engine/measureManager';
import { createSegmentMarkers } from '../engine/segmentMarkers';
import { computeAngles } from '../utils/carmAngles';

const TAP_MAX_MOVE_PX = 8;
const TAP_MAX_MS = 600;
// How close a tap must land to a segment marker to pick it. Markers are only
// a few pixels wide on a phone, so they are picked by distance on screen.
const MARKER_REACH_PX = { touch: 24, mouse: 12 };

/**
 * The 3D canvas.
 *
 * `inset` is the part of the canvas covered by a docked panel ({ right,
 * bottom } in CSS pixels); the view is shifted so the model stays centred in
 * what remains visible.
 */
export default function Viewport({
  engineRef,
  onAnglesChange,
  activeTool,
  onMeasurePoint,
  onLabelClick,
  onPinPoint,
  onMarkerTap,
  inset,
}) {
  const canvasRef = useRef(null);
  // The listeners below are attached once; they read the latest props here.
  const props = useRef({});
  props.current = { onAnglesChange, activeTool, onMeasurePoint, onLabelClick, onPinPoint, onMarkerTap, inset };

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas.parentElement;

    const scene = createScene();
    const camera = createCamera(host.clientWidth / Math.max(host.clientHeight, 1));
    const renderer = createRenderer(canvas);
    scene.add(createFloorGrid());

    const controller = createCameraController(camera, canvas);
    controller.attach();

    const engine = {
      scene,
      camera,
      renderer,
      controller,
      labelManager: createLabelManager(scene),
      measureManager: createMeasureManager(scene),
      segmentMarkers: createSegmentMarkers(),
      raycaster: new THREE.Raycaster(),
      modelMesh: null,
      modelGroup: null,
      mmPerUnit: 1,
      estimated: false,
    };

    // Size from the container, never from the canvas: three writes pixel
    // sizes onto the canvas style, after which the canvas would report its
    // own stale size forever.
    function applySize() {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      const { right = 0, bottom = 0 } = props.current.inset || {};
      // The view is framed by its height. When a panel takes height away, or
      // leaves a strip narrower than the picture, shrink it to fit what is left.
      camera.zoom = Math.min(1, (h - bottom) / h, right ? (w - right) / Math.min(w, h) : 1);
      if (right || bottom) {
        camera.setViewOffset(w, h, right / 2, bottom / 2, w, h);
      } else {
        camera.clearViewOffset();
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    }
    engine.applySize = applySize;
    engineRef.current = engine;
    applySize();
    const resizeObserver = new ResizeObserver(applySize);
    resizeObserver.observe(host);

    let frame;
    let lastPose = '';
    function animate() {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
      // Report angles only when the camera actually moved, so the React tree
      // is not re-rendered sixty times a second while nothing changes.
      const p = camera.position;
      const t = controller.state.target;
      const pose = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}`;
      if (pose !== lastPose) {
        lastPose = pose;
        props.current.onAnglesChange(computeAngles(p, t));
      }
    }
    animate();

    // Taps. The orbit controls cancel touch events, which also suppresses
    // the browser's `click`, so taps are recognised from pointer events: one
    // pointer, down and up in nearly the same place, briefly.
    const pointer = new THREE.Vector2();
    const active = new Set();
    let press = null;

    const projected = new THREE.Vector3();
    function markerNear(clientX, clientY, rect, reach) {
      let best = null;
      for (const object of engine.segmentMarkers.objects()) {
        object.getWorldPosition(projected).project(camera);
        if (projected.z > 1) continue; // behind the camera
        const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
        const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
        const distance = Math.hypot(x - clientX, y - clientY);
        if (distance <= reach && (!best || distance < best.distance)) best = { object, distance };
      }
      return best?.object;
    }

    function handleTap(clientX, clientY, pointerType) {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      engine.raycaster.setFromCamera(pointer, camera);
      // Objects added since the last rendered frame have no world transform yet.
      scene.updateMatrixWorld();
      const { activeTool: tool, onMarkerTap: markerTap, ...on } = props.current;

      if (!tool) {
        const reach = pointerType === 'mouse' ? MARKER_REACH_PX.mouse : MARKER_REACH_PX.touch;
        const marker = markerNear(clientX, clientY, rect, reach);
        if (marker) markerTap?.(marker.userData.segmentId);
        return;
      }

      const meshes = [];
      if (engine.modelMesh) meshes.push(engine.modelMesh);
      if (engine.modelGroup) {
        engine.modelGroup.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });
      }
      const hit = engine.raycaster.intersectObjects(meshes, false)[0];
      if (!hit) return;
      if (tool === 'label') on.onLabelClick?.(hit.point);
      else if (tool === 'measure') on.onMeasurePoint?.(hit.point);
      else if (tool === 'pin') on.onPinPoint?.(hit.point);
    }

    function onPointerDown(e) {
      active.add(e.pointerId);
      const primary = e.pointerType !== 'mouse' || e.button === 0;
      press = active.size === 1 && primary && !e.shiftKey
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() }
        : null;
    }

    function onPointerUp(e) {
      if (!active.delete(e.pointerId)) return;
      const start = press;
      press = null;
      if (!start || start.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved <= TAP_MAX_MOVE_PX && performance.now() - start.at <= TAP_MAX_MS) {
        handleTap(e.clientX, e.clientY, e.pointerType);
      }
    }

    function onPointerCancel(e) {
      active.delete(e.pointerId);
      press = null;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      resizeObserver.disconnect();
      controller.detach();
      cancelAnimationFrame(frame);
      renderer.dispose();
    };
  }, [engineRef]);

  useEffect(() => {
    engineRef.current?.applySize?.();
  }, [engineRef, inset?.right, inset?.bottom]);

  return <canvas ref={canvasRef} className="viewport-canvas" />;
}
