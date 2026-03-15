import type { WeatherEffectTuning, WeatherFxProfileName } from '../engine/WeatherZoneEngine.ts';
import type { WeatherZoneType } from '../types.ts';
import { WEATHER_FX_PROFILE_NAMES } from '../engine/WeatherZoneEngine.ts';

export interface PlayerZoneInfo {
  id: string;
  type: WeatherZoneType;
  distance: number;
}

export interface WeatherEditorCallbacks {
  onPresetChange: (name: WeatherFxProfileName) => void;
  onParamChange: (key: string, value: number) => void;
  onReset: () => void;
}

// ── CSS (injected once) ───────────────────────────────────────────────────────

const CSS = `
#weather-editor {
  position: fixed;
  bottom: 85px;
  left: 16px;
  width: 340px;
  max-height: 80vh;
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
  scrollbar-width: thin;
  scrollbar-color: #1a3a55 transparent;
}
#weather-editor.we-open { display: block; }

.we-section {
  padding: 11px 13px;
  border-bottom: 1px solid #152d42;
}
.we-section:last-child { border-bottom: none; }

.we-section-title {
  color: #2a6a8a;
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  margin-bottom: 9px;
}

/* Preset buttons */
.we-presets {
  display: flex;
  gap: 8px;
}
.we-preset-btn {
  flex: 1;
  background: #0e2a40;
  border: 1px solid #1d4a6a;
  border-radius: 8px;
  color: #5a8aaa;
  font-family: inherit;
  font-size: 11px;
  padding: 7px 4px 5px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
.we-preset-btn:hover { background: #143a55; border-color: #2d6a9a; color: #8ac8e0; }
.we-preset-btn.we-preset-active {
  border: 2px solid var(--we-accent);
  color: var(--we-accent-light);
  font-weight: bold;
  box-shadow: 0 0 10px rgba(var(--we-accent-rgb), 0.4), inset 0 0 6px rgba(var(--we-accent-rgb), 0.15);
}
.we-preset-dots {
  display: flex;
  gap: 3px;
  align-items: flex-end;
  height: 14px;
}
.we-preset-dot {
  width: 5px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.8;
}
.we-preset-label {
  font-size: 9px;
  letter-spacing: 0.8px;
  opacity: 0.75;
}

/* Zone pills */
.we-zone-pills {
  display: flex;
  gap: 6px;
}
.we-zone-pill {
  flex: 1;
  background: #0e2a40;
  border: 1px solid #1d4a6a;
  border-radius: 6px;
  color: #5a8aaa;
  font-family: inherit;
  font-size: 11px;
  padding: 5px 6px;
  cursor: pointer;
  text-align: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.we-zone-pill:hover { background: #143a55; border-color: #2d6a9a; color: #8ac8e0; }
.we-zone-pill.we-zone-active {
  background: #0c2e4a;
  border: 2px solid #3a7aaa;
  color: #88ccee;
  font-weight: bold;
}
.we-zone-pill.we-zone-disabled {
  opacity: 0.25;
  pointer-events: none;
  cursor: default;
}

/* Sliders */
.we-param-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.we-param-row:last-child { margin-bottom: 0; }
.we-param-label {
  width: 72px;
  flex-shrink: 0;
  color: #6a9ab8;
  font-size: 11px;
  text-align: right;
}
.we-slider {
  flex: 1;
  height: 3px;
  accent-color: #4477ee;
  cursor: pointer;
}
.we-param-value {
  width: 38px;
  flex-shrink: 0;
  color: #88c8e0;
  font-size: 11px;
  text-align: right;
}

/* Header / reset */
.we-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 13px 0;
  margin-bottom: 2px;
}
.we-title {
  color: #4477ee;
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 0.8px;
}
.we-reset-btn {
  background: none;
  border: 1px solid #2a5a7a;
  border-radius: 5px;
  color: #6a9ab8;
  font-family: inherit;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.we-reset-btn:hover { border-color: #4a8ab8; color: #a0c8e0; }
`;

let cssInjected = false;

