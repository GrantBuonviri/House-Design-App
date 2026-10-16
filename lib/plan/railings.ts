import type { FloorPlan, PlanStairs, Point, RailingEdit } from "@/lib/model/schema";
import type { Plans } from "./edit";
import { add, cross, dist, dot, lerp, pointInPolygon, scale, sub, unit } from "./geometry";
import { areaKind } from "./measure";
import { flightSplit, placedSteps, stairsFrame, TREAD_IN } from "./stairs";
import { wallPieces } from "./walls";

/**
 * Stair railings, worked out from the stairs and the walls around them every
 * time, so moving or reshaping stairs (or adding a wall beside them) updates
 * them on its own. Only Grant's changes are saved, on the stairs
 * (`PlanStairs.railings`), keyed by edge name, so they ride along when the
 * stairs move, turn, flip or get copied.
 *
 * Every edge of the stairs has a stable name in the stairs' own climbing-north
 * frame (before any flip): `f1-left` / `f1-right` / `f2-left` / `f2-right`
 * (left and right facing up that flight), the landing's open sides, `middle`
 * between the two flights of U stairs, and the step-on and step-off edges
 * (`bottom`, `top`, `join-1`, `join-2`), which never get a railing. The hole
 * the stairs make in the floor above has edges `well-1` ... in the order of
 * the footprint's corners; the one you arrive across is an opening.
 *
 * Automatic railings: a guard on every open stretch (34" along a flight, 36"
 * on a landing and around the stairwell), and a handrail on the wall where a
 * flight runs along a full-height wall (stairs with 4+ risers).
 */

export type RailingKind = NonNullable<RailingEdit["kind"]>;
export type RailingStyle = NonNullable<RailingEdit["style"]>;
export type EdgeRole = "flight" | "landing" | "middle" | "opening" | "well";

/** Guard heights from the Boise code numbers: along a flight (above the nosings), and at landings and floors. */
export const GUARD_FLIGHT_IN = 34;
export const GUARD_LANDING_IN = 36;
/** Handrails go 34" to 38" above the nosings; the app uses the middle. */
export const HANDRAIL_IN = 36;
/** Handrails are needed with this many risers or more. */
export const HANDRAIL_MIN_RISERS = 4;
/** How far a wall can be from a stair edge (past its own half thickness) and still count as along it. */
export const WALL_GAP_IN = 6;
/** A guard's posts are this wide; the guard sits this far in from the edge. */
export const POST_IN = 3.5;
/** A wall-mounted handrail stands this far off the wall (rail middle). */
export const HANDRAIL_OFF_IN = 2.25;
export const HALF_WALL_THICK_IN = 4.5;
const MIN_STRETCH_IN = 4;
/** Steps this low beside a stairwell edge are stepped onto, not fallen into. */
const STEP_ON_IN = 24;

/** One edge of the stairs, in the stairs' own frame: walking-surface heights at each end (`low`: the lower flight beside the U middle). */
export type StairEdge = {
  name: string;
  role: EdgeRole;
  a: Point;
  b: Point;
  za: number;
  zb: number;
  low?: [number, number];
  /** Into the stairs (the walking side). */
  inward: Point;
};

export type Railing = {
  /** `<stairsId>:<edge>`, with `:<n>` for the second and later stretches of one edge. */
  key: string;
  stairsId: string;
  edge: string;
  role: EdgeRole;
  /** The floor it's built on (the floor above for the stairwell's guards). */
  levelId: string;
  /** The floor the stairs are on. */
  stairsLevelId: string;
  kind: RailingKind;
  style: RailingStyle;
  /** Its line on the plan (set in from the edge where it stands). */
  a: Point;
  b: Point;
  /** The walking surface along it, inches above its floor, at each end. */
  za: number;
  zb: number;
  /** The lower walking surface beside it (the U middle's lower flight), for walking into it. */
  low?: [number, number];
  /** How tall it stands above `za`/`zb`. */
  heightIn: number;
  /** Its top stops here (the floor above, where it runs under the stairwell's edge). */
  maxTop?: number;
  /** Toward the side people walk on. */
  toward: Point;
  /** A handrail's wall face is this far behind its line. */
  wallOff?: number;
  auto: boolean;
};

