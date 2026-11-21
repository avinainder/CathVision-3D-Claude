import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAngles, presetToSpherical, PRESETS } from '../src/utils/carmAngles.js';

// Camera position from spherical coords — same formula as controls.js updateCamera()
function cameraFromSpherical(theta, phi, radius = 30) {
  return {
    x: radius * Math.sin(phi) * Math.sin(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.cos(theta),
  };
}

const ORIGIN = { x: 0, y: 0, z: 0 };

// The invariant that broke repeatedly during development: going
// preset → spherical → camera position → computeAngles must return
// the original preset angles. This pins presets and HUD to each other.
test('round-trip: every preset returns its own angles through computeAngles', () => {
  for (const p of PRESETS) {
    const { theta, phi } = presetToSpherical(p.rao, p.cra);
    const cam = cameraFromSpherical(theta, phi);
    const angles = computeAngles(cam, ORIGIN);

    // Convention: preset rao > 0 = RAO, computeAngles raw < 0 = RAO (Slicer sign)
    assert.ok(
      Math.abs(angles.horizontal.raw - -p.rao) < 1e-6,
      `${p.name}: horizontal raw ${angles.horizontal.raw} != ${-p.rao}`
    );
    assert.ok(
      Math.abs(angles.vertical.raw - -p.cra) < 1e-6,
      `${p.name}: vertical raw ${angles.vertical.raw} != ${-p.cra}`
    );

    if (p.rao > 0) assert.equal(angles.horizontal.label, 'RAO', `${p.name} h-label`);
    if (p.rao < 0) assert.equal(angles.horizontal.label, 'LAO', `${p.name} h-label`);
    if (p.cra > 0) assert.equal(angles.vertical.label, 'CRA', `${p.name} v-label`);
    if (p.cra < 0) assert.equal(angles.vertical.label, 'CAU', `${p.name} v-label`);
  }
});

test('AP view: camera at theta=0 phi=PI/2 reads 0/0', () => {
  const angles = computeAngles(cameraFromSpherical(0, Math.PI / 2), ORIGIN);
  assert.ok(Math.abs(angles.horizontal.raw) < 1e-6);
  assert.ok(Math.abs(angles.vertical.raw) < 1e-6);
});
