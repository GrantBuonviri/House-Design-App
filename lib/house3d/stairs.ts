import { ShapeUtils, Vector2 } from "three";
import type { PlanStairs, Point } from "@/lib/model/schema";
import { sub } from "@/lib/plan/geometry";
import { LANDING_THICK_IN, SOFFIT_DEPTH_IN, TREAD_BOARD_IN, TREAD_IN, flightUnderside, stairLayout, stairsFrame, type StairFlight, type StairStep } from "@/lib/plan/stairs";
import { COLORS } from "./colors";
import { MeshBuilder, toScene, type Frame, type Vec3 } from "./mesh";

/**
 * Stairs in 3D, built like real ones: each tread a board over a riser,
 * carried by sloped stringers with a soffit under the flight, and a landing
 * slab between flights. Under the landing and the upper flight it's open,
 * so stairs stacked in the same spot on every floor don't fill each other's
 * stairwell. The bottom flight is boxed in down to the floor when nothing
 * comes up underneath it (`closed`).
 */

/** Each step (and landing) as an outline in the stairs' own frame, the height of its top and of the underside beneath it. */
export function stairSteps(shape: PlanStairs["shape"], w: number, treads: number, riserIn: number, closed = false): StairStep[] {
  return stairLayout(shape, w, treads, riserIn, closed).steps;
}

export function drawStairs(mb: MeshBuilder, f: Frame, s: PlanStairs, riseIn: number, floorIn: number, closed = false) {
  const fr = stairsFrame(s, riseIn);
  const T = TREAD_IN;
  const r = fr.riserIn;
  const lay = stairLayout(s.shape, s.widthIn, fr.treads, r, closed);
  const o = fr.place({ x: 0, y: 0 });
  const dirOf = (v: Point): Point => sub(fr.place(v), o);
  for (const fl of lay.flights) {
    // Side view of the flight: risers and treads on top, the soffit underneath.
    const prof: [number, number][] = [[0, fl.closed ? fl.z0 : fl.base]];
    for (let k = 0; k < fl.n; k++) {
      prof.push([k * T, fl.z0 + (k + 1) * r - TREAD_BOARD_IN]);
      prof.push([(k + 1) * T, fl.z0 + (k + 1) * r - TREAD_BOARD_IN]);
    }
    const end = fl.n * T;
    prof.push([end, flightUnderside(fl, end, r)]);
    const flatAt = fl.closed ? end : Math.min(end, ((fl.base - fl.z0) * T) / r + (SOFFIT_DEPTH_IN * Math.hypot(T, r)) / r);
    if (flatAt > 1e-6 && flatAt < end - 1e-6) prof.push([flatAt, fl.base]);
    extrude(mb, f, fl, s.widthIn, prof, lay.at, fr.place, dirOf, floorIn);
    for (let k = 0; k < fl.n; k++) {
      const top = fl.z0 + (k + 1) * r;
      const pts = [lay.at(fl, k * T, 0), lay.at(fl, (k + 1) * T, 0), lay.at(fl, (k + 1) * T, s.widthIn), lay.at(fl, k * T, s.widthIn)].map(fr.place);
      prism(mb, f, pts, floorIn + top - TREAD_BOARD_IN, floorIn + top);
    }
  }
  if (lay.landing) {
    const pts = lay.landing.outline.map(fr.place);
    prism(mb, f, pts, floorIn + lay.landing.top - LANDING_THICK_IN, floorIn + lay.landing.top);
    mb.flat(f, pts, [], floorIn + lay.landing.top - LANDING_THICK_IN, COLORS.ceiling, false);
  }
}

/** A flight's side view (`prof`, as [along, height] points) pushed across the stairs' width into a solid. */
function extrude(
  mb: MeshBuilder,
  f: Frame,
  fl: StairFlight,
  w: number,
  prof: [number, number][],
  at: (fl: StairFlight, a: number, t: number) => Point,
  place: (p: Point) => Point,
  dirOf: (v: Point) => Point,
  floorIn: number,
) {
  const pts = prof.filter((p, i) => i === 0 || Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]) > 1e-6);
  const n = pts.length;
  const V = (p: [number, number], t: number) => toScene(f, place(at(fl, p[0], t)), floorIn + p[1]);
  // Which way round the side view goes, to tell which way each edge faces out.
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const turn = area > 0 ? 1 : -1;
  const d = dirOf(fl.dir);
  const sd = dirOf(fl.side);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ea = b[0] - a[0];
    const ez = b[1] - a[1];
    // Outward normal in the side view: to the right of the edge when it runs anticlockwise.
    const na = ez * turn;
    const nz = -ea * turn;
    const facing: Vec3 = [d.x * na, nz, d.y * na];
    const riser = Math.abs(ea) < 1e-6 && na < 0;
    const under = nz < -1e-6;
    mb.quad(V(a, 0), V(b, 0), V(b, w), V(a, w), under ? COLORS.ceiling : riser ? COLORS.riser : COLORS.stair, facing);
  }
  let tris: number[][];
  try {
    tris = ShapeUtils.triangulateShape(pts.map((p) => new Vector2(p[0], p[1])), []);
  } catch {
    return;
  }
  for (const [side, t] of [
    [-1, 0],
    [1, w],
  ] as const) {
    const facing: Vec3 = [sd.x * side, 0, sd.y * side];
    for (const [i, j, k] of tris) mb.tri(V(pts[i], t), V(pts[j], t), V(pts[k], t), COLORS.stringer, facing);
  }
}

/** An upright block from a plan outline (any turning direction). */
export function prism(mb: MeshBuilder, f: Frame, pts: Point[], z0: number, z1: number, top = COLORS.stair, side = COLORS.stair) {
  const n = pts.length;
  // Middle of the outline, to tell which way is out.
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const m = { x: (a.x + b.x) / 2 - c.x, y: (a.y + b.y) / 2 - c.y };
    mb.upright(f, a, b, z0, z1, z0, z1, m, side);
  }
  const T = pts.map((p) => toScene(f, p, z1));
  for (let i = 1; i < n - 1; i++) mb.tri(T[0], T[i], T[i + 1], top, [0, 1, 0] as Vec3);
}