/** One side of the stairs or stairwell where a railing can stand, whether or not it has one now. `a`/`b` are the edge itself. */
export type RailingSlot = {
  key: string;
  stairsId: string;
  /** The floor the stairs are on. */
  stairsLevelId: string;
  /** The floor a railing here would stand on. */
  levelId: string;
  edge: string;
  role: EdgeRole;
  a: Point;
  b: Point;
  /** The walking surface along the edge, inches above `levelId`'s floor, at each end. */
  za: number;
  zb: number;
  toward: Point;
};

type Shaped = Pick<PlanStairs, "x" | "y" | "rotation" | "widthIn" | "shape" | "flip">;

/** Every edge of the stairs, in their own frame, with the heights of what you walk on along it. */
export function stairEdges(s: Pick<PlanStairs, "shape" | "widthIn">, riseIn: number, treads: number, riserIn: number): StairEdge[] {
  const w = s.widthIn;
  const r = riserIn;
  const T = TREAD_IN;
  const P = (x: number, y: number): Point => ({ x, y });
  const E = (name: string, role: EdgeRole, a: Point, b: Point, za: number, zb: number, inward: Point, low?: [number, number]): StairEdge => ({ name, role, a, b, za, zb, inward, ...(low ? { low } : {}) });
  const R = P(1, 0);
  const Lf = P(-1, 0);
  if (s.shape === "straight") {
    const L = treads * T;
    return [
      E("bottom", "opening", P(0, 0), P(w, 0), 0, 0, P(0, -1)),
      E("f1-left", "flight", P(0, 0), P(0, -L), r, riseIn, R),
      E("f1-right", "flight", P(w, 0), P(w, -L), r, riseIn, Lf),
      E("top", "opening", P(0, -L), P(w, -L), riseIn, riseIn, P(0, 1)),
    ];
  }
  const { n1, n2 } = flightSplit(treads);
  const L1 = n1 * T;
  const L2 = n2 * T;
  const land = (n1 + 1) * r;
  const out: StairEdge[] = [E("bottom", "opening", P(0, 0), P(w, 0), 0, 0, P(0, -1)), E("f1-left", "flight", P(0, 0), P(0, -L1), r, land, R)];
  if (s.shape === "l") {
    out.push(
      E("f1-right", "flight", P(w, 0), P(w, -L1), r, land, Lf),
      E("join-1", "opening", P(0, -L1), P(w, -L1), land, land, P(0, 1)),
      E("landing-outer-1", "landing", P(0, -L1), P(0, -L1 - w), land, land, R),
      E("landing-outer-2", "landing", P(0, -L1 - w), P(w, -L1 - w), land, land, P(0, 1)),
      E("join-2", "opening", P(w, -L1), P(w, -L1 - w), land, land, Lf),
      E("f2-left", "flight", P(w, -L1 - w), P(w + L2, -L1 - w), land + r, riseIn, P(0, 1)),
      E("f2-right", "flight", P(w, -L1), P(w + L2, -L1), land + r, riseIn, P(0, -1)),
      E("top", "opening", P(w + L2, -L1), P(w + L2, -L1 - w), riseIn, riseIn, Lf),
    );
    return out;
  }
  // U: flight 1's right side runs along flight 2 (the middle), except where flight 1 is longer.
  const extra = L1 - L2;
  if (extra > 1e-6) out.push(E("f1-right", "flight", P(w, 0), P(w, -extra), r, r + (extra * r) / T, Lf));
  out.push(
    E("middle", "middle", P(w, -extra), P(w, -L1), riseIn, land + r, Lf, [r + (extra * r) / T, land]),
    E("join-1", "opening", P(0, -L1), P(w, -L1), land, land, P(0, 1)),
    E("landing-left", "landing", P(0, -L1), P(0, -L1 - w), land, land, R),
    E("landing-far", "landing", P(0, -L1 - w), P(2 * w, -L1 - w), land, land, P(0, 1)),
    E("landing-right", "landing", P(2 * w, -L1 - w), P(2 * w, -L1), land, land, Lf),
    E("join-2", "opening", P(w, -L1), P(2 * w, -L1), land, land, P(0, 1)),
    E("f2-left", "flight", P(2 * w, -L1), P(2 * w, -extra), land + r, riseIn, Lf),
    E("top", "opening", P(w, -extra), P(2 * w, -extra), riseIn, riseIn, P(0, 1)),
  );
  return out;
}

