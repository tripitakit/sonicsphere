# Sonic Sphere - Technical Documentation (Updated)

**Last updated:** March 10, 2026  
**Status:** Advanced prototype, playable, under continuous tuning  
**Target:** desktop browser (WebGL + Web Audio)

---

## 1. Vision

**Sonic Sphere** is a contemplative sonic exploration experience on a spherical surface.  
The player has no gameplay goals: they explore, listen, and traverse regions with distinct timbral identities and weather transitions that transform the global mix.

---

## 2. Tech Stack

| Component | Technology | Notes |
|---|---|---|
| Runtime | TypeScript + Vite | real-time loop, systems orchestration |
| Audio | Tone.js / Web Audio API | multi-engine synthesis + weather FX chain |
| Spatial Audio | Tone.Panner3D | 3D source positioning |
| Rendering | Pixi.js (WebGL) | high-performance abstract visuals |
| Persistence | localStorage | position, heading, world epoch |

Main scripts:
- `npm run dev`
- `npm run build`
- `npm run preview`

---

## 3. Current Product Status

### 3.1 User Experience

- Artistic start/pause overlay with click-to-enter.
- No debug/performance HUD on screen.
- State persistence between sessions.
- Organic autopilot active (manual toggle available).

### 3.2 Controls

- `WASD` / arrows: movement
- `P` or `TAB`: autopilot toggle
- `ESC`: pause/resume
- Overlay click: start/resume audio

---

## 4. World Model

### 4.1 Geometry and movement

- Sphere radius: `SPHERE_RADIUS = 200`
- Audible radius: `HEARING_RADIUS = 52`
- Geodesic movement with local heading.
- Pole anti-singularity clamp (`±89.5°`).

### 4.2 Sources

- Sources slowly oscillate around an equilibrium position.
- Pseudo-uniform spatial distribution (Fibonacci-like with jitter).
- Deterministic PRNG for repeatable world layout.
- Unique detune per archetype clone to reduce perceived tonal duplication.

### 4.3 Cardinality and density

Density is driven by `PERFORMANCE_BUDGET.world.densityMultiplier`:
- `BASE_SOURCE_COUNT = max(180, round(240 * density))`
- `RHYTHMIC_EXTRA_SOURCE_COUNT = max(120, round(180 * density))`
- `SOURCE_COUNT = BASE + RHYTHMIC_EXTRA`

Typical values by tier:
- `high`: ~1260 sources
- `balanced`: ~945 sources
- `low`: ~672 sources

---

## 5. Audio Engines and Archetypes

### 5.1 Engine families

Each archetype uses one of the following engines:
- `subtractive` (default): osc + sub + optional air oscillator
- `noise`: colored noise source
- `fm`: `Tone.FMOscillator`
- `resonator`: noise excitation + feedback comb filter

### 5.2 Archetype library

- Total archetypes: **132**
- Archetypes with `mode: 'rhythmic'`: **66**
- Explicit engines:
  - `noise`: 8
  - `fm`: 4
  - `resonator`: 4
  - remaining in `subtractive` (default)

### 5.3 Balanced engine distribution

In `SphereWorld`, generation uses weights to avoid strong imbalances:
- Base pool: `subtractive 0.55`, `noise 0.15`, `fm 0.15`, `resonator 0.15`
- Rhythmic extra pool: `subtractive 0.5`, `noise 0.15`, `fm 0.175`, `resonator 0.175`

---

## 6. Sonic Weather (Weather Zones)

### 6.1 Zone model

- Generated zones: `DEFAULT_ZONE_COUNT = 28`
- Simultaneously active zones: max `3`
- Simultaneously strong zones: max `2` (+1 background)
- Types: `mist`, `echo`, `ion`
- Influence computed with core + feather + smoothstep
- Slow drift on lat/lon (world alive over time)

This matches the discussed aesthetic direction: **max 2 strong + 1 background**.

### 6.2 Global FX chain

Weather modifies the global FX chain:
- pre-FX `highpass` + `lowpass`
- `bandpass` branch with fast sweep (LFO)
- `FeedbackDelay`
- `JCReverb`
- dry/wet crossfade with controlled dry attenuation
- final limiter

### 6.3 Organic and quantized delay

- Organic per-zone delay (slow parametric oscillation).
- Stabilization with step quantization and hold time.
- More perceptible yet controlled transitions (reduced zipper/click).

### 6.4 Ready weather profiles

Three full presets are available:
- `subtle`
- `experimental`
- `extreme`

Active selector:
- `ACTIVE_WEATHER_FX_PROFILE` in `src/engine/WeatherZoneEngine.ts`

