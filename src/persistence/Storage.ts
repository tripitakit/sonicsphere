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
