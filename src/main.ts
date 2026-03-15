import { AudioEngine }    from './engine/AudioEngine.ts';
import { SphereWorld }    from './engine/SphereWorld.ts';
import { Player }         from './engine/Player.ts';
import { Autopilot, MANUAL_OVERRIDE_DURATION_SEC } from './engine/Autopilot.ts';
import { PERFORMANCE_BUDGET, PERFORMANCE_TIER } from './engine/PerformanceBudget.ts';
import { chordDistance } from './engine/sphereMath.ts';
import {
  WeatherZoneEngine,
  setWeatherFxProfile,
  getTuning,
  WEATHER_FX_PROFILE_NAMES,
  type WeatherEffectTuning,
  type WeatherFxProfileName,
} from './engine/WeatherZoneEngine.ts';
import { KeyboardInput }  from './input/KeyboardInput.ts';
import { Renderer }       from './render/Renderer.ts';
import { WorldView }      from './render/WorldView.ts';
import {
  loadState, saveState,
  loadArchetypeOverrides, saveArchetypeOverride, resetArchetypeOverrides,
  loadWeatherOverrides, saveWeatherProfileName, saveWeatherParam, resetWeatherParams,
} from './persistence/Storage.ts';
import { ArchetypeEditor } from './ui/ArchetypeEditor.ts';
import { WeatherEditor } from './ui/WeatherEditor.ts';
import { WorldCreator } from './ui/WorldCreator.ts';
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

function resolveInitialTargetHeading(
  playerHeading: number,
  persisted: ReturnType<typeof loadState>,
): number {
  if (persisted?.playerTargetHeading !== undefined) return persisted.playerTargetHeading;
  if (persisted?.playerDirectionAngle !== undefined) return playerHeading + persisted.playerDirectionAngle;
  return playerHeading;
}

