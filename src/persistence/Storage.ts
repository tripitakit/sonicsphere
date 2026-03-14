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
      playerTargetHeading: isFiniteNumber(obj.playerTargetHeading) ? obj.playerTargetHeading : undefined,
      playerManualOverrideRemainingSec: isFiniteNumber(obj.playerManualOverrideRemainingSec)
        ? obj.playerManualOverrideRemainingSec
        : undefined,
      playerDirectionAngle: isFiniteNumber(obj.playerDirectionAngle) ? obj.playerDirectionAngle : undefined,
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

// ── Weather FX overrides ──────────────────────────────────────────────────────

const WEATHER_KEY = 'sonicsphere-weather-v1';

export type WeatherOverrides = { profileName: string; params: Record<string, number> };

export function loadWeatherOverrides(): WeatherOverrides {
  try {
    const raw = localStorage.getItem(WEATHER_KEY);
    if (!raw) return { profileName: '', params: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return { profileName: '', params: {} };
    const obj = parsed as Record<string, unknown>;
    const profileName = typeof obj.profileName === 'string' ? obj.profileName : '';
    const params = (typeof obj.params === 'object' && obj.params !== null && !Array.isArray(obj.params))
      ? obj.params as Record<string, number>
      : {};
    return { profileName, params };
  } catch {
    return { profileName: '', params: {} };
  }
}

export function saveWeatherProfileName(name: string): void {
  try {
    const overrides = loadWeatherOverrides();
    overrides.profileName = name;
    localStorage.setItem(WEATHER_KEY, JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

export function saveWeatherParam(key: string, value: number): void {
  try {
    const overrides = loadWeatherOverrides();
    overrides.params[key] = value;
    localStorage.setItem(WEATHER_KEY, JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

export function resetWeatherParams(): void {
  try {
    const overrides = loadWeatherOverrides();
    overrides.params = {};
    localStorage.setItem(WEATHER_KEY, JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

export function clearWeatherOverrides(): void {
  localStorage.removeItem(WEATHER_KEY);
}
