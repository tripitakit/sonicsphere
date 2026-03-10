import type {
  ActiveWeatherZone,
  SphericalCoord,
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

/**
 * Fast tuning surface for weather-FX behavior.
 * Keep edits here for rapid listening tests.
 */
export const WEATHER_EFFECT_TUNING = {
  profileName: 'experimental-v1',
  // >1 pushes blend faster toward zone character; 1 = neutral.
  globalBlendAmount: 1.22,
  // Relative contribution of zone roles.
  roleWeightStrong: 1.0,
  roleWeightBackground: 0.62,
  // Relative impact per weather family.
  zoneTypeWeight: {
    mist: 1.06,
    echo: 1.14,
    ion: 1.28,
  } satisfies Record<WeatherZoneType, number>,
  // Per-parameter multipliers after weighted blend.
  fxMultiplier: {
    wetLevel: 1.28,
    delayFeedback: 1.24,
    delayWet: 1.18,
    reverbRoomSize: 1.12,
    bandpassMix: 1.38,
    bandpassQ: 1.16,
    bandpassSweepHz: 1.12,
  },
  // Temporal smoothing to avoid zipper noise and abrupt spectral jumps.
  fxSmoothingAlphaActive: 0.22,
  fxSmoothingAlphaIdle: 0.12,
} as const;

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

interface WeatherZoneModel {
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
  const minHz = clamp(blend.bandpassSweepMinHz, 220, 5600);
  const maxHz = clamp(blend.bandpassSweepMaxHz, 600, 8400);
  const safeMin = Math.min(minHz, maxHz - 120);
  const safeMax = Math.max(safeMin + 120, maxHz);

  return {
    wetLevel: clamp(blend.wetLevel, 0.06, 0.3),
    delayTimeSec: clamp(blend.delayTimeSec, 0.1, 0.82),
    delayFeedback: clamp(blend.delayFeedback, 0.08, 0.56),
    delayWet: clamp(blend.delayWet, 0.05, 0.5),
    reverbRoomSize: clamp(blend.reverbRoomSize, 0.2, 0.82),
    highpassHz: clamp(blend.highpassHz, 35, 320),
    lowpassHz: clamp(blend.lowpassHz, 2600, 11000),
    bandpassMix: clamp(blend.bandpassMix, 0, 0.72),
    bandpassQ: clamp(blend.bandpassQ, 0.8, 8.5),
    bandpassSweepHz: clamp(blend.bandpassSweepHz, 0.12, 12),
    bandpassSweepMinHz: safeMin,
    bandpassSweepMaxHz: safeMax,
  };
}

function presetForZone(zone: WeatherZoneModel): WeatherPresetVariant {
  const variants = WEATHER_PRESET_VARIANTS[zone.type];
  return variants[zone.presetIndex] ?? variants[0]!;
}

function applyExperimentalTuning(blend: WeatherFxBlend): WeatherFxBlend {
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

  constructor(seed = 0x5f3759df, zoneCount = DEFAULT_ZONE_COUNT) {
    this.zones = this.generateZones(seed, zoneCount);
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
      wetLevel += preset.wetLevel * weight;
      delayTimeSec += organicDelay * weight;
      delayFeedback += preset.delayFeedback * weight;
      delayWet += preset.delayWet * weight;
      reverbRoomSize += preset.reverbRoomSize * weight;
      highpassHz += preset.highpassHz * weight;
      lowpassHz += preset.lowpassHz * weight;
      bandpassMix += preset.bandpassMix * weight;
      bandpassQ += preset.bandpassQ * weight;
      bandpassSweepHz += preset.bandpassSweepHz * weight;
      bandpassSweepMinHz += preset.bandpassMinHz * weight;
      bandpassSweepMaxHz += preset.bandpassMaxHz * weight;
    }

    if (totalWeight <= EPS) return DEFAULT_WEATHER_FX_BLEND;

    const invWeight = 1 / totalWeight;
    const activity = clamp01((totalWeight / 1.15) * WEATHER_EFFECT_TUNING.globalBlendAmount);

    const blend: WeatherFxBlend = {
      wetLevel: lerp(DEFAULT_WEATHER_FX_BLEND.wetLevel, wetLevel * invWeight, activity),
      delayTimeSec: lerp(DEFAULT_WEATHER_FX_BLEND.delayTimeSec, delayTimeSec * invWeight, activity),
      delayFeedback: lerp(DEFAULT_WEATHER_FX_BLEND.delayFeedback, delayFeedback * invWeight, activity),
      delayWet: lerp(DEFAULT_WEATHER_FX_BLEND.delayWet, delayWet * invWeight, activity),
      reverbRoomSize: lerp(DEFAULT_WEATHER_FX_BLEND.reverbRoomSize, reverbRoomSize * invWeight, activity),
      highpassHz: lerp(DEFAULT_WEATHER_FX_BLEND.highpassHz, highpassHz * invWeight, activity),
      lowpassHz: lerp(DEFAULT_WEATHER_FX_BLEND.lowpassHz, lowpassHz * invWeight, activity),
      bandpassMix: lerp(DEFAULT_WEATHER_FX_BLEND.bandpassMix, bandpassMix * invWeight, activity),
      bandpassQ: lerp(DEFAULT_WEATHER_FX_BLEND.bandpassQ, bandpassQ * invWeight, activity),
      bandpassSweepHz: lerp(DEFAULT_WEATHER_FX_BLEND.bandpassSweepHz, bandpassSweepHz * invWeight, activity),
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

    return clampBlend(applyExperimentalTuning(blend));
  }

  private smoothFx(target: WeatherFxBlend, hasActiveZones: boolean): WeatherFxBlend {
    const alpha = hasActiveZones
      ? WEATHER_EFFECT_TUNING.fxSmoothingAlphaActive
      : WEATHER_EFFECT_TUNING.fxSmoothingAlphaIdle;
    const t = clamp01(alpha);

    this.smoothedFx = clampBlend({
      wetLevel: lerp(this.smoothedFx.wetLevel, target.wetLevel, t),
      delayTimeSec: lerp(this.smoothedFx.delayTimeSec, target.delayTimeSec, t),
      delayFeedback: lerp(this.smoothedFx.delayFeedback, target.delayFeedback, t),
      delayWet: lerp(this.smoothedFx.delayWet, target.delayWet, t),
      reverbRoomSize: lerp(this.smoothedFx.reverbRoomSize, target.reverbRoomSize, t),
      highpassHz: lerp(this.smoothedFx.highpassHz, target.highpassHz, t),
      lowpassHz: lerp(this.smoothedFx.lowpassHz, target.lowpassHz, t),
      bandpassMix: lerp(this.smoothedFx.bandpassMix, target.bandpassMix, t),
      bandpassQ: lerp(this.smoothedFx.bandpassQ, target.bandpassQ, t),
      bandpassSweepHz: lerp(this.smoothedFx.bandpassSweepHz, target.bandpassSweepHz, t),
      bandpassSweepMinHz: lerp(this.smoothedFx.bandpassSweepMinHz, target.bandpassSweepMinHz, t),
      bandpassSweepMaxHz: lerp(this.smoothedFx.bandpassSweepMaxHz, target.bandpassSweepMaxHz, t),
    });

    return this.smoothedFx;
  }
}