function resolveInitialManualOverrideRemainingSec(
  persisted: ReturnType<typeof loadState>,
): number {
  return Math.max(0, persisted?.playerManualOverrideRemainingSec ?? 0);
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
  const worldCreatorContainer = document.getElementById('world-creator') as HTMLDivElement;

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

  let world     = new SphereWorld();
  let weather   = new WeatherZoneEngine();
  const input     = new KeyboardInput();
  const autopilot = new Autopilot(
    resolveInitialTargetHeading(playerInitial.heading, persisted),
    resolveInitialManualOverrideRemainingSec(persisted),
  );

  // Any PixiJS canvas control sets this synchronously so the native canvas
  // pointerdown handler can ignore the same event.
  let pixiBtnConsumed = false;

  // Weather FX preset: 0=subtle, 1=experimental, 2=extreme (matches WEATHER_FX_PROFILE_NAMES order)
  let weatherProfileIdx = 1; // default: experimental

  function toggleWeatherEditor(): void {
    if (!weatherEditor.isOpen()) {
      // About to open — freeze gizmo and select nearest zone
      autopilot.cancelManualOverride(player.getHeading());
      const playerPos = player.getPosition();
      const zones = latestWeatherFrame.activeZones.map(z => ({
        id: z.id,
        type: z.type,
        distance: chordDistance(playerPos, z.center),
      })).sort((a, b) => a.distance - b.distance);
      weatherEditor.setPlayerZones(zones);
    }
    weatherEditor.toggle();
  }

  const worldView = new WorldView(
    renderer.stage,
    () => { pixiBtnConsumed = true; toggleWeatherEditor(); },
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
      onSoloChange: (sourceId) => {
        world.setSoloSource(sourceId);
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

  // ── Create World mode ─────────────────────────────────────────────────────
  let createMode = false;

  const worldCreator = new WorldCreator(
    worldCreatorContainer,
    {
      onPlacementModeChange: () => { /* cursor hint could go here */ },
      onWorldChanged: () => { /* preview updates happen via builder in render loop */ },
      onPlay: () => { exitCreateMode(true); },
    },
  );

  function enterCreateMode(): void {
    if (createMode) return;
    createMode = true;
    // Close other editors
    if (archetypeEditor.isOpen()) toggleArchetypeEditor();
    if (weatherEditor.isOpen()) toggleWeatherEditor();
    // Stop audio but don't show pause overlay
    world.suspendAllVoices();
    void audio.stop();
    overlay.classList.add('hidden');
    worldCreator.toggle();
  }

  function exitCreateMode(play: boolean): void {
    if (!createMode) return;
    createMode = false;
    worldCreator.close();
    if (play) {
      const builder = worldCreator.getBuilder();
      if (!builder.isEmpty()) {
        // Hot-swap world and weather from user definitions
        world.dispose();
        world = SphereWorld.fromUserSources(builder.getSources().map(s => ({ ...s })));
        weather = WeatherZoneEngine.fromUserZones(builder.getZones().map(z => ({ ...z })));
        latestWeatherFrame = weather.update(worldElapsedSeconds(), player.getState().position);
      }
      void resumeExperience();
    } else {
      // ESC from create mode → show paused overlay
      setOverlay('paused');
    }
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
      playerTargetHeading: autopilot.getTargetHeading(),
      playerManualOverrideRemainingSec: autopilot.getManualOverrideRemainingSec(),
      worldEpochMs,
      lastSeenAtMs: Date.now(),
    });
  }

  function setOverlay(mode: 'start' | 'paused'): void {
    if (overlayTitle) overlayTitle.textContent = 'Sonic Sphere';
    if (overlayHintControls) {
      overlayHintControls.textContent = 'click/tap set direction | A/D rotate gizmo | ESC pause';
    }
    if (overlayHintPrimary) {
      overlayHintPrimary.textContent = mode === 'start' ? 'click to enter' : 'paused - click or ESC to resume';
    }
    overlay.classList.remove('hidden');
  }

  function toggleArchetypeEditor(): void {
    archetypeEditor.setAudibleSources(world.getSourcesInHearingRadius());
    archetypeEditor.toggle();
    editorTrigger?.classList.toggle('ae-trigger-active', archetypeEditor.isOpen());

    if (archetypeEditor.isOpen()) {
      autopilot.cancelManualOverride(player.getHeading());
    }
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

  // Canvas click/tap → create-mode placement / source selection / steering direction
  renderer.app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    // Any PixiJS canvas button sets this flag synchronously before this handler fires
    if (pixiBtnConsumed) { pixiBtnConsumed = false; return; }

    // Create mode: place sources/zones on sphere
    if (createMode) {
      if (!worldCreator.isPlacementActive()) return;
      e.preventDefault();
      const rect   = renderer.app.canvas.getBoundingClientRect();
      const scaleX = renderer.width  / rect.width;
      const scaleY = renderer.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top)  * scaleY;
      const pos = worldView.pickSpherePosition(
        px, py, renderer.width, renderer.height,
        player.getPosition(), player.getHeading(),
      );
      if (pos) worldCreator.handleSphereClick(pos);
      return;
    }

    if (paused) return;
    e.preventDefault();
    const rect   = renderer.app.canvas.getBoundingClientRect();
    const scaleX = renderer.width  / rect.width;
    const scaleY = renderer.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top)  * scaleY;

    if (archetypeEditor.isOpen()) {
      const sourceId = worldView.pickSourceAt(
        px,
        py,
        renderer.width,
        renderer.height,
        player.getPosition(),
        player.getHeading(),
        world.getSourcesInHearingRadius(),
      );
      if (sourceId !== null) archetypeEditor.selectSource(sourceId);
      return;
    }

    // Block direction steering while weather zone editor is open
    if (weatherEditor.isOpen()) return;

    const directionAngle = worldView.pickDirectionAngle(px, py, renderer.width, renderer.height);
    if (directionAngle !== null) autopilot.setDirectionFromLocalAngle(player.getHeading(), directionAngle);
  }, { passive: false });

  setOverlay('start');

  // E toggles archetype editor, Z toggles weather zone editor,
  // C toggles create mode, ESC toggles pause/resume.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (createMode) { exitCreateMode(false); return; }
      if (paused) void resumeExperience();
      else void pauseExperience();
      return;
    }

    if (e.code === 'KeyC' && !createMode && !paused) {
      e.preventDefault();
      enterCreateMode();
      return;
    }

    if (e.code === 'KeyE' && !createMode) {
      e.preventDefault();
      toggleArchetypeEditor();
    }

    if (e.code === 'KeyZ' && !createMode) {
      e.preventDefault();
      toggleWeatherEditor();
    }
  });

  editorTrigger?.addEventListener('click', () => {
    toggleArchetypeEditor();
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

    if (paused && !createMode) {
      requestAnimationFrame(tick);
      return;
    }

    // Movement — allowed in both listen and create modes (but not when editors block it)
    if (!createMode && !archetypeEditor.isOpen() && !weatherEditor.isOpen()) {
      autopilot.rotateTargetHeading(input.getRotationIntent(), dt, player.getHeading());
      autopilot.tick(dt);
      const intent = autopilot.getIntent(elapsedSecs, player.getPosition(), player.getHeading());
      player.update(dt, intent.forward, intent.turn);
    } else if (createMode) {
      // In create mode: manual WASD/keyboard navigation only, no autopilot
      const rotIntent = input.getRotationIntent();
      if (rotIntent !== 0) {
        autopilot.rotateTargetHeading(rotIntent, dt, player.getHeading());
      }
      autopilot.tick(dt);
      const intent = autopilot.getIntent(elapsedSecs, player.getPosition(), player.getHeading());
      player.update(dt, intent.forward, intent.turn);
    }

    const playerState = player.getState();
    worldAccumulator += dt;
    weatherAccumulator += dt;
    renderAccumulator += dt;

    // Audio/world updates: skip in create mode
    if (!createMode) {
      if (worldAccumulator >= worldStepSec) {
        world.update(
          elapsedSecs,
          playerState.position,
          playerState.heading,
          audio.masterGain,
          audio.isStarted(),
        );
        worldAccumulator %= worldStepSec;
        archetypeEditor.setAudibleSources(world.getSourcesInHearingRadius());
      }

      if (weatherAccumulator >= weatherStepSec) {
        latestWeatherFrame = weather.update(elapsedSecs, playerState.position);
        audio.applyWeatherBlend(latestWeatherFrame.fx);
        weatherAccumulator %= weatherStepSec;
      }
    } else {
      worldAccumulator %= worldStepSec;
      weatherAccumulator %= weatherStepSec;
    }

    if (renderAccumulator >= renderStepSec) {
      const weatherZonesToRender = weatherEditor.isOpen()
        ? latestWeatherFrame.activeZones.filter(z => z.id === weatherEditor.getSelectedZoneId())
        : createMode ? [] : latestWeatherFrame.activeZones;
      worldView.update(
        playerState.position,
        playerState.heading,
        world.getSources(),
        weatherZonesToRender,
        renderer.width,
        renderer.height,
        elapsedSecs,
        createMode ? 0 : autopilot.getDirectionAngle(playerState.heading),
        createMode ? 0 : autopilot.getManualOverrideRemainingSec() / MANUAL_OVERRIDE_DURATION_SEC,
        weatherProfileIdx,
        weatherEditor.isOpen(),
        archetypeEditor.isOpen() ? archetypeEditor.getSelectedSourceId() : null,
      );
      renderAccumulator %= renderStepSec;
    }

    // Save position every 5 seconds (only in listen mode)
    if (!createMode && elapsedSecs - lastSaveWorldElapsed >= 5) {
      persistNow();
      lastSaveWorldElapsed = elapsedSecs;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

bootstrap().catch(console.error);
