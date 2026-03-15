import type {
  SphericalCoord,
  WeatherZoneType,
  UserSourceDef,
  UserZoneDef,
  WorldDef,
} from '../types.ts';
import { getAuthorId } from '../api/authorId.ts';

let nextSourceIdx = 0;
let nextZoneIdx = 0;

function randomVariation() {
  return {
    detuneCents: (Math.random() - 0.5) * 40,
    filterFreqMult: 0.85 + Math.random() * 0.35,
    lfoRateMult: 0.8 + Math.random() * 0.45,
  };
}

function randomOscillation() {
  return {
    period: 180 + Math.random() * 300,
    phase: Math.random() * Math.PI * 2,
    amplitude: 2 + Math.random() * 8,
  };
}

export class WorldBuilder {
  private sources: UserSourceDef[] = [];
  private zones: UserZoneDef[] = [];
  private worldId: string;
  private worldName: string;
  private createdAt: number;

  constructor() {
    this.worldId = crypto.randomUUID();
    this.worldName = 'Untitled World';
    this.createdAt = Date.now();
  }

  // ── Sources ──────────────────────────────────────────────────────────────

  addSource(archetypeName: string, position: SphericalCoord): UserSourceDef {
    const src: UserSourceDef = {
      id: `user-src-${nextSourceIdx++}`,
      archetypeName,
      position: { ...position },
      variation: randomVariation(),
      oscillation: randomOscillation(),
    };
    this.sources.push(src);
    return src;
  }

  removeSource(id: string): void {
    this.sources = this.sources.filter((s) => s.id !== id);
  }

  getSources(): readonly UserSourceDef[] {
    return this.sources;
  }

  // ── Zones ────────────────────────────────────────────────────────────────

  addZone(type: WeatherZoneType, center: SphericalCoord): UserZoneDef {
    const zone: UserZoneDef = {
      id: `user-zone-${nextZoneIdx++}`,
      type,
      presetIndex: Math.floor(Math.random() * 3),
      center: { ...center },
      radiusDeg: 18,
      featherDeg: 12,
      intensity: 0.7,
      driftEnabled: false,
    };
    this.zones.push(zone);
    return zone;
  }

  removeZone(id: string): void {
    this.zones = this.zones.filter((z) => z.id !== id);
  }

  updateZoneParam(id: string, key: keyof UserZoneDef, value: number | boolean): void {
    const zone = this.zones.find((z) => z.id === id);
    if (!zone) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (zone as any)[key] = value;
  }

  getZones(): readonly UserZoneDef[] {
    return this.zones;
  }

  // ── World management ─────────────────────────────────────────────────────

  getWorldId(): string { return this.worldId; }

  getWorldName(): string { return this.worldName; }
  setWorldName(name: string): void { this.worldName = name; }

  toWorldDef(): WorldDef {
    return {
      id: this.worldId,
      name: this.worldName,
      authorId: getAuthorId(),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      sources: this.sources.map((s) => ({ ...s, position: { ...s.position } })),
      zones: this.zones.map((z) => ({ ...z, center: { ...z.center } })),
    };
  }

  loadFromWorldDef(def: WorldDef): void {
    this.worldId = def.id;
    this.worldName = def.name;
    this.createdAt = def.createdAt;
    this.sources = def.sources.map((s) => ({ ...s, position: { ...s.position } }));
    this.zones = def.zones.map((z) => ({ ...z, center: { ...z.center } }));
  }

  clear(): void {
    this.worldId = crypto.randomUUID();
    this.worldName = 'Untitled World';
    this.createdAt = Date.now();
    this.sources = [];
    this.zones = [];
  }

  isEmpty(): boolean {
    return this.sources.length === 0 && this.zones.length === 0;
  }
}