/** The footprint edge you arrive across at the top, by shape (index into the footprint's corners). */
const ARRIVAL = { straight: 2, l: 3, u: 2 } as const;

/** The edges of the hole the stairs make in the floor above, in plan coordinates, `inward` pointing into the hole. */
export function wellEdges(s: Shaped, riseIn: number): { name: string; role: EdgeRole; a: Point; b: Point; inward: Point }[] {
  const fr = stairsFrame(s, riseIn);
  const fp = fr.raw.footprint;
  const placed = fp.map(fr.place);
  return fp.map((_, i) => {
    const a = placed[i];
    const b = placed[(i + 1) % fp.length];
    const u = unit(sub(b, a));
    const n = { x: -u.y, y: u.x };
    const mid = lerp(a, b, 0.5);
    const inward = pointInPolygon(add(mid, scale(n, 0.5)), placed) ? n : scale(n, -1);
    return { name: `well-${i + 1}`, role: i === ARRIVAL[s.shape] ? ("opening" as const) : ("well" as const), a, b, inward };
  });
}

/** Every edge name stairs of this shape have (stairs and stairwell), for dropping changes to edges that are gone. */
export function edgeNames(shape: PlanStairs["shape"]): string[] {
  const s = { shape, widthIn: 40 };
  // A tall rise so U stairs have their short flight-1 side too.
  const names = stairEdges(s, 121, 15, 121 / 16).map((e) => e.name);
  if (shape === "u" && !names.includes("f1-right")) names.push("f1-right");
  const corners = shape === "straight" ? 4 : 6;
  for (let i = 1; i <= corners; i++) names.push(`well-${i}`);
  return names;
}

/** Changes kept only for edges the stairs still have (after a change of shape). */
export function keepRailingEdits(s: PlanStairs): PlanStairs {
  if (!s.railings) return s;
  const names = new Set(edgeNames(s.shape));
  const kept = s.railings.filter((e) => names.has(e.edge));
  if (kept.length === s.railings.length) return s;
  return kept.length ? { ...s, railings: kept } : withoutEdits(s);
}

/**
 * The changes after a left-right or top-bottom flip of the plan. Straight
 * stairs keep their frame (they look the same flipped), so their left and
 * right sides trade names.
 */
export function mirrorRailingEdits(s: PlanStairs): PlanStairs["railings"] {
  if (!s.railings || s.shape !== "straight") return s.railings;
  const swap: Record<string, string> = { "f1-left": "f1-right", "f1-right": "f1-left", "well-2": "well-4", "well-4": "well-2" };
  return s.railings.map((e) => ({ ...e, edge: swap[e.edge] ?? e.edge }));
}

type Stretch = { t0: number; t1: number; wall: boolean; wallOff?: number };

/**
 * Which stretches of a plan edge run along a full-height wall (a room's or a
 * loose one, within `WALL_GAP_IN` past its half thickness and parallel), and
 * which are open. `inward` is the walking side; `wallOff` is how far the
 * wall's face is from the edge toward it (negative when it's behind).
 */
