import type {
  SoundArchetype,
  SoundEngineType,
  SoundSourceState,
  SourceVariation,
  SphericalCoord,
  UserSourceDef,
} from '../types.ts';
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

// Engine-balance weights: equal share across all 4 engines (each has 52 archetypes).
// Subtractive is automatically excluded from the rhythmic pool (no rhythmic archetypes).
const BASE_ENGINE_WEIGHTS: Record<SoundEngineType, number> = {
  subtractive: 0.25,
  noise: 0.25,
  fm: 0.25,
  resonator: 0.25,
};
const RHYTHMIC_ENGINE_WEIGHTS: Record<SoundEngineType, number> = {
  subtractive: 0.25, // no rhythmic sub-archetypes → bucket empty → auto-excluded
  noise: 0.25,
  fm: 0.25,
  resonator: 0.25,
};

function engineOf(archetype: SoundArchetype): SoundEngineType {
  return archetype.engine ?? 'subtractive';
}

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
  private frameDtEma = 1 / 60;
  private lastUpdateElapsed: number | null = null;
  private lastAdaptAt = 0;
  private soloSourceId: string | null = null;

  constructor(externalSources?: SoundSourceState[]) {
    this.sources = externalSources
      ? externalSources.map((s) => new SoundSource(s))
      : this.generateSources();
    this.sortBuf = this.sources.map((_, i) => ({ idx: i, dist: 0 }));
  }

  static fromUserSources(defs: UserSourceDef[]): SphereWorld {
    const archetypeMap = new Map<string, SoundArchetype>();
    for (const a of ARCHETYPES) archetypeMap.set(a.name, a);

    const states: SoundSourceState[] = defs.map((d) => {
      const archetype = archetypeMap.get(d.archetypeName);
      if (!archetype) throw new Error(`Unknown archetype: ${d.archetypeName}`);
      return {
        id: d.id,
        archetype,
        variation: { ...d.variation },
        equilibrium: { ...d.position },
        current: { ...d.position },
        oscillation: { ...d.oscillation },
      };
    });
    return new SphereWorld(states);
  }

  private generateSources(): SoundSource[] {
    const rng = makePrng(0xdeadbeef);
    const perArchetypeOrdinal = new Map<string, number>();
    const allArchetypeIndices = ARCHETYPES.map((_, i) => i);
    const basePool = this.balancedPoolByEngine(
      allArchetypeIndices,
      BASE_SOURCE_COUNT,
      BASE_ENGINE_WEIGHTS,
      rng,
    );

    const rhythmicIndices = ARCHETYPES
      .map((a, i) => (a.mode === 'rhythmic' ? i : -1))
      .filter((i) => i >= 0);

    const rhythmicPool = this.balancedPoolByEngine(
      rhythmicIndices.length > 0 ? rhythmicIndices : ARCHETYPES.map((_, i) => i),
      RHYTHMIC_EXTRA_SOURCE_COUNT,
      RHYTHMIC_ENGINE_WEIGHTS,
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

  private balancedPoolByEngine(
    indices: number[],
    count: number,
    weights: Record<SoundEngineType, number>,
    rng: () => number,
  ): number[] {
    if (indices.length === 0 || count <= 0) return [];

    const buckets: Record<SoundEngineType, number[]> = {
      subtractive: [],
      noise: [],
      fm: [],
      resonator: [],
    };
    for (const idx of indices) {
      const archetype = ARCHETYPES[idx];
      if (!archetype) continue;
      buckets[engineOf(archetype)].push(idx);
    }

    const activeEngines = (Object.keys(buckets) as SoundEngineType[])
      .filter((engine) => buckets[engine].length > 0 && weights[engine] > 0);
    if (activeEngines.length === 0) {
      return this.shuffledPoolFromIndices(indices, count, rng);
    }

    const totalWeight = activeEngines
      .reduce((sum, engine) => sum + weights[engine], 0);
    if (totalWeight <= 0) {
      return this.shuffledPoolFromIndices(indices, count, rng);
    }

    // Each engine gets at minimum its full bucket size (coverage guarantee:
    // every archetype appears at least once) plus a proportional share of any
    // remaining slots.  shuffledPoolFromIndices cycles through all indices
    // before repeating, so quota >= bucket.length implies full coverage.
    const bucketSizeTotal = activeEngines.reduce((s, e) => s + buckets[e].length, 0);
    const extra = Math.max(0, count - bucketSizeTotal);

    const pool: number[] = [];
    let extraAllocated = 0;
    for (let i = 0; i < activeEngines.length; i++) {
      const engine = activeEngines[i]!;
      const proportion = weights[engine] / totalWeight;
      // Last engine absorbs rounding remainder to keep total == count.
      const engineExtra = i < activeEngines.length - 1
        ? Math.round(proportion * extra)
        : extra - extraAllocated;
      extraAllocated += engineExtra;
      const quota = buckets[engine].length + engineExtra;
      const slice = this.shuffledPoolFromIndices(buckets[engine], quota, rng);
      for (const idx of slice) pool.push(idx);
    }

    // Interleave engine slices so adjacent sources vary by engine.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }

    return pool;
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
      const isSoloSource = this.soloSourceId !== null && source.getId() === this.soloSourceId;

      // Quota hysteresis: keep currently audible voices a little longer to
      // avoid rapid stop/start churn when rank fluctuates around the boundary.
      if (audioEnabled && source.isAudible() && !inKeepQuota && !isSoloSource) {
        source.forceStop();
      }

      // Solo gate: silence sources that don't match the selected source id.
      const soloOk = this.soloSourceId === null || isSoloSource;
      if (!soloOk && source.isAudible()) {
        source.forceStop();
      }

      const canStart =
        audioEnabled &&
        inRange &&
        (inStartQuota || isSoloSource) &&
        soloOk &&
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
    }
  }

  getSources(): readonly SoundSource[] {
    return this.sources;
  }

  getActiveSources(): SoundSource[] {
    return this.sortBuf
      .filter(e => this.sources[e.idx]?.isAudible())
      .map(e => this.sources[e.idx]!);
  }

  getSourcesInHearingRadius(): SoundSource[] {
    return this.sortBuf
      .filter(e => e.dist < HEARING_RADIUS)
      .map(e => this.sources[e.idx]!);
  }

  setSoloSource(sourceId: string | null): void {
    this.soloSourceId = sourceId;
    // Immediately silence any currently-running sources that don't match.
    if (sourceId !== null) {
      for (const source of this.sources) {
        if (source.getId() !== sourceId && source.isAudible()) {
          source.forceStop();
        }
      }
    }
  }

  getSoloSource(): string | null {
    return this.soloSourceId;
  }

  updateArchetypeParam(archetypeName: string, key: string, value: number | string): void {
    for (const source of this.sources) {
      if (source.getArchetypeName() === archetypeName) {
        source.updateArchetypeParam(key, value);
      }
    }
  }

  suspendAllVoices(): void {
    for (const source of this.sources) source.forceStop();
  }

  dispose(): void {
    for (const source of this.sources) source.dispose();
  }
}
