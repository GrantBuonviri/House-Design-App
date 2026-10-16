import type { Cabinet, CabinetEdits, FloorPlan, Fixture, Point } from "@/lib/model/schema";
import { add, dist, dot, edgesOf, project, rotate, round1, scale, sub, subtractIntervals } from "./geometry";
import { inSpans, openSpans, openingGeometries } from "./walls";
import { newPlanId } from "./edit";
import { flatPlan } from "./flatten";

/**
 * Cabinets laid out from the counters, islands, vanities and appliances on
 * a floor plan: base cabinets in standard widths under the counters, a sink
 * base under each sink, upper cabinets on the wall behind, a short one over
 * the refrigerator and over the range (high enough to clear the cooktop),
 * and fillers where the standard widths don't add up. The owner can take
 * any away, move them, change their width or add more; those changes are
 * saved on the floor plan as `cabinets` (hidden ids and added boxes).
 */

/** Standard box widths, inches, widest first. */
export const CABINET_WIDTHS = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9];
export const VANITY_WIDTHS = [72, 60, 48, 42, 36, 30, 24];

export const BASE_DEPTH_IN = 24;
export const BASE_HEIGHT_IN = 34.5;
export const COUNTER_TOP_IN = 36;
export const UPPER_DEPTH_IN = 12;
/** Bottom of the upper cabinets: 18" above a 36" counter. */
export const UPPER_BOTTOM_IN = 54;
export const VANITY_DEPTH_IN = 21;
export const VANITY_HEIGHT_IN = 32;
export const TALL_HEIGHT_IN = 84;
/** Refrigerator height allowed for under the cabinet over it. */
const FRIDGE_TALL_IN = 70;

export const CABINET_LABEL: Record<Cabinet["kind"], string> = {
  base: "Base cabinet",
  sink: "Sink base",
  drawer: "Drawer base",
  upper: "Upper cabinet",
  tall: "Tall (pantry) cabinet",
  vanity: "Vanity cabinet",
  filler: "Filler",
};

const KITCHEN_RUN = new Set(["counter", "sink", "dishwasher", "range", "fridge"]);
const LAUNDRY = new Set(["washer", "dryer", "laundry-sink"]);
/** Appliances that sit in a run with no cabinet under them. */
const APPLIANCES = new Set(["dishwasher", "range", "fridge", "washer", "dryer", "laundry-sink"]);

export type RunKind = "wall" | "island" | "vanity" | "laundry";

/** One straight line of cabinets and appliances, measured along `u` from `origin` (a point on the back line). */
export type CabinetRun = {
  id: string;
  kind: RunKind;
  origin: Point;
  /** Along the run. */
  u: Point;
  /** Out of the front. */
  n: Point;
  rotation: number;
  t0: number;
  t1: number;
  depthIn: number;
  roomId?: string;
  /** Stretches of the run with a wall behind (where upper cabinets can go), along `u`. */
  walls: [number, number][];
  /** Appliances and sinks in the run, along `u`. */
  appliances: { fixture: Fixture; t0: number; t1: number }[];
  /** Windows and doors on the wall behind, along `u`, with their heights. */
  openings: { t0: number; t1: number; bottomIn: number; topIn: number; kind: string }[];
};

export type PlacedCabinet = Cabinet & {
  /** Laid out by the app (not added by hand). */
  auto: boolean;
  /** Short maker-style code, like B30, SB36, W3030. */
  code: string;
  /** The run it lines up with, if any. */
  runId?: string;
};

export type CabinetLayout = { runs: CabinetRun[]; cabinets: PlacedCabinet[] };

/** The usual short name for a cabinet box: B30, SB36, DB18, W3030, T2484, V36, F3. */
export function cabinetCode(c: Pick<Cabinet, "kind" | "widthIn" | "heightIn" | "depthIn">): string {
  const w = Math.round(c.widthIn);
  const h = Math.round(c.heightIn);
  switch (c.kind) {
    case "base":
      return `B${w}`;
    case "sink":
      return `SB${w}`;
    case "drawer":
      return `DB${w}`;
    case "upper":
      return c.depthIn > UPPER_DEPTH_IN + 1 ? `W${w}${h}-24` : `W${w}${h}`;
    case "tall":
      return `T${w}${h}`;
    case "vanity":
      return `V${w}`;
    case "filler":
      return `F${Math.max(1, Math.round(c.widthIn))}`;
  }
}

