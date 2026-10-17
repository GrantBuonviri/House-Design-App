import type { Point } from "@/lib/model/schema";
import { add, scale, subtractIntervals, unit, sub } from "@/lib/plan/geometry";
import type { OpeningGeometry } from "@/lib/plan/walls";
import { PATTERN } from "./finishes";
import { hex, MeshBuilder, toScene, type Frame, type RGB, type Vec3 } from "./mesh";

/**
 * Room trim drawn with Pretty graphics only (Fast keeps the plain walls, doors and windows):
 * baseboards, crown molding, door and window casing, window sills and grids, paneled doors with
 * handles. Plain triangle data like the rest of lib/house3d, so it can be tested without a GPU.
 */

/** A point of a trim profile: how far it sticks out from the wall (`d`) and its height (`z`), both in inches. */
export type ProfilePoint = [d: number, z: number];

export const NICKEL = hex("#b8bbc0");

/** Baseboard: 5.25" tall, a flat board with a small rounded cap. Counter-clockwise, wall side on d = 0. */
export const BASEBOARD: ProfilePoint[] = [
  [0, 0],
  [0.6, 0],
  [0.6, 4.5],
  [0.8, 4.9],
  [0.8, 5.25],
  [0, 5.25],
];

const CROWN_IN = 3.5;
/** Crown molding hung from the ceiling: a cove filling the corner, measured down (negative) from the ceiling. */
export const CROWN: ProfilePoint[] = (() => {
  const pts: ProfilePoint[] = [[0, 0], [0, -CROWN_IN]];
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const phi = (i / steps) * (Math.PI / 2);
    pts.push([CROWN_IN - CROWN_IN * Math.cos(phi), -CROWN_IN + CROWN_IN * Math.sin(phi)]);
  }
  return pts;
})();

/** Room types that get crown molding. */
export const CROWN_ROOMS = new Set(["living", "family", "kitchen", "dining", "primary-bedroom"]);

/**
 * Sweep a profile along a line `a` to `b` lying on a wall face, `into` pointing from the wall into
 * the room (a unit vector in plan). `z` is the height the profile's z = 0 sits at. Faces that lie
 * against the wall (d = 0 at both ends) or against the floor or ceiling (z = 0 at both) are left out.
 * The ends are open: they run into a wall, a casing or the other molding at a corner.
 */
export function sweep(mb: MeshBuilder, f: Frame, a: Point, b: Point, into: Point, z: number, profile: ProfilePoint[], color: RGB) {
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [d1, z1] = profile[i];
    const [d2, z2] = profile[(i + 1) % n];
    if (d1 === 0 && d2 === 0) continue;
    if (z1 === 0 && z2 === 0) continue;
    const dd = d2 - d1;
    const dz = z2 - z1;
    const facing: Vec3 = [into.x * dz, -dd, into.y * dz];
    const P = (p: Point, d: number, h: number) => toScene(f, add(p, scale(into, d)), z + h);
    mb.quad(P(a, d1, z1), P(b, d1, z1), P(b, d2, z2), P(a, d2, z2), color, facing);
  }
}

/** What one side of a wall piece needs to be trimmed. */
export type TrimSide = {
  /** The wall's two ends, plan inches. */
  a: Point;
  b: Point;
  thicknessIn: number;
  /** Which side: 1 for the left of a to b, -1 for the right. */
  sign: 1 | -1;
  /** Along the wall, the stretches that are doorways down to the floor (no baseboard there). */
  doorways: [number, number][];
  color: RGB;
  crown: boolean;
};

/** Baseboard along one side of a wall (stopping at doorways), and crown molding under the ceiling when asked. */
export function drawWallTrim(mb: MeshBuilder, f: Frame, s: TrimSide, floorIn: number, ceilingTopIn: number) {
  const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  if (len < 1) return;
  const u = unit(sub(s.b, s.a));
  const into = scale({ x: u.y, y: -u.x }, s.sign);
  const faceOf = (t: number) => add(add(s.a, scale(u, t)), scale(into, s.thicknessIn / 2));
  const was = mb.pattern;
  mb.pattern = PATTERN.paint;
  for (const [t0, t1] of subtractIntervals(len, s.doorways)) {
    if (t1 - t0 < 3) continue;
    sweep(mb, f, faceOf(t0), faceOf(t1), into, floorIn, BASEBOARD, s.color);
  }
  if (s.crown) sweep(mb, f, faceOf(0), faceOf(len), into, ceilingTopIn, CROWN, s.color);
  mb.pattern = was;
}

