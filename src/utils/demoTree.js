import * as THREE from 'three';

// Generate a procedural coronary arterial tree
export function generateDemoTree() {
  const group = new THREE.Group();
  const labelPositions = {};

  const seededRandom = createSeededRandom(42);

  // Aortic root — short wide cylinder
  const aortaPath = [
    new THREE.Vector3(0, 6, 0),
    new THREE.Vector3(0, 4.5, 0),
    new THREE.Vector3(0, 3, 0),
  ];
  addTube(group, aortaPath, 1.2, 0.9);
  labelPositions['Aorta'] = new THREE.Vector3(0, 5.5, 0);

  // Left Main (LM)
  const lmPath = [
    new THREE.Vector3(0, 3, 0),
    new THREE.Vector3(-0.8, 2.4, 0.3),
    new THREE.Vector3(-1.8, 2.0, 0.5),
    new THREE.Vector3(-2.8, 1.6, 0.4),
  ];
  addTube(group, lmPath, 0.7, 0.55);
  labelPositions['LM'] = new THREE.Vector3(-1.5, 2.3, 0.4);

  // LAD — Left Anterior Descending
  const ladBase = lmPath[lmPath.length - 1];
  const ladPath = generateBranch(ladBase, new THREE.Vector3(-0.3, -0.6, 0.5), 12, 0.7, seededRandom);
  addTube(group, ladPath, 0.45, 0.2);
  labelPositions['LAD'] = ladPath[5].clone();

  // LAD diagonal branches
  for (let i = 3; i < ladPath.length; i += 3) {
    if (i + 2 < ladPath.length) {
      const dBranch = generateBranch(
        ladPath[i],
        new THREE.Vector3(-0.5, -0.3, 0.3),
        4,
        0.5,
        seededRandom
      );
      addTube(group, dBranch, 0.2, 0.08);
    }
  }

  // LCx — Left Circumflex
  const lcxPath = generateBranch(ladBase, new THREE.Vector3(-0.5, -0.3, -0.5), 10, 0.6, seededRandom);
  addTube(group, lcxPath, 0.4, 0.18);
  labelPositions['LCx'] = lcxPath[4].clone();

  // LCx obtuse marginals
  for (let i = 3; i < lcxPath.length; i += 3) {
    const omBranch = generateBranch(
      lcxPath[i],
      new THREE.Vector3(-0.3, -0.5, -0.2),
      4,
      0.4,
      seededRandom
    );
    addTube(group, omBranch, 0.18, 0.07);
  }

  // RCA — Right Coronary Artery
  const rcaStart = new THREE.Vector3(0.3, 2.8, 0.2);
  const rcaPath = generateBranch(rcaStart, new THREE.Vector3(0.5, -0.5, -0.4), 12, 0.6, seededRandom);
  addTube(group, rcaPath, 0.45, 0.2);
  labelPositions['RCA'] = rcaPath[5].clone();

  // RCA branches
  for (let i = 4; i < rcaPath.length; i += 4) {
    const rBranch = generateBranch(
      rcaPath[i],
      new THREE.Vector3(0.2, -0.5, -0.3),
      3,
      0.4,
      seededRandom
    );
    addTube(group, rBranch, 0.15, 0.06);
  }

  // PDA from distal RCA
  if (rcaPath.length > 2) {
    const pdaPath = generateBranch(
      rcaPath[rcaPath.length - 1],
      new THREE.Vector3(-0.3, -0.4, 0.4),
      5,
      0.5,
      seededRandom
    );
    addTube(group, pdaPath, 0.2, 0.08);
  }

  return { group, labelPositions, triCount: estimateTriCount(group) };
}

function generateBranch(start, direction, segments, jitter, rng) {
  const points = [start.clone()];
  const dir = direction.clone().normalize();
  const stepLen = 0.8;

  for (let i = 0; i < segments; i++) {
    const prev = points[points.length - 1];
    const offset = new THREE.Vector3(
      dir.x * stepLen + (rng() - 0.5) * jitter * 0.3,
      dir.y * stepLen + (rng() - 0.5) * jitter * 0.15,
      dir.z * stepLen + (rng() - 0.5) * jitter * 0.3
    );
    points.push(prev.clone().add(offset));
  }
  return points;
}

function addTube(group, points, radiusStart, radiusEnd) {
  if (points.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(points);
  const radialSegments = 8;
  const tubularSegments = points.length * 4;
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radiusStart, radialSegments, false);

  // Taper: scale each ring's radius
  const posAttr = geometry.getAttribute('position');
  const tempVec = new THREE.Vector3();
  const ringSize = radialSegments + 1;
  const numRings = tubularSegments + 1;

  for (let ring = 0; ring < numRings; ring++) {
    const t = ring / (numRings - 1);
    const radius = radiusStart + (radiusEnd - radiusStart) * t;
    const scale = radius / radiusStart;
    const centerIdx = ring * ringSize;

    // Find ring center
    const center = new THREE.Vector3(0, 0, 0);
    for (let j = 0; j < ringSize; j++) {
      tempVec.fromBufferAttribute(posAttr, centerIdx + j);
      center.add(tempVec);
    }
    center.divideScalar(ringSize);

    // Scale from center
    for (let j = 0; j < ringSize; j++) {
      const idx = centerIdx + j;
      tempVec.fromBufferAttribute(posAttr, idx);
      tempVec.sub(center).multiplyScalar(scale).add(center);
      posAttr.setXYZ(idx, tempVec.x, tempVec.y, tempVec.z);
    }
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhongMaterial({
    color: 0xcc3333,
    side: THREE.DoubleSide,
    shininess: 60,
    transparent: true,
    opacity: 1.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
}

function createSeededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function estimateTriCount(group) {
  let count = 0;
  group.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const idx = child.geometry.index;
      if (idx) {
        count += idx.count / 3;
      } else {
        const pos = child.geometry.getAttribute('position');
        if (pos) count += pos.count / 3;
      }
    }
  });
  return Math.round(count);
}