/** Cut a length into standard boxes, widest that fit evenly, with a filler for the last inch or two. */
export function fillWidths(length: number, widths = CABINET_WIDTHS): { widths: number[]; filler: number } {
  const min = widths[widths.length - 1];
  if (length < min) return { widths: [], filler: Math.max(0, length) };
  const max = widths[0];
  const step = widths.length > 1 ? widths[widths.length - 2] - min : 3;
  const n = Math.ceil(length / max - 1e-9);
  const each = Math.max(min, Math.floor(length / n / step) * step);
  const out = Array.from({ length: n }, () => each);
  let rest = length - each * n;
  for (let i = 0; i < out.length && rest >= step - 1e-9; i++) {
    if (out[i] + step > max) continue;
    out[i] += step;
    rest -= step;
  }
  return { widths: out, filler: rest > 0.25 ? rest : 0 };
}

const frameOf = (f: Pick<Fixture, "rotation">) => ({ u: rotate({ x: 1, y: 0 }, f.rotation), n: rotate({ x: 0, y: 1 }, f.rotation) });
const angleNear = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180) < 2;

/** Height of the uppers' tops for a ceiling height: 30" boxes under an 8' ceiling, 36" under 9', 42" above that. */
export function upperTop(ceilingIn: number): { topIn: number; heightIn: number } {
  const heightIn = ceilingIn <= 96 ? 30 : ceilingIn <= 108 ? 36 : 42;
  return { topIn: UPPER_BOTTOM_IN + heightIn, heightIn };
}

