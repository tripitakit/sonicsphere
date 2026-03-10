import type { SoundSourceState, SourceVariation, SphericalCoord } from '../types.ts';
import type { Gain } from 'tone';
import { ARCHETYPES } from '../audio/archetypes.ts';
import { SoundSource } from './SoundSource.ts';
import { PERFORMANCE_BUDGET } from './PerformanceBudget.ts';
import { HEARING_RADIUS } from './sphereMath.ts';

const WORLD_DENSITY_MULTIPLIER = PERFORMANCE_BUDGET.world.densityMultiplier;
const BASE_SOURCE_COUNT = Math.max(180, Math.round(240 * WORLD_DENSITY_MULTIPLIER));
const RHYTHMIC_EXTRA_SOURCE_COUNT = Math.max(120, Math.round(180 * WORLD_DENSITY_MULTIPLIER));
const SOURCE_COUNT = BASE_SOURCE_COUNT + RHYTHMIC_EXTRA_SOURCE_COUNT;
const TARGET_MAX_ACTIVE_SOURCES = PERFORMANCE_BUDGET.world.targetMaxActiveSources;
const MIN_MAX_ACTIVE_SOURCES = PERFORMANCE_BUDGET.world.minMaxActiveSources;
const ACTIVE_RELEASE_MARGIN = 2;      // keep audible sources a bit longer to avoid rank thrash
const MAX_NEW_STARTS_PER_FRAME = PERFORMANCE_BUDGET.world.maxNewStartsPerFrame;
const ADAPT_CHECK_INTERVAL = PERFORMANCE_BUDGET.world.adaptCheckIntervalSec;
const ADAPT_DOWN_DT = PERFORMANCE_BUDGET.world.adaptDownDtSec;
const ADAPT_UP_DT = PERFORMANCE_BUDGET.world.adaptUpDtSec;