function injectCss(): void {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Preset visual config ───────────────────────────────────────────────────────

const PRESET_CONFIG: Record<WeatherFxProfileName, {
  accent: string;
  accentLight: string;
  accentRgb: string;
  label: string;
  dotHeights: number[];  // bar heights in px for intensity icon
}> = {
  subtle: {
    accent: '#33bbaa',
    accentLight: '#aafff0',
    accentRgb: '51,187,170',
    label: 'SUBTLE',
    dotHeights: [8],
  },
  experimental: {
    accent: '#4477ee',
    accentLight: '#aaccff',
    accentRgb: '68,119,238',
    label: 'MEDIUM',
    dotHeights: [5, 10],
  },
  extreme: {
    accent: '#ee5533',
    accentLight: '#ffbbaa',
    accentRgb: '238,85,51',
    label: 'INTENSE',
    dotHeights: [4, 7, 10],
  },
};

// Zone type hues (matching WEATHER_TYPE_COLOR_PROFILE in WorldView.ts)
const ZONE_TYPE_HUE: Record<'mist' | 'echo' | 'ion', number> = {
  mist: 34,
  echo: 341,
  ion: 122,
};

// ── Per-zone param definitions ─────────────────────────────────────────────────

type ParamDef = { label: string; key: string; min: number; max: number };

const ZONE_PARAMS: Record<'mist' | 'echo' | 'ion', ParamDef[]> = {
  mist: [
    { label: 'Wet', key: 'zoneTypeFxBias.mist.wetLevel', min: 0.1, max: 3.0 },
    { label: 'Reverb', key: 'zoneTypeFxBias.mist.reverbRoomSize', min: 0.1, max: 3.0 },
    { label: 'Dly Time', key: 'zoneTypeFxBias.mist.delayTimeSec', min: 0.1, max: 3.0 },
    { label: 'LP Cutoff', key: 'zoneTypeFxBias.mist.lowpassHz', min: 0.1, max: 3.0 },
    { label: 'BP Mix', key: 'zoneTypeFxBias.mist.bandpassMix', min: 0.05, max: 3.5 },
  ],
  echo: [
    { label: 'Wet', key: 'zoneTypeFxBias.echo.wetLevel', min: 0.1, max: 3.0 },
    { label: 'Dly Time', key: 'zoneTypeFxBias.echo.delayTimeSec', min: 0.1, max: 3.0 },
    { label: 'Dly Fdbk', key: 'zoneTypeFxBias.echo.delayFeedback', min: 0.1, max: 3.0 },
    { label: 'Dly Wet', key: 'zoneTypeFxBias.echo.delayWet', min: 0.1, max: 3.0 },
    { label: 'Reverb', key: 'zoneTypeFxBias.echo.reverbRoomSize', min: 0.1, max: 3.0 },
  ],
  ion: [
    { label: 'Wet', key: 'zoneTypeFxBias.ion.wetLevel', min: 0.1, max: 3.0 },
    { label: 'BP Mix', key: 'zoneTypeFxBias.ion.bandpassMix', min: 0.05, max: 3.5 },
    { label: 'BP Q', key: 'zoneTypeFxBias.ion.bandpassQ', min: 0.05, max: 4.0 },
    { label: 'BP LFO', key: 'zoneTypeFxBias.ion.bandpassSweepHz', min: 0.05, max: 5.0 },
    { label: 'HP Cutoff', key: 'zoneTypeFxBias.ion.highpassHz', min: 0.1, max: 3.5 },
  ],
};

const GLOBAL_PARAMS: ParamDef[] = [
  { label: 'FX Send', key: 'globalBlendAmount', min: 0.2, max: 3.0 },
  { label: 'Reverb ×', key: 'fxMultiplier.reverbRoomSize', min: 0.1, max: 3.5 },
  { label: 'Dly Fdbk ×', key: 'fxMultiplier.delayFeedback', min: 0.1, max: 3.5 },
];

// ── Tuning value reader ────────────────────────────────────────────────────────

function readTuningValue(tuning: WeatherEffectTuning, key: string): number {
  const parts = key.split('.');
  if (parts.length === 1) {
    return (tuning as unknown as Record<string, number>)[key] ?? 1;
  }
  if (parts.length === 2) {
    const [sec, field] = parts;
    return ((tuning as unknown as Record<string, Record<string, number>>)[sec!]?.[field!]) ?? 1;
  }
  if (parts.length === 3) {
    const [sec, zone, field] = parts;
    return ((tuning as unknown as Record<string, Record<string, Record<string, number>>>)[sec!]?.[zone!]?.[field!]) ?? 1;
  }
  return 1;
}

// ── WeatherEditor class ────────────────────────────────────────────────────────

export class WeatherEditor {
  private container: HTMLElement;
  private callbacks: WeatherEditorCallbacks;
  private open = false;
  private currentProfile: WeatherFxProfileName = 'experimental';
  private selectedZone: 'mist' | 'echo' | 'ion' = 'mist';
  private playerZones: PlayerZoneInfo[] = [];
  private selectedZoneId: string | null = null;
  private getTuning: () => WeatherEffectTuning;

  constructor(
    container: HTMLElement,
    getTuning: () => WeatherEffectTuning,
    callbacks: WeatherEditorCallbacks,
  ) {
    injectCss();
    this.container = container;
    this.getTuning = getTuning;
    this.callbacks = callbacks;
  }

  setPlayerZones(zones: PlayerZoneInfo[]): void {
    this.playerZones = zones;
    if (zones.length > 0) {
      const nearest = zones[0]!;
      this.selectedZoneId = nearest.id;
      this.selectedZone = nearest.type;
    }
  }

  getSelectedZoneId(): string | null {
    return this.selectedZoneId;
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) {
      this.render();
      this.container.classList.add('we-open');
    } else {
      this.container.classList.remove('we-open');
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Update displayed profile without triggering callbacks. */
  setProfile(name: WeatherFxProfileName): void {
    this.currentProfile = name;
    if (this.open) this.render();
  }

  private render(): void {
    const tuning = this.getTuning();

    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'we-header';
    const title = document.createElement('span');
    title.className = 'we-title';
    title.textContent = 'FX EDITOR';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'we-reset-btn';
    resetBtn.textContent = 'RESET';
    resetBtn.addEventListener('click', () => {
      this.callbacks.onReset();
      this.render(); // refresh sliders after reset
    });
    header.appendChild(title);
    header.appendChild(resetBtn);
    this.container.appendChild(header);

    // Preset section
    const presetSection = document.createElement('div');
    presetSection.className = 'we-section';
    const presetTitle = document.createElement('div');
    presetTitle.className = 'we-section-title';
    presetTitle.textContent = 'Intensity Preset';
    presetSection.appendChild(presetTitle);

    const presetsRow = document.createElement('div');
    presetsRow.className = 'we-presets';

    for (const name of WEATHER_FX_PROFILE_NAMES) {
      const cfg = PRESET_CONFIG[name];
      const btn = document.createElement('button');
      btn.className = 'we-preset-btn';
      if (name === this.currentProfile) {
        btn.classList.add('we-preset-active');
        btn.style.setProperty('--we-accent', cfg.accent);
        btn.style.setProperty('--we-accent-light', cfg.accentLight);
        btn.style.setProperty('--we-accent-rgb', cfg.accentRgb);
      }

      // Intensity icon: vertical bars of increasing height
      const dotsEl = document.createElement('div');
      dotsEl.className = 'we-preset-dots';
      for (const h of cfg.dotHeights) {
        const dot = document.createElement('div');
        dot.className = 'we-preset-dot';
        dot.style.height = `${h}px`;
        dot.style.color = name === this.currentProfile ? cfg.accent : '';
        dotsEl.appendChild(dot);
      }
      dotsEl.style.color = name === this.currentProfile ? cfg.accent : '#4a7a9a';

      const labelEl = document.createElement('div');
      labelEl.className = 'we-preset-label';
      labelEl.textContent = cfg.label;

      btn.appendChild(dotsEl);
      btn.appendChild(labelEl);
      btn.addEventListener('click', () => {
        this.currentProfile = name;
        this.callbacks.onPresetChange(name);
        this.render();
      });
      presetsRow.appendChild(btn);
    }
    presetSection.appendChild(presetsRow);
    this.container.appendChild(presetSection);

    // Global params section
    const globalSection = document.createElement('div');
    globalSection.className = 'we-section';
    const globalTitle = document.createElement('div');
    globalTitle.className = 'we-section-title';
    globalTitle.textContent = 'Global';
    globalSection.appendChild(globalTitle);
    for (const param of GLOBAL_PARAMS) {
      globalSection.appendChild(this.buildParamRow(param, tuning));
    }
    this.container.appendChild(globalSection);

    // Zone type picker
    const zoneSection = document.createElement('div');
    zoneSection.className = 'we-section';
    const zoneTitle = document.createElement('div');
    zoneTitle.className = 'we-section-title';
    zoneTitle.textContent = 'Zone Type';
    zoneSection.appendChild(zoneTitle);

    const pillsRow = document.createElement('div');
    pillsRow.className = 'we-zone-pills';
    const ZONE_LABELS: Record<'mist' | 'echo' | 'ion', string> = {
      mist: '~ Mist',
      echo: '⌁ Echo',
      ion: '⚡ Ion',
    };
    const availableTypes = new Set(this.playerZones.map(z => z.type));

    for (const zone of ['mist', 'echo', 'ion'] as const) {
      const pill = document.createElement('button');
      pill.className = 'we-zone-pill';
      const isAvailable = availableTypes.has(zone);
      const isActive = zone === this.selectedZone;
      const hue = ZONE_TYPE_HUE[zone];

      if (!isAvailable) {
        pill.classList.add('we-zone-disabled');
      }

      // Zone-type coloring
      pill.style.borderColor = isActive
        ? `hsl(${hue}, 72%, 55%)`
        : `hsl(${hue}, 40%, 32%)`;
      pill.style.color = isActive
        ? `hsl(${hue}, 85%, 78%)`
        : `hsl(${hue}, 45%, 58%)`;

      if (isActive) {
        pill.classList.add('we-zone-active');
        pill.style.boxShadow = `0 0 10px hsla(${hue}, 70%, 50%, 0.35)`;
      }

      pill.textContent = ZONE_LABELS[zone];

      if (isAvailable) {
        pill.addEventListener('click', () => {
          const zoneOfType = this.playerZones.find(z => z.type === zone);
          if (zoneOfType) this.selectedZoneId = zoneOfType.id;
          this.selectedZone = zone;
          this.render();
        });
      }

      pillsRow.appendChild(pill);
    }
    zoneSection.appendChild(pillsRow);
    this.container.appendChild(zoneSection);

    // Zone params section (dynamic)
    const zoneParamsSection = document.createElement('div');
    zoneParamsSection.className = 'we-section';
    this.renderZoneParams(zoneParamsSection, tuning);
    this.container.appendChild(zoneParamsSection);
  }

  private renderZoneParams(section: HTMLElement, tuning: WeatherEffectTuning): void {
    section.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'we-section-title';
    title.textContent = this.selectedZone.charAt(0).toUpperCase() + this.selectedZone.slice(1) + ' Parameters';
    section.appendChild(title);
    for (const param of ZONE_PARAMS[this.selectedZone]) {
      section.appendChild(this.buildParamRow(param, tuning));
    }
  }

  private buildParamRow(param: ParamDef, tuning: WeatherEffectTuning): HTMLElement {
    const row = document.createElement('div');
    row.className = 'we-param-row';

    const label = document.createElement('span');
    label.className = 'we-param-label';
    label.textContent = param.label;

    const currentVal = readTuningValue(tuning, param.key);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'we-slider';
    slider.min = String(param.min);
    slider.max = String(param.max);
    slider.step = '0.01';
    slider.value = String(currentVal);

    const valueEl = document.createElement('span');
    valueEl.className = 'we-param-value';
    valueEl.textContent = currentVal.toFixed(2);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valueEl.textContent = v.toFixed(2);
      this.callbacks.onParamChange(param.key, v);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueEl);
    return row;
  }
}