/** Lay out the runs and the cabinets the app would put in, before any changes by hand. */
export function autoCabinets(plan: FloorPlan, ceilingIn: number, rangeClearanceIn = 30): CabinetLayout {
  plan = flatPlan(plan);
  const runs = findRuns(plan);
  trimCorners(runs);
  const cabinets: PlacedCabinet[] = [];
  const { topIn, heightIn: upperH } = upperTop(ceilingIn);
  for (const run of runs) {
    const at = (t: number, depth: number) => add(run.origin, add(scale(run.u, t), scale(run.n, depth / 2)));
    let k = 0;
    const put = (kind: Cabinet["kind"], t0: number, t1: number, depthIn: number, heightIn: number, bottomIn: number) => {
      const c = at((t0 + t1) / 2, depthIn);
      const cab: Cabinet = { id: `${run.id}:${kind}${k++}`, kind, x: round1(c.x), y: round1(c.y), rotation: run.rotation, widthIn: round1(t1 - t0), depthIn, heightIn, bottomIn };
      cabinets.push({ ...cab, auto: true, code: cabinetCode(cab), runId: run.id });
    };
    const fill = (t0: number, t1: number, kind: Cabinet["kind"], depthIn: number, heightIn: number, bottomIn: number, widths = CABINET_WIDTHS, fillerAt: "start" | "end" = "end") => {
      const { widths: ws, filler } = fillWidths(t1 - t0, widths);
      let t = t0;
      if (filler && fillerAt === "start") {
        put("filler", t, t + filler, depthIn, heightIn, bottomIn);
        t += filler;
      }
      for (const w of ws) {
        put(kind, t, t + w, depthIn, heightIn, bottomIn);
        t += w;
      }
      if (filler && fillerAt === "end") put("filler", t, t + filler, depthIn, heightIn, bottomIn);
    };

    if (run.kind === "vanity") {
      for (const [a, b] of [[run.t0, run.t1] as [number, number]]) {
        const exact = VANITY_WIDTHS.find((w) => Math.abs(w - (b - a)) < 0.6);
        if (exact) put("vanity", a, b, VANITY_DEPTH_IN, VANITY_HEIGHT_IN, 0);
        else fill(a, b, "vanity", VANITY_DEPTH_IN, VANITY_HEIGHT_IN, 0);
      }
      continue;
    }

    // Base cabinets: everything that isn't an appliance; a sink gets a sink base a little wider than the bowl.
    if (run.kind !== "laundry") {
      const depth = run.kind === "island" && run.depthIn >= 36 ? BASE_DEPTH_IN : Math.min(BASE_DEPTH_IN, run.depthIn);
      const cuts: [number, number][] = [];
      const sinks: [number, number][] = [];
      for (const a of run.appliances) {
        if (a.fixture.kind === "sink") {
          // As wide as the next standard size up, but not into the appliances on either side.
          const others = run.appliances.filter((x) => x.fixture.kind !== "sink");
          const lo = Math.max(run.t0, ...others.filter((x) => x.t1 <= a.t0 + 0.5).map((x) => x.t1));
          const hi = Math.min(run.t1, ...others.filter((x) => x.t0 >= a.t1 - 0.5).map((x) => x.t0));
          const sinkW = a.t1 - a.t0;
          const up = CABINET_WIDTHS.slice().reverse();
          const want = up.find((w) => w >= sinkW + 2 && w <= hi - lo + 0.01) ?? up.find((w) => w >= sinkW && w <= hi - lo + 0.01) ?? Math.min(hi - lo, sinkW);
          const mid = (a.t0 + a.t1) / 2;
          let s0 = Math.max(lo, mid - want / 2);
          const s1 = Math.min(hi, s0 + want);
          s0 = Math.max(lo, s1 - want);
          sinks.push([s0, s1]);
          cuts.push([s0, s1]);
        } else cuts.push([a.t0, a.t1]);
      }
      for (const [a, b] of sinks) put("sink", a, b, depth, BASE_HEIGHT_IN, 0);
      const ranges = run.appliances.filter((a) => a.fixture.kind === "range");
      for (const [a, b] of subtractIntervals(run.t1 - run.t0, cuts.map(([a, b]) => [a - run.t0, b - run.t0])).map(([a, b]) => [a + run.t0, b + run.t0])) {
        // Fillers go against a wall or the fridge, not in the middle of the counter.
        const fillerAt = Math.abs(a - run.t0) < 0.5 ? "start" : "end";
        const startK = cabinets.length;
        fill(a, b, "base", depth, BASE_HEIGHT_IN, 0, CABINET_WIDTHS, fillerAt);
        // The box next to a range is a drawer base, for pots and pans.
        for (const r of ranges)
          for (const c of cabinets.slice(startK)) {
            if (c.kind !== "base" || c.widthIn < 15) continue;
            const ct = dot(sub({ x: c.x, y: c.y }, run.origin), run.u);
            if (Math.abs(ct - c.widthIn / 2 - r.t1) < 0.6 || Math.abs(ct + c.widthIn / 2 - r.t0) < 0.6) {
              c.kind = "drawer";
              c.code = cabinetCode(c);
            }
          }
      }
    }

    // Upper cabinets along the wall behind, except over windows and doors.
    if (run.kind === "island") continue;
    const blocks: [number, number][] = [];
    for (const o of run.openings) if (o.topIn > UPPER_BOTTOM_IN && o.bottomIn < topIn) blocks.push([o.t0 - 2, o.t1 + 2]);
    const special: [number, number][] = [];
    for (const a of run.appliances) {
      if (a.fixture.kind === "fridge") special.push([a.t0, a.t1]);
      if (a.fixture.kind === "range") special.push([a.t0, a.t1]);
    }
    for (const [w0, w1] of run.walls) {
      const span: [number, number] = [Math.max(run.t0, w0), Math.min(run.t1, w1)];
      if (span[1] - span[0] < 9) continue;
      const cuts = [...blocks, ...special].map(([a, b]) => [a - span[0], b - span[0]] as [number, number]);
      for (const [a, b] of subtractIntervals(span[1] - span[0], cuts)) fill(a + span[0], b + span[0], "upper", UPPER_DEPTH_IN, upperH, UPPER_BOTTOM_IN);
      for (const a of run.appliances) {
        const s0 = Math.max(span[0], a.t0);
        const s1 = Math.min(span[1], a.t1);
        if (s1 - s0 < 9 || blocks.some(([b0, b1]) => b0 < s1 && b1 > s0)) continue;
        if (a.fixture.kind === "fridge") {
          const h = Math.floor((topIn - FRIDGE_TALL_IN - 1) / 3) * 3;
          if (h >= 12) put("upper", s0, s1, BASE_DEPTH_IN, h, topIn - h);
        }
        if (a.fixture.kind === "range") {
          // High enough above the cooktop to clear it (the hood goes under it).
          const h = Math.floor((topIn - COUNTER_TOP_IN - rangeClearanceIn) / 3) * 3;
          if (h >= 12) put("upper", s0, s1, UPPER_DEPTH_IN, h, topIn - h);
        }
      }
    }
  }
  return { runs, cabinets };
}

