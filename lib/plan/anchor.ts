import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { FloorPlan, Level, PlanBasics, PlanRoom, PlanStairs, Point } from "@/lib/model/schema";
import { cleanRing } from "@/lib/house3d/footprint";
import { riseBetween } from "./basics";
import { makeRoom, newPlanId, planOf, reshapeRoom, type Plans } from "./edit";
import { add, clockwise, dist, polygonArea, polygonCenter, polygonsOverlap, rotate, roundPoint, sub } from "./geometry";
import { closeGap, findGaps, trimOverlap } from "./overlaps";
import { HALL_CURVE_NOTE as HALL_CURVE, LOCKED_HALL_NOTE as LOCKED_HALL, LOCKED_STAIRS_NOTE as LOCKED_STAIRS } from "./locks";
import { stairsFrame, stairsDrawing } from "./stairs";

/**
 * Stair stacks and anchoring. A stack is one set of stairs climbing through
 * the house (stairs on each floor whose footprints overlap, linked by
 * `PlanStairs.stackId`) plus one stair hall per floor it touches (a room with
 * `stairStack` set). The halls share one outline on every floor, no bigger
 * than `hallLimit` (the stairs plus 3' past the bottom and top of each flight)
 * and never cutting into the stairs (`hallFloor`).
 *
 * Anchored stacks are locked (see lib/plan/locks.ts) except for the stair
 * hall's walls. Unanchored stacks still move, turn and flip together on every
 * floor. `reconcileStacks` runs after every floor plan edit and keeps all
 * that true.
 */

export type StackCtx = { levels: Level[]; basics: PlanBasics | null };

/** Standing room past the bottom and the top of each flight (Grant's 4a: 3'). */
export const HALL_REACH_IN = 36;

export type Flight = { levelId: string; stairs: PlanStairs };

const levelById = (ctx: StackCtx, id: string) => ctx.levels.find((l) => l.id === id);

/** How far these stairs climb (a regular floor when the floor above is missing). */
export function riseOf(ctx: StackCtx, levelId: string, s: Pick<PlanStairs, "toLevelId">): number {
  const from = levelById(ctx, levelId);
  const to = s.toLevelId ? levelById(ctx, s.toLevelId) : undefined;
  return from && to ? riseBetween(ctx.basics, from, to) : 108 + 13;
}

export const footprintOf = (ctx: StackCtx, f: Flight): Point[] => stairsDrawing(f.stairs, riseOf(ctx, f.levelId, f.stairs)).footprint;

/** Every flight of a stack, lowest floor first. */
export function flightsOf(plans: Plans, ctx: StackCtx, stackId: string): Flight[] {
  const out: Flight[] = [];
  for (const [levelId, p] of Object.entries(plans)) for (const s of p.stairs) if (s.stackId === stackId) out.push({ levelId, stairs: s });
  const z = (id: string) => levelById(ctx, id)?.elevationIn ?? 0;
  return out.sort((a, b) => z(a.levelId) - z(b.levelId));
}

/** The floors a stack touches: where its stairs start and where they arrive, lowest first. */
export function floorsOf(plans: Plans, ctx: StackCtx, stackId: string): string[] {
  const ids = new Set<string>();
  for (const f of flightsOf(plans, ctx, stackId)) {
    ids.add(f.levelId);
    if (f.stairs.toLevelId && levelById(ctx, f.stairs.toLevelId)) ids.add(f.stairs.toLevelId);
  }
  for (const [levelId, p] of Object.entries(plans)) if (p.rooms.some((r) => r.stairStack === stackId)) ids.add(levelId);
  const z = (id: string) => levelById(ctx, id)?.elevationIn ?? 0;
  return [...ids].sort((a, b) => z(a) - z(b));
}

/** Every stack id used on any floor. */
export function stackIds(plans: Plans): string[] {
  const ids = new Set<string>();
  for (const p of Object.values(plans)) {
    for (const s of p.stairs) if (s.stackId) ids.add(s.stackId);
    for (const r of p.rooms) if (r.stairStack) ids.add(r.stairStack);
  }
  return [...ids];
}

export const isAnchored = (plans: Plans, stackId: string): boolean =>
  Object.values(plans).some((p) => p.stairs.some((s) => s.stackId === stackId && s.anchored));

