import * as THREE from 'three';

const MIN_RADIUS = 5;
const MAX_RADIUS = 80;
const PHI_MIN = 0.1;
const PHI_MAX = Math.PI - 0.1;

export function createCameraController(camera, domElement) {
  const state = {
    radius: 30,
    theta: 0,        // azimuth (horizontal angle)
    phi: Math.PI / 3, // polar (vertical angle)
    target: new THREE.Vector3(0, 0, 0),
    isDragging: false,
    isPanning: false,
    lastMouse: { x: 0, y: 0 },
    // Touch state
    touchStartTime: 0,
    touchStartPos: { x: 0, y: 0 },
    lastTouchDist: 0,
    lastTouchCenter: { x: 0, y: 0 },
    touchCount: 0,
  };

  function updateCamera() {
    const x = state.radius * Math.sin(state.phi) * Math.sin(state.theta);
    const y = state.radius * Math.cos(state.phi);
    const z = state.radius * Math.sin(state.phi) * Math.cos(state.theta);
    camera.position.set(
      state.target.x + x,
      state.target.y + y,
      state.target.z + z
    );
    camera.lookAt(state.target);
  }

  // Animate to target spherical coords
  let animFrame = null;
  function animateTo(targetTheta, targetPhi, targetRadius, duration = 600) {
    if (animFrame) cancelAnimationFrame(animFrame);
    const startTheta = state.theta;
    const startPhi = state.phi;
    const startRadius = state.radius;
    const startTime = performance.now();

    // Shortest rotation path
    let dTheta = targetTheta - startTheta;
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;

    function tick(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      state.theta = startTheta + dTheta * ease;
      state.phi = startPhi + (targetPhi - startPhi) * ease;
      state.radius = startRadius + (targetRadius - startRadius) * ease;
      updateCamera();

      if (t < 1) {
        animFrame = requestAnimationFrame(tick);
      } else {
        animFrame = null;
      }
    }
    animFrame = requestAnimationFrame(tick);
  }

  // Mouse handlers
  function onMouseDown(e) {
    if (e.button === 0 && !e.shiftKey) {
      state.isDragging = true;
      state.isPanning = false;
    } else if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      state.isDragging = true;
      state.isPanning = true;
    }
    state.lastMouse = { x: e.clientX, y: e.clientY };
  }

  function onMouseMove(e) {
    if (!state.isDragging) return;
    const dx = e.clientX - state.lastMouse.x;
    const dy = e.clientY - state.lastMouse.y;
    state.lastMouse = { x: e.clientX, y: e.clientY };

    if (state.isPanning) {
      pan(dx, dy);
    } else {
      state.theta -= dx * 0.005;
      state.phi = Math.max(PHI_MIN, Math.min(PHI_MAX, state.phi - dy * 0.005));
      updateCamera();
    }
  }

  function onMouseUp() {
    state.isDragging = false;
    state.isPanning = false;
  }

  function onWheel(e) {
    e.preventDefault();
    state.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, state.radius + e.deltaY * 0.03));
    updateCamera();
  }

  function pan(dx, dy) {
    const panSpeed = 0.02 * (state.radius / 30);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(new THREE.Vector3());
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    state.target.addScaledVector(right, -dx * panSpeed);
    state.target.addScaledVector(up, dy * panSpeed);
    updateCamera();
  }

  // Touch handlers
  function onTouchStart(e) {
    e.preventDefault();
    state.touchCount = e.touches.length;
    if (e.touches.length === 1) {
      state.isDragging = true;
      state.isPanning = false;
      state.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      state.touchStartTime = performance.now();
      state.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      state.isDragging = true;
      state.isPanning = true;
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      state.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      state.lastTouchCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && !state.isPanning) {
      const dx = e.touches[0].clientX - state.lastMouse.x;
      const dy = e.touches[0].clientY - state.lastMouse.y;
      state.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      state.theta -= dx * 0.005;
      state.phi = Math.max(PHI_MIN, Math.min(PHI_MAX, state.phi - dy * 0.005));
      updateCamera();
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const center = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };

      // Pinch zoom
      const pinchDelta = state.lastTouchDist - dist;
      state.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, state.radius + pinchDelta * 0.1));

      // Pan
      const panDx = center.x - state.lastTouchCenter.x;
      const panDy = center.y - state.lastTouchCenter.y;
      pan(panDx, panDy);

      state.lastTouchDist = dist;
      state.lastTouchCenter = center;
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    if (e.touches.length === 0) {
      state.isDragging = false;
      state.isPanning = false;
    }
    state.touchCount = e.touches.length;
  }

  function isTap() {
    return state.touchCount <= 1;
  }

  function attach() {
    domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    domElement.addEventListener('touchend', onTouchEnd, { passive: false });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function detach() {
    domElement.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    domElement.removeEventListener('wheel', onWheel);
    domElement.removeEventListener('touchstart', onTouchStart);
    domElement.removeEventListener('touchmove', onTouchMove);
    domElement.removeEventListener('touchend', onTouchEnd);
  }

  updateCamera();

  return {
    state,
    updateCamera,
    animateTo,
    attach,
    detach,
    getSpherical: () => ({ radius: state.radius, theta: state.theta, phi: state.phi }),
    setSpherical: (r, t, p) => {
      state.radius = r;
      state.theta = t;
      state.phi = p;
      updateCamera();
    },
    resetTarget: () => {
      state.target.set(0, 0, 0);
      updateCamera();
    },
  };
}