/** The cabinets on a floor: the app's layout, less any taken away, plus any added or moved by hand. */
export function cabinetLayout(plan: FloorPlan, ceilingIn: number, rangeClearanceIn = 30): CabinetLayout {
  plan = flatPlan(plan);
  const auto = autoCabinets(plan, ceilingIn, rangeClearanceIn);
  const edits = plan.cabinets;
  if (!edits) return auto;
  const hidden = new Set(edits.hidden);
  const runs = [...auto.runs];
  const added: PlacedCabinet[] = [];
  for (const c of edits.added) {
    let run = runFor(runs, c);
    if (!run) {
      // A cabinet on a wall with no counter: it starts its own run, so it gets an elevation too.
      const { u, n } = frameOf(c);
      const origin = add({ x: c.x, y: c.y }, scale(n, -c.depthIn / 2));
      run = { id: `run-${c.id}`, kind: "wall", origin, u, n, rotation: c.rotation, t0: -c.widthIn / 2, t1: c.widthIn / 2, depthIn: c.depthIn, walls: [], appliances: [], openings: [] };
      runs.push(run);
    }
    const t = alongRun(run, c);
    run.t0 = Math.min(run.t0, t - c.widthIn / 2);
    run.t1 = Math.max(run.t1, t + c.widthIn / 2);
    added.push({ ...c, auto: false, code: cabinetCode(c), runId: run.id });
  }
  for (const r of runs.slice(auto.runs.length)) r.openings = openingsBehind(plan, r.origin, r.u, r.n, r.t0, r.t1);
  return { runs, cabinets: [...auto.cabinets.filter((c) => !hidden.has(c.id)), ...added] };
}

/** The run a cabinet lines up with: same direction, its back on the run's back line, and within its length. */
export function runFor(runs: CabinetRun[], c: Pick<Cabinet, "x" | "y" | "rotation" | "depthIn" | "widthIn">): CabinetRun | undefined {
  const back = add({ x: c.x, y: c.y }, scale(frameOf(c).n, -c.depthIn / 2));
  return runs.find((r) => {
    if (!angleNear(r.rotation, c.rotation)) return false;
    const d = sub(back, r.origin);
    const t = dot(d, r.u);
    return Math.abs(dot(d, r.n)) < 3 && t > r.t0 - c.widthIn / 2 - 2 && t < r.t1 + c.widthIn / 2 + 2;
  });
}

/** Where a cabinet is along its run, inches from the run's origin. */
export function alongRun(run: CabinetRun, c: Pick<Cabinet, "x" | "y">): number {
  return dot(sub({ x: c.x, y: c.y }, run.origin), run.u);
}

/** A cabinet's footprint on the plan. */
export function cabinetCorners(c: Pick<Cabinet, "x" | "y" | "rotation" | "widthIn" | "depthIn">): Point[] {
  const L = (x: number, y: number) => add(rotate({ x, y }, c.rotation), { x: c.x, y: c.y });
  const w = c.widthIn / 2;
  const d = c.depthIn / 2;
  return [L(-w, -d), L(w, -d), L(w, d), L(-w, d)];
}