/** The stair hall of a stack on one floor. */
export const hallOn = (plan: FloorPlan, stackId: string): PlanRoom | undefined => plan.rooms.find((r) => r.stairStack === stackId);

/** One flight's footprint plus a strip the width of the stairs past its bottom and top step, in plan coordinates. */
function flightReach(ctx: StackCtx, f: Flight): Point[] {
  const { raw, place } = stairsFrame(f.stairs, riseOf(ctx, f.levelId, f.stairs));
  const w = f.stairs.widthIn;
  const strip = (at: Point, dir: Point): Point[] => {
    const l = Math.hypot(dir.x, dir.y) || 1;
    const u = { x: dir.x / l, y: dir.y / l };
    const side = { x: -u.y * (w / 2), y: u.x * (w / 2) };
    const far = add(at, { x: u.x * HALL_REACH_IN, y: u.y * HALL_REACH_IN });
    return [add(at, side), sub(at, side), add(far, side), sub(far, side)];
  };
  const a = raw.arrow;
  const pts = [...raw.footprint, ...strip(a[0], sub(a[0], a[1])), ...strip(a[a.length - 1], sub(a[a.length - 1], a[a.length - 2]))];
  return pts.map(place);
}

/**
 * The biggest outline a stack's stair hall may have (4a): one rectangle
 * around every flight's footprint and the 3' of standing room past the bottom
 * and top of each flight, lined up with the lowest flight. The same on every floor (3a).
 */
export function hallLimit(plans: Plans, ctx: StackCtx, stackId: string): Point[] | null {
  const flights = flightsOf(plans, ctx, stackId);
  if (!flights.length) return null;
  const turn = flights[0].stairs.rotation ?? 0;
  const pts = flights.flatMap((f) => flightReach(ctx, f)).map((p) => rotate(p, -turn));
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const box = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return clockwise(box.map((p) => roundPoint(rotate(p, turn))));
}

const ring = (poly: Point[]): Polygon => [[...poly.map((p): [number, number] => [p.x, p.y]), [poly[0].x, poly[0].y]]];

/** The biggest piece's outline, cleaned and clockwise. */
function biggest(mp: MultiPolygon): Point[] | null {
  let best: Point[] | null = null;
  for (const poly of mp) {
    const pts = cleanRing(poly[0].slice(0, -1).map(([x, y]) => ({ x, y })), 0.25);
    if (pts.length >= 3 && (!best || polygonArea(pts) > polygonArea(best))) best = pts;
  }
  return best ? clockwise(best.map(roundPoint)) : null;
}

/** The smallest outline a stair hall may have: the stairs themselves (and so the stairwell above them). A wall can't cut into them. */
export function hallFloor(plans: Plans, ctx: StackCtx, stackId: string): Point[] | null {
  const prints = flightsOf(plans, ctx, stackId).map((f) => ring(footprintOf(ctx, f)));
  if (!prints.length) return null;
  return biggest(polygonClipping.union(prints[0], ...prints.slice(1)));
}

/** An outline kept between the floor (the stairs) and the limit. */
export function clampOutline(outline: Point[], limit: Point[], floor: Point[] | null): Point[] {
  const inside = polygonClipping.intersection(ring(outline), ring(limit));
  const kept = floor ? polygonClipping.union(ring(floor), ...inside) : inside;
  return biggest(kept) ?? limit;
}

/** Area of what's in one outline and not the other, both ways (sq in). */
function differenceArea(a: Point[], b: Point[]): number {
  const xor = polygonClipping.xor(ring(a), ring(b));
  return xor.reduce((s, poly) => s + polygonArea(poly[0].slice(0, -1).map(([x, y]) => ({ x, y }))) - poly.slice(1).reduce((h, r) => h + polygonArea(r.slice(0, -1).map(([x, y]) => ({ x, y }))), 0), 0);
}

const sameShape = (a: Point[], b: Point[]) => differenceArea(a, b) < 2;

/** How much of `poly` covers `of` (0 to 1). */
function coverage(poly: Point[], of: Point[]): number {
  const area = polygonArea(of);
  if (!area) return 0;
  const hit = polygonClipping.intersection(ring(poly), ring(of));
  return hit.reduce((s, p) => s + polygonArea(p[0].slice(0, -1).map(([x, y]) => ({ x, y }))), 0) / area;
}

