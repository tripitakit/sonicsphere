import type { SphericalCoord, WeatherZoneType, WorldSummary } from '../types.ts';
import { ARCHETYPES } from '../audio/archetypes.ts';
import { WorldBuilder } from '../engine/WorldBuilder.ts';
import { chordDistance } from '../engine/sphereMath.ts';
import * as api from '../api/WorldApi.ts';
import { getAuthorId } from '../api/authorId.ts';

export interface WorldCreatorCallbacks {
  onPlacementModeChange: (active: boolean) => void;
  onWorldChanged: () => void;
  onPlay: () => void;
}

type PlacementMode =
  | { kind: 'none' }
  | { kind: 'source'; archetypeName: string }
  | { kind: 'zone'; zoneType: WeatherZoneType };

// ── Archetype families ───────────────────────────────────────────────────────

/** Derive family name from archetype name: strip trailing -a..-f and -rhythm suffix. */
function familyOf(name: string): string {
  // E.g. "bamboo-rhythm-a" → "bamboo", "wind-gust" → "wind", "glass-fm-chime" → "glass-fm"
  // "drop-rhythm-f" → "drop", "dust-noise-bed" → "dust-noise"
  const stripped = name.replace(/-rhythm-[a-f]$/, '').replace(/-[a-f]$/, '');
  // For drone/non-rhythmic, use the first word as family
  const parts = stripped.split('-');
  // Heuristic: if archetype has a clear category prefix, use it
  // Most families are 1-word prefix: wind, stream, rain, cricket, etc.
  return parts[0]!;
}

interface ArchetypeFamily {
  name: string;
  hue: number; // HSL hue derived from name hash (matches WorldView palette)
  archetypes: string[];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildFamilies(): ArchetypeFamily[] {
  const map = new Map<string, string[]>();
  for (const a of ARCHETYPES) {
    const fam = familyOf(a.name);
    const list = map.get(fam);
    if (list) list.push(a.name);
    else map.set(fam, [a.name]);
  }
  return Array.from(map.entries()).map(([name, archetypes]) => ({
    name,
    hue: hashString(archetypes[0]!) % 360,
    archetypes,
  }));
}

const FAMILIES = buildFamilies();

/** Minimum chord distance between two placed sources (maps to ~10px at default zoom). */
const SOURCE_EXCLUSION_RADIUS = 2.5;

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
#world-creator {
  position: fixed;
  top: 12px;
  left: 12px;
  width: 340px;
  max-height: 92vh;
  overflow-y: auto;
  background: rgba(8, 22, 38, 0.93);
  border: 1px solid #1a3a55;
  border-radius: 13px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #a0c8e0;
  z-index: 1000;
  display: none;
  box-shadow: 0 5px 32px rgba(0,0,0,0.7);
}
#world-creator.wc-open { display: block; }

.wc-section {
  padding: 10px 13px;
  border-bottom: 1px solid #1a3a55;
}
.wc-section:last-child { border-bottom: none; }

.wc-section-title {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: #5a8aa5;
  margin-bottom: 8px;
}

