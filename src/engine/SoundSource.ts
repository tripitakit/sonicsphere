import type { SoundEngineType, SoundSourceState, SphericalCoord } from '../types.ts';
import type { Gain } from 'tone';
import { SourceSynth } from '../audio/SourceSynth.ts';
import {
  chordDistance,
  directionInPlayerFrame,
  oscillatedPosition,
  HEARING_RADIUS,
} from './sphereMath.ts';

// Hysteresis band: enter at HEARING_RADIUS, exit only at EXIT_RADIUS.
// Prevents rapid create/destroy when player is at the boundary.
const EXIT_RADIUS = HEARING_RADIUS * 1.1;
const DISTANCE_FALLOFF_EXPONENT = 2;

export class SoundSource {
  private synth: SourceSynth | null = null;
  private inRange = false;

  constructor(private state: SoundSourceState) {}

  /**
   * @param audioRunning  AudioContext has started — allow stop operations
   * @param canStartNew   Within quota AND in range — allow synth creation
   */
  update(
    elapsedSeconds: number,
    playerPos: SphericalCoord,
    playerHeading: number,
    masterGain: Gain,
    audioRunning: boolean,
    canStartNew: boolean,
  ): void {
    this.state.current = oscillatedPosition(
      this.state.equilibrium,
      this.state.oscillation.amplitude,
      this.state.oscillation.phase,
      elapsedSeconds,
      this.state.oscillation.period,
    );

    const dist = chordDistance(playerPos, this.state.current);

    if (audioRunning) {
      if (canStartNew && dist < HEARING_RADIUS && !this.inRange) {
        // Enter range: create and start synth
        this.synth = new SourceSynth(this.state.archetype, this.state.variation, masterGain);
        this.synth.start();
        this.inRange = true;
      } else if (this.inRange && dist > EXIT_RADIUS) {
        // Exit range (hysteresis): stop synth, synth self-disposes after release
        this.synth?.stop();
        this.synth = null;
        this.inRange = false;
      }
    }

    if (this.synth && this.inRange) {
      const norm = Math.max(0, 1 - dist / HEARING_RADIUS);
      this.synth.setDistanceGain(Math.pow(norm, DISTANCE_FALLOFF_EXPONENT));

      const dir = directionInPlayerFrame(playerPos, playerHeading, this.state.current);
      this.synth.setPosition(dir.x, dir.y, dir.z);
    }
  }

  getCurrentPosition(): SphericalCoord { return this.state.current; }
  getEquilibrium(): SphericalCoord     { return this.state.equilibrium; }
  getId(): string                       { return this.state.id; }
  getArchetypeName(): string            { return this.state.archetype.name; }
  getArchetype()                        { return this.state.archetype; }
  getEngineType(): SoundEngineType      { return this.state.archetype.engine ?? 'subtractive'; }
  isAudible(): boolean                  { return this.inRange; }

  /**
   * Mutates the archetype parameter (so future synths pick it up) and
   * propagates the change to the currently active SourceSynth if present.
   * Compound keys like 'filter.freq' and 'filter.Q' are handled here.
   */
  updateArchetypeParam(key: string, value: number | string): void {
    const arch = this.state.archetype;
    if (key === 'filter.freq') {
      arch.filter.freq = Number(value);
    } else if (key === 'filter.Q') {
      arch.filter.Q = Number(value);
    } else {
      (arch as unknown as Record<string, unknown>)[key] = value;
    }
    this.synth?.updateParam(key, value);
  }

  getDistanceFrom(pos: SphericalCoord): number {
    return chordDistance(pos, this.state.current);
  }

  forceStop(): void {
    if (!this.inRange) return;
    // Used by voice-quota management: prefer fast teardown over long release tails
    // to prevent overlapping zombie voices and audio stutter.
    this.synth?.dispose();
    this.synth = null;
    this.inRange = false;
  }

  dispose(): void {
    this.synth?.dispose();
    this.synth = null;
    this.inRange = false;
  }
}
