const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Compute C-arm gantry angles from camera position, using the same convention
 * as 3D Slicer's positionerAngleFromViewNormal().
 *
 * After RAS→Three.js transform in the STL parser:
 *   Three.js -X = patient Right, +X = patient Left
 *   Three.js +Y = Superior,      -Y = Inferior
 *   Three.js +Z = Anterior,      -Z = Posterior
 *
 * Reference: Koch14-OVA.pdf (Erlangen) and 3D Slicer source.
 */
export function computeAngles(cameraPosition, target) {
  const cx = cameraPosition.x - target.x;
  const cy = cameraPosition.y - target.y;
  const cz = cameraPosition.z - target.z;
  const dist = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;

  // View direction (from camera toward target)
  const vx = -cx / dist;
  const vy = -cy / dist;
  const vz = -cz / dist;

  // Map to Slicer's nx/ny/nz (LPS-derived quantities):
  //   nx = viewDir.x        (patient Left component)
  //   ny = -viewDir.z       (patient Posterior component)
  //   nz = viewDir.y        (patient Superior component)
  const nx = vx;
  const ny = -vz;
  const nz = vy;

  // Primary angle (RAO/LAO): atan(-nx / ny)
  let primaryDeg;
  if (Math.abs(ny) > 1e-6) {
    primaryDeg = Math.atan(-nx / ny) * RAD_TO_DEG;
  } else {
    primaryDeg = nx >= 0 ? 90.0 : -90.0;
  }

  // Secondary angle (CRA/CAU): asin(nz)
  const secondaryDeg = Math.asin(Math.max(-1, Math.min(1, nz))) * RAD_TO_DEG;

  return {
    horizontal: {
      value: Math.abs(primaryDeg),
      label: primaryDeg < 0 ? 'RAO' : 'LAO',
      fullName: primaryDeg < 0 ? 'Right Anterior Oblique' : 'Left Anterior Oblique',
      raw: primaryDeg,
    },
    vertical: {
      value: Math.abs(secondaryDeg),
      label: secondaryDeg < 0 ? 'CRA' : 'CAU',
      fullName: secondaryDeg < 0 ? 'Cranial' : 'Caudal',
      raw: secondaryDeg,
    },
  };
}

/**
 * Convert preset C-arm angles (degrees) to spherical camera coordinates.
 *
 * After RAS transform, RAO means camera at -X (patient Right), so
 * theta (azimuth) must be negative for RAO.
 * CRA means camera above (+Y), so phi (polar from +Y) must be < PI/2.
 */
export function presetToSpherical(raoDeg, craDeg) {
  const theta = -raoDeg * DEG_TO_RAD;
  const phi = Math.PI / 2 - craDeg * DEG_TO_RAD;
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