// ---------- Changes by hand ----------

const editsOf = (plan: FloorPlan): CabinetEdits => plan.cabinets ?? { hidden: [], added: [] };

/** Take a cabinet away. */
export function removeCabinet(plan: FloorPlan, id: string): FloorPlan {
  const e = editsOf(plan);
  if (e.added.some((c) => c.id === id)) return { ...plan, cabinets: { ...e, added: e.added.filter((c) => c.id !== id) } };
  return { ...plan, cabinets: { ...e, hidden: [...new Set([...e.hidden, id])] } };
}

/** Change a cabinet (move it, or change its kind or size). An app-placed one is swapped for a hand-placed copy. */
export function updateCabinet(plan: FloorPlan, cab: Cabinet, patch: Partial<Omit<Cabinet, "id">>): FloorPlan {
  const e = editsOf(plan);
  const next: Cabinet = { ...stripPlaced(cab), ...patch, x: round1(patch.x ?? cab.x), y: round1(patch.y ?? cab.y) };
  if (e.added.some((c) => c.id === cab.id)) return { ...plan, cabinets: { ...e, added: e.added.map((c) => (c.id === cab.id ? next : c)) } };
  return { ...plan, cabinets: { hidden: [...new Set([...e.hidden, cab.id])], added: [...e.added, { ...next, id: newPlanId("cab") }] } };
}

/** Add a cabinet by hand. */
export function addCabinet(plan: FloorPlan, cab: Omit<Cabinet, "id">): FloorPlan {
  const e = editsOf(plan);
  const c: Cabinet = { ...cab, id: newPlanId("cab"), x: round1(cab.x), y: round1(cab.y) };
  return { ...plan, cabinets: { ...e, added: [...e.added, c] } };
}

/** Go back to the app's layout on this floor. */
export function resetCabinets(plan: FloorPlan): FloorPlan {
  const { cabinets: _drop, ...rest } = plan;
  void _drop;
  return rest;
}

/** Has this floor's layout been changed by hand? */
export const cabinetsEdited = (plan: FloorPlan) => Boolean(plan.cabinets && (plan.cabinets.hidden.length || plan.cabinets.added.length));

function stripPlaced(c: Cabinet | PlacedCabinet): Cabinet {
  const { id, kind, x, y, rotation, widthIn, depthIn, heightIn, bottomIn } = c;
  return { id, kind, x, y, rotation, widthIn, depthIn, heightIn, bottomIn };
}

/** A new box of a kind with its usual size, against a wall at `back` facing `n`. */
export function newCabinet(kind: Cabinet["kind"], back: Point, rotation: number, widthIn: number, ceilingIn: number): Omit<Cabinet, "id"> {
  const { topIn, heightIn: upperH } = upperTop(ceilingIn);
  const size: Record<Cabinet["kind"], { d: number; h: number; z: number }> = {
    base: { d: BASE_DEPTH_IN, h: BASE_HEIGHT_IN, z: 0 },
    sink: { d: BASE_DEPTH_IN, h: BASE_HEIGHT_IN, z: 0 },
    drawer: { d: BASE_DEPTH_IN, h: BASE_HEIGHT_IN, z: 0 },
    upper: { d: UPPER_DEPTH_IN, h: upperH, z: topIn - upperH },
    tall: { d: BASE_DEPTH_IN, h: Math.min(TALL_HEIGHT_IN + 6, topIn), z: 0 },
    vanity: { d: VANITY_DEPTH_IN, h: VANITY_HEIGHT_IN, z: 0 },
    filler: { d: BASE_DEPTH_IN, h: BASE_HEIGHT_IN, z: 0 },
  };
  const s = size[kind];
  const c = add(back, scale(rotate({ x: 0, y: 1 }, rotation), s.d / 2));
  return { kind, x: c.x, y: c.y, rotation, widthIn, depthIn: s.d, heightIn: s.h, bottomIn: s.z };
}

// ---------- Finding the runs ----------

type Piece = { f: Fixture; u: Point; n: Point; back: Point; kind: RunKind };

