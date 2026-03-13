import type { PersistedState, SphericalCoord } from '../types.ts';

const STORAGE_KEY = 'sonicsphere-v1';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSphericalCoord(value: unknown): value is SphericalCoord {
  if (typeof value !== 'object' || value === null) return false;
  return isFiniteNumber((value as SphericalCoord).lat) && isFiniteNumber((value as SphericalCoord).lon);
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    if (!isSphericalCoord(obj.playerPosition) || !isFiniteNumber(obj.playerHeading)) return null;

    return {
      playerPosition: obj.playerPosition,
      playerHeading: obj.playerHeading,
      worldEpochMs: isFiniteNumber(obj.worldEpochMs) ? obj.worldEpochMs : undefined,
      lastSeenAtMs: isFiniteNumber(obj.lastSeenAtMs) ? obj.lastSeenAtMs : undefined,
    };
  } catch {
    return null;
  }
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Archetype parameter overrides ────────────────────────────────────────────

const ARCHETYPES_KEY = 'sonicsphere-archetypes-v1';

export type ArchetypeOverrides = Record<string, Record<string, number | string>>;

export function loadArchetypeOverrides(): ArchetypeOverrides {
  try {
    const raw = localStorage.getItem(ARCHETYPES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ArchetypeOverrides;
  } catch {
    return {};
  }
}

export function saveArchetypeOverride(name: string, param: string, value: number | string): void {
  try {
    const all = loadArchetypeOverrides();
    if (!all[name]) all[name] = {};
    all[name]![param] = value;
    localStorage.setItem(ARCHETYPES_KEY, JSON.stringify(all));
  } catch {
    // Quota exceeded — silently ignore
  }
}

export function resetArchetypeOverrides(name: string): void {
  try {
    const all = loadArchetypeOverrides();
    delete all[name];
    localStorage.setItem(ARCHETYPES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function clearAllArchetypeOverrides(): void {
  localStorage.removeItem(ARCHETYPES_KEY);
}
