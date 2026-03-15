import type { SoundArchetype } from '../types.ts';
import type { SoundSource } from '../engine/SoundSource.ts';

export interface ArchetypeEditorCallbacks {
  onParamChange: (archetypeName: string, param: string, value: number | string) => void;
  onReset: (archetypeName: string) => void;
  onSoloChange: (sourceId: string | null) => void;
}

// ── Log-scale helpers ─────────────────────────────────────────────────────────

function logToSlider(value: number, min: number, max: number): number {
  return (Math.log(value / min) / Math.log(max / min)) * 100;
}

function sliderToLog(t: number, min: number, max: number): number {
  return min * Math.pow(max / min, t / 100);
}

// ── CSS (injected once) ───────────────────────────────────────────────────────

const CSS = `
#archetype-editor {
  position: fixed;
  bottom: 85px;
  right: 16px;
  width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(8, 22, 38, 0.93);
  border: 1px solid #1a3a55;
  border-radius: 13px;
  font-family: 'Courier New', monospace;
  font-size: 15px;
  color: #a0c8e0;
  z-index: 1000;
  display: none;
  box-shadow: 0 5px 32px rgba(0,0,0,0.7);
}
#archetype-editor.ae-open { display: block; }

.ae-hint {
  padding: 13px;
  border-bottom: 1px solid #1a3a55;
  color: #6b94ad;
  font-size: 12px;
  letter-spacing: 0.5px;
}
.ae-empty {
  padding: 13px;
  color: #3a6a8a;
  font-style: italic;
}

.ae-editor {
  padding: 13px;
}
.ae-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 13px;
}
.ae-editor-name {
  color: #33bbaa;
  font-size: 16px;
  font-weight: bold;
  letter-spacing: 0.7px;
}
.ae-reset-btn {
  background: none;
  border: 1px solid #2a5a7a;
  border-radius: 5px;
  color: #6a9ab8;
  font-family: inherit;
  font-size: 13px;
  padding: 3px 9px;
  cursor: pointer;
}
.ae-reset-btn:hover { border-color: #4a8ab8; color: #a0c8e0; }
.ae-solo-btn {
  background: none;
  border: 1px solid #2a5a7a;
  border-radius: 5px;
  color: #6a9ab8;
  font-family: inherit;
  font-size: 13px;
  padding: 3px 9px;
  cursor: pointer;
  letter-spacing: 0.7px;
}
.ae-solo-btn:hover { border-color: #c8921a; color: #e0a830; }
.ae-solo-btn.ae-solo-active {
  border-color: #f5a623;
  color: #f5a623;
  box-shadow: 0 0 8px rgba(245, 166, 35, 0.35);
}

.ae-section-label {
  color: #2a6a8a;
  font-size: 13px;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  margin: 11px 0 7px;
  border-top: 1px solid #122535;
  padding-top: 8px;
}
.ae-section-label:first-child { border-top: none; margin-top: 0; }

.ae-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}
.ae-label {
  width: 77px;
  color: #7a9ab8;
  font-size: 13px;
  flex-shrink: 0;
  text-align: right;
}
.ae-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: #1a3a55;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.ae-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #33bbaa;
  cursor: pointer;
  border: none;
}
.ae-slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #33bbaa;
  cursor: pointer;
  border: none;
}
.ae-value {
  width: 69px;
  color: #a0c8e0;
  font-size: 13px;
  text-align: right;
  flex-shrink: 0;
}

.ae-toggle-group {
  display: flex;
  gap: 4px;
  flex: 1;
}
.ae-toggle-btn {
  flex: 1;
  background: #0e2a40;
  border: 1px solid #1d4a6a;
  border-radius: 4px;
  color: #6a9ab8;
  font-family: inherit;
  font-size: 12px;
  padding: 3px 0;
  cursor: pointer;
  text-transform: uppercase;
}
.ae-toggle-btn:hover { background: #143a55; }
.ae-toggle-btn.ae-active {
  background: #0d3a50;
  border-color: #33bbaa;
  color: #33bbaa;
}
`;

