import type { PlanStairs, Point } from "@/lib/model/schema";
import { add, rotate } from "./geometry";

/**
 * Stairs sized from how far they climb. Steps are at most 7 3/4" tall (a
 * common limit for houses) with 10" treads, so a 9 ft ceiling makes about 15
 * steps and a straight run of about 12 ft.
 */

export const MAX_RISER_IN = 7.75;
export const TREAD_IN = 10;
export const DEFAULT_STAIRS_WIDTH_IN = 40;
export const MIN_STAIRS_WIDTH_IN = 36;

export type StairsDrawing = {
  /** The outline of the stairs, in plan coordinates. */
  footprint: Point[];
  /** Step edges and the line between flights. */
  lines: [Point, Point][];
  /** The walking line, from the bottom step to the top. */
  arrow: Point[];
  risers: number;
  riserIn: number;
  /** Total length of the steps along the walking line, landings left out. */
  runIn: number;
};

export function stepsFor(riseIn: number): { risers: number; riserIn: number; treads: number } {
  const risers = Math.max(2, Math.ceil(riseIn / MAX_RISER_IN - 1e-9));
  return { risers, riserIn: riseIn / risers, treads: risers - 1 };
}

/** The stairs' shape in their own frame: climbing north (up the page), before centering. */
function raw(shape: PlanStairs["shape"], w: number, treads: number) {
  const T = TREAD_IN;
  const lines: [Point, Point][] = [];
  const P = (x: number, y: number): Point => ({ x, y });
  if (shape === "straight") {
    const L = treads * T;
    for (let k = 1; k < treads; k++) lines.push([P(0, -k * T), P(w, -k * T)]);
    return { footprint: [P(0, 0), P(w, 0), P(w, -L), P(0, -L)], lines, arrow: [P(w / 2, 0), P(w / 2, -L)], run: L };
  }
  // A landing takes the place of one step.
  const { n1, n2 } = flightSplit(treads);
  const L1 = n1 * T;
  const L2 = n2 * T;
  for (let k = 1; k < n1; k++) lines.push([P(0, -k * T), P(w, -k * T)]);
  lines.push([P(0, -L1), P(w, -L1)]);
  if (shape === "l") {
    lines.push([P(w, -L1), P(w, -L1 - w)]);
    for (let k = 1; k < n2; k++) lines.push([P(w + k * T, -L1), P(w + k * T, -L1 - w)]);
    return {
      footprint: [P(0, 0), P(w, 0), P(w, -L1), P(w + L2, -L1), P(w + L2, -L1 - w), P(0, -L1 - w)],
      lines,
      arrow: [P(w / 2, 0), P(w / 2, -L1 - w / 2), P(w + L2, -L1 - w / 2)],
      run: L1 + L2,
    };
  }
  // U-shaped: up one flight, across the landing, back down beside it.
  lines.push([P(w, -L1), P(2 * w, -L1)]);
  lines.push([P(w, -L1), P(w, -L1 + L2)]);
  for (let k = 1; k < n2; k++) lines.push([P(w, -L1 + k * T), P(2 * w, -L1 + k * T)]);
  return {
    footprint: [P(0, 0), P(w, 0), P(w, -L1 + L2), P(2 * w, -L1 + L2), P(2 * w, -L1 - w), P(0, -L1 - w)],
    lines,
    arrow: [P(w / 2, 0), P(w / 2, -L1 - w / 2), P(1.5 * w, -L1 - w / 2), P(1.5 * w, -L1 + L2)],
    run: L1 + L2,
  };
}

/** The stairs' own frame: turns a point in the climbing-north layout into a plan point. */
export function stairsFrame(s: Pick<PlanStairs, "x" | "y" | "rotation" | "widthIn" | "shape" | "flip">, riseIn: number) {
  const steps = stepsFor(riseIn);
  const r = raw(s.shape, s.widthIn, steps.treads);
  const mirror = (p: Point): Point => (s.flip ? { x: -p.x, y: p.y } : p);
  const pts = r.footprint.map(mirror);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const place = (p: Point) => add(rotate({ x: mirror(p).x - mid.x, y: mirror(p).y - mid.y }, s.rotation ?? 0), { x: s.x, y: s.y });
  return { ...steps, raw: r, place };
}

/** How the treads of L- and U-shaped stairs split around the landing (which takes the place of one step). */
export function flightSplit(treads: number): { n1: number; n2: number } {
  const n1 = Math.ceil((treads - 1) / 2);
  return { n1, n2: Math.max(1, treads - 1 - n1) };
}

export function stairsDrawing(s: Pick<PlanStairs, "x" | "y" | "rotation" | "widthIn" | "shape" | "flip">, riseIn: number): StairsDrawing {
  const { risers, riserIn, raw: r, place } = stairsFrame(s, riseIn);
  const footprint = r.footprint.map(place);
  return {
    footprint: s.flip ? footprint.reverse() : footprint,
    lines: r.lines.map(([a, b]) => [place(a), place(b)]),
    arrow: r.arrow.map(place),
    risers,
    riserIn,
    runIn: r.run,
  };
}
