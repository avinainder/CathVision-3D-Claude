import * as THREE from 'three';

export function createMeasureManager(scene) {
  const measurements = [];

  function createDistanceSprite(distance) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 192;
    canvas.height = 48;

    ctx.fillStyle = 'rgba(50,40,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
    ctx.fill();

    ctx.font = 'bold 22px "SF Mono", SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#ffdd44';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${distance.toFixed(1)} mm`, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.5, 0.625, 1);
    return sprite;
  }

  function createEndpoint(position) {
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd44, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    return mesh;
  }

  function addMeasurement(p1, p2) {
    const distance = p1.distanceTo(p2);
    const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    midpoint.y += 0.4;

    // Line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffdd44, depthTest: false, linewidth: 2 });
    const line = new THREE.Line(lineGeo, lineMat);

    // Endpoints
    const dot1 = createEndpoint(p1);
    const dot2 = createEndpoint(p2);

    // Distance label
    const label = createDistanceSprite(distance);
    label.position.copy(midpoint);

    scene.add(line);
    scene.add(dot1);
    scene.add(dot2);
    scene.add(label);

    const id = crypto.randomUUID();
    measurements.push({ id, p1: p1.clone(), p2: p2.clone(), distance, line, dot1, dot2, label });
    return { id, distance };
  }

  function removeMeasurement(id) {
    const idx = measurements.findIndex((m) => m.id === id);
    if (idx !== -1) {
      const m = measurements[idx];
      scene.remove(m.line);
      scene.remove(m.dot1);
      scene.remove(m.dot2);
      scene.remove(m.label);
      m.line.geometry.dispose();
      m.line.material.dispose();
      m.dot1.geometry.dispose();
      m.dot1.material.dispose();
      m.dot2.geometry.dispose();
      m.dot2.material.dispose();
      m.label.material.map.dispose();
      m.label.material.dispose();
      measurements.splice(idx, 1);
    }
  }

  function clearAll() {
    while (measurements.length > 0) {
      removeMeasurement(measurements[0].id);
    }
  }

  function getMeasurements() {
    return measurements.map(({ id, p1, p2, distance }) => ({ id, p1, p2, distance }));
  }

  function dispose() {
    clearAll();
  }

  return { addMeasurement, removeMeasurement, clearAll, getMeasurements, dispose };
}
