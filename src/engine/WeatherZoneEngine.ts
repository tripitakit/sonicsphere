import type {
  ActiveWeatherZone,
  SphericalCoord,
  UserZoneDef,
  WeatherFxBlend,
  WeatherZoneRole,
  WeatherZoneType,
} from '../types.ts';
import { chordDistance, normalizeCoord, SPHERE_RADIUS } from './sphereMath.ts';

const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_ZONE_COUNT = 28;
const MAX_ACTIVE_ZONES = 3;
const MAX_STRONG_ZONES = 2;
const MIN_ZONE_INFLUENCE = 0.012;
const EPS = 1e-6;

export type WeatherFxProfileName = 'subtle' | 'experimental' | 'extreme';

type WeatherTypeFxBias = {
  wetLevel: number;
  delayTimeSec: number;
  delayFeedback: number;
  delayWet: number;
  reverbRoomSize: number;
  highpassHz: number;
  lowpassHz: number;
  bandpassMix: number;
  bandpassQ: number;
  bandpassSweepHz: number;
  bandpassSweepMinHz: number;
  bandpassSweepMaxHz: number;
};

type WeatherOverlapBoost = {
  wetLevel: number;
  delayFeedback: number;
  delayWet: number;
  reverbRoomSize: number;
  bandpassMix: number;
  bandpassQ: number;
  bandpassSweepHz: number;
};

type WeatherFxMultiplier = {
  wetLevel: number;
  delayFeedback: number;
  delayWet: number;
  reverbRoomSize: number;
  bandpassMix: number;
  bandpassQ: number;
  bandpassSweepHz: number;
};

type WeatherFxSmoothingStep = {
  default: number;
  delayTimeSec: number;
  delayFeedback: number;
  delayWet: number;
  bandpassSweepHz: number;
  bandpassSweepRange: number;
};

export type WeatherEffectTuning = {
  profileName: string;
  globalBlendAmount: number;
  roleWeightStrong: number;
  roleWeightBackground: number;
  zoneTypeWeight: Record<WeatherZoneType, number>;
  zoneTypeFxBias: Record<WeatherZoneType, WeatherTypeFxBias>;
  overlapBoost: WeatherOverlapBoost;
  fxMultiplier: WeatherFxMultiplier;
  delayQuantization: {
    enabled: boolean;
    stepSec: number;
    blend: number;
    minHoldSec: number;
    switchThresholdSec: number;
  };
  fxSmoothing: {
    active: WeatherFxSmoothingStep;
    idle: WeatherFxSmoothingStep;
  };
};

/**
 * Fast tuning surface for weather-FX behavior.
 * Keep edits here for rapid listening tests.
 */