function findRuns(plan: FloorPlan): CabinetRun[] {
  const pieces: Piece[] = [];
  for (const f of plan.fixtures) {
    const kind: RunKind | null = f.kind === "island" ? "island" : f.kind === "vanity" ? "vanity" : KITCHEN_RUN.has(f.kind) ? "wall" : LAUNDRY.has(f.kind) ? "laundry" : null;
    if (!kind) continue;
    const { u, n } = frameOf(f);
    pieces.push({ f, u, n, back: add({ x: f.x, y: f.y }, scale(n, -f.depthIn / 2)), kind });
  }
  // A sink or dishwasher inside an island belongs to the island.
  const inIsland = (p: Piece) => pieces.find((q) => q.kind === "island" && q !== p && insideFootprint({ x: p.f.x, y: p.f.y }, q.f));
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i: number, j: number) => (parent[find(i)] = find(j));
  pieces.forEach((p, i) => {
    const isl = inIsland(p);
    if (isl && p.kind === "wall") {
      p.kind = "island";
      join(i, pieces.indexOf(isl));
    }
  });
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if (!sameGroup(a.kind, b.kind) || !angleNear(a.f.rotation, b.f.rotation)) continue;
      // Backs on one line, and touching or overlapping along it.
      if (Math.abs(dot(sub(b.back, a.back), a.n)) > 3) continue;
      const ta = dot(a.back, a.u);
      const tb = dot(b.back, a.u);
      if (Math.abs(ta - tb) <= (a.f.widthIn + b.f.widthIn) / 2 + 2) join(i, j);
    }
  const groups = new Map<number, Piece[]>();
  pieces.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));

  const runs: CabinetRun[] = [];
  for (const g of groups.values()) {
    // The run's frame comes from its counter (or island, or first piece).
    const lead = g.find((p) => p.f.kind === "island") ?? g.find((p) => p.f.kind === "counter") ?? g.find((p) => p.f.kind === "vanity") ?? g[0];
    const kind: RunKind = g.some((p) => p.kind === "island") ? "island" : lead.kind === "vanity" ? "vanity" : g.every((p) => p.kind === "laundry") ? "laundry" : "wall";
    const { u, n } = lead;
    const origin = lead.back;
    let t0 = Infinity;
    let t1 = -Infinity;
    const appliances: CabinetRun["appliances"] = [];
    for (const p of g) {
      const c = dot(sub({ x: p.f.x, y: p.f.y }, origin), u);
      const a = c - p.f.widthIn / 2;
      const b = c + p.f.widthIn / 2;
      // Laundry runs are only the washer, dryer and sink, all appliances.
      if (APPLIANCES.has(p.f.kind) || p.f.kind === "sink") appliances.push({ fixture: p.f, t0: a, t1: b });
      t0 = Math.min(t0, a);
      t1 = Math.max(t1, b);
    }
    const depthIn = Math.max(...g.filter((p) => p.f.kind === lead.f.kind).map((p) => p.f.depthIn));
    const sorted = [...g].sort((a, b) => (a.f.id < b.f.id ? -1 : 1));
    runs.push({
      id: `run-${sorted[0].f.id}`,
      kind,
      origin,
      u,
      n,
      rotation: lead.f.rotation,
      t0,
      t1,
      depthIn,
      roomId: lead.f.roomId,
      walls: kind === "island" ? [] : wallsBehind(plan, origin, u, n, t0, t1),
      appliances: appliances.sort((a, b) => a.t0 - b.t0),
      openings: kind === "island" ? [] : openingsBehind(plan, origin, u, n, t0, t1),
    });
  }
  return runs.sort((a, b) => (a.id < b.id ? -1 : 1));
}

const sameGroup = (a: RunKind, b: RunKind) => a === b || (a === "wall" && b === "laundry") || (a === "laundry" && b === "wall");

function insideFootprint(p: Point, f: Fixture): boolean {
  const { u, n } = frameOf(f);
  const d = sub(p, { x: f.x, y: f.y });
  return Math.abs(dot(d, u)) <= f.widthIn / 2 + 0.5 && Math.abs(dot(d, n)) <= f.depthIn / 2 + 0.5;
}

