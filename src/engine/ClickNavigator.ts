/**
 * ClickNavigator: steer the player toward a clicked/tapped sphere destination.
 *
 * Produces the same { forward, turn } intent interface as Autopilot, so it
 * slots cleanly into the intent-priority chain in main.ts.
 *
 * Returns null when there is no active target or when the player arrives,
 * allowing the caller to fall through to autopilot or rest.
 */
import type { SphericalCoord } from '../types.ts';
import { bearingDeg, chordDistance } from './sphereMath.ts';

// Fraction of PLAYER_SPEED (8 u/s) used while navigating at 1× speed
const NAV_FORWARD_SPEED = 0.55;

// Chord-distance (world units) at which we consider the destination reached.
// Near-zero so the player center lands exactly on the marker.
const NAV_ARRIVAL_CHORD = 1.5;

// Start a gentle deceleration below this chord distance
const NAV_SLOW_CHORD = 40;

// Proportional-controller gain: heading error (deg) → turn fraction [-1, 1]
const NAV_TURN_GAIN = 0.035;

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Signed shortest angular difference (target − current) in degrees [-180, 180]. */
function shortestAngleDeltaDeg(current: number, target: number): number {
  return ((target - current + 540) % 360) - 180;
}

export class ClickNavigator {
  private target: SphericalCoord | null = null;

  setTarget(t: SphericalCoord): void {
    this.target = t;
  }

  clearTarget(): void {
    this.target = null;
  }

  hasTarget(): boolean {
    return this.target !== null;
  }

  getTarget(): SphericalCoord | null {
    return this.target;
  }

  /**
   * Returns movement intent toward the target, or null when done / no target.
   * speedMult is applied to forward speed (caller's manual speed setting).
   */
  getIntent(
    playerPos: SphericalCoord,
    playerHeading: number,
    speedMult: number,
    _dt: number,
  ): { forward: number; turn: number } | null {
    if (this.target === null) return null;

    const dist = chordDistance(playerPos, this.target);

    if (dist < NAV_ARRIVAL_CHORD) {
      this.target = null;
      return null;
    }

    const bearing      = bearingDeg(playerPos, this.target);
    const headingError = shortestAngleDeltaDeg(playerHeading, bearing);

    const turn = clamp(headingError * NAV_TURN_GAIN, -1, 1);

    // Forward: decelerate linearly to near-zero as the player closes in
    const alignmentFactor = Math.max(0.1, Math.cos(headingError * DEG));
    const distFactor      = dist > NAV_SLOW_CHORD
      ? 1.0
      : clamp(dist / NAV_SLOW_CHORD, 0.04, 1.0);
    const forward = NAV_FORWARD_SPEED * alignmentFactor * distFactor * speedMult;

    return { forward, turn };
  }
}