export function wallStretches(plan: FloorPlan, a: Point, b: Point, inward: Point, exteriorIn = 6.5): Stretch[] {
  const L = dist(a, b);
  const u = unit(sub(b, a));
  const hits: { t0: number; t1: number; off: number }[] = [];
  for (const p of wallPieces(plan, exteriorIn)) {
    if (p.open || p.height || p.thicknessIn <= 0) continue;
    const pu = unit(sub(p.b, p.a));
    if (Math.abs(cross(u, pu)) > 0.09) continue;
    const s = dot(sub(p.a, a), inward);
    const half = p.thicknessIn / 2;
    if (Math.abs(s) > half + WALL_GAP_IN) continue;
    const ta = dot(sub(p.a, a), u);
    const tb = dot(sub(p.b, a), u);
    const t0 = Math.max(0, Math.min(ta, tb));
    const t1 = Math.min(L, Math.max(ta, tb));
    if (t1 - t0 < 1) continue;
    hits.push({ t0, t1, off: s <= 0 ? s + half : s - half });
  }
  hits.sort((x, y) => x.t0 - y.t0);
  const out: Stretch[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.t1 <= at) continue;
    if (h.t0 > at) out.push({ t0: at, t1: h.t0, wall: false });
    const last = out[out.length - 1];
    if (last?.wall && Math.abs(last.t1 - Math.max(at, h.t0)) < 1e-6) last.t1 = h.t1;
    else out.push({ t0: Math.max(at, h.t0), t1: h.t1, wall: true, wallOff: h.off });
    at = h.t1;
  }
  if (at < L) out.push({ t0: at, t1: L, wall: false });
  return out.filter((st) => st.t1 - st.t0 >= MIN_STRETCH_IN);
}

/** Inches above a floor that stairs climb, as worked out by the caller (null: the stairs aren't built, too short a climb). */
export type RiseOf = (s: PlanStairs, fromLevelId: string) => number | null;

const insideRoom = (plan: FloorPlan | undefined, p: Point) => !!plan?.rooms.some((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon));

const guardHeight = (role: EdgeRole) => (role === "flight" || role === "middle" ? GUARD_FLIGHT_IN : GUARD_LANDING_IN);

/** How far in from the edge a railing of this kind stands (along `toward`). */
function inset(kind: RailingKind, role: EdgeRole, wallOff?: number): number {
  if (role === "middle") return 0;
  if (kind === "handrail") return Math.max(0, wallOff ?? 0) + HANDRAIL_OFF_IN;
  if (kind === "guard") return POST_IN / 2;
  return HALF_WALL_THICK_IN / 2;
}

type Raw = Omit<Railing, "key" | "a" | "b" | "auto"> & { ea: Point; eb: Point; t0: number; t1: number; L: number };

/** The automatic railings of one edge (plan coordinates), before any changes. */
function autoForEdge(base: Omit<Raw, "kind" | "t0" | "t1" | "heightIn">, plan: FloorPlan, risers: number, floorAbove: (p: Point) => boolean): Raw[] {
  const out: Raw[] = [];
  for (const st of wallStretches(plan, base.ea, base.eb, base.toward)) {
    let kind: RailingKind;
    if (st.wall) {
      if (base.role !== "flight" || risers < HANDRAIL_MIN_RISERS) continue;
      kind = "handrail";
    } else kind = "guard";
    if (base.role === "well" && !floorAbove(lerp(base.ea, base.eb, (st.t0 + st.t1) / 2 / base.L))) continue;
    out.push({ ...base, kind, t0: st.t0, t1: st.t1, heightIn: kind === "handrail" ? HANDRAIL_IN : guardHeight(base.role), ...(st.wall ? { wallOff: st.wallOff } : {}) });
  }
  return out;
}

