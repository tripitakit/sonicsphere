import type { SphericalCoord, PlayerState } from '../types.ts';
import { moveOnSphere, normalizeCoord } from './sphereMath.ts';

const PLAYER_SPEED = 8;   // units/second
const TURN_SPEED   = 60;  // degrees/second
const POLE_SAFE_LAT = 89.5; // keep player away from pole singularity

export class Player {
  private state: PlayerState;

  constructor(initial?: Partial<PlayerState>) {
    const initialPos = initial?.position ?? { lat: 0, lon: 0 };
    this.state = {
      position: this.clampAwayFromPoles(initialPos),
      heading:  initial?.heading  ?? 0,
    };
  }

  update(dt: number, forward: number, turn: number): void {
    if (turn !== 0) {
      this.state.heading = (this.state.heading + turn * TURN_SPEED * dt + 360) % 360;
    }
    if (forward !== 0) {
      const prev = this.state.position;
      this.state.position = moveOnSphere(
        prev,
        this.state.heading,
        forward * PLAYER_SPEED * dt,
      );
      this.state.position = this.clampAwayFromPoles(this.state.position, prev.lon);
    }
  }

  getState(): Readonly<PlayerState> {
    return this.state;
  }

  setState(partial: Partial<PlayerState>): void {
    if (partial.position) {
      this.state.position = this.clampAwayFromPoles(partial.position, this.state.position.lon);
    }
    if (partial.heading !== undefined) this.state.heading = partial.heading;
  }

  getPosition(): SphericalCoord {
    return this.state.position;
  }

  getHeading(): number {
    return this.state.heading;
  }

  private clampAwayFromPoles(coord: SphericalCoord, fallbackLon?: number): SphericalCoord {
    const normalized = normalizeCoord(coord);
    if (normalized.lat > POLE_SAFE_LAT) {
      return { lat: POLE_SAFE_LAT, lon: fallbackLon ?? normalized.lon };
    }
    if (normalized.lat < -POLE_SAFE_LAT) {
      return { lat: -POLE_SAFE_LAT, lon: fallbackLon ?? normalized.lon };
    }
    return normalized;
  }
}
