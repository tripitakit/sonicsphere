export interface SphericalCoord {
  lat: number; // degrees, -90 to 90
  lon: number; // degrees, -180 to 180
}

export interface CartesianCoord {
  x: number;
  y: number;
  z: number;
}

export type OscillatorWaveform = 'sine' | 'square' | 'triangle' | 'sawtooth';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type LfoTarget = 'frequency' | 'amplitude';

export interface SoundArchetype {
  name: string;
  frequency: number;
  waveform: OscillatorWaveform;
  mode?: 'drone' | 'rhythmic'; // Optional behavior profile. Default is drone.
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: LfoTarget; // Legacy metadata; runtime modulation is amplitude/timbre only (no pitch LFO)
  filter: { type: FilterType; freq: number; Q: number };
}

export interface SoundSourceOscillation {
  period: number;    // seconds (180-480 = 3-8 minutes)
  phase: number;     // radians, random at startup
  amplitude: number; // degrees of arc deviation
}

export interface SourceVariation {
  detuneCents: number;    // Per-instance unique carrier shift (prevents duplicate pitch within an archetype)
  filterFreqMult: number; // 0.8..1.25 — shifts filter cutoff/centre per instance
  lfoRateMult: number;    // 0.75..1.3 — individuality in modulation speed
}

export interface SoundSourceState {
  id: string;
  archetype: SoundArchetype;
  variation: SourceVariation;
  equilibrium: SphericalCoord;
  current: SphericalCoord;
  oscillation: SoundSourceOscillation;
}

export interface PlayerState {
  position: SphericalCoord;
  heading: number; // degrees, 0=north, 90=east
}

export interface PersistedState {
  playerPosition: SphericalCoord;
  playerHeading: number;
  // Stable world epoch so source oscillations continue across sessions.
  worldEpochMs?: number;
  // Last time we wrote state, useful for diagnostics and future migration.
  lastSeenAtMs?: number;
}