/** Stretches of the back line with a wall right behind it (within about 4 inches). */
function wallsBehind(plan: FloorPlan, origin: Point, u: Point, n: Point, t0: number, t1: number): [number, number][] {
  const edges = [...plan.rooms.flatMap((r) => edgesOf(r.polygon)), ...plan.walls.map((w) => ({ a: w.a, b: w.b }))];
  const out: [number, number][] = [];
  let start: number | null = null;
  const STEP = 3;
  for (let t = t0; t <= t1 + 1e-6; t += STEP) {
    const p = add(origin, add(scale(u, Math.min(t, t1)), scale(n, -1)));
    const hit = edges.some((e) => {
      const pr = project(p, e.a, e.b);
      if (pr.d > 5) return false;
      // The wall has to run the same way as the cabinets, and still be there (not taken out).
      const dir = sub(e.b, e.a);
      return Math.abs(dot(dir, n)) / Math.max(1e-6, dist(e.a, e.b)) < 0.1 && !inSpans(openSpans(plan, e.a, e.b), pr.t);
    });
    if (hit && start === null) start = Math.min(t, t1);
    if (!hit && start !== null) {
      out.push([start, t - STEP]);
      start = null;
    }
  }
  if (start !== null) out.push([start, t1]);
  // Snap the ends back to the run's ends when they're within a step.
  return out.map(([a, b]) => [a - t0 < STEP + 0.1 ? t0 : a, t1 - b < STEP + 0.1 ? t1 : b] as [number, number]).filter(([a, b]) => b - a > 1);
}

/** Windows and doors in the wall behind a run. */
function openingsBehind(plan: FloorPlan, origin: Point, u: Point, n: Point, t0: number, t1: number): CabinetRun["openings"] {
  const out: CabinetRun["openings"] = [];
  for (const g of openingGeometries(plan)) {
    const da = dot(sub(g.a, origin), n);
    const db = dot(sub(g.b, origin), n);
    if (Math.abs(da) > 12 || Math.abs(db) > 12) continue;
    const a = dot(sub(g.a, origin), u);
    const b = dot(sub(g.b, origin), u);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi < t0 || lo > t1) continue;
    const o = g.opening;
    const bottomIn = o.kind === "window" ? (o.sillIn ?? 30) : 0;
    out.push({ t0: lo, t1: hi, bottomIn, topIn: bottomIn + o.heightIn, kind: o.kind });
  }
  return out.sort((p, q) => p.t0 - q.t0);
}

/**
 * Where two runs meet in an L, the corner belongs to one of them: the other
 * stops at the first one's front edge, so the boxes don't overlap.
 */
function trimCorners(runs: CabinetRun[]) {
  for (const a of runs) {
    if (a.kind === "vanity") continue;
    for (const b of runs) {
      if (a === b || b.kind === "vanity" || Math.abs(dot(a.u, b.u)) > 0.1) continue;
      // Where is b's front edge along a?
      const frontB = add(b.origin, scale(b.n, b.depthIn));
      const ends: ("t0" | "t1")[] = ["t0", "t1"];
      for (const end of ends) {
        const t = a[end];
        const p = add(a.origin, add(scale(a.u, t), scale(a.n, Math.min(a.depthIn, BASE_DEPTH_IN) / 2)));
        // Inside b's footprint?
        const d = sub(p, b.origin);
        const along = dot(d, b.u);
        const out = dot(d, b.n);
        if (out < 0 || out > b.depthIn + 0.5 || along < b.t0 - 0.5 || along > b.t1 + 0.5) continue;
        // Keep the corner on the longer run.
        const la = a.t1 - a.t0;
        const lb = b.t1 - b.t0;
        if (la > lb + 0.5 || (Math.abs(la - lb) <= 0.5 && a.id < b.id)) continue;
        const cut = dot(sub(frontB, a.origin), a.u);
        if (end === "t0") a.t0 = Math.max(a.t0, cut);
        else a.t1 = Math.min(a.t1, cut);
      }
    }
  }
}