/** The stairs on other floors that overlap these: the ones below arriving on this floor, and the ones on the floor these climb to. */
export function stackFrom(plans: Plans, ctx: StackCtx, levelId: string, stairsId: string): Flight[] {
  const start = planOf(plans, levelId).stairs.find((s) => s.id === stairsId);
  if (!start) return [];
  const found: Flight[] = [{ levelId, stairs: start }];
  const seen = new Set([stairsId]);
  for (let k = 0; k < found.length; k++) {
    const f = found[k];
    const print = footprintOf(ctx, f);
    for (const [lid, p] of Object.entries(plans)) {
      for (const s of p.stairs) {
        if (seen.has(s.id)) continue;
        const sameStack = !!f.stairs.stackId && s.stackId === f.stairs.stackId;
        const above = lid === f.stairs.toLevelId;
        const below = s.toLevelId === f.levelId;
        if (!sameStack && !((above || below) && polygonsOverlap(print, footprintOf(ctx, { levelId: lid, stairs: s })))) continue;
        seen.add(s.id);
        found.push({ levelId: lid, stairs: s });
      }
    }
  }
  return found;
}

/** A room on this floor that already serves as the stair hall: the stack's own, or a hall that holds most of the stairs (or the stairwell). */
function existingHall(plan: FloorPlan, stackId: string, floor: Point[]): PlanRoom | undefined {
  return hallOn(plan, stackId) ?? plan.rooms.find((r) => !r.stairStack && r.type === "hall" && coverage(r.polygon, floor) > 0.5);
}

/**
 * Give the stair hall on one floor this outline, keeping its doors and
 * windows near where they were. A floor without one gets a new "Stair hall".
 * Other rooms in the way are trimmed back around it.
 */
function setHall(plan: FloorPlan, stackId: string, outline: Point[], anchored: boolean, floor: Point[]): { plan: FloorPlan; trimmed: string[]; made: boolean } {
  const have = existingHall(plan, stackId, floor);
  let next: FloorPlan;
  let id: string;
  if (have) {
    id = have.id;
    const sameOutline = have.polygon.length === outline.length && sameShape(have.polygon, outline) && !have.bulges?.some(Boolean);
    next = sameOutline ? plan : reshapeRoom(plan, id, outline, []);
    next = { ...next, rooms: next.rooms.map((r) => (r.id === id ? withStack(r, stackId, anchored) : r)) };
  } else {
    const room = withStack(makeRoom(outline, "Stair hall", { type: "hall" }), stackId, anchored);
    id = room.id;
    next = { ...plan, rooms: [...plan.rooms, room] };
  }
  const fit = trimOverlap(next, [id]);
  next = fit.plan;
  const trimmed = fit.trims.map((t) => t.roomId);
  // A room the hall sits in the middle of can't just be trimmed (it would have a hole): open it to its nearest wall.
  const hall = next.rooms.find((r) => r.id === id)!;
  for (const r of next.rooms) {
    if (r.id === id || r.anchored || !polygonsOverlap(r.polygon, hall.polygon)) continue;
    const cut = notchAround(r.polygon, hall.polygon);
    if (!cut) continue;
    next = reshapeRoom(next, r.id, cut, []);
    trimmed.push(r.id);
  }
  return { plan: next, trimmed, made: !have };
}

/**
 * A room with the hall cut out, when the hall sits inside it: the cut runs
 * on from the hall to the room's nearest outside wall, so what's left is one
 * outline (wrapped around the hall) instead of a room with a hole.
 */
