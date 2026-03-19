/**
 * PerspectiveView — immersive first-person 3D renderer.
 *
 * Style: low-poly solid objects, deep blue palette matching the 2D WorldView.
 * Faces filled with flat shading + glowing edges, Battlezone aesthetic.
 * Sphere curvature correction ensures sources appear on the horizon.
 */

import * as PIXI from 'pixi.js';
import type { SoundEngineType, SphericalCoord } from '../types.ts';
import type { SoundSource } from '../engine/SoundSource.ts';
import {
  directionInPlayerFrame,
  HEARING_RADIUS,
  SPHERE_RADIUS,
} from '../engine/sphereMath.ts';
import { archetypeBodyColor, archetypeCoreColor, hslToHex, hashString } from './colorUtils.ts';

// ── Constants ──────────────────────────────────────────────────────────────

const SOLID_RADIUS  = 1.35;   // world-space radius of each solid
const FOV_H_TAN     = 1.0;    // tan(45°) → focalLength = W/2
const NEAR_CLIP     = 0.5;
const MOUNTAIN_COUNT = 64;
const MOUNTAIN_SEED  = 0xc0ffee;

const GROUND_H      = 13;    // camera height above ground plane (world units)
const FLOAT_OFFSET  = 9;     // world-y offset below camera for floating objects

// 2D palette — mirrors WorldView constants for visual consistency
const COLOR_SKY     = 0x000000;
const COLOR_GROUND  = 0x0f2338;   // lighter ground so shadows are visible
const COLOR_HORIZON = 0x5d8fb1;   // GRID_COLOR_MAJOR
const COLOR_MTN_FILL = 0x0d2240;  // mountain fill — visible dark blue against black sky
const COLOR_MTN_EDGE = 0x4a7ea8;  // mountain outline — bright enough to see

// Light direction in player-local frame (right=x, up=y, forward=-z)
const LIGHT_RAW: [number, number, number] = [0.35, 0.80, 0.45];
const LIGHT_LEN = Math.sqrt(LIGHT_RAW[0] ** 2 + LIGHT_RAW[1] ** 2 + LIGHT_RAW[2] ** 2);
const LIGHT: [number, number, number] = [
  LIGHT_RAW[0] / LIGHT_LEN,
  LIGHT_RAW[1] / LIGHT_LEN,
  LIGHT_RAW[2] / LIGHT_LEN,
];

const SOLID_ROT_RATE: Record<SoundEngineType, number> = {
  subtractive: 0.06, noise: 0.40, fm: 0.18, resonator: 0.09,
};
const BREATH_RATE: Record<SoundEngineType, number> = {
  subtractive: 1.6, noise: 2.4, fm: 1.9, resonator: 1.25,
};
const BREATH_DEPTH: Record<SoundEngineType, number> = {
  subtractive: 0.09, noise: 0.15, fm: 0.07, resonator: 0.13,
};

// ── Geometry types & helpers ───────────────────────────────────────────────

type Vec3 = [number, number, number];
type Solid3D = {
  verts: Vec3[];
  edges: [number, number][];
  faces: [number, number, number][];
};