**Current default:** `experimental`.

Each preset modifies:
- zone weights and roles
- FX bias by weather type
- boost in overlap (2-3 zones)
- final FX multipliers
- delay quantization
- temporal smoothing
- audio runtime response/limits (aligned in `AudioEngine`)

---

## 7. Visual System

### 7.1 Layering

Layer order (bottom -> top):
- background
- world/sonic zones
- weather zones
- player trail
- graticule
- world horizon
- source glyphs
- ring overlay
- compass
- player dot

### 7.2 Visual weather zones

- Weather colors are separate from the audible-zone palette.
- Distinct palette per type (`mist/echo/ion`).
- High transparency.
- Overlap with additive blending (`blendMode = 'add'`) for pleasant color summation.

### 7.3 Glyphs per audio engine

Shape -> engine mapping:
- `subtractive`: circle
- `noise`: triangle
- `fm`: square
- `resonator`: hexagon

Shapes are used for glow/body/core/ring (not only on the core).
In addition, each engine has its own animation profile (breath/ring/pulse) for immediate recognizability.

---

## 8. Performance and Anti-Glitch

### 8.1 Automatic tiers

`PerformanceBudget` selects `high | balanced | low` using:
- `hardwareConcurrency`
- `deviceMemory`
- user-agent (more conservative on Windows)

Available overrides:
- query param `?perfTier=high|balanced|low`
- `localStorage` key `sonicsphere.perfTier`

### 8.2 Budget by tier

Main parameters by tier:
- `targetMaxActiveSources`
- `minMaxActiveSources`
- `maxNewStartsPerFrame`
- loop rates (`worldHz`, `weatherHz`, `renderHz`)
- renderer quality (`pixelRatioCap`, `antialias`)
- synth options (air osc, timbre LFO, panning model)

### 8.3 Click/glitch mitigations

Active measures:
- adaptive voice quota with release hysteresis (`ACTIVE_RELEASE_MARGIN`)
- per-frame start limit (`maxNewStartsPerFrame`)
- smoothing on source gain/position
- audio guard on weather blend application:
  - minimum update interval
  - minimum delta thresholds
  - slew-rate limit for sweep range
- differentiated ramp times for critical parameters (delay/reverb/LFO)
- master output limiter

### 8.4 HUD / debug overlay

- Performance HUD fully removed.
- Weather debug overlay removed.
- Performance status remains trackable via console logs and budget parameters.

---

## 9. Runtime Loop

The main loop uses separate-step updates:
- world update
- weather update
- rendering update

Each step uses accumulators and target frequencies from `PerformanceBudget`.  
Player persistence every 5 seconds + `visibilitychange/pagehide/beforeunload` events.

---

## 10. Persistence

Storage key: `sonicsphere-v1`

Saved data:
- `playerPosition`
- `playerHeading`
- `worldEpochMs`
- `lastSeenAtMs`

`worldEpochMs` keeps oscillatory evolution coherent across sessions.

---

## 11. File Map (Main Tuning Points)

- `src/engine/WeatherZoneEngine.ts`
  - weather presets (`subtle/experimental/extreme`)
  - zone blending, overlap boost, delay quantization, smoothing
- `src/engine/AudioEngine.ts`
  - audio profiles aligned with weather presets
  - limits, ramps, anti-glitch guards
- `src/engine/SphereWorld.ts`
  - source density, engine distribution, adaptive voice cap
- `src/audio/SourceSynth.ts`
  - timbral engine implementation
- `src/render/WorldView.ts`
  - additive weather palette
  - engine shape mapping
  - per-engine glyph animation profiles
- `src/engine/sphereMath.ts`
  - `SPHERE_RADIUS`, `HEARING_RADIUS`
- `src/engine/PerformanceBudget.ts`
  - auto-tier and budget by hardware

---

## 12. Recent Technical Changelog (Summary)

- Added weather zones that process the global mix.
- Boosted delay/reverb/band-pass sweep with a more experimental character.
- Stabilized delay time with quantization + hold in weather transitions.
- Added weather-zone color distinction with additive overlap blending.
- Fixed/mitigated click causes with smoothing, guards, and voice management.
- Completely removed performance HUD and related runtime code.
- Added visual encoding for audio engines with dedicated shapes.
- Added per-engine animation profiles (ring/pulse/breath).
- Reduced world sphere radius from 250 to 200.
- Introduced weather presets `subtle / experimental / extreme` with quick switching.

---

## 13. Decision Status

- Current aesthetic vision: contemplative with more expressive weather zones.
- Active profile for testing: `experimental`.
- Compatibility direction: prioritize audio stability on less powerful machines.