/** Turn a stretch of an edge into a finished railing: its line set in from the edge, heights at its ends. */
function finish(r: Raw, i: number): Railing {
  const { ea, eb, t0, t1, L, ...rest } = r;
  const at = (t: number) => lerp(ea, eb, t / L);
  const off = scale(r.toward, inset(r.kind, r.role, r.wallOff));
  const zAt = (t: number) => r.za + ((r.zb - r.za) * t) / L;
  const lowAt = r.low ? (t: number) => r.low![0] + ((r.low![1] - r.low![0]) * t) / L : null;
  return {
    ...rest,
    key: `${r.stairsId}:${r.edge}${i ? `:${i}` : ""}`,
    a: add(at(t0), off),
    b: add(at(t1), off),
    za: zAt(t0),
    zb: zAt(t1),
    ...(lowAt ? { low: [lowAt(t0), lowAt(t1)] as [number, number] } : {}),
    auto: true,
  };
}

/** Apply the saved changes for one edge to its automatic stretches. `whole` is the full edge, for a railing added where there was none. */
function applyEdit(raws: Raw[], whole: Omit<Raw, "kind" | "t0" | "t1" | "heightIn">, edit: RailingEdit | undefined): { raws: Raw[]; edited: boolean } {
  if (!edit) return { raws, edited: false };
  if (edit.removed) return { raws: [], edited: true };
  let out = raws;
  if (edit.kind) {
    const wallOff = raws.find((x) => x.wallOff !== undefined)?.wallOff;
    out = [{ ...whole, kind: edit.kind, t0: 0, t1: whole.L, heightIn: edit.kind === "handrail" ? HANDRAIL_IN : guardHeight(whole.role), ...(wallOff !== undefined && edit.kind === "handrail" ? { wallOff } : {}) }];
  }
  if (edit.style) out = out.map((x) => ({ ...x, style: edit.style! }));
  return { raws: out, edited: true };
}

/**
 * Every railing built on floor `levelId`: those of the stairs on it, and the
 * guards around the holes of stairs coming up into it from below. Plans
 * should already be flat (see `flatPlans`), so curved walls count.
 */
export function railingsOn(plans: Plans, levelId: string, riseOf: RiseOf, opts: { auto?: boolean; slots?: RailingSlot[] } = {}): Railing[] {
  const plan = plans[levelId];
  if (!plan) return [];
  const out: Railing[] = [];
  const editsOf = (s: PlanStairs) => new Map((opts.auto ? [] : (s.railings ?? [])).map((e) => [e.edge, e]));

  for (const s of plan.stairs) {
    const rise = riseOf(s, levelId);
    if (rise === null) continue;
    const fr = stairsFrame(s, rise);
    const edits = editsOf(s);
    const above = s.toLevelId ? plans[s.toLevelId] : undefined;
    const footprint = fr.raw.footprint.map(fr.place);
    // Where the floor above runs over a side of the stairs, a railing under it stops at that floor.
    for (const e of stairEdges(s, rise, fr.treads, fr.riserIn)) {
      if (e.role === "opening") continue;
      const ea = fr.place(e.a);
      const eb = fr.place(e.b);
      const L = dist(ea, eb);
      if (L < MIN_STRETCH_IN) continue;
      const toward = unit(sub(fr.place(e.inward), fr.place({ x: 0, y: 0 })));
      const mid = lerp(ea, eb, 0.5);
      const out6 = add(mid, scale(toward, -6));
      const under = above && insideRoom(above, out6) && !pointInPolygon(out6, footprint);
      const whole = { stairsId: s.id, stairsLevelId: levelId, edge: e.name, role: e.role, levelId, style: "wood" as RailingStyle, za: e.za, zb: e.zb, ...(e.low ? { low: e.low } : {}), toward, ea, eb, L, ...(under ? { maxTop: rise } : {}) };
      opts.slots?.push({ key: `${s.id}:${e.name}`, stairsId: s.id, stairsLevelId: levelId, levelId, edge: e.name, role: e.role, a: ea, b: eb, za: e.za, zb: e.zb, toward });
      const auto = autoForEdge(whole, plan, fr.risers, () => true);
      const { raws, edited } = applyEdit(auto, whole, edits.get(e.name));
      raws.forEach((r, i) => out.push({ ...finish(r, i), auto: !edited }));
    }
  }

  // Stairwell guards around stairs coming up from other floors. Where this
  // floor's own stairs start over the hole (stairs stacked in one spot), that
  // side is where you step on, so it's left open
  // where those steps are low enough to step onto.
  const lowSteps = plan.stairs.flatMap((s) => {
    const rise = riseOf(s, levelId);
    return rise === null ? [] : placedSteps(s, rise).filter((st) => st.top <= STEP_ON_IN).map((st) => st.outline);
  });
  for (const [fromId, other] of Object.entries(plans)) {
    if (fromId === levelId) continue;
    for (const s of other.stairs) {
      if (s.toLevelId !== levelId) continue;
      const rise = riseOf(s, fromId);
      if (rise === null) continue;
      const edits = editsOf(s);
      for (const e of wellEdges(s, rise)) {
        if (e.role === "opening") continue;
        const L = dist(e.a, e.b);
        if (L < MIN_STRETCH_IN) continue;
        const toward = scale(e.inward, -1);
        const whole = { stairsId: s.id, stairsLevelId: fromId, edge: e.name, role: e.role, levelId, style: "wood" as RailingStyle, za: 0, zb: 0, toward, ea: e.a, eb: e.b, L };
        opts.slots?.push({ key: `${s.id}:${e.name}`, stairsId: s.id, stairsLevelId: fromId, levelId, edge: e.name, role: e.role, a: e.a, b: e.b, za: 0, zb: 0, toward });
        const open = (p: Point) => insideRoom(plan, add(p, scale(toward, 6))) && !lowSteps.some((o) => pointInPolygon(add(p, scale(toward, -6)), o));
        const auto = autoForEdge(whole, plan, 0, open);
        const { raws, edited } = applyEdit(auto, whole, edits.get(e.name));
        raws.forEach((r, i) => out.push({ ...finish(r, i), auto: !edited }));
      }
    }
  }
  return out;
}

