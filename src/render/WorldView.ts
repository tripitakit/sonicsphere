import * as PIXI from 'pixi.js';
import type { ActiveWeatherZone, SphericalCoord, WeatherZoneType } from '../types.ts';
import type { SoundSource } from '../engine/SoundSource.ts';
import {
  chordDistance,
  directionInPlayerFrame,
  HEARING_RADIUS,
  SPHERE_RADIUS,
  toCartesian,
} from '../engine/sphereMath.ts';

// How many world units map to 1 pixel on screen.
// Scene zoom set to 150% so world appears larger without browser zoom.
// Scale is compensated by sphere radius so changing SPHERE_RADIUS does not
// change the apparent size of the visible world disk on screen.
const REFERENCE_SPHERE_RADIUS = 100;
const BASE_WORLD_SCALE = 2.5;
const SCENE_ZOOM = 1.5;
// Internal camera zoom to match the preferred browser-zoomed look (250%)
// while keeping browser zoom at 100%.
const GAME_VIEW_ZOOM = 2.5;
const BASELINE_WORLD_SCALE = BASE_WORLD_SCALE * SCENE_ZOOM * (REFERENCE_SPHERE_RADIUS / SPHERE_RADIUS);
// Audible-zone-centric zoom: target audible diameter on the short screen edge.
// 0.38 means ~38% of the viewport short side.
const AUDIBLE_FOCUS_DIAMETER_RATIO = 0.38;
const REFERENCE_HEARING_RADIUS = 40;
const HEARING_VISUAL_FACTOR = Math.max(0.8, Math.min(1.6, HEARING_RADIUS / REFERENCE_HEARING_RADIUS));

// Zone palette: layered shades for a calmer, deeper look while keeping
// full black outside the world horizon.
const COLOR_WORLD_EDGE = 0x05111d;
const COLOR_WORLD_MID = 0x081a2b;
const COLOR_WORLD_CORE = 0x0c2439;
const COLOR_WORLD_VIGNETTE = 0x020812;
const COLOR_SONIC_EDGE = 0x0b2a40;
const COLOR_SONIC_CORE = 0x16425d;

const GRID_LAT_STEP_DEG = 30;
const GRID_LON_STEP_DEG = 30;
const GRID_SAMPLE_STEP_DEG = 4;

const GRID_COLOR_MINOR = 0x355f7d;
const GRID_COLOR_MAJOR = 0x5d8fb1;
const GRID_COLOR_EQUATOR = 0x86c5ee;
const GRID_COLOR_NORTH_POLE = 0xb9e7ff;
const GRID_COLOR_SOUTH_POLE = 0x8ec2e5;
const PLAYER_TRAIL_COLOR = 0xff965e;
const PLAYER_TRAIL_BLUR_COLOR = 0xff6f3c;
const PLAYER_TRAIL_MAX_AGE_SEC = 110;
const PLAYER_TRAIL_MIN_STEP = 1.4; // chord units on sphere radius=100
const PLAYER_TRAIL_WIDTH_AT_SLOW = 2.2;
const PLAYER_TRAIL_WIDTH_AT_FAST = 0.65;
const PLAYER_TRAIL_WIDTH_MULTIPLIER = 3;
const PLAYER_TRAIL_SPEED_SLOW = 0.9; // world units/s
const PLAYER_TRAIL_SPEED_FAST = 9.0; // world units/s

type GridStroke = { color: number; alpha: number; width: number };
type ArchetypePalette = {
  glowOuter: number;
  glowInner: number;
  body: number;
  core: number;
  ring: number;
  silentOuter: number;
  silentInner: number;
  silentCore: number;
};
type WeatherPatchPalette = {
  outer: number;
  inner: number;
  core: number;
  ring: number;
};

type WeatherPatchProfile = {
  hue: number;
  hueSpread: number;
  saturation: number;
  outerLightness: number;
  innerLightness: number;
  coreLightness: number;
  ringLightness: number;
};

// Distinct hue families, deliberately far from the audible-zone blue palette.
const WEATHER_TYPE_COLOR_PROFILE: Record<WeatherZoneType, WeatherPatchProfile> = {
  mist: {
    hue: 34,
    hueSpread: 16,
    saturation: 80,
    outerLightness: 25,
    innerLightness: 40,
    coreLightness: 56,
    ringLightness: 71,
  },
  echo: {
    hue: 341,
    hueSpread: 18,
    saturation: 78,
    outerLightness: 24,
    innerLightness: 39,
    coreLightness: 55,
    ringLightness: 70,
  },
  ion: {
    hue: 122,
    hueSpread: 14,
    saturation: 76,
    outerLightness: 23,
    innerLightness: 38,
    coreLightness: 54,
    ringLightness: 69,
  },
};