function injectStyles(): void {
  if (document.getElementById('ae-styles')) return;
  const style = document.createElement('style');
  style.id = 'ae-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Main class ────────────────────────────────────────────────────────────────

export class ArchetypeEditor {
  private readonly container: HTMLElement;
  private readonly callbacks: ArchetypeEditorCallbacks;
  private readonly originalDefaults: Map<string, SoundArchetype>;

  private open = false;
  private selectedSourceId: string | null = null;
  private manuallySelected = false; // true = user explicitly picked a source in the world
  private soloedSourceId: string | null = null;
  private lastActiveKey = '';

  // Sources currently inside the hearing radius, ordered nearest first.
  private audibleSources: Map<string, SoundSource> = new Map();

  constructor(
    container: HTMLElement,
    originalDefaults: Map<string, SoundArchetype>,
    callbacks: ArchetypeEditorCallbacks,
  ) {
    this.container = container;
    this.originalDefaults = originalDefaults;
    this.callbacks = callbacks;
    injectStyles();
    this.container.innerHTML = '<div class="ae-empty">No active sources nearby</div>';
  }

  toggle(): void {
    this.open = !this.open;
    this.container.classList.toggle('ae-open', this.open);
    this.lastActiveKey = ''; // force re-render on next open/update

    if (this.open) {
      this.manuallySelected = false;
      this.selectedSourceId = this.getNearestSourceId();
      this.soloedSourceId = this.selectedSourceId;
      this.callbacks.onSoloChange(this.soloedSourceId);
      this.render();
      return;
    }

    this.callbacks.onSoloChange(null);
    this.soloedSourceId = null;
    this.manuallySelected = false;
    this.selectedSourceId = null;
  }

  isOpen(): boolean { return this.open; }
  getSelectedSourceId(): string | null { return this.selectedSourceId; }

  selectSource(sourceId: string): void {
    if (!this.open) return;
    if (!this.audibleSources.has(sourceId)) return;

    this.selectedSourceId = sourceId;
    this.manuallySelected = true;
    if (this.soloedSourceId !== null && this.soloedSourceId !== sourceId) {
      this.soloedSourceId = sourceId;
      this.callbacks.onSoloChange(sourceId);
    }
    this.lastActiveKey = '';
    this.render();
  }

  /**
   * Called every game frame. Re-renders only when the ordered list of audible
   * sources, selection, or solo state changes.
   */
  setAudibleSources(sources: SoundSource[]): void {
    const nextSources = new Map<string, SoundSource>();
    for (const source of sources) nextSources.set(source.getId(), source);
    this.audibleSources = nextSources;

    const nearestSourceId = this.getNearestSourceId();

    // If the manually-selected source left range, revert to auto-select.
    if (this.manuallySelected && this.selectedSourceId !== null && !nextSources.has(this.selectedSourceId)) {
      this.manuallySelected = false;
      this.selectedSourceId = null;
    }

    if (!this.manuallySelected) {
      this.selectedSourceId = nearestSourceId;
      if (this.soloedSourceId !== null && this.soloedSourceId !== nearestSourceId) {
        this.soloedSourceId = nearestSourceId;
        this.callbacks.onSoloChange(nearestSourceId);
      }
    }

    // If the soloed source left range, release solo and restore the full mix.
    if (this.soloedSourceId !== null && !nextSources.has(this.soloedSourceId)) {
      this.soloedSourceId = null;
      this.callbacks.onSoloChange(null);
    }

    if (!this.open) return;

    const key = `${this.selectedSourceId ?? ''}|${this.soloedSourceId ?? ''}|${[...nextSources.keys()].join(',')}`;
    if (key === this.lastActiveKey) return;
    this.lastActiveKey = key;

    this.render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    const { container, audibleSources, selectedSourceId } = this;
    container.innerHTML = '';

    const hint = document.createElement('div');
    hint.className = 'ae-hint';
    hint.textContent = 'click a nearby source marker in the world to edit it';
    container.appendChild(hint);

    if (audibleSources.size === 0) {
      const empty = document.createElement('span');
      empty.className = 'ae-empty';
      empty.textContent = 'No active sources nearby';
      container.appendChild(empty);
      return;
    }

    // Parameter editor
    if (selectedSourceId !== null) {
      const source = audibleSources.get(selectedSourceId);
      if (source) this.renderEditor(source);
      else this.renderNoSelection();
      return;
    }

    this.renderNoSelection();
  }

  private renderEditor(source: SoundSource): void {
    const arch = source.getArchetype();
    const sourceId = source.getId();

    const editor = document.createElement('div');
    editor.className = 'ae-editor';

    // Header
    const header = document.createElement('div');
    header.className = 'ae-editor-header';
    const nameEl = document.createElement('span');
    nameEl.className = 'ae-editor-name';
    nameEl.textContent = this.formatSourceLabel(source);

    const soloBtn = document.createElement('button');
    const isSoloed = this.soloedSourceId === sourceId;
    soloBtn.className = 'ae-solo-btn' + (isSoloed ? ' ae-solo-active' : '');
    soloBtn.textContent = isSoloed ? '◉ solo' : '◎ solo';
    soloBtn.title = 'Mute all other sources';
    soloBtn.addEventListener('click', () => {
      const nowSoloed = this.soloedSourceId === sourceId;
      if (nowSoloed) {
        // Release solo
        this.soloedSourceId = null;
        this.callbacks.onSoloChange(null);
      } else {
        this.soloedSourceId = sourceId;
        this.callbacks.onSoloChange(sourceId);
      }
      this.render();
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'ae-reset-btn';
    resetBtn.textContent = '↺ reset';
    resetBtn.addEventListener('click', () => this.handleReset(arch.name));
    header.appendChild(nameEl);
    header.appendChild(soloBtn);
    header.appendChild(resetBtn);
    editor.appendChild(header);

    const engine = arch.engine ?? 'subtractive';

    // ── BASE ──
    editor.appendChild(this.sectionLabel('Base'));

    if (engine !== 'noise' && engine !== 'resonator') {
      editor.appendChild(this.logSliderRow('Freq', 'frequency', arch.frequency, 16, 12000, 'Hz', arch.name));
    }
    if (engine === 'subtractive' || engine === 'fm') {
      editor.appendChild(this.toggleRow('Wave', 'waveform', arch.waveform,
        ['sine', 'triangle', 'square', 'sawtooth'], arch.name));
    }

    // ── ENVELOPE + LFO ──
    editor.appendChild(this.sectionLabel('Env / LFO'));
    editor.appendChild(this.linSliderRow('Sustain', 'sustain', arch.sustain, 0, 1, '', arch.name));
    editor.appendChild(this.logSliderRow('LFO Rate', 'lfoRate', arch.lfoRate, 0.01, 20, 'Hz', arch.name));
    editor.appendChild(this.linSliderRow('LFO Depth', 'lfoDepth', arch.lfoDepth, 0, 200, '', arch.name));

    // ── FILTER ──
    editor.appendChild(this.sectionLabel('Filter'));
    editor.appendChild(this.logSliderRow('Cutoff', 'filter.freq', arch.filter.freq, 20, 18000, 'Hz', arch.name));
    editor.appendChild(this.linSliderRow('Q', 'filter.Q', arch.filter.Q, 0.1, 25, '', arch.name));

    // ── ENGINE-SPECIFIC ──
    if (engine === 'fm') {
      editor.appendChild(this.sectionLabel('FM'));
      editor.appendChild(this.logSliderRow('Ratio', 'fmHarmonicity',
        arch.fmHarmonicity ?? 1.8, 0.1, 20, '', arch.name));
      editor.appendChild(this.linSliderRow('Mod Idx', 'fmModulationIndex',
        arch.fmModulationIndex ?? 3.2, 0.1, 60, '', arch.name));
      editor.appendChild(this.toggleRow('Mod Wave', 'fmModulationType',
        arch.fmModulationType ?? 'sine',
        ['sine', 'triangle', 'square', 'sawtooth'], arch.name));
    }

    if (engine === 'noise') {
      editor.appendChild(this.sectionLabel('Noise'));
      editor.appendChild(this.toggleRow('Color', 'noiseColor',
        arch.noiseColor ?? 'pink',
        ['white', 'pink', 'brown'], arch.name));
    }

    if (engine === 'resonator') {
      editor.appendChild(this.sectionLabel('Resonator'));
      editor.appendChild(this.logSliderRow('Pitch', 'resonatorHz',
        arch.resonatorHz ?? 200, 20, 1000, 'Hz', arch.name));
      editor.appendChild(this.linSliderRow('Feedback', 'resonatorFeedback',
        arch.resonatorFeedback ?? 0.76, 0.02, 0.98, '', arch.name));
    }

    this.container.appendChild(editor);
  }

  // ── Widget builders ────────────────────────────────────────────────────────

  private sectionLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ae-section-label';
    el.textContent = text;
    return el;
  }

  private logSliderRow(
    label: string, key: string, value: number,
    min: number, max: number, unit: string,
    archetypeName: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ae-row';

    const lbl = document.createElement('span');
    lbl.className = 'ae-label';
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ae-slider';
    slider.min = '0';
    slider.max = '100';
    slider.step = '0.1';
    slider.value = String(logToSlider(Math.max(min, Math.min(max, value)), min, max));

    const valEl = document.createElement('span');
    valEl.className = 'ae-value';
    valEl.textContent = this.formatValue(value, unit);

    slider.addEventListener('input', () => {
      const v = sliderToLog(Number(slider.value), min, max);
      valEl.textContent = this.formatValue(v, unit);
      // Mutate the live archetype reference so the editor reflects the change
      const arch = this.getSelectedSource()?.getArchetypeName() === archetypeName
        ? this.getSelectedSource()?.getArchetype()
        : null;
      if (arch) this.setArchetypeField(arch, key, v);
      this.callbacks.onParamChange(archetypeName, key, v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valEl);
    return row;
  }

  private linSliderRow(
    label: string, key: string, value: number,
    min: number, max: number, unit: string,
    archetypeName: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ae-row';

    const lbl = document.createElement('span');
    lbl.className = 'ae-label';
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ae-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String((max - min) / 200);
    slider.value = String(Math.max(min, Math.min(max, value)));

    const valEl = document.createElement('span');
    valEl.className = 'ae-value';
    valEl.textContent = this.formatValue(value, unit);

    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      valEl.textContent = this.formatValue(v, unit);
      const arch = this.getSelectedSource()?.getArchetypeName() === archetypeName
        ? this.getSelectedSource()?.getArchetype()
        : null;
      if (arch) this.setArchetypeField(arch, key, v);
      this.callbacks.onParamChange(archetypeName, key, v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valEl);
    return row;
  }

  private toggleRow(
    label: string, key: string, current: string,
    options: string[], archetypeName: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ae-row';

    const lbl = document.createElement('span');
    lbl.className = 'ae-label';
    lbl.textContent = label;

    const group = document.createElement('div');
    group.className = 'ae-toggle-group';

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'ae-toggle-btn' + (opt === current ? ' ae-active' : '');
      btn.textContent = opt.substring(0, 4);
      btn.title = opt;
      btn.addEventListener('click', () => {
        group.querySelectorAll('.ae-toggle-btn').forEach(b => b.classList.remove('ae-active'));
        btn.classList.add('ae-active');
        const arch = this.getSelectedSource()?.getArchetypeName() === archetypeName
          ? this.getSelectedSource()?.getArchetype()
          : null;
        if (arch) this.setArchetypeField(arch, key, opt);
        this.callbacks.onParamChange(archetypeName, key, opt);
      });
      group.appendChild(btn);
    }

    row.appendChild(lbl);
    row.appendChild(group);
    return row;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private formatValue(v: number, unit: string): string {
    const s = v >= 100 ? v.toFixed(0)
      : v >= 10   ? v.toFixed(1)
      : v >= 1    ? v.toFixed(2)
      :              v.toFixed(3);
    return unit ? `${s} ${unit}` : s;
  }

  private setArchetypeField(arch: SoundArchetype, key: string, value: number | string): void {
    if (key === 'filter.freq') { arch.filter.freq = Number(value); return; }
    if (key === 'filter.Q')   { arch.filter.Q   = Number(value); return; }
    (arch as unknown as Record<string, unknown>)[key] = value;
  }

  private handleReset(archetypeName: string): void {
    const defaults = this.originalDefaults.get(archetypeName);
    if (!defaults) return;

    // Restore all fields on the live archetype reference
    const source = this.getSelectedSource();
    const arch = source?.getArchetypeName() === archetypeName ? source.getArchetype() : null;
    if (arch) Object.assign(arch, structuredClone(defaults));

    this.callbacks.onReset(archetypeName);

    // Force re-render of the editor panel with default values
    this.render();
  }

  private renderNoSelection(): void {
    const empty = document.createElement('div');
    empty.className = 'ae-empty';
    empty.textContent = 'Select a nearby source marker in the world';
    this.container.appendChild(empty);
  }

  private getNearestSourceId(): string | null {
    return this.audibleSources.size > 0 ? this.audibleSources.keys().next().value ?? null : null;
  }

  private getSelectedSource(): SoundSource | null {
    return this.selectedSourceId !== null ? this.audibleSources.get(this.selectedSourceId) ?? null : null;
  }

  private formatSourceLabel(source: SoundSource): string {
    const suffix = source.getId().replace('source-', '#');
    return `${source.getArchetypeName()} ${suffix}`;
  }
}