/** The automatic railings alone, with no changes applied. */
export function autoRailings(plans: Plans, levelId: string, riseOf: RiseOf): Railing[] {
  return railingsOn(plans, levelId, riseOf, { auto: true });
}

/** Railings with Grant's changes applied (the same as `railingsOn`). */
export const railingsFor = railingsOn;

/** The bottom and top of a railing `t` (0 to 1) along it, inches above its floor. */
export function railingAt(r: Railing, t: number): { bottom: number; top: number } {
  const bottom = r.za + (r.zb - r.za) * t;
  const top = bottom + r.heightIn;
  return { bottom, top: r.maxTop !== undefined ? Math.min(top, r.maxTop) : top };
}

/** Change one edge's railing on the stairs: merge a change into its saved edit (an empty change clears it). */
export function editRailing(s: PlanStairs, edge: string, change: Omit<RailingEdit, "edge"> | null): PlanStairs {
  const rest = (s.railings ?? []).filter((e) => e.edge !== edge);
  const next = change ? [...rest, { edge, ...change }] : rest;
  return next.length ? { ...s, railings: next } : withoutEdits(s);
}

/** Put every railing of the stairs back to automatic. */
export function resetRailings(s: PlanStairs): PlanStairs {
  return withoutEdits(s);
}

function withoutEdits(s: PlanStairs): PlanStairs {
  const clean = { ...s };
  delete clean.railings;
  return clean;
}

/** Every side where a railing could stand on this floor but none does now (removed, or never needed): "Add railing here". */
export function bareSlots(plans: Plans, levelId: string, riseOf: RiseOf): { railings: Railing[]; bare: RailingSlot[] } {
  const slots: RailingSlot[] = [];
  const railings = railingsOn(plans, levelId, riseOf, { slots });
  const has = new Set(railings.map((r) => `${r.stairsId}:${r.edge}`));
  return { railings, bare: slots.filter((x) => !has.has(x.key)) };
}