function norm3(v: Vec3): Vec3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function sub3(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot3(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

// ── Solid geometry definitions ─────────────────────────────────────────────

const S3 = 1 / Math.sqrt(3); // normalises cube/tetrahedron to unit sphere

/** subtractive → Icosahedron (12 verts, 20 faces, 30 edges) — smooth sphere */
const ICOSAHEDRON: Solid3D = (() => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const verts: Vec3[] = [
    [-1,  PHI, 0], [ 1,  PHI, 0], [-1, -PHI, 0], [ 1, -PHI, 0],
    [ 0, -1,  PHI], [ 0,  1,  PHI], [ 0, -1, -PHI], [ 0,  1, -PHI],
    [ PHI, 0, -1], [ PHI, 0,  1], [-PHI, 0, -1], [-PHI, 0,  1],
  ].map(v => norm3(v as Vec3) as Vec3);

  const faces: [number, number, number][] = [
    [0,11,5],[0,5,1],  [0,1,7],  [0,7,10],[0,10,11],
    [1,5,9], [5,11,4],[11,10,2],[10,7,6], [7,1,8],
    [3,9,4], [3,4,2], [3,2,6],  [3,6,8], [3,8,9],
    [4,9,5], [2,4,11],[6,2,10], [8,6,7], [9,8,1],
  ];

  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  for (const [a, b, c] of faces) {
    for (const [i, j] of [[a,b],[b,c],[c,a]] as [number,number][]) {
      const k = `${Math.min(i,j)}_${Math.max(i,j)}`;
      if (!edgeSet.has(k)) { edgeSet.add(k); edges.push([i,j]); }
    }
  }
  return { verts, edges, faces };
})();

/** noise → Tetrahedron (4 verts, 4 faces, 6 edges) */
const TETRAHEDRON: Solid3D = {
  verts: [[ S3, S3, S3],[ S3,-S3,-S3],[-S3, S3,-S3],[-S3,-S3, S3]],
  edges: [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],
  faces: [[0,2,1],[0,3,2],[0,1,3],[1,2,3]],
};

/** fm → Cube (8 verts, 12 triangular faces, 12 edges) */
const CUBE: Solid3D = {
  verts: [
    [-S3,-S3,-S3],[ S3,-S3,-S3],[ S3, S3,-S3],[-S3, S3,-S3],
    [-S3,-S3, S3],[ S3,-S3, S3],[ S3, S3, S3],[-S3, S3, S3],
  ],
  edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],
  faces: [
    [0,3,2],[0,2,1],   // z− face
    [4,5,6],[4,6,7],   // z+ face
    [0,1,5],[0,5,4],   // y− face
    [2,3,7],[2,7,6],   // y+ face
    [0,4,7],[0,7,3],   // x− face
    [1,2,6],[1,6,5],   // x+ face
  ],
};

/** resonator → Octahedron (6 verts, 8 triangular faces, 12 edges) */
const OCTAHEDRON: Solid3D = {
  verts: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],
  edges: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]],
  faces: [
    [0,2,4],[0,4,3],[0,3,5],[0,5,2],
    [1,4,2],[1,3,4],[1,5,3],[1,2,5],
  ],
};

function solidForEngine(engine: SoundEngineType): Solid3D {
  switch (engine) {
    case 'noise':     return TETRAHEDRON;
    case 'fm':        return CUBE;
    case 'resonator': return OCTAHEDRON;
    default:          return ICOSAHEDRON;
  }
}

// ── Seeded PRNG ────────────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── Types ──────────────────────────────────────────────────────────────────

type Mountain = { azimuth: number; heightFrac: number; halfWidthFrac: number };
type ProjVertex = { sx: number; sy: number; depth: number };

// ── PerspectiveView ────────────────────────────────────────────────────────

export class PerspectiveView {
  private mountains: Mountain[];

  constructor() {
    const rng = makePrng(MOUNTAIN_SEED);
    this.mountains = Array.from({ length: MOUNTAIN_COUNT }, (_, i) => ({
      azimuth:       (360 / MOUNTAIN_COUNT) * i,
      heightFrac:    0.018 + rng() * 0.072,  // 2–9% of H, low & varied
      halfWidthFrac: 0.030 + rng() * 0.055,  // 3–8.5% of W
    }));
  }

  draw(
    gfx: PIXI.Graphics,
    sources: readonly SoundSource[],
    playerPos: SphericalCoord,
    playerHeading: number,
    elapsed: number,
    W: number,
    H: number,
    selectedId: string | null,
  ): void {
    gfx.clear();
    const cx = W / 2;
    const hy = H / 2; // horizon at vertical centre

    // 1. Sky + ground
    gfx.rect(0, 0, W, hy).fill({ color: COLOR_SKY });
    gfx.rect(0, hy, W, H - hy).fill({ color: COLOR_GROUND });

    // 2. Mountains — solid silhouettes with slope edges only
    this.drawMountains(gfx, playerHeading, W, H, hy);

    // 4. Horizon line — drawn after mountains, serves as their base
    gfx.moveTo(0, hy).lineTo(W, hy)
      .stroke({ color: COLOR_HORIZON, alpha: 0.75, width: 1.5 });

    // 5. Source solids — back-to-front (farthest first)
    const visible: Array<{ src: SoundSource; loc: { x: number; y: number; z: number }; depth: number }> = [];
    for (const src of sources) {
      const loc = directionInPlayerFrame(playerPos, playerHeading, src.getCurrentPosition());
      const depth = -loc.z;
      if (depth <= NEAR_CLIP || depth > HEARING_RADIUS * 1.05) continue;
      visible.push({ src, loc, depth });
    }
    visible.sort((a, b) => b.depth - a.depth);

    for (const { src, loc, depth } of visible) {
      this.drawSourceSolid(gfx, src, loc, depth, elapsed, W, cx, hy, selectedId);
    }
  }

