import type { PlanStairs, Point } from "@/lib/model/schema";
import { add, polygonsOverlap, rotate } from "./geometry";

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

/** Each tread is a board this thick, over a riser. */
export const TREAD_BOARD_IN = 1.5;
/** How deep the stringers and soffit run under a flight, square to its slope. */
export const SOFFIT_DEPTH_IN = 10;
/** A landing is a slab this thick. */
export const LANDING_THICK_IN = 10;

/**
 * One flight in the stairs' own climbing-north frame: it starts on the edge
 * through `origin`, climbs along `dir` and is the stairs' width across
 * `side`. `z0` is what it starts from (the floor, or the landing), `base`
 * the lowest its underside goes (the floor, or the landing's underside).
 */
export type StairFlight = { origin: Point; dir: Point; side: Point; n: number; z0: number; base: number; closed: boolean };
/** A tread or landing to stand on: its outline (stairs frame), the height of its top, and the lowest point of what's under it. */
export type StairStep = { outline: Point[]; top: number; under: number };

/**
 * The stairs as built: flights on sloped stringers with an open soffit
 * under them and a landing slab between them. `closed` boxes the bottom
 * flight in down to the floor (nothing comes up underneath it).
 */
export function stairLayout(shape: PlanStairs["shape"], w: number, treads: number, riserIn: number, closed = false) {
  const T = TREAD_IN;
  const P = (x: number, y: number): Point => ({ x, y });
  const flights: StairFlight[] = [];
  let landing: { outline: Point[]; top: number } | null = null;
  const rect = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  if (shape === "straight") {
    flights.push({ origin: P(0, 0), dir: P(0, -1), side: P(1, 0), n: treads, z0: 0, base: 0, closed });
  } else {
    const { n1, n2 } = flightSplit(treads);
    const L1 = n1 * T;
    const top = (n1 + 1) * riserIn;
    flights.push({ origin: P(0, 0), dir: P(0, -1), side: P(1, 0), n: n1, z0: 0, base: 0, closed });
    landing = { outline: shape === "l" ? rect(0, -L1 - w, w, -L1) : rect(0, -L1 - w, 2 * w, -L1), top };
    const base = top - LANDING_THICK_IN;
    if (shape === "l") flights.push({ origin: P(w, -L1), dir: P(1, 0), side: P(0, -1), n: n2, z0: top, base, closed: false });
    else flights.push({ origin: P(w, -L1), dir: P(0, 1), side: P(1, 0), n: n2, z0: top, base, closed: false });
  }
  const at = (f: StairFlight, a: number, t: number): Point => ({ x: f.origin.x + f.dir.x * a + f.side.x * t, y: f.origin.y + f.dir.y * a + f.side.y * t });
  const tread = (f: StairFlight, k: number): StairStep => ({
    outline: [at(f, k * T, 0), at(f, (k + 1) * T, 0), at(f, (k + 1) * T, w), at(f, k * T, w)],
    top: f.z0 + (k + 1) * riserIn,
    under: flightUnderside(f, k * T, riserIn),
  });
  const steps: StairStep[] = [];
  for (let k = 0; k < flights[0].n; k++) steps.push(tread(flights[0], k));
  if (landing) steps.push({ ...landing, under: landing.top - LANDING_THICK_IN });
  if (flights[1]) for (let k = 0; k < flights[1].n; k++) steps.push(tread(flights[1], k));
  return { flights, landing, steps, at };
}

/** The height of a flight's underside `a` inches along it: a slope parallel to the treads, or the floor where it's closed in. */
export function flightUnderside(f: StairFlight, a: number, riserIn: number): number {
  if (f.closed) return f.z0;
  const T = TREAD_IN;
  const drop = (SOFFIT_DEPTH_IN * Math.hypot(T, riserIn)) / T;
  return Math.max(f.base, f.z0 + (a * riserIn) / T - drop);
}

type Placed = Pick<PlanStairs, "x" | "y" | "rotation" | "widthIn" | "shape" | "flip">;

/** Each tread and landing of placed stairs, in plan coordinates, heights above the floor they stand on. */
export function placedSteps(s: Placed, riseIn: number, closed = false): StairStep[] {
  const fr = stairsFrame(s, riseIn);
  return stairLayout(s.shape, s.widthIn, fr.treads, fr.riserIn, closed).steps.map((st) => ({ ...st, outline: st.outline.map(fr.place) }));
}

/** Stairs are boxed in under their bottom flight unless other stairs come up underneath them (`holes`: the footprints of stairs arriving at this floor). */
export function isClosedIn(s: Placed, riseIn: number, holes: Point[][]): boolean {
  const fp = stairsDrawing(s, riseIn).footprint;
  return !holes.some((h) => polygonsOverlap(h, fp));
}

/**
 * The least headroom over stairs `lower` when stairs `upper` start on the
 * floor they climb to (`riseIn` of the lower stairs higher), measured up
 * from each tread to the underside of whatever upper tread or landing sits
 * over it. Infinity when they don't overlap.
 */
export function stackedHeadroom(lower: Placed, lowerRise: number, upper: Placed, upperRise: number): number {
  const lo = placedSteps(lower, lowerRise);
  const hi = placedSteps(upper, upperRise);
  let min = Infinity;
  for (const a of lo) for (const b of hi) if (polygonsOverlap(a.outline, b.outline)) min = Math.min(min, lowerRise + b.under - a.top);
  return min;
}

/** Plans are cut about 4 ft above the floor: stairs going up are drawn to there, stairs going down from there. */
export const PLAN_CUT_IN = 48;

export type StairsCut = {
  /** The diagonal break line across the tread where the plan is cut. */
  line: [Point, Point];
  /** Treads and landings below the cut (drawn on this floor going UP), and above it (seen from the floor above going DN). */
  below: Point[][];
  above: Point[][];
  /** Walking lines: UP from the bottom step to the cut, DN from the top step to the cut. */
  up: Point[];
  down: Point[];
};

/** Where plan drawings break the stairs, the way real floor plans draw stacked stairs. */
export function stairsCut(s: Placed, riseIn: number): StairsCut {
  const steps = placedSteps(s, riseIn);
  const mid = (o: Point[]) => ({ x: o.reduce((t, p) => t + p.x, 0) / o.length, y: o.reduce((t, p) => t + p.y, 0) / o.length });
  const c = Math.max(1, Math.min(steps.length - 1, steps.findIndex((st) => st.top >= PLAN_CUT_IN)));
  const o = steps[c].outline;
  const front = (st: StairStep) => ({ x: (st.outline[0].x + st.outline[3].x) / 2, y: (st.outline[0].y + st.outline[3].y) / 2 });
  const back = (st: StairStep) => ({ x: (st.outline[1].x + st.outline[2].x) / 2, y: (st.outline[1].y + st.outline[2].y) / 2 });
  const last = steps[steps.length - 1];
  return {
    line: [o[0], o[2]],
    below: [...steps.slice(0, c).map((st) => st.outline), [o[0], o[2], o[3]]],
    above: [[o[0], o[1], o[2]], ...steps.slice(c + 1).map((st) => st.outline)],
    up: [front(steps[0]), ...steps.slice(0, c).map((st) => mid(st.outline)), mid(o)],
    down: [back(last), ...steps.slice(c + 1).reverse().map((st) => mid(st.outline)), mid(o)],
  };
}
