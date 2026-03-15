/**
 * Autopilot: organic wandering with a temporary manual heading override.
 *
 * The gizmo represents a desired local direction only while manual steering is
 * active. The player follows it with a smooth curve, then after 30 seconds of
 * active movement the controller falls back to organic autopilot wandering.
 */
import type { SphericalCoord } from '../types.ts';

const TAU = Math.PI * 2;
const AUTOPILOT_SPEED = 3 / 8; // fraction of PLAYER_SPEED (8 u/s)
const GIZMO_ROTATION_SPEED_DEG = 120;
const TURN_FULL_LOCK_ANGLE_DEG = 72;
const STRAIGHT_DEADZONE_DEG = 0.75;
export const MANUAL_OVERRIDE_DURATION_SEC = 30;

// Incommensurable periods keep the autopilot path organic and non-repeating.
const PERIOD_1 = 44.7;
const PERIOD_2 = 27.3;
const PHASE_2 = 1.618;
const TURN_AMP_1 = 0.09;
const TURN_AMP_2 = 0.05;

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

function normalizeHeadingDeg(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/** Signed smallest angular difference (target - current) in degrees [-180, 180]. */
function shortestAngleDeltaDeg(current: number, target: number): number {
  return ((target - current + 540) % 360) - 180;
}

function speedMultiplierFromWave(wave: number): number {
  const s = clampSigned(wave);
  if (s >= 0) return 1 + s * (SPEED_MULT_MAX - 1);
  return 1 + s * (1 - SPEED_MULT_MIN);
}

type MovementIntent = { forward: number; turn: number };

export class Autopilot {
  private targetHeadingDeg: number;
  private manualOverrideRemainingSec: number;

  constructor(initialTargetHeadingDeg = 0, initialManualOverrideRemainingSec = 0) {
    this.targetHeadingDeg = normalizeHeadingDeg(initialTargetHeadingDeg);
    this.manualOverrideRemainingSec = Math.max(0, initialManualOverrideRemainingSec);
  }

  setTargetHeading(headingDeg: number): void {
    this.targetHeadingDeg = normalizeHeadingDeg(headingDeg);
  }

  cancelManualOverride(playerHeading?: number): void {
    if (playerHeading !== undefined) this.targetHeadingDeg = normalizeHeadingDeg(playerHeading);
    this.manualOverrideRemainingSec = 0;
  }

  private activateManualOverride(): void {
    this.manualOverrideRemainingSec = MANUAL_OVERRIDE_DURATION_SEC;
  }

  tick(dt: number): void {
    if (dt <= 0 || this.manualOverrideRemainingSec <= 0) return;
    this.manualOverrideRemainingSec = Math.max(0, this.manualOverrideRemainingSec - dt);
  }

  setDirectionFromLocalAngle(playerHeading: number, angleDeg: number): void {
    this.setTargetHeading(playerHeading + angleDeg);
    this.activateManualOverride();
  }

  rotateTargetHeading(turnIntent: number, dt: number, playerHeading: number): void {
    if (turnIntent === 0 || dt <= 0) return;
    if (!this.isManualOverrideActive()) this.setTargetHeading(playerHeading);
    this.setTargetHeading(this.targetHeadingDeg + turnIntent * GIZMO_ROTATION_SPEED_DEG * dt);
    this.activateManualOverride();
  }

  getTargetHeading(): number {
    return this.targetHeadingDeg;
  }

  getManualOverrideRemainingSec(): number {
    return this.manualOverrideRemainingSec;
  }

  isManualOverrideActive(): boolean {
    return this.manualOverrideRemainingSec > 0;
  }

  getDirectionAngle(playerHeading: number): number {
    if (!this.isManualOverrideActive()) return 0;
    const angle = shortestAngleDeltaDeg(playerHeading, this.targetHeadingDeg);
    return Math.abs(angle) < STRAIGHT_DEADZONE_DEG ? 0 : angle;
  }

  /** Returns movement intent compatible with Player.update(). */
  getIntent(
    elapsed: number,
    playerPos?: SphericalCoord,
    playerHeading?: number,
  ): MovementIntent {
    const organicIntent = this.getOrganicIntent(elapsed, playerPos, playerHeading);
    if (!this.isManualOverrideActive() || playerPos === undefined || playerHeading === undefined) {
      return organicIntent;
    }

    const headingError = this.getDirectionAngle(playerHeading);
    const manualIntent = this.applyPoleEscape(
      {
        forward: organicIntent.forward,
        turn: clampSigned(headingError / TURN_FULL_LOCK_ANGLE_DEG),
      },
      playerPos,
      playerHeading,
    );

    return manualIntent;
  }

  private getOrganicIntent(
    elapsed: number,
    playerPos?: SphericalCoord,
    playerHeading?: number,
  ): MovementIntent {
    const baseTurn =
      Math.sin((elapsed / PERIOD_1) * TAU) * TURN_AMP_1 +
      Math.sin((elapsed / PERIOD_2) * TAU + PHASE_2) * TURN_AMP_2;
    const speedWave =
      Math.sin((elapsed / SPEED_PERIOD_1) * TAU) * SPEED_WAVE_AMP_1 +
      Math.sin((elapsed / SPEED_PERIOD_2) * TAU + SPEED_PHASE_2) * SPEED_WAVE_AMP_2;
    const baseIntent: MovementIntent = {
      forward: AUTOPILOT_SPEED * speedMultiplierFromWave(speedWave),
      turn: baseTurn,
    };

    if (playerPos === undefined || playerHeading === undefined) return baseIntent;
    return this.applyPoleEscape(baseIntent, playerPos, playerHeading);
  }

  private applyPoleEscape(
    intent: MovementIntent,
    playerPos: SphericalCoord,
    playerHeading: number,
  ): MovementIntent {
    const absLat = Math.abs(playerPos.lat);
    const escapeMix = clamp01((absLat - POLE_ESCAPE_START_LAT) / (POLE_ESCAPE_FULL_LAT - POLE_ESCAPE_START_LAT));

    // In north hemisphere, heading 180 moves south (towards equator).
    // In south hemisphere, heading 0 moves north (towards equator).
    const escapeHeading = playerPos.lat >= 0 ? 180 : 0;
    const headingDelta = shortestAngleDeltaDeg(playerHeading, escapeHeading);
    const escapeTurn = Math.max(-1, Math.min(1, headingDelta / 45));

    return {
      forward: intent.forward * (1 - escapeMix * 0.6 * Math.min(1, Math.abs(headingDelta) / 90)),
      turn: intent.turn * (1 - escapeMix) + escapeTurn * escapeMix,
    };
  }
}