export const RAILING_KINDS: { kind: RailingKind; label: string; note: string }[] = [
  { kind: "guard", label: "Railing with balusters", note: "Open at the side, 34\" along stairs and 36\" at landings." },
  { kind: "handrail", label: "Handrail on wall", note: "Mounted on the wall beside the stairs. Doesn't block you." },
  { kind: "half-wall", label: "Half wall", note: "A low stud wall with a wood cap." },
  { kind: "wall", label: "Full wall", note: "Floor to ceiling. Closes this side in." },
];

export const RAILING_STYLES: { style: RailingStyle; label: string }[] = [
  { style: "wood", label: "Wood with white balusters" },
  { style: "metal", label: "Black metal" },
  { style: "glass", label: "Glass" },
];

export const railingKindLabel = (kind: RailingKind) => RAILING_KINDS.find((k) => k.kind === kind)?.label ?? kind;

/** Short names for the PDF and the walkthrough. */
export const railingShortName = (r: Pick<Railing, "kind" | "heightIn">) =>
  r.kind === "guard" ? `GUARD ${Math.round(r.heightIn)}"` : r.kind === "handrail" ? "HANDRAIL" : r.kind === "half-wall" ? "HALF WALL" : "WALL";

/** One change to an edge's railing, merged into what was already saved for it (adding one clears a removal). */
export function changeRailing(s: PlanStairs, edge: string, change: { kind?: RailingKind; style?: RailingStyle }): PlanStairs {
  const was = (s.railings ?? []).find((e) => e.edge === edge);
  const { removed: _removed, ...rest } = was ?? { edge };
  void _removed;
  return editRailing(s, edge, { ...rest, ...change });
}

/** Take the railing off an edge (and keep it off when the stairs move). */
export function removeRailing(s: PlanStairs, edge: string): PlanStairs {
  return editRailing(s, edge, { removed: true });
}

/** Back to what the app would do on its own for this edge. */
export function autoRailing(s: PlanStairs, edge: string): PlanStairs {
  return editRailing(s, edge, null);
}

const KIND_PHRASE: Record<RailingKind, string> = { guard: "a railing with balusters", handrail: "a handrail on the wall", "half-wall": "a half wall", wall: "a full wall" };
const STYLE_PHRASE: Record<RailingStyle, string> = { wood: "wood", metal: "black metal", glass: "glass" };

/** How the railing on an edge was changed between two versions of the stairs, for the undo label (null when it isn't a single edge). */
export function describeRailingEdit(was: PlanStairs, now: PlanStairs): string | null {
  const a = new Map((was.railings ?? []).map((e) => [e.edge, e]));
  const b = new Map((now.railings ?? []).map((e) => [e.edge, e]));
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k)));
  if (changed.length !== 1) return null;
  const [x, y] = [a.get(changed[0]), b.get(changed[0])];
  if (!y) return "put a railing back to automatic";
  if (y.removed) return "remove a railing";
  // Adding a railing where there is none saves its kind and look together; changing an existing one starts with just the kind or the look.
  if (x?.removed || (!x && y.kind && y.style)) return "add a railing";
  if (y.kind && y.kind !== x?.kind) return `change a railing to ${KIND_PHRASE[y.kind]}`;
  if (y.style && y.style !== x?.style) return `change a railing to ${STYLE_PHRASE[y.style]}`;
  return null;
}

/** Feet of each kind of railing, for the cost: guards by look, half walls, full walls, and wall-mounted handrails. */
export function railingLengths(rs: Railing[]): { guard: Record<RailingStyle, number>; halfWall: number; wall: number; handrail: number } {
  const out = { guard: { wood: 0, metal: 0, glass: 0 }, halfWall: 0, wall: 0, handrail: 0 };
  for (const r of rs) {
    const ft = dist(r.a, r.b) / 12;
    if (r.kind === "guard") out.guard[r.style] += ft;
    else if (r.kind === "half-wall") out.halfWall += ft;
    else if (r.kind === "wall") out.wall += ft;
    else out.handrail += ft;
  }
  return out;
}
