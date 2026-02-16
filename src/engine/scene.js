import * as THREE from 'three';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#08080d');

  // Lights — multi-light setup
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(5, 8, 5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x8888cc, 0.5);
  fillLight.position.set(-5, 3, -5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
  rimLight.position.set(0, -3, -8);
  scene.add(rimLight);

  const ambient = new THREE.AmbientLight(0x404050, 0.6);
  scene.add(ambient);

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
  const grid = new THREE.GridHelper(60, 40, 0x222233, 0x151520);
  grid.position.y = -8;
  grid.material.opacity = 0.4;
  grid.material.transparent = true;
  return grid;
}