.wc-name-input {
  width: 100%;
  background: rgba(5, 16, 28, 0.8);
  border: 1px solid #1a3a55;
  border-radius: 6px;
  color: #d7f1ff;
  font-family: inherit;
  font-size: 14px;
  padding: 6px 9px;
  outline: none;
}
.wc-name-input:focus { border-color: #33bbaa; }

.wc-btn-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.wc-btn {
  flex: 1;
  min-width: 60px;
  padding: 6px 0;
  background: rgba(16, 42, 62, 0.7);
  border: 1px solid #1a3a55;
  border-radius: 6px;
  color: #7fb8d4;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.wc-btn:hover { border-color: #33bbaa; color: #33bbaa; }
.wc-btn-active { border-color: #33bbaa; color: #33bbaa; box-shadow: 0 0 6px rgba(51,187,170,0.25); }
.wc-btn-danger:hover { border-color: #ee5533; color: #ee5533; }
.wc-btn-play {
  background: rgba(20, 60, 50, 0.6);
  border-color: #33bbaa;
  color: #33bbaa;
  font-size: 13px;
  padding: 9px 0;
}
.wc-btn-play:hover { background: rgba(30, 80, 65, 0.7); }

/* Family selector buttons */
.wc-family-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.wc-family-btn {
  padding: 4px 8px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.3px;
  cursor: pointer;
  border: 1px solid;
  transition: opacity 0.12s;
  opacity: 0.65;
}
.wc-family-btn:hover { opacity: 0.9; }
.wc-family-btn.wc-family-active { opacity: 1; box-shadow: 0 0 8px rgba(255,255,255,0.15); }

/* Archetype list within selected family */
.wc-arch-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  max-height: 120px;
  overflow-y: auto;
}
.wc-arch-item {
  padding: 4px 8px;
  background: rgba(12, 30, 48, 0.7);
  border: 1px solid #142a3c;
  border-radius: 4px;
  font-size: 10px;
  color: #6b94ad;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.12s, color 0.12s;
}
.wc-arch-item:hover { border-color: #4488aa; color: #a0d0e8; }
.wc-arch-item.wc-arch-selected { border-color: #33bbaa; color: #33bbaa; }

/* Placed item list */
.wc-item-list {
  max-height: 160px;
  overflow-y: auto;
  margin-top: 6px;
}
.wc-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.wc-item-row:hover { background: rgba(20, 50, 70, 0.4); }
.wc-item-row.wc-item-selected { background: rgba(30, 70, 90, 0.5); border: 1px solid #2a6080; }
.wc-item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wc-item-name {
  flex: 1;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wc-item-del {
  width: 18px;
  height: 18px;
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  color: #5a6a78;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wc-item-del:hover { border-color: #ee5533; color: #ee5533; }

/* Zone type buttons */
.wc-zone-btns {
  display: flex;
  gap: 6px;
}
.wc-zone-btn {
  flex: 1;
  padding: 6px 0;
  border-radius: 6px;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.5px;
  cursor: pointer;
  border: 1px solid;
  transition: opacity 0.15s;
}
.wc-zone-btn:hover { opacity: 1; }

/* Zone param slider */
.wc-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.wc-slider-label {
  width: 60px;
  font-size: 10px;
  color: #5a8aa5;
  text-align: right;
}
.wc-slider {
  flex: 1;
  accent-color: #33bbaa;
}
.wc-slider-val {
  width: 36px;
  font-size: 10px;
  color: #7fb8d4;
  text-align: left;
}

/* Browse panel */
.wc-browse-list {
  max-height: 240px;
  overflow-y: auto;
  margin-top: 6px;
}
.wc-browse-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid #0f2030;
}
.wc-browse-row:last-child { border-bottom: none; }
.wc-browse-info {
  flex: 1;
  font-size: 11px;
}
.wc-browse-name { color: #a0d0e8; }
.wc-browse-meta { color: #4a7a96; font-size: 9px; margin-top: 2px; }
.wc-browse-actions { display: flex; gap: 4px; }

/* Placement banner */
.wc-placement-banner {
  padding: 8px 13px;
  background: rgba(20, 60, 50, 0.5);
  border-bottom: 1px solid #1a5a4a;
  color: #33bbaa;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wc-placement-cancel {
  margin-left: auto;
  padding: 3px 10px;
  background: none;
  border: 1px solid #33bbaa;
  border-radius: 4px;
  color: #33bbaa;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
}

/* Status line */
.wc-status {
  padding: 6px 13px;
  font-size: 10px;
  color: #3a6a8a;
  text-align: center;
}

/* Exclusion warning */
.wc-warn {
  padding: 6px 13px;
  font-size: 10px;
  color: #ee8833;
  text-align: center;
  background: rgba(100,60,20,0.2);
}
`;

const ZONE_TYPE_COLORS: Record<WeatherZoneType, { bg: string; border: string; color: string }> = {
  mist: { bg: 'rgba(180,140,60,0.15)', border: '#aa8830', color: '#ccaa44' },
  echo: { bg: 'rgba(180,60,100,0.15)', border: '#aa3366', color: '#cc4488' },
  ion:  { bg: 'rgba(60,180,100,0.15)', border: '#30aa66', color: '#44cc88' },
};

function hslStr(h: number, s: number, l: number): string {
  return `hsl(${h},${s}%,${l}%)`;
}

export class WorldCreator {
  private container: HTMLDivElement;
  private open = false;
  private builder = new WorldBuilder();
  private placement: PlacementMode = { kind: 'none' };
  private callbacks: WorldCreatorCallbacks;
  private browseOpen = false;
  private browseWorlds: WorldSummary[] = [];
  private selectedSourceId: string | null = null;
  private selectedZoneId: string | null = null;
  private existsOnServer = false;
  private activeFamily: string | null = null;
  private lastExclusionWarn = '';

  constructor(container: HTMLDivElement, callbacks: WorldCreatorCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    if (!document.getElementById('wc-style')) {
      const style = document.createElement('style');
      style.id = 'wc-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
  }

  isOpen(): boolean { return this.open; }

  toggle(): void {
    this.open = !this.open;
    if (this.open) {
      this.render();
    } else {
      this.cancelPlacement();
    }
    this.container.classList.toggle('wc-open', this.open);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.cancelPlacement();
    this.container.classList.remove('wc-open');
  }

  getBuilder(): WorldBuilder { return this.builder; }

  isPlacementActive(): boolean { return this.placement.kind !== 'none'; }

  /** Called by main.ts when user clicks on the sphere in create mode. */
  handleSphereClick(pos: SphericalCoord): boolean {
    if (this.placement.kind === 'source') {
      // Exclusion check: reject if too close to an existing source
      for (const existing of this.builder.getSources()) {
        if (chordDistance(pos, existing.position) < SOURCE_EXCLUSION_RADIUS) {
          this.lastExclusionWarn = 'Too close to an existing source';
          this.render();
          return false;
        }
      }
      this.lastExclusionWarn = '';
      this.builder.addSource(this.placement.archetypeName, pos);
      this.callbacks.onWorldChanged();
      this.render();
      return true;
    } else if (this.placement.kind === 'zone') {
      this.lastExclusionWarn = '';
      const zone = this.builder.addZone(this.placement.zoneType, pos);
      this.selectedZoneId = zone.id;
      this.callbacks.onWorldChanged();
      this.render();
      return true;
    }
    return false;
  }

  private cancelPlacement(): void {
    if (this.placement.kind !== 'none') {
      this.placement = { kind: 'none' };
      this.lastExclusionWarn = '';
      this.callbacks.onPlacementModeChange(false);
    }
  }

  private render(): void {
    let html = '';

    // Placement banner
    if (this.placement.kind !== 'none') {
      const label = this.placement.kind === 'source'
        ? `Click sphere to place: ${this.placement.archetypeName}`
        : `Click sphere to place: ${this.placement.zoneType} zone`;
      html += `<div class="wc-placement-banner">
        <span>${label}</span>
        <button class="wc-placement-cancel" data-action="cancel-placement">Cancel</button>
      </div>`;
    }

    // Exclusion warning
    if (this.lastExclusionWarn) {
      html += `<div class="wc-warn">${this.lastExclusionWarn}</div>`;
    }

    // World name + action buttons
    html += `<div class="wc-section">
      <div class="wc-section-title">World</div>
      <input class="wc-name-input" type="text" value="${this.escapeHtml(this.builder.getWorldName())}" data-action="name" />
      <div class="wc-btn-row">
        <button class="wc-btn" data-action="save">Save</button>
        <button class="wc-btn${this.browseOpen ? ' wc-btn-active' : ''}" data-action="browse">Browse</button>
        <button class="wc-btn" data-action="new">New</button>
      </div>
    </div>`;

    // Browse panel
    if (this.browseOpen) {
      html += this.renderBrowsePanel();
    }

    // Sources section with family selector
    html += `<div class="wc-section">
      <div class="wc-section-title">Sources (${this.builder.getSources().length})</div>
      <div class="wc-family-grid">`;
    for (const fam of FAMILIES) {
      const isActive = this.activeFamily === fam.name;
      const bg = hslStr(fam.hue, 40, 18);
      const border = hslStr(fam.hue, 60, 45);
      const color = hslStr(fam.hue, 75, 70);
      html += `<button class="wc-family-btn${isActive ? ' wc-family-active' : ''}" data-action="pick-family" data-family="${fam.name}" style="background:${bg};border-color:${border};color:${color};">${fam.name}</button>`;
    }
    html += `</div>`;

    // Show archetypes for selected family
    if (this.activeFamily) {
      const fam = FAMILIES.find(f => f.name === this.activeFamily);
      if (fam) {
        html += `<div class="wc-arch-list">`;
        for (const archName of fam.archetypes) {
          const isSelected = this.placement.kind === 'source' && this.placement.archetypeName === archName;
          const color = hslStr(fam.hue, 75, isSelected ? 75 : 60);
          const borderColor = isSelected ? hslStr(fam.hue, 80, 65) : '#142a3c';
          html += `<div class="wc-arch-item${isSelected ? ' wc-arch-selected' : ''}" data-action="pick-archetype" data-name="${archName}" style="color:${color};border-color:${borderColor};">${archName}</div>`;
        }
        html += `</div>`;
      }
    }

    // Placed sources list
    const sources = this.builder.getSources();
    if (sources.length > 0) {
      html += `<div class="wc-item-list">`;
      for (const src of sources) {
        const isSelected = this.selectedSourceId === src.id;
        const hue = hashString(src.archetypeName) % 360;
        const dotColor = hslStr(hue, 80, 60);
        html += `<div class="wc-item-row${isSelected ? ' wc-item-selected' : ''}" data-action="select-source" data-id="${src.id}">
          <div class="wc-item-dot" style="background:${dotColor};"></div>
          <span class="wc-item-name">${this.escapeHtml(src.archetypeName)}</span>
          <span style="font-size:9px;color:#4a7a96;">${src.position.lat.toFixed(0)},${src.position.lon.toFixed(0)}</span>
          <button class="wc-item-del" data-action="del-source" data-id="${src.id}">&times;</button>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;

    // Zones section
    html += `<div class="wc-section">
      <div class="wc-section-title">Zones (${this.builder.getZones().length})</div>
      <div class="wc-zone-btns">`;
    for (const type of ['mist', 'echo', 'ion'] as WeatherZoneType[]) {
      const c = ZONE_TYPE_COLORS[type];
      const isActive = this.placement.kind === 'zone' && this.placement.zoneType === type;
      html += `<button class="wc-zone-btn${isActive ? ' wc-btn-active' : ''}" data-action="pick-zone" data-type="${type}" style="background:${c.bg};border-color:${c.border};color:${c.color};opacity:${isActive ? 1 : 0.7};">${type}</button>`;
    }
    html += `</div>`;

    // Placed zones list + sliders
    const zones = this.builder.getZones();
    if (zones.length > 0) {
      html += `<div class="wc-item-list">`;
      for (const zone of zones) {
        const c = ZONE_TYPE_COLORS[zone.type];
        const isSelected = this.selectedZoneId === zone.id;
        html += `<div>
          <div class="wc-item-row${isSelected ? ' wc-item-selected' : ''}" data-action="select-zone" data-id="${zone.id}">
            <div class="wc-item-dot" style="background:${c.color};"></div>
            <span class="wc-item-name">${zone.type} zone</span>
            <span style="font-size:9px;color:#4a7a96;">${zone.center.lat.toFixed(0)},${zone.center.lon.toFixed(0)}</span>
            <button class="wc-item-del" data-action="del-zone" data-id="${zone.id}">&times;</button>
          </div>`;
        if (isSelected) {
          html += this.renderZoneSliders(zone.id, zone.radiusDeg, zone.featherDeg, zone.intensity);
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;

    // Play button
    html += `<div class="wc-section">
      <button class="wc-btn wc-btn-play" data-action="play" style="width:100%;">\u25B6 Play This World</button>
    </div>`;

    // Status
    html += `<div class="wc-status">${sources.length} sources, ${zones.length} zones</div>`;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  private renderBrowsePanel(): string {
    let html = `<div class="wc-section">
      <div class="wc-section-title">Public Worlds</div>
      <div class="wc-browse-list">`;
    if (this.browseWorlds.length === 0) {
      html += `<div style="color:#3a6a8a;font-size:11px;padding:8px;">No worlds saved yet</div>`;
    }
    const myId = getAuthorId();
    for (const w of this.browseWorlds) {
      const isMine = w.authorId === myId;
      html += `<div class="wc-browse-row">
        <div class="wc-browse-info">
          <div class="wc-browse-name">${this.escapeHtml(w.name)}</div>
          <div class="wc-browse-meta">${w.sourceCount} sources, ${w.zoneCount} zones${isMine ? ' (yours)' : ''}</div>
        </div>
        <div class="wc-browse-actions">
          <button class="wc-btn" data-action="load-world" data-id="${w.id}" style="min-width:40px;flex:none;padding:4px 8px;">Load</button>
          ${isMine ? `<button class="wc-btn wc-btn-danger" data-action="delete-world" data-id="${w.id}" style="min-width:32px;flex:none;padding:4px 8px;">Del</button>` : ''}
        </div>
      </div>`;
    }
    html += `</div></div>`;
    return html;
  }

  private renderZoneSliders(id: string, radius: number, feather: number, intensity: number): string {
    return `<div style="padding:4px 6px 8px 20px;">
      <div class="wc-slider-row">
        <span class="wc-slider-label">Radius</span>
        <input class="wc-slider" type="range" min="5" max="40" step="1" value="${radius}" data-action="zone-param" data-id="${id}" data-param="radiusDeg" />
        <span class="wc-slider-val">${radius.toFixed(0)}&deg;</span>
      </div>
      <div class="wc-slider-row">
        <span class="wc-slider-label">Feather</span>
        <input class="wc-slider" type="range" min="2" max="30" step="1" value="${feather}" data-action="zone-param" data-id="${id}" data-param="featherDeg" />
        <span class="wc-slider-val">${feather.toFixed(0)}&deg;</span>
      </div>
      <div class="wc-slider-row">
        <span class="wc-slider-label">Intensity</span>
        <input class="wc-slider" type="range" min="10" max="100" step="1" value="${Math.round(intensity * 100)}" data-action="zone-param" data-id="${id}" data-param="intensity" />
        <span class="wc-slider-val">${(intensity * 100).toFixed(0)}%</span>
      </div>
    </div>`;
  }

  private bindEvents(): void {
    this.container.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action;

      switch (action) {
        case 'cancel-placement':
          this.cancelPlacement();
          this.render();
          break;
        case 'save':
          void this.saveWorld();
          break;
        case 'browse':
          this.browseOpen = !this.browseOpen;
          if (this.browseOpen) void this.loadBrowseList();
          else this.render();
          break;
        case 'new':
          this.builder.clear();
          this.existsOnServer = false;
          this.selectedSourceId = null;
          this.selectedZoneId = null;
          this.activeFamily = null;
          this.cancelPlacement();
          this.callbacks.onWorldChanged();
          this.render();
          break;
        case 'pick-family': {
          const fam = target.dataset.family!;
          this.activeFamily = this.activeFamily === fam ? null : fam;
          // If deselecting family, also cancel any source placement from that family
          if (!this.activeFamily && this.placement.kind === 'source') {
            this.cancelPlacement();
          }
          this.render();
          break;
        }
        case 'pick-archetype': {
          const name = target.dataset.name!;
          if (this.placement.kind === 'source' && this.placement.archetypeName === name) {
            this.cancelPlacement();
          } else {
            this.placement = { kind: 'source', archetypeName: name };
            this.lastExclusionWarn = '';
            this.callbacks.onPlacementModeChange(true);
          }
          this.render();
          break;
        }
        case 'pick-zone': {
          const type = target.dataset.type as WeatherZoneType;
          if (this.placement.kind === 'zone' && this.placement.zoneType === type) {
            this.cancelPlacement();
          } else {
            this.placement = { kind: 'zone', zoneType: type };
            this.lastExclusionWarn = '';
            this.callbacks.onPlacementModeChange(true);
          }
          this.render();
          break;
        }
        case 'select-source':
          this.selectedSourceId = target.dataset.id ?? null;
          this.render();
          break;
        case 'del-source':
          e.stopPropagation();
          this.builder.removeSource(target.dataset.id!);
          if (this.selectedSourceId === target.dataset.id) this.selectedSourceId = null;
          this.callbacks.onWorldChanged();
          this.render();
          break;
        case 'select-zone':
          this.selectedZoneId = this.selectedZoneId === target.dataset.id ? null : (target.dataset.id ?? null);
          this.render();
          break;
        case 'del-zone':
          e.stopPropagation();
          this.builder.removeZone(target.dataset.id!);
          if (this.selectedZoneId === target.dataset.id) this.selectedZoneId = null;
          this.callbacks.onWorldChanged();
          this.render();
          break;
        case 'load-world':
          void this.loadWorld(target.dataset.id!);
          break;
        case 'delete-world':
          void this.deleteWorld(target.dataset.id!);
          break;
        case 'play':
          this.callbacks.onPlay();
          break;
      }
    });

    // Name input
    const nameInput = this.container.querySelector('[data-action="name"]') as HTMLInputElement | null;
    nameInput?.addEventListener('input', () => {
      this.builder.setWorldName(nameInput.value);
    });

    // Zone param sliders
    this.container.querySelectorAll('[data-action="zone-param"]').forEach((el) => {
      el.addEventListener('input', () => {
        const input = el as HTMLInputElement;
        const id = input.dataset.id!;
        const param = input.dataset.param!;
        let value = Number(input.value);
        if (param === 'intensity') value /= 100;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.builder.updateZoneParam(id, param as any, value);
        const valSpan = input.nextElementSibling as HTMLSpanElement;
        if (valSpan) {
          if (param === 'intensity') valSpan.textContent = `${Math.round(value * 100)}%`;
          else valSpan.textContent = `${value.toFixed(0)}\u00B0`;
        }
        this.callbacks.onWorldChanged();
      });
    });
  }

  private async saveWorld(): Promise<void> {
    try {
      const def = this.builder.toWorldDef();
      if (this.existsOnServer) {
        await api.updateWorld(def);
      } else {
        await api.createWorld(def);
        this.existsOnServer = true;
      }
      this.render();
    } catch (err) {
      console.error('Failed to save world:', err);
    }
  }

  private async loadBrowseList(): Promise<void> {
    try {
      this.browseWorlds = await api.listWorlds();
    } catch (err) {
      console.error('Failed to load world list:', err);
      this.browseWorlds = [];
    }
    this.render();
  }

  private async loadWorld(id: string): Promise<void> {
    try {
      const def = await api.getWorld(id);
      this.builder.loadFromWorldDef(def);
      this.existsOnServer = true;
      this.selectedSourceId = null;
      this.selectedZoneId = null;
      this.activeFamily = null;
      this.cancelPlacement();
      this.browseOpen = false;
      this.callbacks.onWorldChanged();
      this.render();
    } catch (err) {
      console.error('Failed to load world:', err);
    }
  }

  private async deleteWorld(id: string): Promise<void> {
    try {
      await api.deleteWorld(id);
      this.browseWorlds = this.browseWorlds.filter(w => w.id !== id);
      if (this.builder.getWorldId() === id) {
        this.existsOnServer = false;
      }
      this.render();
    } catch (err) {
      console.error('Failed to delete world:', err);
    }
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