const WEATHER_VISUAL_TUNING = {
  alphaByRole: {
    strong: 0.34,
    background: 0.2,
  },
  layerAlpha: {
    outer: 0.4,
    inner: 0.48,
    core: 0.54,
    ring: 0.34,
  },
} as const;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): number {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = light - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return (r << 16) | (g << 8) | b;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function hashJitter(hash: number, bitOffset: number): number {
  const n = ((hash >>> bitOffset) & 0xff) / 255;
  return n * 2 - 1;
}

function inverseWidthForSpeed(speed: number): number {
  const t = clamp01((speed - PLAYER_TRAIL_SPEED_SLOW) / (PLAYER_TRAIL_SPEED_FAST - PLAYER_TRAIL_SPEED_SLOW));
  return PLAYER_TRAIL_WIDTH_AT_SLOW + (PLAYER_TRAIL_WIDTH_AT_FAST - PLAYER_TRAIL_WIDTH_AT_SLOW) * t;
}

function chordRadiusFromDegrees(arcDegrees: number): number {
  const halfRad = Math.max(0, arcDegrees) * (Math.PI / 180) * 0.5;
  return 2 * SPHERE_RADIUS * Math.sin(halfRad);
}

export class WorldView {
  private container: PIXI.Container;
  private sourceGraphics = new Map<string, PIXI.Graphics>();
  private visibleSourceIds = new Set<string>();
  private archetypePaletteCache = new Map<string, ArchetypePalette>();
  private weatherPaletteCache = new Map<string, WeatherPatchPalette>();
  private playerDot: PIXI.Graphics;
  private topCompass: PIXI.Graphics;
  private worldHorizon: PIXI.Graphics;
  private horizons: PIXI.Graphics;
  private grid: PIXI.Graphics;
  private trail: PIXI.Graphics;
  private weatherZones: PIXI.Graphics;
  private zones: PIXI.Graphics;     // filled zone discs, between background and source dots
  private background: PIXI.Graphics;
  private playerTrailHistory: Array<{ pos: SphericalCoord; t: number }> = [];
  private worldScale = BASELINE_WORLD_SCALE;
  private soundHorizonPx = HEARING_RADIUS * BASELINE_WORLD_SCALE;
  private worldHorizonPx = SPHERE_RADIUS * BASELINE_WORLD_SCALE;

  constructor(stage: PIXI.Container) {
    // Layer order (bottom → top):
    //   background  — full-screen void colour, audio-reactive tint
    //   zones       — filled discs for world/sonic surfaces
    //   weatherZones— diffuse weather patches that drive global FX
    //   trail       — faded player path on visible hemisphere
    //   grid        — poles + equator + lat/lon guide lines
    //   worldHorizon— always-visible boundary of the visible world disk
    //   container   — source dot glyphs
    //   horizons    — ring stroke overlays
    //   topCompass  — top-right navigation compass
    //   playerDot   — player center gizmo

    this.background = new PIXI.Graphics();
    stage.addChild(this.background);

    this.zones = new PIXI.Graphics();
    stage.addChild(this.zones);

    this.weatherZones = new PIXI.Graphics();
    // Additive blending makes overlapping weather patches sum their colors.
    this.weatherZones.blendMode = 'add';
    stage.addChild(this.weatherZones);

    this.trail = new PIXI.Graphics();
    stage.addChild(this.trail);

    this.grid = new PIXI.Graphics();
    stage.addChild(this.grid);

    this.worldHorizon = new PIXI.Graphics();
    stage.addChild(this.worldHorizon);

    this.container = new PIXI.Container();
    stage.addChild(this.container);

    this.horizons = new PIXI.Graphics();
    stage.addChild(this.horizons);

    this.topCompass = new PIXI.Graphics();
    stage.addChild(this.topCompass);

    this.playerDot = new PIXI.Graphics();
    stage.addChild(this.playerDot);
  }

  update(
    playerPos: SphericalCoord,
    playerHeading: number,
    sources: readonly SoundSource[],
    activeWeatherZones: readonly ActiveWeatherZone[],
    screenW: number,
    screenH: number,
    elapsed: number,
    autopilotEnabled: boolean,
  ): void {
    const cx = screenW / 2;
    const cy = screenH / 2;
    this.updateViewScale(screenW, screenH);

    this.container.x = cx;
    this.container.y = cy;

    const audibleCount = sources.filter((s) => s.isAudible()).length;

    this.drawBackground(screenW, screenH, audibleCount);
    this.drawZones(cx, cy, audibleCount, elapsed);
    this.drawWeatherZones(playerPos, playerHeading, activeWeatherZones, cx, cy, elapsed);
    this.drawPlayerTrail(playerPos, playerHeading, cx, cy, elapsed);
    this.drawGraticule(playerPos, playerHeading, cx, cy);
    this.drawVisibleWorldHorizon(cx, cy);
    this.drawHorizons(cx, cy, audibleCount, elapsed);
    this.drawTopRightCompass(screenW, playerHeading, autopilotEnabled);
    this.drawPlayerDot(cx, cy, playerHeading, autopilotEnabled);

    // Draw each source
    const visible = this.visibleSourceIds;
    visible.clear();
    for (const source of sources) {
      const dist = chordDistance(playerPos, source.getCurrentPosition());
      if (dist > HEARING_RADIUS * 1.6) continue;

      visible.add(source.getId());
      const screen = this.project(playerPos, playerHeading, source.getCurrentPosition());
      const g = this.getOrCreate(source.getId());
      g.visible = true;
      g.x = screen.x;
      g.y = screen.y;

      // Unique per-source phase so pulses don't synchronise
      const idHash = source.getId().charCodeAt(7) ?? 0;
      const phaseA = idHash * 0.13;
      const phaseB = idHash * 0.07 + 1.1;

      const norm = Math.max(0, 1 - dist / HEARING_RADIUS);
      const palette = this.getArchetypePalette(source.getArchetypeName());

      g.clear();

      if (source.isAudible()) {
        // Archetype-coloured audible glyph: halo + body + core.
        const breath = 0.9 + 0.1 * Math.sin(elapsed * 1.8 + phaseA);
        const radius = (3.7 + norm * 6.3) * breath;

        g.circle(0, 0, radius * 2.5).fill({ color: palette.glowOuter, alpha: 0.045 });
        g.circle(0, 0, radius * 1.65).fill({ color: palette.glowInner, alpha: 0.11 });
        g.circle(0, 0, radius).fill({ color: palette.body, alpha: 0.78 });
        g.circle(0, 0, radius * 0.38).fill({ color: palette.core, alpha: 0.92 });

        // Faint expanding sonar ring
        const ringT = (elapsed * 0.7 + phaseB) % 1;
        const ringR = radius * (1.8 + ringT * 1.8);
        const ringA = 0.25 * (1 - ringT);
        g.circle(0, 0, ringR).stroke({ color: palette.ring, alpha: ringA, width: 1 });

      } else {
        // Dimmer archetype-coloured hint when source is currently silent.
        const pulse  = 0.92 + 0.08 * Math.sin(elapsed * 1.2 + phaseA);
        const radius = (2 + norm * 5) * pulse;
        const alpha  = 0.06 + norm * 0.28;

        g.circle(0, 0, radius * 2.0).fill({ color: palette.silentOuter, alpha: alpha * 0.1 });
        g.circle(0, 0, radius * 1.3).fill({ color: palette.silentInner, alpha: alpha * 0.2 });
        g.circle(0, 0, radius).fill({ color: palette.silentCore, alpha });
      }
    }

    for (const [id, g] of this.sourceGraphics) {
      if (!visible.has(id)) g.visible = false;
    }
  }

  /**
   * Azimuthal equidistant projection: project a sphere point onto 2D plane
   * centered on player, oriented with player's heading pointing up.
   */
  private project(
    playerPos: SphericalCoord,
    playerHeading: number,
    sourcePos: SphericalCoord,
  ): { x: number; y: number } {
    const dir = directionInPlayerFrame(playerPos, playerHeading, sourcePos);

    return {
      x: dir.x * this.worldScale,
      y: dir.z * this.worldScale,
    };
  }

  private updateViewScale(screenW: number, screenH: number): void {
    const shortEdge = Math.max(1, Math.min(screenW, screenH));
    const targetSoundRadiusPx = shortEdge * AUDIBLE_FOCUS_DIAMETER_RATIO * 0.5;
    const focusScale = (targetSoundRadiusPx / HEARING_RADIUS) * GAME_VIEW_ZOOM;
    const baselineScaled = BASELINE_WORLD_SCALE * GAME_VIEW_ZOOM;

    this.worldScale = Math.max(baselineScaled, focusScale);
    this.soundHorizonPx = HEARING_RADIUS * this.worldScale;
    this.worldHorizonPx = SPHERE_RADIUS * this.worldScale;
  }

  private drawGraticule(
    playerPos: SphericalCoord,
    playerHeading: number,
    cx: number,
    cy: number,
  ): void {
    this.grid.clear();

    const minorStroke: GridStroke   = { color: GRID_COLOR_MINOR, alpha: 0.2, width: 1 };
    const majorStroke: GridStroke   = { color: GRID_COLOR_MAJOR, alpha: 0.3, width: 1.05 };
    const equatorStroke: GridStroke = { color: GRID_COLOR_EQUATOR, alpha: 0.5, width: 1.3 };

    for (let lat = -60; lat <= 60; lat += GRID_LAT_STEP_DEG) {
      this.drawLatitudeLine(
        playerPos,
        playerHeading,
        cx,
        cy,
        lat,
        lat === 0 ? equatorStroke : minorStroke,
      );
    }

    for (let lon = -180; lon < 180; lon += GRID_LON_STEP_DEG) {
      this.drawLongitudeLine(
        playerPos,
        playerHeading,
        cx,
        cy,
        lon,
        lon === 0 ? majorStroke : minorStroke,
      );
    }

    this.drawPoleMarker(playerPos, playerHeading, cx, cy, { lat: 90, lon: 0 }, true);
    this.drawPoleMarker(playerPos, playerHeading, cx, cy, { lat: -90, lon: 0 }, false);
  }

  private drawPlayerTrail(
    playerPos: SphericalCoord,
    playerHeading: number,
    cx: number,
    cy: number,
    elapsed: number,
  ): void {
    this.recordTrailPoint(playerPos, elapsed);
    const cutoff = elapsed - PLAYER_TRAIL_MAX_AGE_SEC;
    while (this.playerTrailHistory.length > 0 && this.playerTrailHistory[0]!.t < cutoff) {
      this.playerTrailHistory.shift();
    }

    this.trail.clear();
    let prevScreen: {
      x: number;
      y: number;
      alpha: number;
      t: number;
      pos: SphericalCoord;
    } | null = null;

    for (const point of this.playerTrailHistory) {
      if (!this.isNearHemisphere(playerPos, point.pos)) {
        prevScreen = null;
        continue;
      }

      const projected = this.project(playerPos, playerHeading, point.pos);
      if ((projected.x * projected.x + projected.y * projected.y) > this.worldHorizonPx * this.worldHorizonPx) {
        prevScreen = null;
        continue;
      }

      const age = Math.max(0, elapsed - point.t);
      const alpha = Math.max(0, 1 - age / PLAYER_TRAIL_MAX_AGE_SEC);
      const current = {
        x: cx + projected.x,
        y: cy + projected.y,
        alpha,
        t: point.t,
        pos: point.pos,
      };

      if (prevScreen) {
        const dt = Math.max(0.016, current.t - prevScreen.t);
        const speed = chordDistance(prevScreen.pos, current.pos) / dt;
        const baseWidth = inverseWidthForSpeed(speed) * PLAYER_TRAIL_WIDTH_MULTIPLIER;

        const midX = (prevScreen.x + current.x) * 0.5;
        const midY = (prevScreen.y + current.y) * 0.5;
        const distFromGizmoNorm = clamp01(Math.hypot(midX - cx, midY - cy) / Math.max(1, this.worldHorizonPx));
        // Fade out trail as segments get farther from player gizmo.
        const distanceFade = Math.pow(1 - distFromGizmoNorm, 1.35);
        const alpha = 0.34 * Math.min(prevScreen.alpha, current.alpha) * distanceFade;
        if (alpha <= 0.001) {
          prevScreen = current;
          continue;
        }

        // Soft, blurred under-stroke + sharp core stroke.
        const blurWidth = baseWidth * (2.0 + distFromGizmoNorm * 0.55);
        this.trail
          .moveTo(prevScreen.x, prevScreen.y)
          .lineTo(current.x, current.y)
          .stroke({
            color: PLAYER_TRAIL_BLUR_COLOR,
            alpha: alpha * 0.32,
            width: blurWidth,
          });
        this.trail
          .moveTo(prevScreen.x, prevScreen.y)
          .lineTo(current.x, current.y)
          .stroke({
            color: PLAYER_TRAIL_COLOR,
            alpha,
            width: baseWidth,
          });
      }

      prevScreen = current;
    }
  }

  private recordTrailPoint(playerPos: SphericalCoord, elapsed: number): void {
    const last = this.playerTrailHistory[this.playerTrailHistory.length - 1];
    if (!last || chordDistance(last.pos, playerPos) >= PLAYER_TRAIL_MIN_STEP) {
      this.playerTrailHistory.push({
        pos: { lat: playerPos.lat, lon: playerPos.lon },
        t: elapsed,
      });
    }
  }

  private drawLatitudeLine(
    playerPos: SphericalCoord,
    playerHeading: number,
    cx: number,
    cy: number,
    lat: number,
    stroke: GridStroke,
  ): void {
    let prev: { x: number; y: number } | null = null;
    for (let lon = -180; lon <= 180; lon += GRID_SAMPLE_STEP_DEG) {
      prev = this.extendGridLineSegment(
        playerPos,
        playerHeading,
        cx,
        cy,
        { lat, lon },
        prev,
        stroke,
      );
    }
  }

  private drawLongitudeLine(
    playerPos: SphericalCoord,
    playerHeading: number,
    cx: number,
    cy: number,
    lon: number,
    stroke: GridStroke,
  ): void {
    let prev: { x: number; y: number } | null = null;
    for (let lat = -90; lat <= 90; lat += GRID_SAMPLE_STEP_DEG) {
      prev = this.extendGridLineSegment(
        playerPos,
        playerHeading,
        cx,
        cy,
        { lat, lon },
        prev,
        stroke,
      );
    }
  }

  private extendGridLineSegment(
    playerPos: SphericalCoord,
    playerHeading: number,
    cx: number,
    cy: number,
    point: SphericalCoord,
    prev: { x: number; y: number } | null,
    stroke: GridStroke,
  ): { x: number; y: number } | null {
    if (!this.isNearHemisphere(playerPos, point)) return null;

    const p = this.project(playerPos, playerHeading, point);
    // Hard-clip to visible world disk to keep space outside fully black.
    if ((p.x * p.x + p.y * p.y) > this.worldHorizonPx * this.worldHorizonPx) return null;
    const current = { x: cx + p.x, y: cy + p.y };

    if (prev) {
      this.grid
        .moveTo(prev.x, prev.y)
        .lineTo(current.x, current.y)
        .stroke(stroke);
    }
    return current;
  }

  private drawPoleMarker(
    playerPos: SphericalCoord,
    playerHeading: number,
    cx: number,
    cy: number,
    pole: SphericalCoord,
    isNorth: boolean,
  ): void {
    if (!this.isNearHemisphere(playerPos, pole)) return;

    const projected = this.project(playerPos, playerHeading, pole);
    const x = cx + projected.x;
    const y = cy + projected.y;

    const color = isNorth ? GRID_COLOR_NORTH_POLE : GRID_COLOR_SOUTH_POLE;
    const markerStroke: GridStroke = { color, alpha: 0.62, width: 1.4 };
    const markerSize = 4;

    this.grid.circle(x, y, 5).stroke({ color, alpha: 0.52, width: 1.2 });
    this.grid
      .moveTo(x - markerSize, y)
      .lineTo(x + markerSize, y)
      .stroke(markerStroke);

    if (isNorth) {
      this.grid
        .moveTo(x, y - markerSize)
        .lineTo(x, y + markerSize)
        .stroke(markerStroke);
    }
  }

  private isNearHemisphere(playerPos: SphericalCoord, worldPoint: SphericalCoord): boolean {
    const p = toCartesian(playerPos);
    const q = toCartesian(worldPoint);
    return p.x * q.x + p.y * q.y + p.z * q.z >= 0;
  }

  /** Full-screen void outside world surface: always black. */
  private drawBackground(w: number, h: number, _audibleCount: number): void {
    this.background.clear();
    this.background.rect(0, 0, w, h).fill({ color: 0x000000 });
  }

  /**
   * Filled zone discs — drawn below source dots so glyphs appear "inside" each zone.
   *
   * Three concentric surfaces, all harmonised in the cool blue-teal family:
   *   Void         — background (drawn separately, fills everything)
   *   World zone   — near hemisphere (all of the sphere surface within 90° arc)
   *   Sonic zone   — audible area (within hearing radius), slightly warmer/lighter
   *
   * Alpha of the sonic zone pulses faintly with audibleCount so the "alive" area
   * brightens as you approach more sources.
   */
  private drawZones(cx: number, cy: number, audibleCount: number, elapsed: number): void {
    this.zones.clear();

    const worldBreath = 0.5 + 0.5 * Math.sin(elapsed * 0.08);
    const activity = Math.min(audibleCount / 12, 1);
    const sonicPulse = 0.5 + 0.5 * Math.sin(elapsed * 1.15 + activity * 2);

    // World disc layers: soft radial depth
    this.zones
      .circle(cx, cy, this.worldHorizonPx)
      .fill({ color: COLOR_WORLD_EDGE, alpha: 0.93 });
    this.zones
      .circle(cx, cy, this.worldHorizonPx * 0.84)
      .fill({ color: COLOR_WORLD_MID, alpha: 0.72 });
    this.zones
      .circle(cx, cy, this.worldHorizonPx * 0.60)
      .fill({ color: COLOR_WORLD_CORE, alpha: 0.24 + worldBreath * 0.07 });

    // Sonic zone with subtle breathing: brighter with higher source activity.
    const hearingAlphaBoost = 0.82 + HEARING_VISUAL_FACTOR * 0.22;
    const sonicOuterAlpha = (0.52 + activity * 0.14) * hearingAlphaBoost;
    const sonicInnerAlpha = (0.24 + activity * 0.10) * hearingAlphaBoost;
    const sonicScale = 0.992 + sonicPulse * 0.008;
    this.zones
      .circle(cx, cy, this.soundHorizonPx * sonicScale)
      .fill({ color: COLOR_SONIC_EDGE, alpha: sonicOuterAlpha });
    this.zones
      .circle(cx, cy, this.soundHorizonPx * 0.72)
      .fill({ color: COLOR_SONIC_CORE, alpha: sonicInnerAlpha });

    // Edge vignette keeps the eye inside the world disk.
    this.zones
      .circle(cx, cy, this.worldHorizonPx)
      .stroke({ color: COLOR_WORLD_VIGNETTE, alpha: 0.42, width: 12 });
  }

  private drawWeatherZones(
    playerPos: SphericalCoord,
    playerHeading: number,
    activeWeatherZones: readonly ActiveWeatherZone[],
    cx: number,
    cy: number,
    elapsed: number,
  ): void {
    this.weatherZones.clear();

    for (const zone of activeWeatherZones) {
      if (!this.isNearHemisphere(playerPos, zone.center)) continue;

      const projected = this.project(playerPos, playerHeading, zone.center);
      const outerRadiusPx = chordRadiusFromDegrees(zone.radiusDeg + zone.featherDeg) * this.worldScale;
      const coreRadiusPx = chordRadiusFromDegrees(zone.radiusDeg) * this.worldScale;
      const distFromPlayerPx = Math.hypot(projected.x, projected.y);

      // Skip far-off patches that are fully outside the visible world disc.
      if (distFromPlayerPx - outerRadiusPx > this.worldHorizonPx) continue;

      const x = cx + projected.x;
      const y = cy + projected.y;
      const palette = this.getWeatherZonePalette(zone);
      const motion = zone.type === 'ion' ? 1.85 : zone.type === 'echo' ? 0.82 : 0.56;
      const pulse = 0.92 + 0.08 * Math.sin(elapsed * motion + distFromPlayerPx * 0.004);
      const baseAlpha = clamp01(zone.influence) * WEATHER_VISUAL_TUNING.alphaByRole[zone.role];

      this.weatherZones
        .circle(x, y, outerRadiusPx * pulse)
        .fill({ color: palette.outer, alpha: baseAlpha * WEATHER_VISUAL_TUNING.layerAlpha.outer });
      this.weatherZones
        .circle(x, y, coreRadiusPx * (0.96 + pulse * 0.04))
        .fill({ color: palette.inner, alpha: baseAlpha * WEATHER_VISUAL_TUNING.layerAlpha.inner });
      this.weatherZones
        .circle(x, y, coreRadiusPx * 0.58)
        .fill({ color: palette.core, alpha: baseAlpha * WEATHER_VISUAL_TUNING.layerAlpha.core });
      this.weatherZones
        .circle(x, y, coreRadiusPx * (1.02 + 0.02 * pulse))
        .stroke({ color: palette.ring, alpha: baseAlpha * WEATHER_VISUAL_TUNING.layerAlpha.ring, width: 1.1 });
    }
  }

  private drawHorizons(cx: number, cy: number, audibleCount: number, elapsed: number): void {
    this.horizons.clear();

    const activity = Math.min(audibleCount / 12, 1);
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 1.2);
    const baseAlpha = (0.26 + activity * 0.14) * (0.82 + HEARING_VISUAL_FACTOR * 0.24);
    const pulseScale = 1 + pulse * 0.006;
    const ringWidth = 1.05 + 0.25 * HEARING_VISUAL_FACTOR;

    // Sound horizon ring — audibility boundary, gently breathing.
    this.horizons
      .circle(cx, cy, this.soundHorizonPx * pulseScale)
      .stroke({ color: 0x66b7dc, alpha: baseAlpha, width: ringWidth });
    this.horizons
      .circle(cx, cy, this.soundHorizonPx * (1.016 + pulse * 0.004))
      .stroke({ color: 0x4f98be, alpha: baseAlpha * 0.45, width: Math.max(1, ringWidth - 0.22) });
  }

  /** Always draw the visible-world boundary, independent of grid lines. */
  private drawVisibleWorldHorizon(cx: number, cy: number): void {
    this.worldHorizon.clear();
    this.worldHorizon
      .circle(cx, cy, this.worldHorizonPx)
      .stroke({ color: 0x4b89ad, alpha: 0.42, width: 1.2 });
    this.worldHorizon
      .circle(cx, cy, this.worldHorizonPx - 1.4)
      .stroke({ color: 0x1f4560, alpha: 0.32, width: 1.8 });
  }

  private drawDashedCircle(
    cx: number, cy: number, radius: number,
    segments: number, dashFraction: number,
    color: number, alpha: number, width: number,
  ): void {
    const TAU       = Math.PI * 2;
    const segAngle  = TAU / segments;
    const dashAngle = segAngle * dashFraction;

    for (let i = 0; i < segments; i++) {
      const start = i * segAngle - Math.PI / 2;
      this.horizons
        .arc(cx, cy, radius, start, start + dashAngle)
        .stroke({ color, alpha, width });
    }
  }

  private drawPlayerDot(cx: number, cy: number, _heading: number, autopilotEnabled: boolean): void {
    this.playerDot.clear();

    const ringR = 9;
    // Local-frame forward is always screen-up in this projection.
    const forwardLocalA = -Math.PI / 2;

    // Restored center gizmo: compact position marker + heading pointer.
    this.playerDot.circle(cx, cy, ringR + 4).fill({ color: 0x190d06, alpha: 0.6 });
    this.playerDot.circle(cx, cy, ringR + 1).stroke({ color: 0xad6433, alpha: 0.76, width: 1.2 });
    this.playerDot.circle(cx, cy, ringR).fill({ color: 0x2c1609, alpha: 0.9 });
    this.playerDot.circle(cx, cy, 3.4).fill({ color: 0xffc27d, alpha: 0.92 });
    this.playerDot.circle(cx, cy, 1.6).fill({ color: 0x5a3519, alpha: 0.92 });

    const hx = cx + Math.cos(forwardLocalA) * (ringR + 8);
    const hy = cy + Math.sin(forwardLocalA) * (ringR + 8);
    this.playerDot
      .moveTo(cx, cy)
      .lineTo(hx, hy)
      .stroke({ color: 0xffe8cb, alpha: 0.88, width: 1.3 });
    this.playerDot.circle(hx, hy, 2.1).fill({ color: 0xfff2e3, alpha: 0.92 });

    if (autopilotEnabled) {
      this.playerDot
        .circle(cx, cy, ringR + 7)
        .stroke({ color: 0xff9648, alpha: 0.52, width: 1.1 });
    }
  }

  private drawTopRightCompass(screenW: number, heading: number, autopilotEnabled: boolean): void {
    this.topCompass.clear();

    const DEG = Math.PI / 180;
    const margin = 78;
    const cx = Math.max(64, screenW - margin);
    const cy = margin;
    const radius = 40;

    this.topCompass.circle(cx, cy, radius + 9).fill({ color: 0x050b14, alpha: 0.62 });
    this.topCompass.circle(cx, cy, radius + 3).stroke({ color: 0x35566d, alpha: 0.72, width: 1.2 });
    this.topCompass.circle(cx, cy, radius).fill({ color: 0x0d1622, alpha: 0.9 });
    this.topCompass.circle(cx, cy, radius).stroke({ color: 0x9bbfd6, alpha: 0.4, width: 1 });

    for (let deg = 0; deg < 360; deg += 15) {
      const isMajor = deg % 90 === 0;
      const tickLen = isMajor ? 8 : 4.2;
      const tickInner = radius - 4 - tickLen;
      const tickOuter = radius - 4;
      const a = ((deg - heading) - 90) * DEG;

      const x0 = cx + Math.cos(a) * tickInner;
      const y0 = cy + Math.sin(a) * tickInner;
      const x1 = cx + Math.cos(a) * tickOuter;
      const y1 = cy + Math.sin(a) * tickOuter;

      this.topCompass
        .moveTo(x0, y0)
        .lineTo(x1, y1)
        .stroke({
          color: isMajor ? 0xcde5f5 : 0x7390a5,
          alpha: isMajor ? 0.84 : 0.45,
          width: isMajor ? 1.2 : 1,
        });
    }

    const northA = ((0 - heading) - 90) * DEG;
    const southA = ((180 - heading) - 90) * DEG;
    this.drawCompassRoseTip(this.topCompass, cx, cy, northA, radius - 3, 8, 0xea5f62, 0.92);
    this.drawCompassRoseTip(this.topCompass, cx, cy, southA, radius - 3, 8, 0xdce8f4, 0.84);

    // Fixed lubber line (forward reference)
    const topY = cy - radius - 5;
    this.topCompass
      .moveTo(cx, topY)
      .lineTo(cx - 4.6, topY - 7.2)
      .lineTo(cx + 4.6, topY - 7.2)
      .closePath()
      .fill({ color: 0xf5f8fc, alpha: 0.93 });

    this.topCompass.circle(cx, cy, 3.3).fill({ color: 0xe5edf6, alpha: 0.95 });
    this.topCompass.circle(cx, cy, 1.25).fill({ color: 0x273441, alpha: 0.95 });

    if (autopilotEnabled) {
      this.topCompass
        .circle(cx, cy, radius + 14)
        .stroke({ color: 0x44a6da, alpha: 0.34, width: 1 });
    }
  }

  private drawCompassRoseTip(
    target: PIXI.Graphics,
    cx: number,
    cy: number,
    angle: number,
    distance: number,
    size: number,
    color: number,
    alpha: number,
  ): void {
    const tipX = cx + Math.cos(angle) * distance;
    const tipY = cy + Math.sin(angle) * distance;
    const baseX = cx + Math.cos(angle) * (distance - size);
    const baseY = cy + Math.sin(angle) * (distance - size);
    const px = Math.cos(angle + Math.PI / 2) * (size * 0.52);
    const py = Math.sin(angle + Math.PI / 2) * (size * 0.52);

    target
      .moveTo(tipX, tipY)
      .lineTo(baseX + px, baseY + py)
      .lineTo(baseX - px, baseY - py)
      .closePath()
      .fill({ color, alpha });
  }

  private getWeatherZonePalette(zone: ActiveWeatherZone): WeatherPatchPalette {
    const cacheKey = `${zone.id}:${zone.type}`;
    const cached = this.weatherPaletteCache.get(cacheKey);
    if (cached) return cached;

    const profile = WEATHER_TYPE_COLOR_PROFILE[zone.type];
    const hash = hashString(cacheKey);
    const hue = profile.hue + hashJitter(hash, 0) * profile.hueSpread;
    const sat = clampPercent(profile.saturation + hashJitter(hash, 8) * 8);
    const lightShift = hashJitter(hash, 16) * 4;

    const palette: WeatherPatchPalette = {
      outer: hslToHex(
        hue - 6,
        clampPercent(sat - 6),
        clampPercent(profile.outerLightness + lightShift * 0.7),
      ),
      inner: hslToHex(
        hue - 1,
        sat,
        clampPercent(profile.innerLightness + lightShift),
      ),
      core: hslToHex(
        hue + 4,
        clampPercent(sat + 6),
        clampPercent(profile.coreLightness + lightShift * 1.1),
      ),
      ring: hslToHex(
        hue + 10 + hashJitter(hash, 24) * 4,
        clampPercent(sat + 8),
        clampPercent(profile.ringLightness + lightShift * 1.2),
      ),
    };

    this.weatherPaletteCache.set(cacheKey, palette);
    return palette;
  }

  private getArchetypePalette(archetypeName: string): ArchetypePalette {
    const cached = this.archetypePaletteCache.get(archetypeName);
    if (cached) return cached;

    const hue = hashString(archetypeName) % 360;
    const palette: ArchetypePalette = {
      glowOuter:   hslToHex(hue, 82, 40),
      glowInner:   hslToHex(hue, 84, 50),
      body:        hslToHex(hue, 86, 64),
      core:        hslToHex(hue, 92, 86),
      ring:        hslToHex((hue + 10) % 360, 88, 74),
      silentOuter: hslToHex(hue, 50, 28),
      silentInner: hslToHex(hue, 56, 38),
      silentCore:  hslToHex(hue, 62, 58),
    };

    this.archetypePaletteCache.set(archetypeName, palette);
    return palette;
  }

  private getOrCreate(id: string): PIXI.Graphics {
    let g = this.sourceGraphics.get(id);
    if (!g) {
      g = new PIXI.Graphics();
      this.container.addChild(g);
      this.sourceGraphics.set(id, g);
    }
    return g;
  }

  destroy(): void {
    for (const g of this.sourceGraphics.values()) g.destroy();
    this.sourceGraphics.clear();
    this.visibleSourceIds.clear();
    this.weatherPaletteCache.clear();
    this.container.destroy();
    this.playerDot.destroy();
    this.topCompass.destroy();
    this.horizons.destroy();
    this.worldHorizon.destroy();
    this.grid.destroy();
    this.trail.destroy();
    this.weatherZones.destroy();
    this.zones.destroy();
    this.background.destroy();
  }
}
