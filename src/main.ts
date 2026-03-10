import { AudioEngine }    from './engine/AudioEngine.ts';
import { SphereWorld }    from './engine/SphereWorld.ts';
import { Player }         from './engine/Player.ts';
import { Autopilot }      from './engine/Autopilot.ts';
import { PERFORMANCE_BUDGET, PERFORMANCE_TIER } from './engine/PerformanceBudget.ts';
import { WeatherZoneEngine } from './engine/WeatherZoneEngine.ts';
import { KeyboardInput }  from './input/KeyboardInput.ts';
import { Renderer }       from './render/Renderer.ts';
import { WorldView }      from './render/WorldView.ts';
import { loadState, saveState } from './persistence/Storage.ts';
import type { PlayerState, WeatherFxBlend } from './types.ts';

function randomInitialPlayerState(): PlayerState {
  // Uniform sample on sphere surface for latitude + independent longitude.
  const u = Math.random() * 2 - 1;
  const lat = Math.asin(u) * (180 / Math.PI);
  const lon = Math.random() * 360 - 180;
  const heading = Math.random() * 360;
  return { position: { lat, lon }, heading };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

type PerformanceHud = {
  tier: HTMLSpanElement;
  fps: HTMLSpanElement;
  risk: HTMLSpanElement;
  riskBar: HTMLSpanElement;
  voices: HTMLSpanElement;
  voicesBar: HTMLSpanElement;
  weather: HTMLSpanElement;
  weatherBar: HTMLSpanElement;
  effects: HTMLDivElement;
};

function getPerformanceHud(): PerformanceHud | null {
  const tier = document.getElementById('perf-tier') as HTMLSpanElement | null;
  const fps = document.getElementById('perf-fps') as HTMLSpanElement | null;
  const risk = document.getElementById('perf-risk') as HTMLSpanElement | null;
  const riskBar = document.getElementById('perf-risk-bar') as HTMLSpanElement | null;
  const voices = document.getElementById('perf-voices') as HTMLSpanElement | null;
  const voicesBar = document.getElementById('perf-voices-bar') as HTMLSpanElement | null;
  const weather = document.getElementById('perf-weather') as HTMLSpanElement | null;
  const weatherBar = document.getElementById('perf-weather-bar') as HTMLSpanElement | null;
  const effects = document.getElementById('perf-effects') as HTMLDivElement | null;
  if (!tier || !fps || !risk || !riskBar || !voices || !voicesBar || !weather || !weatherBar || !effects) {
    return null;
  }
  return { tier, fps, risk, riskBar, voices, voicesBar, weather, weatherBar, effects };
}

function weatherFxLoad(fx: WeatherFxBlend): number {
  const wet = clamp01(fx.wetLevel / 0.3);
  const delay = clamp01(fx.delayWet / 0.5);
  const reverb = clamp01(fx.reverbRoomSize / 0.82);
  const sweep = clamp01(fx.bandpassMix / 0.72);
  return clamp01(wet * 0.32 + delay * 0.3 + reverb * 0.24 + sweep * 0.14);
}

function gaugeColor(ratio: number): string {
  if (ratio >= 0.9) return '#ff7a74';
  if (ratio >= 0.72) return '#f0cb6c';
  return '#76ddbc';
}

function weatherGaugeColor(ratio: number): string {
  if (ratio >= 0.72) return '#ffb567';
  if (ratio >= 0.4) return '#87c8ff';
  return '#6acda2';
}

type GlitchRisk = {
  ratio: number;
  label: 'low' | 'med' | 'high';
  color: string;
  background: string;
  text: string;
};

type GlitchRiskThresholds = {
  med: number;
  high: number;
};

function getGlitchRiskThresholds(): GlitchRiskThresholds {
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  // On Windows we trigger warnings earlier to be more conservative on weaker machines/drivers.
  if (isWindows) return { med: 0.4, high: 0.64 };
  return { med: 0.46, high: 0.72 };
}

function computeGlitchRisk(fps: number, voiceRatio: number, fxLoad: number): GlitchRisk {
  const thresholds = getGlitchRiskThresholds();
  const targetFps = Math.max(24, PERFORMANCE_BUDGET.loop.renderHz);
  const fpsPressure = clamp01((targetFps - fps) / (targetFps * 0.42));
  const voicePressure = clamp01(voiceRatio);
  const fxPressure = clamp01(fxLoad);
  const comboBoost = clamp01((voicePressure - 0.72) / 0.28) * clamp01((fxPressure - 0.55) / 0.45);
  const ratio = clamp01(
    fpsPressure * 0.52
      + voicePressure * 0.3
      + fxPressure * 0.18
      + comboBoost * 0.18,
  );

  if (ratio >= thresholds.high) {
    return {
      ratio,
      label: 'high',
      color: '#ff7a74',
      background: 'rgba(145, 58, 54, 0.55)',
      text: '#fff3f2',
    };
  }
  if (ratio >= thresholds.med) {
    return {
      ratio,
      label: 'med',
      color: '#f0cb6c',
      background: 'rgba(116, 96, 47, 0.52)',
      text: '#fff8e8',
    };
  }
  return {
    ratio,
    label: 'low',
    color: '#76ddbc',
    background: 'rgba(44, 103, 85, 0.5)',
    text: '#eafef6',
  };
}

async function bootstrap(): Promise<void> {
  const overlay   = document.getElementById('start-overlay') as HTMLDivElement;
  const overlayTitle = document.getElementById('overlay-title') as HTMLSpanElement | null;
  const overlayHintPrimary = document.getElementById('overlay-hint-primary') as HTMLSpanElement | null;
  const overlayHintControls = document.getElementById('overlay-hint-controls') as HTMLSpanElement | null;
  const container = document.getElementById('canvas-container') as HTMLDivElement;
  const perfHud = getPerformanceHud();

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
  const worldView = new WorldView(renderer.stage);

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
      overlayHintControls.textContent = 'WASD move | P autopilot | ESC pause';
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
      updatePerformanceHud(fpsEma);
    } finally {
      transitionInFlight = false;
    }
  }

  setOverlay('start');

  // Tab/P toggle autopilot, ESC toggles pause/resume.
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
    }
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
  let fpsEma = 60;
  let hudAccumulator = 0;

  function updatePerformanceHud(fps: number): void {
    if (!perfHud) return;

    const activeVoices = world.getActiveVoiceCount();
    const voiceStartCap = Math.max(1, world.getVoiceStartCap());
    const voiceSoftCap = Math.max(voiceStartCap, world.getVoiceSoftCap());
    const voiceRatio = clamp01(activeVoices / voiceSoftCap);
    const voicePressure = clamp01(activeVoices / voiceStartCap);
    const fxLoad = weatherFxLoad(latestWeatherFrame.fx);
    const glitchRisk = computeGlitchRisk(fps, voicePressure, fxLoad);
    const zones = latestWeatherFrame.activeZones;
    const zoneTypeTags = Array.from(new Set(zones.map((z) => z.type)));

    perfHud.tier.textContent = `${PERFORMANCE_TIER} profile`;
    perfHud.fps.textContent = `${Math.round(fps)} fps`;
    perfHud.risk.textContent = glitchRisk.label;
    perfHud.risk.style.borderColor = glitchRisk.color;
    perfHud.risk.style.backgroundColor = glitchRisk.background;
    perfHud.risk.style.color = glitchRisk.text;
    perfHud.riskBar.style.width = `${Math.round(glitchRisk.ratio * 100)}%`;
    perfHud.riskBar.style.backgroundColor = glitchRisk.color;

    perfHud.voices.textContent = `${activeVoices}/${voiceSoftCap}`;
    perfHud.voicesBar.style.width = `${Math.round(voiceRatio * 100)}%`;
    perfHud.voicesBar.style.backgroundColor = gaugeColor(voiceRatio);

    perfHud.weather.textContent = `${Math.round(fxLoad * 100)}%`;
    perfHud.weatherBar.style.width = `${Math.round(fxLoad * 100)}%`;
    perfHud.weatherBar.style.backgroundColor = weatherGaugeColor(fxLoad);

    const fx = latestWeatherFrame.fx;
    const zoneLabel = zoneTypeTags.length > 0 ? zoneTypeTags.join(',') : 'none';
    perfHud.effects.textContent = `z:${zones.length} ${zoneLabel} | `
      + `d:${Math.round(fx.delayWet * 100)}% ${fx.delayTimeSec.toFixed(2)}s | `
      + `r:${Math.round(fx.reverbRoomSize * 100)}% | `
      + `s:${Math.round(fx.bandpassMix * 100)}% | `
      + `start:${voiceStartCap} pool:${world.getTotalSourceCount()}`;
  }

  function tick(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap delta at 100ms
    lastTime = now;
    const fpsNow = 1 / Math.max(1e-3, dt);
    fpsEma = fpsEma * 0.9 + fpsNow * 0.1;
    hudAccumulator += dt;
    const elapsedSecs = worldElapsedSeconds();

    if (paused) {
      requestAnimationFrame(tick);
      return;
    }

    // Keyboard overrides autopilot when any key is held
    const kb = input.getIntent();
    const hasKbInput = kb.forward !== 0 || kb.turn !== 0;

    const intent = hasKbInput
      ? kb
      : autopilot.getIntent(elapsedSecs, player.getPosition(), player.getHeading());

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
      );
      renderAccumulator %= renderStepSec;
    }

    if (hudAccumulator >= 0.18) {
      updatePerformanceHud(fpsEma);
      hudAccumulator = 0;
    }

    // Save position every 5 seconds
    if (elapsedSecs - lastSaveWorldElapsed >= 5) {
      persistNow();
      lastSaveWorldElapsed = elapsedSecs;
    }

    requestAnimationFrame(tick);
  }

  updatePerformanceHud(0);
  requestAnimationFrame(tick);
}

bootstrap().catch(console.error);