export const WEATHER_EFFECT_PRESETS: Record<WeatherFxProfileName, WeatherEffectTuning> = {
  subtle: {
    profileName: 'subtle-contemplative',
    globalBlendAmount: 1.08,
    roleWeightStrong: 1.0,
    roleWeightBackground: 0.54,
    zoneTypeWeight: {
      mist: 1.0,
      echo: 1.04,
      ion: 1.1,
    },
    zoneTypeFxBias: {
      mist: {
        wetLevel: 1.08,
        delayTimeSec: 0.94,
        delayFeedback: 0.9,
        delayWet: 0.86,
        reverbRoomSize: 1.18,
        highpassHz: 0.9,
        lowpassHz: 0.9,
        bandpassMix: 0.88,
        bandpassQ: 0.9,
        bandpassSweepHz: 0.84,
        bandpassSweepMinHz: 0.92,
        bandpassSweepMaxHz: 0.92,
      },
      echo: {
        wetLevel: 1.1,
        delayTimeSec: 1.08,
        delayFeedback: 1.2,
        delayWet: 1.16,
        reverbRoomSize: 1.12,
        highpassHz: 0.96,
        lowpassHz: 0.84,
        bandpassMix: 0.96,
        bandpassQ: 1.02,
        bandpassSweepHz: 0.9,
        bandpassSweepMinHz: 0.95,
        bandpassSweepMaxHz: 0.98,
      },
      ion: {
        wetLevel: 0.92,
        delayTimeSec: 0.88,
        delayFeedback: 0.88,
        delayWet: 0.82,
        reverbRoomSize: 0.9,
        highpassHz: 1.12,
        lowpassHz: 1.08,
        bandpassMix: 1.18,
        bandpassQ: 1.2,
        bandpassSweepHz: 1.08,
        bandpassSweepMinHz: 0.92,
        bandpassSweepMaxHz: 1.08,
      },
    },
    overlapBoost: {
      wetLevel: 0.018,
      delayFeedback: 0.02,
      delayWet: 0.018,
      reverbRoomSize: 0.02,
      bandpassMix: 0.04,
      bandpassQ: 0.25,
      bandpassSweepHz: 0.15,
    },
    fxMultiplier: {
      wetLevel: 1.08,
      delayFeedback: 1.06,
      delayWet: 1.02,
      reverbRoomSize: 1.04,
      bandpassMix: 1.12,
      bandpassQ: 1.08,
      bandpassSweepHz: 1.04,
    },
    delayQuantization: {
      enabled: true,
      stepSec: 0.035,
      blend: 0.86,
      minHoldSec: 0.96,
      switchThresholdSec: 0.025,
    },
    fxSmoothing: {
      active: {
        default: 0.13,
        delayTimeSec: 0.055,
        delayFeedback: 0.09,
        delayWet: 0.09,
        bandpassSweepHz: 0.07,
        bandpassSweepRange: 0.045,
      },
      idle: {
        default: 0.075,
        delayTimeSec: 0.03,
        delayFeedback: 0.05,
        delayWet: 0.05,
        bandpassSweepHz: 0.04,
        bandpassSweepRange: 0.026,
      },
    },
  },
  experimental: {
    profileName: 'experimental-v4-deep-anomaly',
    globalBlendAmount: 1.52,
    roleWeightStrong: 1.0,
    roleWeightBackground: 0.74,
    zoneTypeWeight: {
      mist: 1.12,
      echo: 1.30,
      ion: 1.46,
    },
    zoneTypeFxBias: {
      mist: {
        wetLevel: 1.28,
        delayTimeSec: 0.86,
        delayFeedback: 0.94,
        delayWet: 0.92,
        reverbRoomSize: 1.56,
        highpassHz: 0.72,
        lowpassHz: 0.66,
        bandpassMix: 1.16,
        bandpassQ: 1.12,
        bandpassSweepHz: 0.98,
        bandpassSweepMinHz: 0.82,
        bandpassSweepMaxHz: 0.86,
      },
      echo: {
        wetLevel: 1.46,
        delayTimeSec: 1.34,
        delayFeedback: 1.62,
        delayWet: 1.56,
        reverbRoomSize: 1.44,
        highpassHz: 0.90,
        lowpassHz: 0.60,
        bandpassMix: 1.36,
        bandpassQ: 1.38,
        bandpassSweepHz: 1.18,
        bandpassSweepMinHz: 0.92,
        bandpassSweepMaxHz: 1.10,
      },
      ion: {
        wetLevel: 1.06,
        delayTimeSec: 0.80,
        delayFeedback: 0.96,
        delayWet: 0.94,
        reverbRoomSize: 0.94,
        highpassHz: 1.42,
        lowpassHz: 1.24,
        bandpassMix: 1.88,
        bandpassQ: 2.04,
        bandpassSweepHz: 1.76,
        bandpassSweepMinHz: 0.86,
        bandpassSweepMaxHz: 1.38,
      },
    },
    overlapBoost: {
      wetLevel: 0.07,
      delayFeedback: 0.12,
      delayWet: 0.09,
      reverbRoomSize: 0.10,
      bandpassMix: 0.22,
      bandpassQ: 1.8,
      bandpassSweepHz: 1.4,
    },
    fxMultiplier: {
      wetLevel: 1.50,
      delayFeedback: 1.46,
      delayWet: 1.38,
      reverbRoomSize: 1.36,
      bandpassMix: 1.78,
      bandpassQ: 1.56,
      bandpassSweepHz: 1.46,
    },
    delayQuantization: {
      enabled: true,
      stepSec: 0.07,
      blend: 0.94,
      minHoldSec: 1.08,
      switchThresholdSec: 0.045,
    },
    fxSmoothing: {
      active: {
        default: 0.145,
        delayTimeSec: 0.058,
        delayFeedback: 0.096,
        delayWet: 0.096,
        bandpassSweepHz: 0.078,
        bandpassSweepRange: 0.05,
      },
      idle: {
        default: 0.082,
        delayTimeSec: 0.038,
        delayFeedback: 0.056,
        delayWet: 0.056,
        bandpassSweepHz: 0.048,
        bandpassSweepRange: 0.032,
      },
    },
  },
  extreme: {
    profileName: 'extreme-fractured-weather',
    globalBlendAmount: 1.72,
    roleWeightStrong: 1.0,
    roleWeightBackground: 0.82,
    zoneTypeWeight: {
      mist: 1.18,
      echo: 1.44,
      ion: 1.62,
    },
    zoneTypeFxBias: {
      mist: {
        wetLevel: 1.38,
        delayTimeSec: 0.82,
        delayFeedback: 0.98,
        delayWet: 0.94,
        reverbRoomSize: 1.72,
        highpassHz: 0.64,
        lowpassHz: 0.56,
        bandpassMix: 1.28,
        bandpassQ: 1.22,
        bandpassSweepHz: 1.06,
        bandpassSweepMinHz: 0.76,
        bandpassSweepMaxHz: 0.80,
      },
      echo: {
        wetLevel: 1.62,
        delayTimeSec: 1.48,
        delayFeedback: 1.82,
        delayWet: 1.74,
        reverbRoomSize: 1.62,
        highpassHz: 0.86,
        lowpassHz: 0.52,
        bandpassMix: 1.56,
        bandpassQ: 1.56,
        bandpassSweepHz: 1.32,
        bandpassSweepMinHz: 0.88,
        bandpassSweepMaxHz: 1.18,
      },
      ion: {
        wetLevel: 1.14,
        delayTimeSec: 0.74,
        delayFeedback: 1.04,
        delayWet: 1.02,
        reverbRoomSize: 0.98,
        highpassHz: 1.56,
        lowpassHz: 1.32,
        bandpassMix: 2.24,
        bandpassQ: 2.48,
        bandpassSweepHz: 2.14,
        bandpassSweepMinHz: 0.76,
        bandpassSweepMaxHz: 1.52,
      },
    },
    overlapBoost: {
      wetLevel: 0.10,
      delayFeedback: 0.20,
      delayWet: 0.16,
      reverbRoomSize: 0.16,
      bandpassMix: 0.34,
      bandpassQ: 3.6,
      bandpassSweepHz: 3.2,
    },
    fxMultiplier: {
      wetLevel: 1.72,
      delayFeedback: 1.68,
      delayWet: 1.58,
      reverbRoomSize: 1.56,
      bandpassMix: 2.24,
      bandpassQ: 2.0,
      bandpassSweepHz: 1.88,
    },
    delayQuantization: {
      enabled: true,
      stepSec: 0.09,
      blend: 0.97,
      minHoldSec: 0.92,
      switchThresholdSec: 0.055,
    },
    fxSmoothing: {
      active: {
        default: 0.18,
        delayTimeSec: 0.072,
        delayFeedback: 0.12,
        delayWet: 0.12,
        bandpassSweepHz: 0.095,
        bandpassSweepRange: 0.065,
      },
      idle: {
        default: 0.09,
        delayTimeSec: 0.04,
        delayFeedback: 0.062,
        delayWet: 0.062,
        bandpassSweepHz: 0.055,
        bandpassSweepRange: 0.038,
      },
    },
  },
};

