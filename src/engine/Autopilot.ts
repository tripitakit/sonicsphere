/**
 * Autopilot: smooth, organic wandering on the sphere surface.
 *
 * Heading change rate is the sum of two sinusoids with incommensurable periods
 * (≈45 s and ≈27 s) so the path never exactly repeats. The result is large,
 * gently curving arcs — contemplative, not Brownian.
 *
 * Speed: base 3 units/s (vs 8 for manual control), modulated in 0.3x..6x range
 * Max turn rate: ≈ ±8 deg/s  → minimum arc radius ≈ 21 units on the sphere
 */
import type { SphericalCoord } from '../types.ts';

const TAU = Math.PI * 2;

// Incommensurable periods (irrational ratio keeps path aperiodic)
const PERIOD_1 = 44.7;  // seconds
const PERIOD_2 = 27.3;  // seconds
const PHASE_2  = 1.618; // golden ratio offset prevents symmetric start

// Fraction of PLAYER_SPEED (8 u/s) to use for autopilot: 3/8
const AUTOPILOT_SPEED = 3 / 8;

// Turn amplitude: fraction of TURN_SPEED (60 deg/s). 0.13 → ~8 deg/s peak.
const TURN_AMP_1 = 0.09;
const TURN_AMP_2 = 0.05;

// Speed modulation (parametric, like heading):
// a weighted sum of two slow sinusoids, mapped to multiplier in [0.3x, 6x].
const SPEED_PERIOD_1 = 52.1;
const SPEED_PERIOD_2 = 33.7;
const SPEED_PHASE_2 = 0.93;
const SPEED_WAVE_AMP_1 = 0.62;
const SPEED_WAVE_AMP_2 = 0.38;
const SPEED_MULT_MIN = 0.3;
const SPEED_MULT_MAX = 6.0;

// Pole escape hysteresis: smoothly blend from wander to equator-seeking steering.
const POLE_ESCAPE_START_LAT = 72; // start biasing away from poles
const POLE_ESCAPE_FULL_LAT = 84;  // strong corrective steering

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampSigned(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** Signed smallest angular difference (target - current) in degrees [-180, 180]. */
function shortestAngleDeltaDeg(current: number, target: number): number {
  return ((target - current + 540) % 360) - 180;
}

/**
 * Maps modulation signal [-1, 1] to speed multiplier:
 * -1 => 0.3x, 0 => 1x (current baseline), +1 => 6x.
 */
function speedMultiplierFromWave(wave: number): number {
  const s = clampSigned(wave);
  if (s >= 0) return 1 + s * (SPEED_MULT_MAX - 1);
  return 1 + s * (1 - SPEED_MULT_MIN);
}

export class Autopilot {
  private enabled = true;

  /** Returns movement intent compatible with Player.update(). */
  getIntent(
    elapsed: number,
    playerPos?: SphericalCoord,
    playerHeading?: number,
  ): { forward: number; turn: number } {
    if (!this.enabled) return { forward: 0, turn: 0 };

    const baseTurn =
      Math.sin((elapsed / PERIOD_1) * TAU) * TURN_AMP_1 +
      Math.sin((elapsed / PERIOD_2) * TAU + PHASE_2) * TURN_AMP_2;
    const speedWave =
      Math.sin((elapsed / SPEED_PERIOD_1) * TAU) * SPEED_WAVE_AMP_1 +
      Math.sin((elapsed / SPEED_PERIOD_2) * TAU + SPEED_PHASE_2) * SPEED_WAVE_AMP_2;
    const speedMult = speedMultiplierFromWave(speedWave);

    if (playerPos === undefined || playerHeading === undefined) {
      return { forward: AUTOPILOT_SPEED * speedMult, turn: baseTurn };
    }

    const absLat = Math.abs(playerPos.lat);
    const escapeMix = clamp01((absLat - POLE_ESCAPE_START_LAT) / (POLE_ESCAPE_FULL_LAT - POLE_ESCAPE_START_LAT));

    // In north hemisphere, heading 180 moves south (towards equator).
    // In south hemisphere, heading 0 moves north (towards equator).
    const escapeHeading = playerPos.lat >= 0 ? 180 : 0;
    const headingDelta = shortestAngleDeltaDeg(playerHeading, escapeHeading);
    const escapeTurn = Math.max(-1, Math.min(1, headingDelta / 45));

    const turn = baseTurn * (1 - escapeMix) + escapeTurn * escapeMix;

    // If we're near poles and badly misaligned, slow forward motion so steering can recover.
    const misalignment = Math.min(1, Math.abs(headingDelta) / 90);
    const speedScale = 1 - escapeMix * 0.6 * misalignment;
    const forward = AUTOPILOT_SPEED * speedMult * speedScale;

    return { forward, turn };
  }

  toggle(): void { this.enabled = !this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }
  isEnabled(): boolean { return this.enabled; }
}
