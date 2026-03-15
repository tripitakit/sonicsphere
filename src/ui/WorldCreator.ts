import type { SoundEngineType, SphericalCoord, WeatherZoneType, WorldSummary } from '../types.ts';
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

// ── Engine tabs ──────────────────────────────────────────────────────────────

const ENGINE_TABS: { engine: SoundEngineType; label: string; color: string; border: string; bg: string }[] = [
  { engine: 'subtractive', label: 'Synth',     color: '#7fb8d4', border: '#3388aa', bg: 'rgba(20,55,80,0.5)' },
  { engine: 'noise',       label: 'Noise',     color: '#b8a47f', border: '#aa8833', bg: 'rgba(60,45,20,0.5)' },
  { engine: 'fm',          label: 'FM',        color: '#a47fb8', border: '#8833aa', bg: 'rgba(50,20,60,0.5)' },
  { engine: 'resonator',   label: 'Resonator', color: '#7fb8a4', border: '#33aa88', bg: 'rgba(20,60,45,0.5)' },
];

/** Pre-computed archetype names per engine, sorted alphabetically. */
const ARCHETYPES_BY_ENGINE: Record<SoundEngineType, string[]> = {
  subtractive: ARCHETYPES.filter(a => (a.engine ?? 'subtractive') === 'subtractive').map(a => a.name).sort(),
  noise: ARCHETYPES.filter(a => a.engine === 'noise').map(a => a.name).sort(),
  fm: ARCHETYPES.filter(a => a.engine === 'fm').map(a => a.name).sort(),
  resonator: ARCHETYPES.filter(a => a.engine === 'resonator').map(a => a.name).sort(),
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Minimum chord distance between two placed sources (maps to ~10px at default zoom). */
const SOURCE_EXCLUSION_RADIUS = 2.5;

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
#world-creator {
  position: fixed;
  top: 10px;
  left: 10px;
  width: 510px;
  height: calc(100vh - 20px);
  overflow-y: auto;
  background: rgba(8, 22, 38, 0.94);
  border: 1px solid #1a3a55;
  border-radius: 14px;
  font-family: 'Courier New', monospace;
  font-size: 15px;
  color: #a0c8e0;
  z-index: 1000;
  display: none;
  box-shadow: 0 5px 32px rgba(0,0,0,0.7);
  flex-direction: column;
}
#world-creator.wc-open { display: flex; }

