import { AudioEngine }    from './engine/AudioEngine.ts';
import { SphereWorld }    from './engine/SphereWorld.ts';
import { Player }         from './engine/Player.ts';
import { Autopilot }      from './engine/Autopilot.ts';
import { KeyboardInput }  from './input/KeyboardInput.ts';
import { Renderer }       from './render/Renderer.ts';
import { WorldView }      from './render/WorldView.ts';
import { loadState, saveState } from './persistence/Storage.ts';
import type { PlayerState } from './types.ts';

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
  const input     = new KeyboardInput();
  const autopilot = new Autopilot();
  const worldView = new WorldView(renderer.stage);

  let paused = true;
  let transitionInFlight = false;
  let lastSaveWorldElapsed = 0;

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

  function tick(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap delta at 100ms
    lastTime = now;
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

    // Update world (audio + oscillations)
    world.update(
      elapsedSecs,
      playerState.position,
      playerState.heading,
      audio.masterGain,
      audio.isStarted(),
    );

    // Render
    worldView.update(
      playerState.position,
      playerState.heading,
      world.getSources(),
      renderer.width,
      renderer.height,
      elapsedSecs,
      autopilot.isEnabled(),
    );

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