// Active FX profile — mutable so it can be switched at runtime.
// Cloned from preset so user-param overrides don't corrupt the original preset data.
let activeProfileName: WeatherFxProfileName = 'experimental';
let WEATHER_EFFECT_TUNING: WeatherEffectTuning = structuredClone(WEATHER_EFFECT_PRESETS[activeProfileName]);

export const WEATHER_FX_PROFILE_NAMES: readonly WeatherFxProfileName[] = ['subtle', 'experimental', 'extreme'];

export function getWeatherFxProfile(): WeatherFxProfileName {
  return activeProfileName;
}

export function setWeatherFxProfile(name: WeatherFxProfileName): void {
  activeProfileName = name;
  WEATHER_EFFECT_TUNING = structuredClone(WEATHER_EFFECT_PRESETS[name]);
}

/** Returns the live, mutable tuning object. Callers may mutate fields directly. */
export function getTuning(): WeatherEffectTuning {
  return WEATHER_EFFECT_TUNING;
}

interface WeatherPresetVariant {
  name: string;
  wetLevel: number;
  delayTimeSec: number;
  delayFeedback: number;
  delayWet: number;
  reverbRoomSize: number;
  highpassHz: number;
  lowpassHz: number;
  bandpassMix: number;
  bandpassQ: number;
  bandpassSweepHz: number;
  bandpassMinHz: number;
  bandpassMaxHz: number;
  delayOrganicDepthSec: number;
  delayOrganicHz: number;
}

export interface WeatherZoneModel {
  id: string;
  type: WeatherZoneType;
  presetIndex: number;
  center: SphericalCoord;
  radiusDeg: number;
  featherDeg: number;
  intensity: number;
  driftPeriodSec: number;
  driftLatDeg: number;
  driftLonDeg: number;
  driftPhaseA: number;
  driftPhaseB: number;
  delayPhase: number;
}

interface EvaluatedZone {
  model: WeatherZoneModel;
  center: SphericalCoord;
  influence: number;
}

interface SelectedZone extends EvaluatedZone {
  role: WeatherZoneRole;
}

export interface WeatherFrame {
  activeZones: readonly ActiveWeatherZone[];
  fx: WeatherFxBlend;
}