.wc-section {
  padding: 14px 18px;
  border-bottom: 1px solid #1a3a55;
  flex-shrink: 0;
}
.wc-section:last-child { border-bottom: none; }
.wc-section-sources {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.wc-section-title {
  font-size: 12px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: #5a8aa5;
  margin-bottom: 10px;
}

.wc-name-input {
  width: 100%;
  background: rgba(5, 16, 28, 0.8);
  border: 1px solid #1a3a55;
  border-radius: 7px;
  color: #d7f1ff;
  font-family: inherit;
  font-size: 16px;
  padding: 8px 12px;
  outline: none;
}
.wc-name-input:focus { border-color: #33bbaa; }

.wc-btn-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.wc-btn {
  flex: 1;
  min-width: 70px;
  padding: 8px 0;
  background: rgba(16, 42, 62, 0.7);
  border: 1px solid #1a3a55;
  border-radius: 7px;
  color: #7fb8d4;
  font-family: inherit;
  font-size: 13px;
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
  font-size: 15px;
  padding: 11px 0;
}
.wc-btn-play:hover { background: rgba(30, 80, 65, 0.7); }

/* Engine tab bar */
.wc-engine-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.wc-engine-tab {
  flex: 1;
  padding: 7px 0;
  border-radius: 8px;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid;
  transition: opacity 0.15s;
  opacity: 0.55;
  text-align: center;
}
.wc-engine-tab:hover { opacity: 0.85; }
.wc-engine-tab.wc-tab-active { opacity: 1; box-shadow: 0 0 10px rgba(255,255,255,0.1); }

/* Archetype list within selected engine tab */
.wc-arch-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  align-content: flex-start;
}
.wc-arch-item {
  padding: 6px 12px;
  background: rgba(12, 30, 48, 0.7);
  border: 1px solid #1a3550;
  border-radius: 5px;
  font-size: 12px;
  color: #6b94ad;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.12s, color 0.12s;
}
.wc-arch-item:hover { border-color: #4488aa; color: #a0d0e8; }
.wc-arch-item.wc-arch-selected { border-color: #33bbaa; color: #33bbaa; }

/* Placed item list */
.wc-item-list {
  max-height: 200px;
  overflow-y: auto;
  margin-top: 8px;
}
.wc-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.wc-item-row:hover { background: rgba(20, 50, 70, 0.4); }
.wc-item-row.wc-item-selected { background: rgba(30, 70, 90, 0.5); border: 1px solid #2a6080; }
.wc-item-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wc-item-name {
  flex: 1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wc-item-del {
  width: 22px;
  height: 22px;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #5a6a78;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wc-item-del:hover { border-color: #ee5533; color: #ee5533; }

/* Zone type buttons */
.wc-zone-btns {
  display: flex;
  gap: 8px;
}
.wc-zone-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: 7px;
  font-family: inherit;
  font-size: 13px;
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
  gap: 8px;
  margin-top: 5px;
}
.wc-slider-label {
  width: 72px;
  font-size: 12px;
  color: #5a8aa5;
  text-align: right;
}
.wc-slider {
  flex: 1;
  accent-color: #33bbaa;
}
.wc-slider-val {
  width: 42px;
  font-size: 12px;
  color: #7fb8d4;
  text-align: left;
}

/* Browse panel */
.wc-browse-list {
  max-height: 280px;
  overflow-y: auto;
  margin-top: 8px;
}
.wc-browse-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid #0f2030;
}
.wc-browse-row:last-child { border-bottom: none; }
.wc-browse-info {
  flex: 1;
  font-size: 13px;
}
.wc-browse-name { color: #a0d0e8; }
.wc-browse-meta { color: #4a7a96; font-size: 11px; margin-top: 3px; }
.wc-browse-actions { display: flex; gap: 6px; }

/* Placement banner */
.wc-placement-banner {
  padding: 10px 18px;
  background: rgba(20, 60, 50, 0.5);
  border-bottom: 1px solid #1a5a4a;
  color: #33bbaa;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.wc-placement-cancel {
  margin-left: auto;
  padding: 4px 14px;
  background: none;
  border: 1px solid #33bbaa;
  border-radius: 5px;
  color: #33bbaa;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

/* Status line */
.wc-status {
  padding: 8px 18px;
  font-size: 12px;
  color: #3a6a8a;
  text-align: center;
}

/* Exclusion warning */
.wc-warn {
  padding: 8px 18px;
  font-size: 12px;
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
  private activeEngine: SoundEngineType = 'subtractive';
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
    // Preserve scroll position across re-renders
    const scrollTop = this.container.scrollTop;
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

    // Sources section with engine tabs (flex-grow to fill)
    html += `<div class="wc-section wc-section-sources">
      <div class="wc-section-title">Sources (${this.builder.getSources().length})</div>
      <div class="wc-engine-tabs">`;
    for (const tab of ENGINE_TABS) {
      const isActive = this.activeEngine === tab.engine;
      html += `<button class="wc-engine-tab${isActive ? ' wc-tab-active' : ''}" data-action="pick-engine" data-engine="${tab.engine}" style="background:${tab.bg};border-color:${tab.border};color:${tab.color};">${tab.label}</button>`;
    }
    html += `</div>`;

    // Show archetypes for selected engine tab (pre-sorted alphabetically)
    const archNames = ARCHETYPES_BY_ENGINE[this.activeEngine];
    if (archNames.length > 0) {
      html += `<div class="wc-arch-list">`;
      for (const archName of archNames) {
        const isSelected = this.placement.kind === 'source' && this.placement.archetypeName === archName;
        const hue = hashString(archName) % 360;
        const color = hslStr(hue, 75, isSelected ? 75 : 60);
        const borderColor = isSelected ? hslStr(hue, 80, 65) : '#1a3550';
        html += `<div class="wc-arch-item${isSelected ? ' wc-arch-selected' : ''}" data-action="pick-archetype" data-name="${archName}" style="color:${color};border-color:${borderColor};">${archName}</div>`;
      }
      html += `</div>`;
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
          <span style="font-size:11px;color:#4a7a96;">${src.position.lat.toFixed(0)},${src.position.lon.toFixed(0)}</span>
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
            <span style="font-size:11px;color:#4a7a96;">${zone.center.lat.toFixed(0)},${zone.center.lon.toFixed(0)}</span>
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
    // Restore scroll position to prevent jump on re-render
    this.container.scrollTop = scrollTop;
  }

  private renderBrowsePanel(): string {
    let html = `<div class="wc-section">
      <div class="wc-section-title">Public Worlds</div>
      <div class="wc-browse-list">`;
    if (this.browseWorlds.length === 0) {
      html += `<div style="color:#3a6a8a;font-size:13px;padding:10px;">No worlds saved yet</div>`;
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
          <button class="wc-btn" data-action="load-world" data-id="${w.id}" style="min-width:48px;flex:none;padding:5px 10px;">Load</button>
          ${isMine ? `<button class="wc-btn wc-btn-danger" data-action="delete-world" data-id="${w.id}" style="min-width:38px;flex:none;padding:5px 10px;">Del</button>` : ''}
        </div>
      </div>`;
    }
    html += `</div></div>`;
    return html;
  }

  private renderZoneSliders(id: string, radius: number, feather: number, intensity: number): string {
    return `<div style="padding:6px 8px 10px 24px;">
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
          this.cancelPlacement();
          this.callbacks.onWorldChanged();
          this.render();
          break;
        case 'pick-engine': {
          const engine = target.dataset.engine as SoundEngineType;
          this.activeEngine = engine;
          // Cancel source placement if it was from a different engine
          const pl = this.placement;
          if (pl.kind === 'source') {
            const arch = ARCHETYPES.find(a => a.name === pl.archetypeName);
            if (arch && (arch.engine ?? 'subtractive') !== engine) {
              this.cancelPlacement();
            }
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
