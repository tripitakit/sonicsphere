import { AudioEngine }    from './engine/AudioEngine.ts';
import { SphereWorld }    from './engine/SphereWorld.ts';
import { Player }         from './engine/Player.ts';
import { Autopilot }      from './engine/Autopilot.ts';
import { PERFORMANCE_BUDGET, PERFORMANCE_TIER } from './engine/PerformanceBudget.ts';
import {
  WeatherZoneEngine,
  setWeatherFxProfile,
  getTuning,
  WEATHER_FX_PROFILE_NAMES,
  type WeatherEffectTuning,
  type WeatherFxProfileName,
} from './engine/WeatherZoneEngine.ts';
import { KeyboardInput }  from './input/KeyboardInput.ts';
import { ClickNavigator } from './engine/ClickNavigator.ts';
import { Renderer }       from './render/Renderer.ts';
import { WorldView }      from './render/WorldView.ts';
import {
  loadState, saveState,
  loadArchetypeOverrides, saveArchetypeOverride, resetArchetypeOverrides,
  loadWeatherOverrides, saveWeatherProfileName, saveWeatherParam, resetWeatherParams,
} from './persistence/Storage.ts';
import { ArchetypeEditor } from './ui/ArchetypeEditor.ts';
import { WeatherEditor } from './ui/WeatherEditor.ts';
import { ARCHETYPES } from './audio/archetypes.ts';
import type { PlayerState, SoundArchetype } from './types.ts';

/** Apply persisted archetype overrides onto the ARCHETYPES array before world construction. */
function applyArchetypeOverrides(overrides: ReturnType<typeof loadArchetypeOverrides>): void {
  for (const arch of ARCHETYPES) {
    const ov = overrides[arch.name];
    if (!ov) continue;
    for (const [key, val] of Object.entries(ov)) {
      if (key === 'filter.freq') { arch.filter.freq = Number(val); }
      else if (key === 'filter.Q') { arch.filter.Q = Number(val); }
      else { (arch as unknown as Record<string, unknown>)[key] = val; }
    }
  }
}

/** Applies a dotted-key weather tuning param (e.g. "fxMultiplier.reverbRoomSize") to the live tuning object. */
function applyWeatherTuningParam(tuning: WeatherEffectTuning, key: string, value: number): void {
  const parts = key.split('.');
  if (parts.length === 1) {
    (tuning as unknown as Record<string, number>)[key] = value;
  } else if (parts.length === 2) {
    const [sec, field] = parts;
    (tuning as unknown as Record<string, Record<string, number>>)[sec!]![field!] = value;
  } else if (parts.length === 3) {
    const [sec, zone, field] = parts;
    (tuning as unknown as Record<string, Record<string, Record<string, number>>>)[sec!]![zone!]![field!] = value;
  }
}

function randomInitialPlayerState(): PlayerState {
  // Uniform sample on sphere surface for latitude + independent longitude.
  const u = Math.random() * 2 - 1;
  const lat = Math.asin(u) * (180 / Math.PI);
  const lon = Math.random() * 360 - 180;
  const heading = Math.random() * 360;
  return { position: { lat, lon }, heading };
}

