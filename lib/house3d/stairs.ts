import type { PlanStairs, Point } from "@/lib/model/schema";
import { TREAD_IN, flightSplit, stairsFrame } from "@/lib/plan/stairs";
import { COLORS } from "./colors";
import { MeshBuilder, toScene, type Frame, type Vec3 } from "./mesh";

/**
 * Stairs in 3D: solid steps that climb `riseIn` from the floor they stand
 * on, laid out the same way as the plan drawing (straight, L or U).
 */

/** Each step (and landing) as an outline in the stairs' own frame and the height of its top. */
export function stairSteps(shape: PlanStairs["shape"], w: number, treads: number, riserIn: number): { outline: Point[]; top: number }[] {
  const T = TREAD_IN;
  const P = (x: number, y: number): Point => ({ x, y });
  const rect = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  const out: { outline: Point[]; top: number }[] = [];
  if (shape === "straight") {
    for (let k = 0; k < treads; k++) out.push({ outline: rect(0, -(k + 1) * T, w, -k * T), top: (k + 1) * riserIn });
    return out;
  }
  const { n1, n2 } = flightSplit(treads);
  const L1 = n1 * T;
  for (let k = 0; k < n1; k++) out.push({ outline: rect(0, -(k + 1) * T, w, -k * T), top: (k + 1) * riserIn });
  const landing = (n1 + 1) * riserIn;
  if (shape === "l") {
    out.push({ outline: rect(0, -L1 - w, w, -L1), top: landing });
    for (let j = 0; j < n2; j++) out.push({ outline: rect(w + j * T, -L1 - w, w + (j + 1) * T, -L1), top: landing + (j + 1) * riserIn });
    return out;
  }
  out.push({ outline: rect(0, -L1 - w, 2 * w, -L1), top: landing });
  for (let j = 0; j < n2; j++) out.push({ outline: rect(w, -L1 + j * T, 2 * w, -L1 + (j + 1) * T), top: landing + (j + 1) * riserIn });
  return out;
}

export function drawStairs(mb: MeshBuilder, f: Frame, s: PlanStairs, riseIn: number, floorIn: number) {
  const fr = stairsFrame(s, riseIn);
  for (const step of stairSteps(s.shape, s.widthIn, fr.treads, fr.riserIn)) {
    const pts = step.outline.map(fr.place);
    prism(mb, f, pts, floorIn, floorIn + step.top);
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