  // ── Mountains ─────────────────────────────────────────────────────────────

  private drawMountains(
    gfx: PIXI.Graphics,
    playerHeading: number,
    W: number,
    H: number,
    hy: number,
  ): void {
    for (const m of this.mountains) {
      const angleDiff = ((m.azimuth - playerHeading + 540) % 360) - 180;
      if (Math.abs(angleDiff) > 105) continue;

      const screenX = W / 2 + (angleDiff / 45) * (W / 2);
      const halfW   = m.halfWidthFrac * W;
      const height  = m.heightFrac * H;
      const lx = screenX - halfW;
      const rx = screenX + halfW;
      const ty = hy - height;

      // Fill — visible dark-blue against black sky
      gfx.poly([lx, hy, screenX, ty, rx, hy]).fill({ color: COLOR_MTN_FILL, alpha: 1.0 });
      // Outline — bright enough to read against sky
      gfx.moveTo(lx, hy).lineTo(screenX, ty).lineTo(rx, hy)
        .stroke({ color: COLOR_MTN_EDGE, alpha: 0.80, width: 1.2 });
    }
  }

  // ── Source solid ──────────────────────────────────────────────────────────

  /**
   * Project a world-space vertex (player-local coords) to screen.
   *
   * Includes sphere-curvature correction: sources on the sphere surface
   * appear below the horizon due to chord geometry. The correction term
   * `depth² / (2 * SPHERE_RADIUS)` exactly restores them to y=0 (horizon).
   */
  private project(
    wx: number, wy: number, wz: number,
    fL: number, cx: number, hy: number,
  ): ProjVertex | null {
    const depth = -wz;
    if (depth <= NEAR_CLIP) return null;
    const wyCorr = wy + (depth * depth) / (2 * SPHERE_RADIUS);
    return {
      sx: cx + (wx / depth) * fL,
      sy: hy - (wyCorr / depth) * fL,
      depth,
    };
  }

