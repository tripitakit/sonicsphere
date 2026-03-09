import type { SphericalCoord, CartesianCoord } from '../types.ts';

// Physical sphere radius (world-space units). Increased to enlarge world surface
// and reduce source density per unit area.
export const SPHERE_RADIUS = 250;
export const HEARING_RADIUS = 52;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EPS = 1e-8;

function length(v: CartesianCoord): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: CartesianCoord): CartesianCoord {
  const len = length(v);
  if (len < EPS) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: CartesianCoord, b: CartesianCoord): CartesianCoord {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: CartesianCoord, b: CartesianCoord): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function toUnit(coord: SphericalCoord): CartesianCoord {
  const latR = coord.lat * DEG;
  const lonR = coord.lon * DEG;
  return {
    x: Math.cos(latR) * Math.sin(lonR),
    y: Math.sin(latR),
    z: Math.cos(latR) * Math.cos(lonR),
  };
}

/** Stable local basis on tangent plane (north/east/up), including poles. */
function localBasis(coord: SphericalCoord): {
  north: CartesianCoord;
  east: CartesianCoord;
  up: CartesianCoord;
} {
  const up = normalize(toUnit(coord));

  // East candidate: cross(globalUpY, up) => (up.z, 0, -up.x)
  let east = normalize({ x: up.z, y: 0, z: -up.x });

  // At poles the candidate is near zero; use a fixed fallback axis.
  if (length(east) < EPS) {
    east = normalize(cross({ x: 1, y: 0, z: 0 }, up));
  }
  if (length(east) < EPS) {
    east = normalize(cross({ x: 0, y: 0, z: 1 }, up));
  }

  const north = normalize(cross(up, east));
  return { north, east, up };
}

/** Convert spherical (lat/lon degrees) to Cartesian, scaled by SPHERE_RADIUS */
export function toCartesian(coord: SphericalCoord): CartesianCoord {
  const latR = coord.lat * DEG;
  const lonR = coord.lon * DEG;
  return {
    x: SPHERE_RADIUS * Math.cos(latR) * Math.sin(lonR),
    y: SPHERE_RADIUS * Math.sin(latR),
    z: SPHERE_RADIUS * Math.cos(latR) * Math.cos(lonR),
  };
}

/** Chord distance (3D Euclidean) between two points on the sphere surface */
export function chordDistance(a: SphericalCoord, b: SphericalCoord): number {
  const ca = toCartesian(a);
  const cb = toCartesian(b);
  const dx = ca.x - cb.x;
  const dy = ca.y - cb.y;
  const dz = ca.z - cb.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Move player along sphere surface using Rodrigues rotation formula.
 * heading: 0=north (+z tangent), 90=east (+x tangent)
 * distanceDelta: units to move (positive = forward)
 */
export function moveOnSphere(
  position: SphericalCoord,
  headingDeg: number,
  distanceDelta: number,
): SphericalCoord {
  if (distanceDelta === 0) return normalizeCoord(position);

  const p = normalize(toUnit(position));
  const { north, east } = localBasis(position);

  // Heading tangent vector in local tangent plane
  const hR = headingDeg * DEG;
  const t = normalize({
    x: Math.cos(hR) * north.x + Math.sin(hR) * east.x,
    y: Math.cos(hR) * north.y + Math.sin(hR) * east.y,
    z: Math.cos(hR) * north.z + Math.sin(hR) * east.z,
  });

  // Great-circle motion: rotate position p by angle theta in direction t.
  // For unit vectors p and t with p·t=0: p_rot = p*cos(theta) + t*sin(theta)
  const theta = distanceDelta / SPHERE_RADIUS;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const rx = p.x * cosT + t.x * sinT;
  const ry = p.y * cosT + t.y * sinT;
  const rz = p.z * cosT + t.z * sinT;

  // Back to lat/lon
  const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const newLat = Math.asin(ry / len) * RAD;
  const newLon = Math.atan2(rx, rz) * RAD;

  return normalizeCoord({ lat: newLat, lon: newLon });
}

/**
 * Returns the direction FROM player TO source in player's local coordinate frame.
 * Local frame: forward = player heading, right = perpendicular right, up = sphere normal.
 * Used to position Panner3D sources while keeping listener at default orientation.
 */
export function directionInPlayerFrame(
  playerPos: SphericalCoord,
  playerHeading: number,
  sourcePos: SphericalCoord,
): CartesianCoord {
  const basis = localBasis(playerPos);

  // Forward (heading direction in tangent plane)
  const hR = playerHeading * DEG;
  const forward = normalize({
    x: Math.cos(hR) * basis.north.x + Math.sin(hR) * basis.east.x,
    y: Math.cos(hR) * basis.north.y + Math.sin(hR) * basis.east.y,
    z: Math.cos(hR) * basis.north.z + Math.sin(hR) * basis.east.z,
  });

  // Right = forward × up (orthonormal frame)
  const right = normalize(cross(forward, basis.up));

  // Source position vector
  const src = toCartesian(sourcePos);
  // Direction from player (world-space, not unit)
  const playerCart = toCartesian(playerPos);
  const dx = src.x - playerCart.x;
  const dy = src.y - playerCart.y;
  const dz = src.z - playerCart.z;

  // Project onto local frame axes
  return {
    x: dx * right.x + dy * right.y + dz * right.z,       // right
    y: dx * basis.up.x + dy * basis.up.y + dz * basis.up.z, // up
    z: -dot({ x: dx, y: dy, z: dz }, forward),           // +z = behind (WebAudio default)
  };
}

/**
 * Harmonic oscillation (pendulum) of a source around its equilibrium.
 * Oscillates along the north direction at the equilibrium point.
 */
export function oscillatedPosition(
  equilibrium: SphericalCoord,
  amplitude: number,  // degrees of arc
  phase: number,      // initial phase (radians)
  elapsedSeconds: number,
  period: number,     // seconds
): SphericalCoord {
  const offsetDeg = amplitude * Math.sin((2 * Math.PI * elapsedSeconds) / period + phase);
  const offsetDist = offsetDeg * DEG * SPHERE_RADIUS;
  return moveOnSphere(equilibrium, 0, offsetDist);
}

/** Wrap lon to -180..180 and reflect properly when crossing poles. */
export function normalizeCoord(coord: SphericalCoord): SphericalCoord {
  let lat = Number.isFinite(coord.lat) ? coord.lat : 0;
  let lon = Number.isFinite(coord.lon) ? coord.lon : 0;

  while (lat > 90 || lat < -90) {
    if (lat > 90) {
      lat = 180 - lat;
      lon += 180;
    } else {
      lat = -180 - lat;
      lon += 180;
    }
  }

  lon = ((lon + 180) % 360 + 360) % 360 - 180;

  return { lat, lon };
}
