import * as THREE from 'three';

export function parseSTL(buffer) {
  if (isBinarySTL(buffer)) {
    return parseBinarySTL(buffer);
  }
  return parseASCIISTL(buffer);
}

function isBinarySTL(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) return false;
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  // If file size matches binary format, treat as binary
  // Also check if it starts with "solid" — but some binary STLs do too
  if (Math.abs(buffer.byteLength - expectedSize) < 10) return true;
  // Try to detect ASCII
  const header = new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength));
  const headerStr = String.fromCharCode(...header);
  if (headerStr.trimStart().startsWith('solid') && buffer.byteLength !== expectedSize) {
    return false;
  }
  return true;
}

function parseBinarySTL(buffer) {
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let v = 0; v < 3; v++) {
      const idx = i * 9 + v * 3;
      positions[idx] = view.getFloat32(offset, true);
      positions[idx + 1] = view.getFloat32(offset + 4, true);
      positions[idx + 2] = view.getFloat32(offset + 8, true);
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
      offset += 12;
    }
    offset += 2; // attribute byte count
  }

  return buildGeometry(positions, normals, triCount);
}

function parseASCIISTL(buffer) {
  const text = new TextDecoder().decode(buffer);
  const lines = text.split('\n');
  const verts = [];
  const norms = [];
  let currentNormal = [0, 0, 0];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('facet normal')) {
      const parts = trimmed.split(/\s+/);
      currentNormal = [parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])];
    } else if (trimmed.startsWith('vertex')) {
      const parts = trimmed.split(/\s+/);
      verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      norms.push(...currentNormal);
    }
  }

  const triCount = verts.length / 9;
  return buildGeometry(new Float32Array(verts), new Float32Array(norms), triCount);
}

function buildGeometry(positions, normals, triCount) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, triCount };
}

export function centerAndScale(geometry, targetSize = 15) {
  // Apply RAS → Three.js coordinate transform.
  // Medical STLs (from 3D Slicer, CT scanners) use RAS:
  //   STL X = Right, STL Y = Anterior, STL Z = Superior
  // Three.js with our camera convention:
  //   X = screen-right, Y = up, Z = toward viewer
  // Mapping: RAS_X → -X (radiological: R on left), RAS_Y → +Z, RAS_Z → +Y
  const pos = geometry.getAttribute('position');
  const norm = geometry.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const rx = pos.getX(i), ry = pos.getY(i), rz = pos.getZ(i);
    pos.setXYZ(i, -rx, rz, ry);
    const nnx = norm.getX(i), nny = norm.getY(i), nnz = norm.getZ(i);
    norm.setXYZ(i, -nnx, nnz, nny);
  }
  pos.needsUpdate = true;
  norm.needsUpdate = true;

  // Center at origin
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  // Scale to target size
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = targetSize / maxDim;
    geometry.scale(scale, scale, scale);
  }
  geometry.computeBoundingSphere();
}
