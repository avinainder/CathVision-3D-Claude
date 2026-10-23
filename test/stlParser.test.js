import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSTL, detectCoordinateSpace, centerAndScale } from '../src/engine/stlParser.js';

// Build a binary STL in memory: 80-byte header, uint32 tri count,
// then per triangle: normal (3 floats) + 3 vertices (3 floats each) + uint16.
function buildBinarySTL(headerText, triangles) {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < Math.min(headerText.length, 80); i++) {
    bytes[i] = headerText.charCodeAt(i);
  }
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const tri of triangles) {
    for (const v of [[0, 0, 1], ...tri]) {
      view.setFloat32(offset, v[0], true);
      view.setFloat32(offset + 4, v[1], true);
      view.setFloat32(offset + 8, v[2], true);
      offset += 12;
    }
    offset += 2;
  }
  return buffer;
}

// Calibration fixture: two triangles whose six vertices sit on the axes at
// ±10, so the bounding box is centered at the origin (no translation) and
// scale is exactly 15/20 = 0.75. Each axis has one unambiguous marker vertex.
const MARKER_TRIS = [
  [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
  [[-10, 0, 0], [0, -10, 0], [0, 0, -10]],
];

function findVertex(geometry, px, py, pz) {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (
      Math.abs(pos.getX(i) - px) < 1e-4 &&
      Math.abs(pos.getY(i) - py) < 1e-4 &&
      Math.abs(pos.getZ(i) - pz) < 1e-4
    ) return true;
  }
  return false;
}

test('detectCoordinateSpace reads Slicer header tags', () => {
  assert.equal(detectCoordinateSpace(buildBinarySTL('3D Slicer output. SPACE=LPS', MARKER_TRIS)), 'LPS');
  assert.equal(detectCoordinateSpace(buildBinarySTL('3D Slicer output. SPACE=RAS', MARKER_TRIS)), 'RAS');
  assert.equal(detectCoordinateSpace(buildBinarySTL('no tag here', MARKER_TRIS)), null);
});

test('detectCoordinateSpace reads ASCII solid line', () => {
  const ascii = new TextEncoder().encode(
    'solid model SPACE=RAS\n' +
    'facet normal 0 0 1\nouter loop\n' +
    'vertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\n' +
    'endloop\nendfacet\nendsolid model\n'
  ).buffer;
  assert.equal(detectCoordinateSpace(ascii), 'RAS');
});

test('parseSTL returns detected space alongside geometry', () => {
  const { geometry, triCount, space } = parseSTL(
    buildBinarySTL('CathVision fixture SPACE=LPS', MARKER_TRIS)
  );
  assert.equal(triCount, 2);
  assert.equal(space, 'LPS');
  assert.equal(geometry.getAttribute('position').count, 6);
});

// World axis contract: -X = patient Right, +Y = Superior, +Z = Anterior.

test('RAS transform: file +X (Right) lands at world -X, +Y (Anterior) at +Z, +Z (Superior) at +Y', () => {
  const { geometry } = parseSTL(buildBinarySTL('SPACE=RAS', MARKER_TRIS));
  centerAndScale(geometry, 15, 'RAS');
  assert.ok(findVertex(geometry, -7.5, 0, 0), 'patient Right marker should be at world -X');
  assert.ok(findVertex(geometry, 0, 0, 7.5), 'patient Anterior marker should be at world +Z');
  assert.ok(findVertex(geometry, 0, 7.5, 0), 'patient Superior marker should be at world +Y');
});

test('LPS transform: file +X (Left) lands at world +X, +Y (Posterior) at -Z, +Z (Superior) at +Y', () => {
  const { geometry } = parseSTL(buildBinarySTL('SPACE=LPS', MARKER_TRIS));
  centerAndScale(geometry, 15, 'LPS');
  assert.ok(findVertex(geometry, 7.5, 0, 0), 'patient Left marker should be at world +X');
  assert.ok(findVertex(geometry, 0, 0, -7.5), 'patient Posterior marker should be at world -Z');
  assert.ok(findVertex(geometry, 0, 7.5, 0), 'patient Superior marker should be at world +Y');
});

test('RAS and LPS transforms agree on anatomy: same patient-space point, same world position', () => {
  // The same anatomical location (patient Right, 10mm) is written as
  // (10,0,0) in a RAS file and (-10,0,0) in an LPS file. Both must land
  // at the same world position.
  const rasFile = parseSTL(buildBinarySTL('SPACE=RAS', MARKER_TRIS));
  const lpsFile = parseSTL(buildBinarySTL('SPACE=LPS', MARKER_TRIS));
  centerAndScale(rasFile.geometry, 15, 'RAS');
  centerAndScale(lpsFile.geometry, 15, 'LPS');
  // RAS (10,0,0) = patient Right → world (-7.5, 0, 0)
  assert.ok(findVertex(rasFile.geometry, -7.5, 0, 0));
  // LPS (-10,0,0) = patient Right → world (-7.5, 0, 0)
  assert.ok(findVertex(lpsFile.geometry, -7.5, 0, 0));
});
