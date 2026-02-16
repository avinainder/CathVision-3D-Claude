const RAD_TO_DEG = 180 / Math.PI;

export function computeAngles(cameraPosition, target) {
  const dx = cameraPosition.x - target.x;
  const dy = cameraPosition.y - target.y;
  const dz = cameraPosition.z - target.z;
  const distXZ = Math.sqrt(dx * dx + dz * dz);

  // Horizontal angle: atan2(x, z) gives the azimuth from +Z axis.
  // Positive X = patient's right = RAO, Negative X = patient's left = LAO
  const horizontalRad = Math.atan2(dx, dz);
  const horizontalDeg = horizontalRad * RAD_TO_DEG;

  // Vertical angle: atan2(y, distXZ) gives the elevation from the XZ horizon.
  // Positive Y = cranial (camera above), Negative Y = caudal (camera below)
  const verticalRad = Math.atan2(dy, distXZ);
  const verticalDeg = verticalRad * RAD_TO_DEG;

  return {
    horizontal: {
      value: Math.abs(horizontalDeg),
      label: horizontalDeg >= 0 ? 'RAO' : 'LAO',
      fullName: horizontalDeg >= 0 ? 'Right Anterior Oblique' : 'Left Anterior Oblique',
      raw: horizontalDeg,
    },
    vertical: {
      value: Math.abs(verticalDeg),
      label: verticalDeg >= 0 ? 'CRA' : 'CAU',
      fullName: verticalDeg >= 0 ? 'Cranial' : 'Caudal',
      raw: verticalDeg,
    },
  };
}

// Convert preset angles (in degrees) to spherical coords (theta, phi)
export function presetToSpherical(raoDeg, craDeg) {
  // raoDeg: positive = RAO, negative = LAO (convention for presets)
  // craDeg: positive = CRA, negative = CAU
  // theta = azimuth: RAO positive → positive theta (camera moves to +X)
  // phi = polar from +Y: horizon is PI/2, CRA (above) decreases phi, CAU increases phi
  const theta = raoDeg * (Math.PI / 180);
  const phi = Math.PI / 2 - craDeg * (Math.PI / 180);
  return { theta, phi };
}

export const PRESETS = [
  { name: 'AP', short: 'AP', rao: 0, cra: 0, tip: 'Anteroposterior' },
  { name: 'RAO 30', short: 'RAO30', rao: 30, cra: 0, tip: 'Right Anterior Oblique 30°' },
  { name: 'LAO 30', short: 'LAO30', rao: -30, cra: 0, tip: 'Left Anterior Oblique 30°' },
  { name: 'RAO CAU', short: 'R30U25', rao: 30, cra: -25, tip: 'RAO 30° / CAU 25°' },
  { name: 'RAO CRA', short: 'R30C25', rao: 30, cra: 25, tip: 'RAO 30° / CRA 25°' },
  { name: 'AP CRA', short: 'APC25', rao: 0, cra: 25, tip: 'AP / CRA 25°' },
  { name: 'LAO CRA', short: 'L30C25', rao: -30, cra: 25, tip: 'LAO 30° / CRA 25°' },
  { name: 'LAO CAU', short: 'L30U25', rao: -30, cra: -25, tip: 'LAO 30° / CAU 25°' },
  { name: 'AP CAU', short: 'APU25', rao: 0, cra: -25, tip: 'AP / CAU 25°' },
];