function notchAround(room: Point[], hall: Point[]): Point[] | null {
  const turn = (Math.atan2(hall[1].y - hall[0].y, hall[1].x - hall[0].x) * 180) / Math.PI;
  const r = room.map((p) => rotate(p, -turn));
  const h = hall.map((p) => rotate(p, -turn));
  const xs = (ps: Point[]) => ps.map((p) => p.x);
  const ys = (ps: Point[]) => ps.map((p) => p.y);
  const [hx0, hx1, hy0, hy1] = [Math.min(...xs(h)), Math.max(...xs(h)), Math.min(...ys(h)), Math.max(...ys(h))];
  const [rx0, rx1, ry0, ry1] = [Math.min(...xs(r)) - 1, Math.max(...xs(r)) + 1, Math.min(...ys(r)) - 1, Math.max(...ys(r)) + 1];
  const strips = [
    { len: hx0 - rx0, box: [rx0, hy0, hx0, hy1] },
    { len: rx1 - hx1, box: [hx1, hy0, rx1, hy1] },
    { len: hy0 - ry0, box: [hx0, ry0, hx1, hy0] },
    { len: ry1 - hy1, box: [hx0, hy1, hx1, ry1] },
  ].sort((a, b) => a.len - b.len);
  for (const { box: [x0, y0, x1, y1] } of strips) {
    const strip = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const out = polygonClipping.difference(ring(r), ring(h), ring(strip));
    if (out.length !== 1 || out[0].length !== 1) continue;
    const pts = cleanRing(out[0][0].slice(0, -1).map(([x, y]) => ({ x, y })), 0.25);
    if (pts.length < 3 || polygonArea(pts) < 24 * 24) continue;
    return clockwise(pts.map((p) => roundPoint(rotate(p, turn))));
  }
  return null;
}

function withStack(r: PlanRoom, stackId: string, anchored: boolean): PlanRoom {
  const { bulges: _b, anchored: _a, ...rest } = r;
  void _b;
  void _a;
  return { ...rest, stairStack: stackId, ...(anchored ? { anchored: true } : {}) };
}

/** Rooms a few inches off the stair hall move up against it, so it can still have a door. */
function closeHallGaps(plan: FloorPlan, hallId: string): FloorPlan {
  let next = plan;
  for (let k = 0; k < 4; k++) {
    const gap = findGaps(next).find((g) => g.aId === hallId || g.bId === hallId);
    if (!gap) break;
    const after = closeGap(next, gap);
    if (after === next) break;
    next = after;
  }
  return next;
}

/** Write one outline to the stack's stair hall on every floor of the stack. */
export function syncHall(plans: Plans, ctx: StackCtx, stackId: string, outline: Point[], skip?: string): Plans {
  const anchored = isAnchored(plans, stackId);
  const floor = hallFloor(plans, ctx, stackId) ?? outline;
  let next = plans;
  for (const levelId of floorsOf(plans, ctx, stackId)) {
    if (levelId === skip) continue;
    const plan = planOf(next, levelId);
    const hall = hallOn(plan, stackId);
    if (!hall) continue;
    if (hall.polygon.length === outline.length && sameShape(hall.polygon, outline)) continue;
    next = { ...next, [levelId]: setHall(plan, stackId, outline, anchored, floor).plan };
  }
  return next;
}

export type AnchorResult = { plans: Plans; stackId: string; note: string };

/**
 * The Anchor button: link these stairs with the stairs that overlap them on
 * the floors above and below, lock them, and give every floor of the stack
 * a stair hall with the same outline. The stairs don't move.
 */
export function anchor(plans: Plans, ctx: StackCtx, levelId: string, stairsId: string): AnchorResult | null {
  const flights = stackFrom(plans, ctx, levelId, stairsId);
  if (!flights.length) return null;
  const stackId = flights.find((f) => f.stairs.stackId)?.stairs.stackId ?? newPlanId("stack");
  const ids = new Set(flights.map((f) => f.stairs.id));
  let next: Plans = { ...plans };
  for (const lid of new Set(flights.map((f) => f.levelId))) {
    const p = planOf(next, lid);
    next[lid] = { ...p, stairs: p.stairs.map((s) => (ids.has(s.id) ? { ...s, stackId, anchored: true } : s)) };
  }
  const limit = hallLimit(next, ctx, stackId)!;
  const floor = hallFloor(next, ctx, stackId);
  const floors = floorsOf(next, ctx, stackId);
  // The first stair hall found (lowest floor first) sets the outline, cut down to the limit.
  let outline = limit;
  for (const lid of floors) {
    const have = existingHall(planOf(next, lid), stackId, floor ?? limit);
    if (have) {
      outline = clampOutline(have.polygon, limit, floor);
      break;
    }
  }
  const trimmed: { levelId: string; name: string }[] = [];
  for (const lid of floors) {
    const before = planOf(next, lid);
    const set = setHall(before, stackId, outline, true, floor ?? outline);
    const hall = hallOn(set.plan, stackId)!;
    for (const id of set.trimmed) trimmed.push({ levelId: lid, name: before.rooms.find((r) => r.id === id)?.name ?? "a room" });
    next = { ...next, [lid]: closeHallGaps(set.plan, hall.id) };
  }
  const where = (id: string) => (levelById(ctx, id)?.name ?? "").toLowerCase();
  const note = trimmed.length
    ? `Anchored the stairs. Made room for the stair hall in the ${trimmed[0].name}${where(trimmed[0].levelId) ? ` (${where(trimmed[0].levelId)})` : ""}${trimmed.length > 1 ? ` and ${trimmed.length - 1} more` : ""}. Undo puts it back.`
    : "Anchored the stairs and their stair halls on every floor.";
  return { plans: next, stackId, note };
}

