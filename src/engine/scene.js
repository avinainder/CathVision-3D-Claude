import * as THREE from 'three';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1a2e');

  // Even ambient-dominant lighting (no harsh directional shadows)
  const ambient = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambient);

  // Soft fill from multiple directions for even coverage
  const light1 = new THREE.DirectionalLight(0xffffff, 0.3);
  light1.position.set(5, 5, 5);
  scene.add(light1);

  const light2 = new THREE.DirectionalLight(0xffffff, 0.3);
  light2.position.set(-5, 5, -5);
  scene.add(light2);

  const light3 = new THREE.DirectionalLight(0xffffff, 0.3);
  light3.position.set(0, -5, 5);
  scene.add(light3);

  const light4 = new THREE.DirectionalLight(0xffffff, 0.3);
  light4.position.set(0, 5, -5);
  scene.add(light4);

  return scene;
}

export function createCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
  camera.position.set(0, 0, 30);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createFloorGrid() {
  const grid = new THREE.GridHelper(60, 40, 0x2a2a40, 0x222238);
  grid.position.y = -8;
  grid.material.opacity = 0.4;
  grid.material.transparent = true;
  return grid;
}