export const DEFAULT_WEATHER_FX_BLEND: WeatherFxBlend = {
  wetLevel: 0.085,
  delayTimeSec: 0.24,
  delayFeedback: 0.16,
  delayWet: 0.13,
  reverbRoomSize: 0.34,
  highpassHz: 60,
  lowpassHz: 8800,
  bandpassMix: 0.02,
  bandpassQ: 1.0,
  bandpassSweepHz: 0.25,
  bandpassSweepMinHz: 550,
  bandpassSweepMaxHz: 1200,
};

const WEATHER_PRESET_VARIANTS: Record<WeatherZoneType, readonly WeatherPresetVariant[]> = {
  mist: [
    {
      name: 'mist-veil',
      wetLevel: 0.16,
      delayTimeSec: 0.24,
      delayFeedback: 0.15,
      delayWet: 0.12,
      reverbRoomSize: 0.58,
      highpassHz: 62,
      lowpassHz: 3500,
      bandpassMix: 0.05,
      bandpassQ: 1.1,
      bandpassSweepHz: 0.36,
      bandpassMinHz: 620,
      bandpassMaxHz: 980,
      delayOrganicDepthSec: 0.02,
      delayOrganicHz: 0.075,
    },
    {
      name: 'mist-glass',
      wetLevel: 0.18,
      delayTimeSec: 0.31,
      delayFeedback: 0.2,
      delayWet: 0.15,
      reverbRoomSize: 0.61,
      highpassHz: 74,
      lowpassHz: 4200,
      bandpassMix: 0.08,
      bandpassQ: 1.35,
      bandpassSweepHz: 0.48,
      bandpassMinHz: 760,
      bandpassMaxHz: 1250,
      delayOrganicDepthSec: 0.03,
      delayOrganicHz: 0.11,
    },
    {
      name: 'mist-dawn',
      wetLevel: 0.17,
      delayTimeSec: 0.27,
      delayFeedback: 0.17,
      delayWet: 0.13,
      reverbRoomSize: 0.54,
      highpassHz: 70,
      lowpassHz: 3950,
      bandpassMix: 0.06,
      bandpassQ: 1.22,
      bandpassSweepHz: 0.42,
      bandpassMinHz: 700,
      bandpassMaxHz: 1120,
      delayOrganicDepthSec: 0.024,
      delayOrganicHz: 0.094,
    },
  ],
  echo: [
    {
      name: 'echo-canyon',
      wetLevel: 0.2,
      delayTimeSec: 0.56,
      delayFeedback: 0.32,
      delayWet: 0.27,
      reverbRoomSize: 0.46,
      highpassHz: 112,
      lowpassHz: 6200,
      bandpassMix: 0.1,
      bandpassQ: 1.65,
      bandpassSweepHz: 0.58,
      bandpassMinHz: 860,
      bandpassMaxHz: 1500,
      delayOrganicDepthSec: 0.082,
      delayOrganicHz: 0.16,
    },
    {
      name: 'echo-stone',
      wetLevel: 0.18,
      delayTimeSec: 0.47,
      delayFeedback: 0.27,
      delayWet: 0.22,
      reverbRoomSize: 0.42,
      highpassHz: 104,
      lowpassHz: 7000,
      bandpassMix: 0.08,
      bandpassQ: 1.42,
      bandpassSweepHz: 0.5,
      bandpassMinHz: 940,
      bandpassMaxHz: 1680,
      delayOrganicDepthSec: 0.068,
      delayOrganicHz: 0.14,
    },
    {
      name: 'echo-hollow',
      wetLevel: 0.21,
      delayTimeSec: 0.63,
      delayFeedback: 0.36,
      delayWet: 0.31,
      reverbRoomSize: 0.51,
      highpassHz: 124,
      lowpassHz: 5800,
      bandpassMix: 0.13,
      bandpassQ: 1.94,
      bandpassSweepHz: 0.72,
      bandpassMinHz: 980,
      bandpassMaxHz: 1640,
      delayOrganicDepthSec: 0.091,
      delayOrganicHz: 0.19,
    },
  ],
  ion: [
    {
      name: 'ion-shimmer',
      wetLevel: 0.15,
      delayTimeSec: 0.28,
      delayFeedback: 0.2,
      delayWet: 0.16,
      reverbRoomSize: 0.4,
      highpassHz: 150,
      lowpassHz: 7700,
      bandpassMix: 0.29,
      bandpassQ: 3.6,
      bandpassSweepHz: 5.6,
      bandpassMinHz: 480,
      bandpassMaxHz: 2550,
      delayOrganicDepthSec: 0.042,
      delayOrganicHz: 0.28,
    },
    {
      name: 'ion-orbit',
      wetLevel: 0.14,
      delayTimeSec: 0.33,
      delayFeedback: 0.24,
      delayWet: 0.18,
      reverbRoomSize: 0.44,
      highpassHz: 176,
      lowpassHz: 7350,
      bandpassMix: 0.36,
      bandpassQ: 4.4,
      bandpassSweepHz: 7.4,
      bandpassMinHz: 430,
      bandpassMaxHz: 3100,
      delayOrganicDepthSec: 0.056,
      delayOrganicHz: 0.33,
    },
    {
      name: 'ion-strand',
      wetLevel: 0.17,
      delayTimeSec: 0.3,
      delayFeedback: 0.23,
      delayWet: 0.19,
      reverbRoomSize: 0.45,
      highpassHz: 168,
      lowpassHz: 7100,
      bandpassMix: 0.33,
      bandpassQ: 4.9,
      bandpassSweepHz: 8.5,
      bandpassMinHz: 390,
      bandpassMaxHz: 3300,
      delayOrganicDepthSec: 0.06,
      delayOrganicHz: 0.35,
    },
  ],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Fast deterministic LCG PRNG. Returns values in [0, 1). */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function weightedWeatherType(rng: () => number): WeatherZoneType {
  const roll = rng();
  if (roll < 0.46) return 'mist';
  if (roll < 0.8) return 'echo';
  return 'ion';
}

function degreesToChord(distanceDeg: number): number {
  const halfAngle = clamp(distanceDeg, 0, 180) * DEG_TO_RAD * 0.5;
  return 2 * SPHERE_RADIUS * Math.sin(halfAngle);
}

function clampBlend(blend: WeatherFxBlend): WeatherFxBlend {
  const minHz = clamp(blend.bandpassSweepMinHz, 180, 6400);
  const maxHz = clamp(blend.bandpassSweepMaxHz, 520, 9200);
  const safeMin = Math.min(minHz, maxHz - 150);
  const safeMax = Math.max(safeMin + 150, maxHz);

  return {
    wetLevel: clamp(blend.wetLevel, 0.06, 0.38),
    delayTimeSec: clamp(blend.delayTimeSec, 0.1, 0.82),
    delayFeedback: clamp(blend.delayFeedback, 0.08, 0.62),
    delayWet: clamp(blend.delayWet, 0.05, 0.58),
    reverbRoomSize: clamp(blend.reverbRoomSize, 0.2, 0.9),
    highpassHz: clamp(blend.highpassHz, 35, 520),
    lowpassHz: clamp(blend.lowpassHz, 1800, 11000),
    bandpassMix: clamp(blend.bandpassMix, 0, 0.84),
    bandpassQ: clamp(blend.bandpassQ, 0.8, 11),
    bandpassSweepHz: clamp(blend.bandpassSweepHz, 0.12, 15),
    bandpassSweepMinHz: safeMin,
    bandpassSweepMaxHz: safeMax,
  };
}

function presetForZone(zone: WeatherZoneModel): WeatherPresetVariant {
  const variants = WEATHER_PRESET_VARIANTS[zone.type];
  return variants[zone.presetIndex] ?? variants[0]!;
}

function applyProfileTuning(blend: WeatherFxBlend): WeatherFxBlend {
  const m = WEATHER_EFFECT_TUNING.fxMultiplier;
  return {
    ...blend,
    wetLevel: blend.wetLevel * m.wetLevel,
    delayFeedback: blend.delayFeedback * m.delayFeedback,
    delayWet: blend.delayWet * m.delayWet,
    reverbRoomSize: blend.reverbRoomSize * m.reverbRoomSize,
    bandpassMix: blend.bandpassMix * m.bandpassMix,
    bandpassQ: blend.bandpassQ * m.bandpassQ,
    bandpassSweepHz: blend.bandpassSweepHz * m.bandpassSweepHz,
  };
}

export class WeatherZoneEngine {
  private zones: WeatherZoneModel[];
  private smoothedFx: WeatherFxBlend = { ...DEFAULT_WEATHER_FX_BLEND };
  private quantizedDelayTimeSec = DEFAULT_WEATHER_FX_BLEND.delayTimeSec;
  private quantizedDelayLastSwitchSec = Number.NEGATIVE_INFINITY;

  constructor(seed = 0x5f3759df, zoneCount = DEFAULT_ZONE_COUNT, externalZones?: WeatherZoneModel[]) {
    this.zones = externalZones ?? this.generateZones(seed, zoneCount);
  }

  /** Returns all zone models (for minimap display). */
  getAllZones(): readonly WeatherZoneModel[] {
    return this.zones;
  }

  static fromUserZones(defs: UserZoneDef[]): WeatherZoneEngine {
    const TAU_LOCAL = Math.PI * 2;
    const models: WeatherZoneModel[] = defs.map((d) => ({
      id: d.id,
      type: d.type,
      presetIndex: d.presetIndex,
      center: { ...d.center },
      radiusDeg: d.radiusDeg,
      featherDeg: d.featherDeg,
      intensity: d.intensity,
      driftPeriodSec: d.driftEnabled ? 400 + Math.random() * 400 : 1e9,
      driftLatDeg: d.driftEnabled ? 1.0 + Math.random() * 1.5 : 0,
      driftLonDeg: d.driftEnabled ? 1.5 + Math.random() * 2.5 : 0,
      driftPhaseA: Math.random() * TAU_LOCAL,
      driftPhaseB: Math.random() * TAU_LOCAL,
      delayPhase: Math.random() * TAU_LOCAL,
    }));
    return new WeatherZoneEngine(0, 0, models);
  }

  update(elapsedSeconds: number, playerPos: SphericalCoord): WeatherFrame {
    const evaluated = this.evaluateZones(elapsedSeconds, playerPos);
    const selected = this.selectActiveZones(evaluated);

    const activeZones: ActiveWeatherZone[] = selected.map((zone) => ({
      id: zone.model.id,
      type: zone.model.type,
      role: zone.role,
      center: zone.center,
      radiusDeg: zone.model.radiusDeg,
      featherDeg: zone.model.featherDeg,
      influence: zone.influence,
    }));

    const rawFx = this.buildFxBlend(selected, elapsedSeconds);

    return {
      activeZones,
      fx: this.smoothFx(rawFx, selected.length > 0),
    };
  }

  private generateZones(seed: number, zoneCount: number): WeatherZoneModel[] {
    const rng = makePrng(seed);
    const count = Math.max(6, zoneCount);
    const zones: WeatherZoneModel[] = [];

    for (let i = 0; i < count; i++) {
      // Fibonacci-like spread so weather patches cover the sphere evenly.
      const t = (i + 0.5) / count;
      const baseLat = Math.asin(2 * t - 1) * RAD_TO_DEG;
      const baseLon = ((i * 137.508) % 360) - 180;
      const type = weightedWeatherType(rng);
      const variants = WEATHER_PRESET_VARIANTS[type];
      const presetIndex = Math.floor(rng() * variants.length);

      zones.push({
        id: `weather-${i}`,
        type,
        presetIndex,
        center: normalizeCoord({
          lat: baseLat + (rng() - 0.5) * 22,
          lon: baseLon + (rng() - 0.5) * 24,
        }),
        radiusDeg: 12 + rng() * 18,
        featherDeg: 8 + rng() * 16,
        intensity: 0.42 + rng() * 0.5,
        driftPeriodSec: 280 + rng() * 620,
        driftLatDeg: 0.4 + rng() * 2.2,
        driftLonDeg: 0.8 + rng() * 3.2,
        driftPhaseA: rng() * TAU,
        driftPhaseB: rng() * TAU,
        delayPhase: rng() * TAU,
      });
    }

    return zones;
  }

  private evaluateZones(elapsedSeconds: number, playerPos: SphericalCoord): EvaluatedZone[] {
    const evaluated: EvaluatedZone[] = [];

    for (const zone of this.zones) {
      const center = this.zoneCenterAt(zone, elapsedSeconds);
      const influence = this.computeInfluence(zone, center, playerPos);
      if (influence <= 0) continue;
      evaluated.push({ model: zone, center, influence });
    }

    evaluated.sort((a, b) => b.influence - a.influence);
    return evaluated;
  }

  private zoneCenterAt(zone: WeatherZoneModel, elapsedSeconds: number): SphericalCoord {
    const driftPhase = elapsedSeconds / zone.driftPeriodSec;
    const lat = zone.center.lat
      + Math.sin(TAU * driftPhase + zone.driftPhaseA) * zone.driftLatDeg;
    const lon = zone.center.lon
      + Math.sin(TAU * driftPhase * 0.87 + zone.driftPhaseB) * zone.driftLonDeg;

    return normalizeCoord({ lat, lon });
  }

  private computeInfluence(
    zone: WeatherZoneModel,
    centerNow: SphericalCoord,
    playerPos: SphericalCoord,
  ): number {
    const distance = chordDistance(playerPos, centerNow);
    const coreRadius = degreesToChord(zone.radiusDeg);
    const outerRadius = degreesToChord(zone.radiusDeg + zone.featherDeg);

    if (distance >= outerRadius) return 0;
    if (distance <= coreRadius) return zone.intensity;

    const t = (outerRadius - distance) / Math.max(EPS, outerRadius - coreRadius);
    return zone.intensity * smoothstep01(t);
  }

  private selectActiveZones(evaluated: readonly EvaluatedZone[]): SelectedZone[] {
    const selected: SelectedZone[] = [];

    for (const zone of evaluated) {
      if (zone.influence < MIN_ZONE_INFLUENCE) break;
      if (selected.length >= MAX_ACTIVE_ZONES) break;

      const role: WeatherZoneRole = selected.length < MAX_STRONG_ZONES ? 'strong' : 'background';
      selected.push({ ...zone, role });
    }

    return selected;
  }

  private buildFxBlend(selected: readonly SelectedZone[], elapsedSeconds: number): WeatherFxBlend {
    if (selected.length === 0) return DEFAULT_WEATHER_FX_BLEND;

    let totalWeight = 0;
    let wetLevel = 0;
    let delayTimeSec = 0;
    let delayFeedback = 0;
    let delayWet = 0;
    let reverbRoomSize = 0;
    let highpassHz = 0;
    let lowpassHz = 0;
    let bandpassMix = 0;
    let bandpassQ = 0;
    let bandpassSweepHz = 0;
    let bandpassSweepMinHz = 0;
    let bandpassSweepMaxHz = 0;

    for (const zone of selected) {
      const preset = presetForZone(zone.model);
      const typeFx = WEATHER_EFFECT_TUNING.zoneTypeFxBias[zone.model.type];
      const roleWeight = zone.role === 'background'
        ? WEATHER_EFFECT_TUNING.roleWeightBackground
        : WEATHER_EFFECT_TUNING.roleWeightStrong;
      const typeWeight = WEATHER_EFFECT_TUNING.zoneTypeWeight[zone.model.type];
      const weight = zone.influence * roleWeight * typeWeight;
      if (weight <= 0) continue;

      const organicDelay = preset.delayTimeSec + Math.sin(
        elapsedSeconds * TAU * preset.delayOrganicHz + zone.model.delayPhase,
      ) * preset.delayOrganicDepthSec;

      totalWeight += weight;
      wetLevel += preset.wetLevel * typeFx.wetLevel * weight;
      delayTimeSec += organicDelay * typeFx.delayTimeSec * weight;
      delayFeedback += preset.delayFeedback * typeFx.delayFeedback * weight;
      delayWet += preset.delayWet * typeFx.delayWet * weight;
      reverbRoomSize += preset.reverbRoomSize * typeFx.reverbRoomSize * weight;
      highpassHz += preset.highpassHz * typeFx.highpassHz * weight;
      lowpassHz += preset.lowpassHz * typeFx.lowpassHz * weight;
      bandpassMix += preset.bandpassMix * typeFx.bandpassMix * weight;
      bandpassQ += preset.bandpassQ * typeFx.bandpassQ * weight;
      bandpassSweepHz += preset.bandpassSweepHz * typeFx.bandpassSweepHz * weight;
      bandpassSweepMinHz += preset.bandpassMinHz * typeFx.bandpassSweepMinHz * weight;
      bandpassSweepMaxHz += preset.bandpassMaxHz * typeFx.bandpassSweepMaxHz * weight;
    }

    if (totalWeight <= EPS) return DEFAULT_WEATHER_FX_BLEND;

    const invWeight = 1 / totalWeight;
    const activity = clamp01((totalWeight / 1.15) * WEATHER_EFFECT_TUNING.globalBlendAmount);
    const rawDelayTimeSec = delayTimeSec * invWeight;
    const stabilizedDelayTimeSec = this.stabilizeDelayTime(rawDelayTimeSec, activity, elapsedSeconds);
    const overlapFactor = clamp01(((selected.length - 1) / Math.max(1, MAX_ACTIVE_ZONES - 1)) * activity);
    const overlap = WEATHER_EFFECT_TUNING.overlapBoost;

    const blend: WeatherFxBlend = {
      wetLevel: lerp(
        DEFAULT_WEATHER_FX_BLEND.wetLevel,
        wetLevel * invWeight + overlap.wetLevel * overlapFactor,
        activity,
      ),
      delayTimeSec: lerp(DEFAULT_WEATHER_FX_BLEND.delayTimeSec, stabilizedDelayTimeSec, activity),
      delayFeedback: lerp(
        DEFAULT_WEATHER_FX_BLEND.delayFeedback,
        delayFeedback * invWeight + overlap.delayFeedback * overlapFactor,
        activity,
      ),
      delayWet: lerp(
        DEFAULT_WEATHER_FX_BLEND.delayWet,
        delayWet * invWeight + overlap.delayWet * overlapFactor,
        activity,
      ),
      reverbRoomSize: lerp(
        DEFAULT_WEATHER_FX_BLEND.reverbRoomSize,
        reverbRoomSize * invWeight + overlap.reverbRoomSize * overlapFactor,
        activity,
      ),
      highpassHz: lerp(DEFAULT_WEATHER_FX_BLEND.highpassHz, highpassHz * invWeight, activity),
      lowpassHz: lerp(DEFAULT_WEATHER_FX_BLEND.lowpassHz, lowpassHz * invWeight, activity),
      bandpassMix: lerp(
        DEFAULT_WEATHER_FX_BLEND.bandpassMix,
        bandpassMix * invWeight + overlap.bandpassMix * overlapFactor,
        activity,
      ),
      bandpassQ: lerp(
        DEFAULT_WEATHER_FX_BLEND.bandpassQ,
        bandpassQ * invWeight + overlap.bandpassQ * overlapFactor,
        activity,
      ),
      bandpassSweepHz: lerp(
        DEFAULT_WEATHER_FX_BLEND.bandpassSweepHz,
        bandpassSweepHz * invWeight + overlap.bandpassSweepHz * overlapFactor,
        activity,
      ),
      bandpassSweepMinHz: lerp(
        DEFAULT_WEATHER_FX_BLEND.bandpassSweepMinHz,
        bandpassSweepMinHz * invWeight,
        activity,
      ),
      bandpassSweepMaxHz: lerp(
        DEFAULT_WEATHER_FX_BLEND.bandpassSweepMaxHz,
        bandpassSweepMaxHz * invWeight,
        activity,
      ),
    };

    return clampBlend(applyProfileTuning(blend));
  }

  private stabilizeDelayTime(rawDelayTimeSec: number, activity: number, elapsedSeconds: number): number {
    const q = WEATHER_EFFECT_TUNING.delayQuantization;
    if (!q.enabled || q.stepSec <= EPS) return rawDelayTimeSec;

    const quantizedCandidate = clamp(
      Math.round(rawDelayTimeSec / q.stepSec) * q.stepSec,
      0.1,
      0.82,
    );
    const switchDelta = Math.abs(quantizedCandidate - this.quantizedDelayTimeSec);
    const holdElapsed = elapsedSeconds - this.quantizedDelayLastSwitchSec;
    if (switchDelta >= q.switchThresholdSec && holdElapsed >= q.minHoldSec) {
      this.quantizedDelayTimeSec = quantizedCandidate;
      this.quantizedDelayLastSwitchSec = elapsedSeconds;
    }

    const quantizeMix = clamp01(q.blend * activity);
    return lerp(rawDelayTimeSec, this.quantizedDelayTimeSec, quantizeMix);
  }

  private smoothFx(target: WeatherFxBlend, hasActiveZones: boolean): WeatherFxBlend {
    const profile = hasActiveZones
      ? WEATHER_EFFECT_TUNING.fxSmoothing.active
      : WEATHER_EFFECT_TUNING.fxSmoothing.idle;
    const tBase = clamp01(profile.default);
    const tDelayTime = clamp01(profile.delayTimeSec);
    const tDelayFeedback = clamp01(profile.delayFeedback);
    const tDelayWet = clamp01(profile.delayWet);
    const tSweepRate = clamp01(profile.bandpassSweepHz);
    const tSweepRange = clamp01(profile.bandpassSweepRange);

    this.smoothedFx = clampBlend({
      wetLevel: lerp(this.smoothedFx.wetLevel, target.wetLevel, tBase),
      delayTimeSec: lerp(this.smoothedFx.delayTimeSec, target.delayTimeSec, tDelayTime),
      delayFeedback: lerp(this.smoothedFx.delayFeedback, target.delayFeedback, tDelayFeedback),
      delayWet: lerp(this.smoothedFx.delayWet, target.delayWet, tDelayWet),
      reverbRoomSize: lerp(this.smoothedFx.reverbRoomSize, target.reverbRoomSize, tBase),
      highpassHz: lerp(this.smoothedFx.highpassHz, target.highpassHz, tBase),
      lowpassHz: lerp(this.smoothedFx.lowpassHz, target.lowpassHz, tBase),
      bandpassMix: lerp(this.smoothedFx.bandpassMix, target.bandpassMix, tBase),
      bandpassQ: lerp(this.smoothedFx.bandpassQ, target.bandpassQ, tBase),
      bandpassSweepHz: lerp(this.smoothedFx.bandpassSweepHz, target.bandpassSweepHz, tSweepRate),
      bandpassSweepMinHz: lerp(this.smoothedFx.bandpassSweepMinHz, target.bandpassSweepMinHz, tSweepRange),
      bandpassSweepMaxHz: lerp(this.smoothedFx.bandpassSweepMaxHz, target.bandpassSweepMaxHz, tSweepRange),
    });

    return this.smoothedFx;
  }
}