/** The Unanchor button: free the stairs and stair halls. They stay one stack, so they still move together. */
export function unanchor(plans: Plans, stackId: string): Plans {
  const next: Plans = {};
  for (const [lid, p] of Object.entries(plans)) {
    const touches = p.stairs.some((s) => s.stackId === stackId) || p.rooms.some((r) => r.stairStack === stackId);
    if (!touches) {
      next[lid] = p;
      continue;
    }
    next[lid] = {
      ...p,
      stairs: p.stairs.map((s) => (s.stackId === stackId && s.anchored ? stripAnchor(s) : s)),
      rooms: p.rooms.map((r) => (r.stairStack === stackId && r.anchored ? stripAnchor(r) : r)),
    };
  }
  return next;
}

function stripAnchor<T extends { anchored?: boolean }>(x: T): T {
  const { anchored: _a, ...rest } = x;
  void _a;
  return rest as T;
}

/** The stack that stairs or a stair hall on this floor belong to. */
export function stackOfItem(plan: FloorPlan, id: string): string | null {
  return plan.stairs.find((s) => s.id === id)?.stackId ?? plan.rooms.find((r) => r.id === id)?.stairStack ?? null;
}

/** Re-fit every stack's stair halls to its limit (after the stairs change shape or size). */
export function refitHalls(plans: Plans, ctx: StackCtx, only?: string[]): Plans {
  let next = plans;
  for (const id of only ?? stackIds(plans)) next = refitStack(next, ctx, id);
  return next;
}

function refitStack(plans: Plans, ctx: StackCtx, stackId: string, levelId?: string): Plans {
  const limit = hallLimit(plans, ctx, stackId);
  if (!limit) return freeHalls(plans, stackId);
  const floor = hallFloor(plans, ctx, stackId);
  const first = (levelId && hallOn(planOf(plans, levelId), stackId)) || floorsOf(plans, ctx, stackId).map((l) => hallOn(planOf(plans, l), stackId)).find(Boolean);
  if (!first) return plans;
  const outline = clampOutline(first.polygon, limit, floor);
  const keep = sameShape(outline, first.polygon) ? first.polygon : outline;
  return syncHall(plans, ctx, stackId, keep);
}

/** No stairs left in a stack: its stair halls become ordinary halls. */
function freeHalls(plans: Plans, stackId: string): Plans {
  const next: Plans = {};
  for (const [lid, p] of Object.entries(plans)) {
    next[lid] = p.rooms.some((r) => r.stairStack === stackId)
      ? { ...p, rooms: p.rooms.map((r) => (r.stairStack === stackId ? (({ stairStack: _s, anchored: _a, ...rest }) => (void _s, void _a, rest))(r) : r)) }
      : p;
  }
  return next;
}

/** A rigid move (turn + shift) worked out from one thing before and after. */
type Motion = { from: Point; to: Point; deg: number; flip: boolean };

const moveBy = (m: Motion, p: Point): Point => roundPoint(add(m.to, rotate(sub(p, m.from), m.deg)));
const turnBy = (m: Motion, r: number) => ((((Math.round((r + m.deg) * 10) / 10) % 360) + 360) % 360);