const CASE_IN = 2.5;
const CASE_D = 0.75;

/** Which colors the two faces of a wall get: `positive` is the side the opening's normal points to. */
export type TrimColors = { positive: RGB; negative: RGB; frame: RGB };

/**
 * Casing around a door, window or cased opening on both faces of its wall. Windows also get a
 * sill (stool) and apron, and a grid of bars across the glass. Boxes standing on the plan.
 */
export function drawOpeningTrim(mb: MeshBuilder, f: Frame, og: OpeningGeometry, wallIn: number, z0: number, z1: number, ceilingTopIn: number, colors: TrimColors) {
  const o = og.opening;
  const w = o.widthIn;
  const was = mb.pattern;
  mb.pattern = PATTERN.paint;
  for (const sign of [1, -1] as const) {
    const color = sign === 1 ? colors.positive : colors.negative;
    const paint = { left: color, right: color, ends: color, top: color, bottom: color };
    const face = (thick: number) => scale(og.n, sign * (wallIn / 2 + thick / 2));
    const line = (t: number, thick: number): Point => add(add(og.a, scale(og.u, t)), face(thick));
    const board = (t0: number, t1: number, zLow: number, zHigh: number, thick = CASE_D) => {
      if (zHigh - zLow < 0.4) return;
      mb.box(f, line(t0, thick), line(t1, thick), thick, zLow, zHigh, paint);
    };
    const win = o.kind === "window";
    // Windows: a stool at the sill with an apron under it; the side boards start above the stool.
    const sideLow = win ? z0 + 0.9 : z0;
    board(-CASE_IN, 0.25, sideLow, z1);
    board(w - 0.25, w + CASE_IN, sideLow, z1);
    const headTop = Math.min(z1 + CASE_IN, ceilingTopIn - 0.1);
    board(-CASE_IN, w + CASE_IN, z1, headTop);
    if (headTop - z1 > CASE_IN - 0.01 && headTop + 0.7 < ceilingTopIn) board(-CASE_IN - 0.75, w + CASE_IN + 0.75, headTop, headTop + 0.7, CASE_D + 0.6);
    if (win) {
      board(-CASE_IN - 0.75, w + CASE_IN + 0.75, z0, z0 + 0.9, 2.1);
      board(-CASE_IN, w + CASE_IN, z0 - 3, z0, CASE_D);
    }
  }
  mb.pattern = was;
  if (o.kind === "window") drawGrid(mb, f, og, z0, z1, colors.frame);
}

/** Bars across the glass of a window, so the panes are about 20" wide and 22" tall. */
function drawGrid(mb: MeshBuilder, f: Frame, og: OpeningGeometry, z0: number, z1: number, color: RGB) {
  const FRAME = 2.5;
  const w = og.opening.widthIn;
  const innerW = w - 2 * FRAME;
  const innerH = z1 - z0 - 2 * FRAME;
  if (innerW < 12 || innerH < 12) return;
  const cols = Math.max(1, Math.round(innerW / 20));
  const rows = Math.max(1, Math.round(innerH / 22));
  const paint = { left: color, right: color, ends: color, top: color, bottom: color };
  const at = (t: number): Point => add(og.a, scale(og.u, t));
  const was = mb.pattern;
  mb.pattern = PATTERN.paint;
  for (let i = 1; i < cols; i++) {
    const t = FRAME + (innerW * i) / cols;
    mb.box(f, at(t - 0.4), at(t + 0.4), 1.2, z0 + FRAME, z1 - FRAME, paint);
  }
  for (let j = 1; j < rows; j++) {
    const z = z0 + FRAME + (innerH * j) / rows;
    mb.box(f, at(FRAME), at(w - FRAME), 1.2, z - 0.4, z + 0.4, paint);
  }
  mb.pattern = was;
}

