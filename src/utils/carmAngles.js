const RAD_TO_DEG = 180 / Math.PI;

export function computeAngles(cameraPosition, target) {
  const dx = cameraPosition.x - target.x;
  const dy = cameraPosition.y - target.y;
  const dz = cameraPosition.z - target.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Horizontal angle: atan2(x, z) → positive = LAO, negative = RAO
  const horizontalRad = Math.atan2(dx, dz);
  const horizontalDeg = horizontalRad * RAD_TO_DEG;

  // Vertical angle: asin(y / dist) → positive = Cranial, negative = Caudal
  const verticalRad = Math.asin(dy / (dist || 1));
  const verticalDeg = verticalRad * RAD_TO_DEG;

  return {
    horizontal: {
      value: Math.abs(horizontalDeg),
      label: horizontalDeg >= 0 ? 'LAO' : 'RAO',
      fullName: horizontalDeg >= 0 ? 'Left Anterior Oblique' : 'Right Anterior Oblique',
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
  const theta = -raoDeg * (Math.PI / 180);
  const phi = Math.PI / 2 - craDeg * (Math.PI / 180);
  return { theta, phi };
}

export const PRESETS = [
  { name: 'AP', short: 'AP', rao: 0, cra: 0, tip: 'Anteroposterior' },
  { name: 'RAO 30', short: 'RAO30', rao: 30, cra: 0, tip: 'Right Anterior Oblique 30°' },
  { name: 'LAO 45', short: 'LAO45', rao: -45, cra: 0, tip: 'Left Anterior Oblique 45°' },
  { name: 'RAO CRA', short: 'R30C25', rao: 30, cra: 25, tip: 'RAO 30° / CRA 25° — mid-LAD' },
  { name: 'LAO CRA', short: 'L45C25', rao: -45, cra: 25, tip: 'LAO 45° / CRA 25° — LM bifurcation' },
  { name: 'RAO CAU', short: 'R30U25', rao: 30, cra: -25, tip: 'RAO 30° / CAU 25° — Hepatoclavicular variant' },
  { name: 'Spider', short: 'Spider', rao: -45, cra: -30, tip: 'LAO 45° / CAU 30° — LM/bifurcation' },
  { name: 'Hepatocl.', short: 'Hepato', rao: 25, cra: -30, tip: 'RAO 25° / CAU 30° — Hepatoclavicular' },
];