/** If `b` is `a` turned and shifted (same corners, same distances), how; null when it changed shape. */
function rigidMotion(a: Point[], b: Point[]): Motion | null {
  if (a.length !== b.length || a.length < 2) return null;
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    if (Math.abs(dist(a[i], a[j]) - dist(b[i], b[j])) > 0.5) return null;
  }
  const angle = (p: Point, q: Point) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  const deg = angle(b[0], b[1]) - angle(a[0], a[1]);
  const m: Motion = { from: polygonCenter(a), to: polygonCenter(b), deg: Math.round(deg * 10) / 10, flip: false };
  if (a.some((p, i) => dist(moveBy(m, p), b[i]) > 1)) return null;
  return m;
}

const GEOMETRY: (keyof PlanStairs)[] = ["x", "y", "rotation", "widthIn", "shape", "flip", "toLevelId"];
const sameGeometry = (a: PlanStairs, b: PlanStairs) => GEOMETRY.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Move every member of a stack the same way, on every floor, except what's in `done` (already moved by the edit). */
function moveStack(plans: Plans, before: Plans, stackId: string, m: Motion, done: Set<string>): Plans {
  const next: Plans = { ...plans };
  for (const [lid, p] of Object.entries(plans)) {
    const was = planOf(before, lid);
    if (!p.stairs.some((s) => s.stackId === stackId) && !p.rooms.some((r) => r.stairStack === stackId)) continue;
    let plan: FloorPlan = {
      ...p,
      stairs: p.stairs.map((s) => {
        if (s.stackId !== stackId || done.has(s.id)) return s;
        const o = was.stairs.find((x) => x.id === s.id) ?? s;
        return { ...s, ...moveBy(m, o), rotation: turnBy(m, o.rotation), flip: m.flip && o.shape === "l" ? !o.flip : o.flip };
      }),
    };
    for (const r of p.rooms) {
      if (r.stairStack !== stackId || done.has(r.id)) continue;
      const o = was.rooms.find((x) => x.id === r.id) ?? r;
      plan = reshapeRoom(plan, r.id, o.polygon.map((q) => moveBy(m, q)), []);
    }
    next[lid] = plan;
  }
  return next;
}

export type Reconciled = { plans: Plans; note: string | null };

/**
 * After an edit to one floor, keep every stack whole: anchored stairs and
 * halls stay put (a stair hall's walls may move, within its limits, and the
 * change goes to every floor), unanchored stacks follow their stairs or
 * hall on every floor, and halls re-fit when the stairs change size.
 */
export function reconcileStacks(before: Plans, after: Plans, levelId: string, ctx: StackCtx): Reconciled {
  const a = planOf(before, levelId);
  const b = planOf(after, levelId);
  if (a === b) return { plans: after, note: null };
  const ids = new Set([...a.stairs.map((s) => s.stackId), ...a.rooms.map((r) => r.stairStack), ...b.stairs.map((s) => s.stackId), ...b.rooms.map((r) => r.stairStack)].filter((x): x is string => !!x));
  let plans = after;
  let note: string | null = null;
  for (const stackId of ids) {
    const r = reconcileOne(before, plans, levelId, ctx, stackId);
    plans = r.plans;
    note = note ?? r.note;
  }
  return { plans, note };
}