async function bootstrap(): Promise<void> {
  const overlay   = document.getElementById('start-overlay') as HTMLDivElement;
  const overlayTitle = document.getElementById('overlay-title') as HTMLSpanElement | null;
  const overlayHintPrimary = document.getElementById('overlay-hint-primary') as HTMLSpanElement | null;
  const overlayHintControls = document.getElementById('overlay-hint-controls') as HTMLSpanElement | null;
  const container = document.getElementById('canvas-container') as HTMLDivElement;
  const editorContainer = document.getElementById('archetype-editor') as HTMLDivElement;
  const editorTrigger   = document.getElementById('archetype-editor-trigger') as HTMLButtonElement | null;
  const weatherEditorContainer = document.getElementById('weather-editor') as HTMLDivElement;

  // Snapshot original archetype defaults BEFORE applying any persisted overrides,
  // so the reset function can restore the pristine values.
  const originalDefaults = new Map<string, SoundArchetype>(
    ARCHETYPES.map(a => [a.name, structuredClone(a) as SoundArchetype]),
  );

  // Apply persisted archetype overrides to ARCHETYPES before world construction
  applyArchetypeOverrides(loadArchetypeOverrides());

  // Init subsystems
  const audio    = new AudioEngine();
  const renderer = new Renderer();
  await renderer.init(container);

  // Restore or start fresh
  const persisted = loadState();
  const worldEpochMs = persisted?.worldEpochMs ?? Date.now();
  const playerInitial = persisted
    ? { position: persisted.playerPosition, heading: persisted.playerHeading }
    : randomInitialPlayerState();
  const player = new Player(playerInitial);

  const world     = new SphereWorld();
  const weather   = new WeatherZoneEngine();
  const input     = new KeyboardInput();
  const autopilot = new Autopilot();
  const clickNav  = new ClickNavigator();

  // Speed steps: range mirrors autopilot SPEED_MULT limits (0.3× – 6×)
  const SPEED_STEPS: readonly number[] = [0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.5, 6.0];
  let speedStepIdx = 3; // default: 1.0×

  // Single flag: any PixiJS button sets this synchronously so the native canvas
  // pointerdown handler can skip the event and not plant a nav target.
  let pixiBtnConsumed = false;

  // Weather FX preset: 0=subtle, 1=experimental, 2=extreme (matches WEATHER_FX_PROFILE_NAMES order)
  let weatherProfileIdx = 1; // default: experimental

  const worldView = new WorldView(
    renderer.stage,
    () => { pixiBtnConsumed = true; if (!paused) autopilot.toggle(); },
    () => { pixiBtnConsumed = true; speedStepIdx = Math.max(0, speedStepIdx - 1); },
    () => { pixiBtnConsumed = true; speedStepIdx = Math.min(SPEED_STEPS.length - 1, speedStepIdx + 1); },
    () => { pixiBtnConsumed = true; weatherEditor.toggle(); },
  );

  // Archetype editor
  const archetypeEditor = new ArchetypeEditor(
    editorContainer,
    originalDefaults,
    {
      onParamChange: (archetypeName, param, value) => {
        world.updateArchetypeParam(archetypeName, param, value);
        saveArchetypeOverride(archetypeName, param, value);
      },
      onSoloToggle: (archetypeName, activate) => {
        world.setSolo(activate ? archetypeName : null);
      },
      onReset: (archetypeName) => {
        // Restore all world sources' archetype objects to original defaults
        const defaults = originalDefaults.get(archetypeName);
        if (defaults) {
          const clone = structuredClone(defaults) as SoundArchetype;
          // Apply each original param back through the world so active synths update
          const paramKeys: Array<keyof SoundArchetype | 'filter.freq' | 'filter.Q'> = [
            'frequency', 'waveform', 'attack', 'decay', 'sustain', 'release',
            'lfoRate', 'lfoDepth', 'filter.freq', 'filter.Q',
            'fmHarmonicity', 'fmModulationIndex', 'fmModulationType',
            'noiseColor', 'resonatorHz', 'resonatorFeedback',
          ];
          for (const key of paramKeys) {
            let val: number | string | undefined;
            if (key === 'filter.freq') val = clone.filter.freq;
            else if (key === 'filter.Q') val = clone.filter.Q;
            else val = (clone as unknown as Record<string, unknown>)[key] as number | string | undefined;
            if (val !== undefined) world.updateArchetypeParam(archetypeName, key, val);
          }
        }
        resetArchetypeOverrides(archetypeName);
      },
    },
  );

  // Weather FX editor
  const weatherEditor = new WeatherEditor(
    weatherEditorContainer,
    getTuning,
    {
      onPresetChange: (name: WeatherFxProfileName) => {
        weatherProfileIdx = WEATHER_FX_PROFILE_NAMES.indexOf(name);
        if (weatherProfileIdx < 0) weatherProfileIdx = 1;
        setWeatherFxProfile(name);
        saveWeatherProfileName(name);
      },
      onParamChange: (key: string, value: number) => {
        applyWeatherTuningParam(getTuning(), key, value);
        saveWeatherParam(key, value);
      },
      onReset: () => {
        const currentName = WEATHER_FX_PROFILE_NAMES[weatherProfileIdx] ?? 'experimental';
        setWeatherFxProfile(currentName);
        resetWeatherParams();
        weatherEditor.setProfile(currentName);
      },
    },
  );

  // Apply boot overrides from localStorage
  const weatherOverrides = loadWeatherOverrides();
  if (weatherOverrides.profileName) {
    const idx = WEATHER_FX_PROFILE_NAMES.indexOf(weatherOverrides.profileName as WeatherFxProfileName);
    if (idx >= 0) {
      weatherProfileIdx = idx;
      setWeatherFxProfile(weatherOverrides.profileName as WeatherFxProfileName);
    }
  }
  for (const [key, val] of Object.entries(weatherOverrides.params)) {
    applyWeatherTuningParam(getTuning(), key, val);
  }

  let paused = true;
  let transitionInFlight = false;
  let lastSaveWorldElapsed = 0;
  let latestWeatherFrame = weather.update(worldElapsedSeconds(), player.getState().position);
  const worldStepSec = 1 / Math.max(1, PERFORMANCE_BUDGET.loop.worldHz);
  const weatherStepSec = 1 / Math.max(1, PERFORMANCE_BUDGET.loop.weatherHz);
  const renderStepSec = 1 / Math.max(1, PERFORMANCE_BUDGET.loop.renderHz);
  let worldAccumulator = worldStepSec;
  let weatherAccumulator = weatherStepSec;
  let renderAccumulator = renderStepSec;

  console.info(
    `[perf] tier=${PERFORMANCE_TIER} worldHz=${PERFORMANCE_BUDGET.loop.worldHz}`
      + ` weatherHz=${PERFORMANCE_BUDGET.loop.weatherHz}`
      + ` renderHz=${PERFORMANCE_BUDGET.loop.renderHz}`,
  );

  function worldElapsedSeconds(): number {
    return Math.max(0, (Date.now() - worldEpochMs) / 1000);
  }

  function persistNow(): void {
    const state = player.getState();
    saveState({
      playerPosition: state.position,
      playerHeading: state.heading,
      worldEpochMs,
      lastSeenAtMs: Date.now(),
    });
  }

  function setOverlay(mode: 'start' | 'paused'): void {
    if (overlayTitle) overlayTitle.textContent = 'Sonic Sphere';
    if (overlayHintControls) {
      overlayHintControls.textContent = 'WASD / tap to navigate | P autopilot | ESC pause';
    }
    if (overlayHintPrimary) {
      overlayHintPrimary.textContent = mode === 'start' ? 'click to enter' : 'paused - click or ESC to resume';
    }
    overlay.classList.remove('hidden');
  }

  async function resumeExperience(): Promise<void> {
    if (!paused || transitionInFlight) return;
    transitionInFlight = true;
    try {
      await audio.start();
      paused = false;
      overlay.classList.add('hidden');
    } finally {
      transitionInFlight = false;
    }
  }

  async function pauseExperience(): Promise<void> {
    if (paused || transitionInFlight) return;
    transitionInFlight = true;
    paused = true;
    persistNow();
    setOverlay('paused');
    try {
      await audio.stop();
      world.suspendAllVoices();
    } finally {
      transitionInFlight = false;
    }
  }

  // Canvas click/tap → navigate to destination
  renderer.app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (paused) return;
    // Any PixiJS button sets this flag synchronously before this handler fires
    if (pixiBtnConsumed) { pixiBtnConsumed = false; return; }
    e.preventDefault();
    const rect   = renderer.app.canvas.getBoundingClientRect();
    const scaleX = renderer.width  / rect.width;
    const scaleY = renderer.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top)  * scaleY;
    const target = worldView.unprojectClick(
      px, py, renderer.width, renderer.height,
      player.getPosition(), player.getHeading(),
    );
    if (target) clickNav.setTarget(target);
  }, { passive: false });

  setOverlay('start');

  // Tab/P toggle autopilot, E toggle archetype editor, ESC toggles pause/resume.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (paused) void resumeExperience();
      else void pauseExperience();
      return;
    }

    if (e.code === 'Tab' || e.code === 'KeyP') {
      e.preventDefault();
      if (!paused) autopilot.toggle();
      return;
    }

    if (e.code === 'KeyE') {
      e.preventDefault();
      archetypeEditor.toggle();
      editorTrigger?.classList.toggle('ae-trigger-active', archetypeEditor.isOpen());
    }
  });

  editorTrigger?.addEventListener('click', () => {
    archetypeEditor.toggle();
    editorTrigger.classList.toggle('ae-trigger-active', archetypeEditor.isOpen());
  });

  // User gesture gate: click to start/resume audio.
  overlay.addEventListener('click', () => {
    void resumeExperience();
  });

  const persistOnBackground = (): void => {
    persistNow();
    if (!paused) void pauseExperience();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistOnBackground();
  });
  window.addEventListener('pagehide', persistOnBackground);
  window.addEventListener('beforeunload', persistOnBackground);

  // Game loop
  let lastTime    = performance.now();

  function tick(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap delta at 100ms
    lastTime = now;
    const elapsedSecs = worldElapsedSeconds();

    if (paused) {
      requestAnimationFrame(tick);
      return;
    }

    // Intent priority: keyboard > click-navigation > autopilot/rest
    const kb = input.getIntent();
    const hasKbInput = kb.forward !== 0 || kb.turn !== 0;
    const speedMult = SPEED_STEPS[speedStepIdx] ?? 1.0;

    let intent: { forward: number; turn: number };
    if (hasKbInput) {
      clickNav.clearTarget(); // keyboard cancels in-progress navigation
      // Apply manual speed multiplier when autopilot is off
      intent = autopilot.isEnabled()
        ? kb
        : { forward: kb.forward * speedMult, turn: kb.turn };
    } else {
      const navIntent = clickNav.getIntent(player.getPosition(), player.getHeading(), speedMult, dt);
      if (navIntent !== null) {
        intent = navIntent;
      } else {
        // No active nav target: autopilot wanders (or returns {0,0} if disabled)
        intent = autopilot.getIntent(elapsedSecs, player.getPosition(), player.getHeading());
      }
    }

    player.update(dt, intent.forward, intent.turn);

    const playerState = player.getState();
    worldAccumulator += dt;
    weatherAccumulator += dt;
    renderAccumulator += dt;

    if (worldAccumulator >= worldStepSec) {
      world.update(
        elapsedSecs,
        playerState.position,
        playerState.heading,
        audio.masterGain,
        audio.isStarted(),
      );
      worldAccumulator %= worldStepSec;
      // Feed active sources to the editor (cheap: filtered only when editor is open)
      if (archetypeEditor.isOpen()) {
        archetypeEditor.setActiveSources(world.getActiveSources());
      }
    }

    if (weatherAccumulator >= weatherStepSec) {
      latestWeatherFrame = weather.update(elapsedSecs, playerState.position);
      audio.applyWeatherBlend(latestWeatherFrame.fx);
      weatherAccumulator %= weatherStepSec;
    }

    if (renderAccumulator >= renderStepSec) {
      worldView.update(
        playerState.position,
        playerState.heading,
        world.getSources(),
        latestWeatherFrame.activeZones,
        renderer.width,
        renderer.height,
        elapsedSecs,
        autopilot.isEnabled(),
        clickNav.getTarget(),
        speedMult,
        weatherProfileIdx,
        weatherEditor.isOpen(),
        archetypeEditor.isOpen() ? archetypeEditor.getSelectedName() : null,
      );
      renderAccumulator %= renderStepSec;
    }

    // Save position every 5 seconds
    if (elapsedSecs - lastSaveWorldElapsed >= 5) {
      persistNow();
      lastSaveWorldElapsed = elapsedSecs;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

bootstrap().catch(console.error);
