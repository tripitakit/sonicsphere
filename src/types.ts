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
export type SoundEngineType = 'subtractive' | 'noise' | 'fm' | 'resonator';
export type NoiseColor = 'white' | 'pink' | 'brown';

export interface SoundArchetype {
  name: string;
  frequency: number;
  waveform: OscillatorWaveform;
  engine?: SoundEngineType;
  mode?: 'drone' | 'rhythmic'; // Optional behavior profile. Default is drone.
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: LfoTarget; // Legacy metadata; runtime modulation is amplitude/timbre only (no pitch LFO)
  filter: { type: FilterType; freq: number; Q: number };
  noiseColor?: NoiseColor;
  fmHarmonicity?: number;
  fmModulationIndex?: number;
  fmModulationType?: OscillatorWaveform;
  resonatorHz?: number;
  resonatorFeedback?: number;
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
  playerTargetHeading?: number;
  playerManualOverrideRemainingSec?: number;
  // Legacy local gizmo offset kept only for migration from the previous build.
  playerDirectionAngle?: number;
  // Stable world epoch so source oscillations continue across sessions.
  worldEpochMs?: number;
  // Last time we wrote state, useful for diagnostics and future migration.
  lastSeenAtMs?: number;
}

export type WeatherZoneType = 'mist' | 'echo' | 'ion';
export type WeatherZoneRole = 'strong' | 'background';

export interface ActiveWeatherZone {
  id: string;
  type: WeatherZoneType;
  role: WeatherZoneRole;
  center: SphericalCoord;
  radiusDeg: number;
  featherDeg: number;
  influence: number; // 0..1 after zone intensity + distance falloff
}

// ── Create World types ───────────────────────────────────────────────────────

/** A user-placed sound source definition (serializable). */
export interface UserSourceDef {
  id: string;
  archetypeName: string;
  position: SphericalCoord;
  variation: SourceVariation;
  oscillation: SoundSourceOscillation;
}

/** A user-placed weather zone definition (serializable). */
export interface UserZoneDef {
  id: string;
  type: WeatherZoneType;
  presetIndex: number;
  center: SphericalCoord;
  radiusDeg: number;
  featherDeg: number;
  intensity: number;
  driftEnabled: boolean;
}

/** A complete user-created world definition (serializable). */
export interface WorldDef {
  id: string;
  name: string;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  sources: UserSourceDef[];
  zones: UserZoneDef[];
}

/** Lightweight list item returned by GET /api/worlds. */
export interface WorldSummary {
  id: string;
  name: string;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  sourceCount: number;
  zoneCount: number;
}

// ── Weather FX types ─────────────────────────────────────────────────────────

export interface WeatherFxBlend {
  wetLevel: number;           // overall FX return amount
  delayTimeSec: number;       // free/organic delay time (seconds)
  delayFeedback: number;      // 0..1
  delayWet: number;           // wet mix inside feedback delay
  reverbRoomSize: number;     // 0..1
  highpassHz: number;         // pre-FX high-pass cutoff
  lowpassHz: number;          // pre-FX low-pass cutoff
  bandpassMix: number;        // crossfade into rapid-sweep band-pass lane
  bandpassQ: number;          // resonance for the band-pass lane
  bandpassSweepHz: number;    // LFO rate for rapid sweep
  bandpassSweepMinHz: number; // LFO minimum frequency
  bandpassSweepMaxHz: number; // LFO maximum frequency
}