function reconcileOne(before: Plans, after: Plans, levelId: string, ctx: StackCtx, stackId: string): Reconciled {
  const a = planOf(before, levelId);
  let b = planOf(after, levelId);
  let plans = after;
  const anchored = isAnchored(before, stackId);
  let note: string | null = null;
  const hallA = hallOn(a, stackId);
  const stairsA = a.stairs.filter((s) => s.stackId === stackId);

  if (anchored) {
    // Anchored stairs keep their place, size and shape (railings can change); deleted ones come back.
    let restored = false;
    const stairs = b.stairs.map((s) => {
      const was = stairsA.find((x) => x.id === s.id);
      if (!was || !was.anchored || sameGeometry(was, s)) return s;
      restored = true;
      return { ...s, ...Object.fromEntries(GEOMETRY.map((k) => [k, was[k]])) } as PlanStairs;
    });
    const gone = stairsA.filter((s) => s.anchored && !b.stairs.some((x) => x.id === s.id));
    if (restored || gone.length) {
      b = { ...b, stairs: [...stairs, ...gone] };
      note = LOCKED_STAIRS;
    }
    if (hallA?.anchored && !b.rooms.some((r) => r.id === hallA.id)) {
      b = { ...b, rooms: [...b.rooms, hallA] };
      note = note ?? LOCKED_HALL;
    }
    plans = { ...plans, [levelId]: b };
  } else {
    // A stack that's free moves together: follow the stairs that moved, or else the stair hall.
    const movedStairs = stairsA.map((s) => ({ was: s, now: b.stairs.find((x) => x.id === s.id) })).find(({ was, now }) => now && (was.x !== now.x || was.y !== now.y || was.rotation !== now.rotation || was.flip !== now.flip) && was.widthIn === now.widthIn && was.shape === now.shape);
    if (movedStairs?.now) {
      const { was, now } = movedStairs;
      const m: Motion = { from: { x: was.x, y: was.y }, to: { x: now.x, y: now.y }, deg: Math.round((now.rotation - was.rotation) * 10) / 10, flip: was.flip !== now.flip };
      if (m.flip) m.deg = 0;
      const done = new Set([now.id]);
      const hallB = hallA && hallOn(b, stackId);
      if (hallA && hallB && hallB.polygon !== hallA.polygon) {
        // Moved with the stairs (picked together): leave the hall where the edit put it.
        const hm = rigidMotion(hallA.polygon, hallB.polygon);
        if (hm && dist(moveBy(m, polygonCenter(hallA.polygon)), hallB.polygon.length ? polygonCenter(hallB.polygon) : { x: 0, y: 0 }) < 2) done.add(hallB.id);
      }
      plans = moveStack(plans, before, stackId, m, done);
      return { plans: refitStack(plans, ctx, stackId, levelId), note: null };
    }
    const hallB = hallA ? hallOn(b, stackId) : undefined;
    if (hallA && hallB && hallA.polygon !== hallB.polygon && !b.stairs.some((s) => s.stackId === stackId && stairsA.some((w) => w.id === s.id && !sameGeometry(w, s)))) {
      const m = rigidMotion(hallA.polygon, hallB.polygon);
      if (m && (dist(m.from, m.to) > 0.05 || Math.abs(m.deg) > 0.05)) return { plans: moveStack(plans, before, stackId, m, new Set([hallB.id])), note: null };
    }
  }

  // The stairs changed size or shape (or a flight went): the halls re-fit.
  const resized = stairsA.some((s) => {
    const now = b.stairs.find((x) => x.id === s.id);
    return !now || !sameGeometry(s, now);
  }) || b.stairs.some((s) => s.stackId === stackId && !stairsA.some((x) => x.id === s.id));
  if (resized) return { plans: refitStack(plans, ctx, stackId, levelId), note };

  // A stair hall wall moved: keep it between the stairs and the limit, on every floor.
  const hallB = hallA ? hallOn(b, stackId) : undefined;
  if (hallA && hallB && (hallA.polygon !== hallB.polygon || hallB.bulges?.some(Boolean))) {
    if (anchored && rigidMotion(hallA.polygon, hallB.polygon) && !sameShape(hallA.polygon, hallB.polygon)) {
      // Dragged as a whole: anchored halls stay put.
      b = reshapeRoom(b, hallB.id, hallA.polygon, []);
      return { plans: { ...plans, [levelId]: b }, note: LOCKED_HALL };
    }
    if (hallB.bulges?.some(Boolean)) {
      b = { ...b, rooms: b.rooms.map((r) => (r.id === hallB.id ? withStack(r, stackId, anchored) : r)) };
      plans = { ...plans, [levelId]: b };
      note = HALL_CURVE;
    }
    const cur = hallOn(b, stackId)!;
    // Same space, new corners (a wall split or combined): that's this floor's own business.
    if (sameShape(hallA.polygon, cur.polygon)) return { plans, note };
    const limit = hallLimit(plans, ctx, stackId);
    if (!limit) return { plans, note };
    const floor = hallFloor(plans, ctx, stackId);
    const clamped = clampOutline(cur.polygon, limit, floor);
    const outline = sameShape(clamped, cur.polygon) ? cur.polygon : clamped;
    if (outline !== cur.polygon) {
      b = reshapeRoom(b, cur.id, outline, []);
      plans = { ...plans, [levelId]: b };
      note = note ?? "The stair hall can't be bigger than the stairs plus 3' at each end, or cut into the stairs.";
    }
    return { plans: syncHall(plans, ctx, stackId, outline, levelId), note };
  }
  return { plans, note };
}
