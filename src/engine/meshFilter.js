/**
 * meshFilter.js — Client-side connected component analysis for STL meshes.
 *
 * Uses Union-Find on the triangle adjacency graph to identify disconnected
 * mesh components, then extracts the largest one (typically the aorta +
 * coronary tree in CCTA-derived STLs).
 *
 * Because our STL parser (stlParser.js) produces non-indexed geometry
 * (each triangle has its own 3 vertices), we identify shared edges by
 * hashing vertex positions to a grid and matching triangles that share
 * two vertices at the same position.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Union-Find with path compression + union by size
// ---------------------------------------------------------------------------
class UnionFind {
  constructor(n) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.size[i] = 1;
    }
  }

  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path halving
      x = this.parent[x];
    }
    return x;
  }

  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) { const t = ra; ra = rb; rb = t; }
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
  }
}

// ---------------------------------------------------------------------------
// Vertex hashing — snap positions to a grid to handle floating-point jitter
// ---------------------------------------------------------------------------
const PRECISION = 1e4; // 4 decimal places → 0.1mm resolution

function vertexKey(x, y, z) {
  const ix = Math.round(x * PRECISION);
  const iy = Math.round(y * PRECISION);
  const iz = Math.round(z * PRECISION);
  return `${ix}_${iy}_${iz}`;
}

function edgeKey(vk1, vk2) {
  return vk1 < vk2 ? `${vk1}|${vk2}` : `${vk2}|${vk1}`;
}

// ---------------------------------------------------------------------------
// Find connected components in a non-indexed BufferGeometry
// ---------------------------------------------------------------------------
function findComponents(positions, triCount) {
  const uf = new UnionFind(triCount);

  // Map: edgeKey → first triangle index that owns this edge.
  // When a second triangle claims the same edge, union them.
  const edgeOwner = new Map();

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const vk0 = vertexKey(positions[base],     positions[base + 1], positions[base + 2]);
    const vk1 = vertexKey(positions[base + 3], positions[base + 4], positions[base + 5]);
    const vk2 = vertexKey(positions[base + 6], positions[base + 7], positions[base + 8]);

    const edges = [
      edgeKey(vk0, vk1),
      edgeKey(vk1, vk2),
      edgeKey(vk2, vk0),
    ];

    for (const ek of edges) {
      const existing = edgeOwner.get(ek);
      if (existing !== undefined) {
        uf.union(t, existing);
      } else {
        edgeOwner.set(ek, t);
      }
    }
  }

  // Collect components: root → list of face indices
  const components = new Map();
  for (let t = 0; t < triCount; t++) {
    const root = uf.find(t);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(t);
  }

  // Sort by size descending
  return Array.from(components.values()).sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a non-indexed BufferGeometry and return connected component stats.
 * @param {THREE.BufferGeometry} geometry
 * @returns {{ components: number, largest: number, sizes: number[] }}
 */
export function analyzeComponents(geometry) {
  const positions = geometry.getAttribute('position').array;
  const triCount = positions.length / 9;
  const components = findComponents(positions, triCount);
  return {
    components: components.length,
    largest: components[0]?.length ?? 0,
    sizes: components.map(c => c.length),
  };
}

/**
 * Extract the largest connected component from a non-indexed BufferGeometry.
 * Returns a new geometry containing only the triangles of the largest component.
 *
 * @param {THREE.BufferGeometry} geometry — non-indexed (from stlParser)
 * @returns {{ geometry: THREE.BufferGeometry, stats: { original: number, kept: number, removed: number, components: number }}}
 */
export function isolateLargestComponent(geometry) {
  const positions = geometry.getAttribute('position').array;
  const normals = geometry.getAttribute('normal').array;
  const triCount = positions.length / 9;

  if (triCount === 0) {
    return { geometry: geometry.clone(), stats: { original: 0, kept: 0, removed: 0, components: 0 } };
  }

  const components = findComponents(positions, triCount);

  if (components.length <= 1) {
    return {
      geometry: geometry.clone(),
      stats: { original: triCount, kept: triCount, removed: 0, components: 1 },
    };
  }

  // Build new buffers containing only the largest component's triangles
  const keptFaces = components[0];
  const keptCount = keptFaces.length;
  const newPositions = new Float32Array(keptCount * 9);
  const newNormals = new Float32Array(keptCount * 9);

  for (let i = 0; i < keptCount; i++) {
    const srcBase = keptFaces[i] * 9;
    const dstBase = i * 9;
    for (let j = 0; j < 9; j++) {
      newPositions[dstBase + j] = positions[srcBase + j];
      newNormals[dstBase + j] = normals[srcBase + j];
    }
  }

  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
  newGeometry.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
  newGeometry.computeBoundingSphere();
  newGeometry.computeBoundingBox();

  return {
    geometry: newGeometry,
    stats: {
      original: triCount,
      kept: keptCount,
      removed: triCount - keptCount,
      components: components.length,
    },
  };
}