/** How a hinged leaf is paneled: columns by rows of fields, from the style. */
export function panelsOf(style: string): { cols: number; rows: number } {
  return style === "door-entry" ? { cols: 2, rows: 3 } : { cols: 1, rows: 2 };
}

const STILE_IN = 4.5;
const PANEL_PROUD = 0.5;

/**
 * Raised stiles and rails on both faces of a hinged leaf (so the fields between them read as
 * panels), a lever handle on both faces, and a deadbolt on a front door. The leaf runs from
 * `pivot` along `along` for `length`, `slabIn` thick, drawn closed (the caller moves it with the leaf).
 */
export function drawLeafDetail(
  mb: MeshBuilder,
  f: Frame,
  pivot: Point,
  along: Point,
  length: number,
  slabIn: number,
  z0: number,
  z1: number,
  style: string,
  color: RGB,
) {
  const { cols, rows } = panelsOf(style);
  const nrm = { x: -along.y, y: along.x };
  const paint = { left: color, right: color, ends: color, top: color, bottom: color };
  const was = mb.pattern;
  mb.pattern = PATTERN.paint;
  const bottomRail = style === "door-entry" ? 9 : 8;
  const midRails = rows - 1;
  const H = z1 - z0;
  const fieldH = (H - STILE_IN - bottomRail - midRails * STILE_IN) / rows;
  const stiles = cols + 1;
  const fieldW = (length - stiles * STILE_IN) / cols;
  if (fieldH > 3 && fieldW > 3) {
    for (const s of [1, -1] as const) {
      const off = scale(nrm, s * (slabIn / 2 + PANEL_PROUD / 2));
      const p = (t: number): Point => add(add(pivot, scale(along, t)), off);
      // Rails across the whole width.
      const rails: [number, number][] = [[z1 - STILE_IN, z1], [z0, z0 + bottomRail]];
      for (let r = 1; r < rows; r++) {
        const top = z1 - STILE_IN - r * fieldH - (r - 1) * STILE_IN;
        rails.push([top - STILE_IN, top]);
      }
      for (const [lo, hi] of rails) mb.box(f, p(0), p(length), PANEL_PROUD, lo, hi, paint);
      // Stiles down the sides and between the columns.
      for (let c = 0; c < stiles; c++) {
        const t0 = c * (STILE_IN + fieldW);
        mb.box(f, p(t0), p(t0 + STILE_IN), PANEL_PROUD, z0, z1, paint);
      }
    }
  }
  mb.pattern = PATTERN.metal;
  // A lever near the free end, pointing back toward the hinge; the rose is a small square plate.
  const handleAt = length - 2.6;
  const handleZ = z0 + 36;
  const front = style === "door-entry";
  for (const s of [1, -1] as const) {
    const base = add(add(pivot, scale(along, handleAt)), scale(nrm, s * (slabIn / 2 + PANEL_PROUD)));
    const out = (d: number): Point => add(base, scale(nrm, s * d));
    // Rose, then a short stem, then the lever.
    mb.box(f, out(0), out(0.5), 2.3, handleZ - 1.15, handleZ + 1.15, { left: NICKEL, right: NICKEL, ends: NICKEL, top: NICKEL, bottom: NICKEL });
    mb.box(f, out(0.5), out(2.1), 0.8, handleZ - 0.4, handleZ + 0.4, { left: NICKEL, right: NICKEL, ends: NICKEL, top: NICKEL, bottom: NICKEL });
    const tip = add(out(2.1), scale(along, -4.2));
    mb.box(f, out(2.1), tip, 0.9, handleZ - 0.6, handleZ + 0.6, { left: NICKEL, right: NICKEL, ends: NICKEL, top: NICKEL, bottom: NICKEL });
    if (front) {
      const zb = handleZ + 6;
      mb.box(f, out(0), out(0.7), 2.3, zb - 1.15, zb + 1.15, { left: NICKEL, right: NICKEL, ends: NICKEL, top: NICKEL, bottom: NICKEL });
    }
  }
  mb.pattern = was;
}