  private drawSourceSolid(
    gfx: PIXI.Graphics,
    src: SoundSource,
    loc: { x: number; y: number; z: number },
    depth: number,
    elapsed: number,
    W: number,
    cx: number,
    hy: number,
    selectedId: string | null,
  ): void {
    const engine  = src.getEngineType();
    const solid   = solidForEngine(engine);
    const bodyHex = archetypeBodyColor(src.getArchetypeName());
    const coreHex = archetypeCoreColor(src.getArchetypeName());
    const hue     = hashString(src.getArchetypeName()) % 360;
    const fL      = W * FOV_H_TAN / 2;

    const idHash = src.getId().charCodeAt(src.getId().length - 1) ?? 0;
    const phase  = idHash * 0.13;

    const breath = 1 + BREATH_DEPTH[engine] * Math.sin(elapsed * BREATH_RATE[engine] + phase);
    const norm   = Math.max(0, 1 - depth / HEARING_RADIUS);
    const solidR = SOLID_RADIUS * (1 + norm * 0.6) * breath;

    const rotAngle = elapsed * SOLID_ROT_RATE[engine] + idHash * 0.37;
    const cosA = Math.cos(rotAngle);
    const sinA = Math.sin(rotAngle);

    // Object centre floats FLOAT_HEIGHT above the ground plane.
    // The ground plane is GROUND_H below the camera in world-y.
    // Sphere-curvature correction (applied inside project()) then cancels
    // the downward loc.y component so the ground plane maps correctly.
    const floatWy = loc.y - FLOAT_OFFSET;

    // Build rotated vertex positions in player-local frame
    const worldVerts: Vec3[] = solid.verts.map(([x, y, z]) => [
      loc.x + (x * cosA + z * sinA) * solidR,
      floatWy + y * solidR,
      loc.z + (-x * sinA + z * cosA) * solidR,
    ]);

    const projected: (ProjVertex | null)[] = worldVerts.map(
      ([vx, vy, vz]) => this.project(vx, vy, vz, fL, cx, hy),
    );

    const audible   = src.isAudible();
    const baseAlpha = audible ? 1.0 : 0.38;

    // ── 0. Shadow on ground plane ────────────────────────────────────────────
    // Project the shadow centre onto the ground (wy = loc.y - GROUND_H).
    const shadowProj = this.project(loc.x, loc.y - GROUND_H, loc.z, fL, cx, hy);
    if (shadowProj && shadowProj.sy > hy && shadowProj.sy <= hy * 2.2) {
      const sr = (solidR * 1.5 * fL) / shadowProj.depth;
      gfx.ellipse(shadowProj.sx, shadowProj.sy, sr, sr * 0.22)
        .fill({ color: 0x000000, alpha: 0.50 * baseAlpha });
    }

    // ── 1. Filled faces — painter's algorithm (farthest first) ─────────────
    const facesToDraw = solid.faces
      .map((face) => {
        const [ai, bi, ci] = face;
        const pa = projected[ai]; const pb = projected[bi]; const pc = projected[ci];
        if (!pa || !pb || !pc) return null;
        return { face, avgDepth: (pa.depth + pb.depth + pc.depth) / 3 };
      })
      .filter((f): f is { face: [number,number,number]; avgDepth: number } => f !== null)
      .sort((a, b) => b.avgDepth - a.avgDepth);

    for (const { face } of facesToDraw) {
      const [ai, bi, ci] = face;
      const pa = projected[ai]!;
      const pb = projected[bi]!;
      const pc = projected[ci]!;

      // Flat shading — normal dot light
      const wa = worldVerts[ai]!; const wb = worldVerts[bi]!; const wc = worldVerts[ci]!;
      const normal  = norm3(cross3(sub3(wb, wa), sub3(wc, wa)));
      const diffuse = Math.max(0, dot3(normal, LIGHT));

      // Face fill: archetype tint, clearly visible against dark ground
      const fillL     = 22 + diffuse * 38;          // lightness 22..60
      const fillAlpha = (0.82 + diffuse * 0.14) * baseAlpha;
      const fillColor = hslToHex(hue, 50, fillL);

      gfx.poly([pa.sx, pa.sy, pb.sx, pb.sy, pc.sx, pc.sy])
        .fill({ color: fillColor, alpha: fillAlpha });
    }

    // ── 2. Glowing edges ────────────────────────────────────────────────────
    for (const [i, j] of solid.edges) {
      const pa = projected[i]; const pb = projected[j];
      if (!pa || !pb) continue;
      gfx.moveTo(pa.sx, pa.sy).lineTo(pb.sx, pb.sy)
        .stroke({ color: bodyHex, alpha: 0.06 * baseAlpha, width: 4.5 });
      gfx.moveTo(pa.sx, pa.sy).lineTo(pb.sx, pb.sy)
        .stroke({ color: bodyHex, alpha: 0.62 * baseAlpha, width: 1.0 });
      gfx.moveTo(pa.sx, pa.sy).lineTo(pb.sx, pb.sy)
        .stroke({ color: coreHex, alpha: 0.32 * baseAlpha, width: 0.4 });
    }

    // ── 3. Selection ring ───────────────────────────────────────────────────
    if (selectedId !== null && src.getId() === selectedId) {
      const selPulse = 0.7 + 0.3 * Math.sin(elapsed * 3.8 + phase);
      const centre   = this.project(loc.x, floatWy, loc.z, fL, cx, hy);
      if (centre) {
        const ringR = (solidR / centre.depth) * fL * 2.2;
        gfx.circle(centre.sx, centre.sy, ringR)
          .stroke({ color: 0x33bbaa, alpha: 0.70 * selPulse, width: 1.5 });
        gfx.circle(centre.sx, centre.sy, ringR * 1.3)
          .stroke({ color: 0x33bbaa, alpha: 0.25 * selPulse, width: 3 });
      }
    }
  }
}