/** Fast deterministic LCG PRNG. Returns values in [0, 1). */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class SphereWorld {
  private sources: SoundSource[];
  // Pre-allocated sort buffer to avoid per-frame GC pressure
  private sortBuf: Array<{ idx: number; dist: number }>;
  private adaptiveMaxActiveSources = TARGET_MAX_ACTIVE_SOURCES;
  private activeVoiceCount = 0;
  private frameDtEma = 1 / 60;
  private lastUpdateElapsed: number | null = null;
  private lastAdaptAt = 0;

  constructor() {
    this.sources = this.generateSources();
    this.sortBuf = this.sources.map((_, i) => ({ idx: i, dist: 0 }));
  }

  private generateSources(): SoundSource[] {
    const rng = makePrng(0xdeadbeef);
    const perArchetypeOrdinal = new Map<string, number>();

    const basePool = this.shuffledPoolFromIndices(
      ARCHETYPES.map((_, i) => i),
      BASE_SOURCE_COUNT,
      rng,
    );

    const rhythmicIndices = ARCHETYPES
      .map((a, i) => (a.mode === 'rhythmic' ? i : -1))
      .filter((i) => i >= 0);

    const rhythmicPool = this.shuffledPoolFromIndices(
      rhythmicIndices.length > 0 ? rhythmicIndices : ARCHETYPES.map((_, i) => i),
      RHYTHMIC_EXTRA_SOURCE_COUNT,
      rng,
    );

    const pool = [...basePool, ...rhythmicPool];
    const archetypeCount = new Map<string, number>();
    for (const archetypeIndex of pool) {
      const archetypeName = ARCHETYPES[archetypeIndex]!.name;
      archetypeCount.set(archetypeName, (archetypeCount.get(archetypeName) ?? 0) + 1);
    }

    const states: SoundSourceState[] = [];

    for (let i = 0; i < SOURCE_COUNT; i++) {
      const archetype = ARCHETYPES[pool[i]!]!;
      const ordinal = perArchetypeOrdinal.get(archetype.name) ?? 0;
      perArchetypeOrdinal.set(archetype.name, ordinal + 1);

      const baseLat = Math.asin(-1 + (2 * i) / (SOURCE_COUNT - 1)) * (180 / Math.PI);
      const baseLon = ((137.5 * i) % 360) - 180;
      const lat = baseLat + (rng() - 0.5) * 20;
      const lon = baseLon + (rng() - 0.5) * 20;

      // Frequency identity per archetype instance:
      // each clone gets a unique detune slot, so no two sources of the same
      // archetype share exactly the same carrier frequency.
      const clonesForArchetype = archetypeCount.get(archetype.name) ?? 1;
      const centreOrdinal = (clonesForArchetype - 1) * 0.5;
      const uniqueDetuneSlot = (ordinal - centreOrdinal) * 8;
      const variation: SourceVariation = {
        detuneCents:    uniqueDetuneSlot + (rng() - 0.5) * 0.6,
        filterFreqMult: 0.8 + rng() * 0.45,
        lfoRateMult:    0.75 + rng() * 0.55,
      };

      states.push({
        id: `source-${i}`,
        archetype,
        variation,
        equilibrium: { lat, lon },
        current:     { lat, lon },
        oscillation: {
          period:    180 + rng() * 300,
          phase:     rng() * Math.PI * 2,
          amplitude: 2 + rng() * 8,
        },
      });
    }

    return states.map((s) => new SoundSource(s));
  }

  private shuffledPoolFromIndices(
    indices: number[],
    count: number,
    rng: () => number,
  ): number[] {
    const reps = Math.ceil(count / indices.length);
    const pool: number[] = [];

    for (let r = 0; r < reps; r++) {
      for (const idx of indices) pool.push(idx);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, count);
  }

  update(
    elapsedSeconds: number,
    playerPos: SphericalCoord,
    playerHeading: number,
    masterGain: Gain,
    audioEnabled: boolean,
  ): void {
    if (this.lastUpdateElapsed !== null) {
      const dt = Math.max(0.001, Math.min(0.2, elapsedSeconds - this.lastUpdateElapsed));
      this.frameDtEma = this.frameDtEma * 0.92 + dt * 0.08;
      if (elapsedSeconds - this.lastAdaptAt >= ADAPT_CHECK_INTERVAL) {
        if (this.frameDtEma > ADAPT_DOWN_DT && this.adaptiveMaxActiveSources > MIN_MAX_ACTIVE_SOURCES) {
          this.adaptiveMaxActiveSources--;
          this.lastAdaptAt = elapsedSeconds;
        } else if (this.frameDtEma < ADAPT_UP_DT && this.adaptiveMaxActiveSources < TARGET_MAX_ACTIVE_SOURCES) {
          this.adaptiveMaxActiveSources++;
          this.lastAdaptAt = elapsedSeconds;
        }
      }
    }
    this.lastUpdateElapsed = elapsedSeconds;

    let startsThisFrame = 0;
    let activeVoices = 0;

    for (let i = 0; i < this.sources.length; i++) {
      const entry = this.sortBuf[i]!;
      entry.idx  = i;
      entry.dist = this.sources[i]!.getDistanceFrom(playerPos);
    }

    this.sortBuf.sort((a, b) => a.dist - b.dist);

    // Keep only the nearest sources eligible to start, so the mix remains
    // readable while still allowing a larger spatial spread.
    for (let rank = 0; rank < this.sortBuf.length; rank++) {
      const entry   = this.sortBuf[rank]!;
      const source  = this.sources[entry.idx]!;
      const inRange = entry.dist < HEARING_RADIUS;
      const inStartQuota = rank < this.adaptiveMaxActiveSources;
      const inKeepQuota = rank < (this.adaptiveMaxActiveSources + ACTIVE_RELEASE_MARGIN);

      // Quota hysteresis: keep currently audible voices a little longer to
      // avoid rapid stop/start churn when rank fluctuates around the boundary.
      if (audioEnabled && source.isAudible() && !inKeepQuota) {
        source.forceStop();
      }

      const canStart =
        audioEnabled &&
        inRange &&
        inStartQuota &&
        startsThisFrame < MAX_NEW_STARTS_PER_FRAME;

      const wasAudible = source.isAudible();
      source.update(
        elapsedSeconds, playerPos, playerHeading, masterGain,
        audioEnabled,
        canStart,
      );
      if (!wasAudible && source.isAudible()) {
        startsThisFrame++;
      }
      if (source.isAudible()) {
        activeVoices++;
      }
    }

    this.activeVoiceCount = activeVoices;
  }

  getSources(): readonly SoundSource[] {
    return this.sources;
  }

  getActiveVoiceCount(): number {
    return this.activeVoiceCount;
  }

  getAdaptiveVoiceCap(): number {
    return this.adaptiveMaxActiveSources;
  }

  getTotalSourceCount(): number {
    return this.sources.length;
  }

  suspendAllVoices(): void {
    for (const source of this.sources) source.forceStop();
    this.activeVoiceCount = 0;
  }

  dispose(): void {
    for (const source of this.sources) source.dispose();
    this.activeVoiceCount = 0;
  }
}
