import type { FloorPlan, Level, PlanBasics, PlanStairs, Point } from "@/lib/model/schema";
import { riseBetween } from "./basics";
import { newPlanId, planOf, type Plans } from "./edit";
import { add, polygonsOverlap, rotate, roundPoint, sub } from "./geometry";
import { LOCKED_STAIRS_NOTE as LOCKED_STAIRS } from "./locks";
import { stairsDrawing } from "./stairs";

/**
 * Stair stacks and anchoring. A stack is one set of stairs climbing through
 * the house (stairs on each floor whose footprints overlap, linked by
 * `PlanStairs.stackId`). Anchoring locks the stack's stairs (see
 * lib/plan/locks.ts) and changes nothing else: no room or wall on any floor.
 * Unanchored stacks still move, turn and flip together on every floor.
 * `reconcileStacks` runs after every floor plan edit and keeps that true.
 */

export type StackCtx = { levels: Level[]; basics: PlanBasics | null };

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

/** Every stack id used on any floor. */
export function stackIds(plans: Plans): string[] {
  const ids = new Set<string>();
  for (const p of Object.values(plans)) {
    for (const s of p.stairs) if (s.stackId) ids.add(s.stackId);
  }
  return [...ids];
}

export const isAnchored = (plans: Plans, stackId: string): boolean =>
  Object.values(plans).some((p) => p.stairs.some((s) => s.stackId === stackId && s.anchored));

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

/** Link every set of overlapping stairs into a stack and anchor it, without touching rooms (used by Suggest a plan). */
export function linkStacks(plans: Plans, ctx: StackCtx): Plans {
  const next: Plans = { ...plans };
  for (const [levelId, p] of Object.entries(plans)) {
    for (const s of p.stairs) {
      if (planOf(next, levelId).stairs.find((x) => x.id === s.id)?.stackId) continue;
      const flights = stackFrom(next, ctx, levelId, s.id);
      const stackId = flights.find((f) => f.stairs.stackId)?.stairs.stackId ?? newPlanId("stack");
      const ids = new Set(flights.map((f) => f.stairs.id));
      for (const lid of new Set(flights.map((f) => f.levelId))) {
        const q = planOf(next, lid);
        next[lid] = { ...q, stairs: q.stairs.map((x) => (ids.has(x.id) ? { ...x, stackId, anchored: true } : x)) };
      }
    }
  }
  return next;
}

export type AnchorResult = { plans: Plans; stackId: string; note: string };

/**
 * The Anchor button: link these stairs with the stairs that overlap them on
 * the floors above and below, and lock them. The stairs don't move, and no
 * room or wall changes on any floor.
 */
export function anchor(plans: Plans, ctx: StackCtx, levelId: string, stairsId: string): AnchorResult | null {
  const flights = stackFrom(plans, ctx, levelId, stairsId);
  if (!flights.length) return null;
  const stackId = flights.find((f) => f.stairs.stackId)?.stairs.stackId ?? newPlanId("stack");
  const ids = new Set(flights.map((f) => f.stairs.id));
  const floors = new Set(flights.map((f) => f.levelId));
  const next: Plans = { ...plans };
  for (const lid of floors) {
    const p = planOf(next, lid);
    next[lid] = { ...p, stairs: p.stairs.map((s) => (ids.has(s.id) ? { ...s, stackId, anchored: true } : s)) };
  }
  return { plans: next, stackId, note: floors.size > 1 ? "Anchored the stairs on every floor they connect." : "Anchored the stairs." };
}

/** The Unanchor button: free the stairs. They stay one stack, so they still move together. */
export function unanchor(plans: Plans, stackId: string): Plans {
  const next: Plans = {};
  for (const [lid, p] of Object.entries(plans)) {
    if (!p.stairs.some((s) => s.stackId === stackId)) {
      next[lid] = p;
      continue;
    }
    next[lid] = {
      ...p,
      stairs: p.stairs.map((s) => (s.stackId === stackId && s.anchored ? stripAnchor(s) : s)),
    };
  }
  return next;
}

function stripAnchor<T extends { anchored?: boolean }>(x: T): T {
  const { anchored: _a, ...rest } = x;
  void _a;
  return rest as T;
}

/** The stack that stairs on this floor belong to. */
export function stackOfItem(plan: FloorPlan, id: string): string | null {
  return plan.stairs.find((s) => s.id === id)?.stackId ?? null;
}

/** A rigid move (turn + shift) worked out from one thing before and after. */
type Motion = { from: Point; to: Point; deg: number; flip: boolean };

const moveBy = (m: Motion, p: Point): Point => roundPoint(add(m.to, rotate(sub(p, m.from), m.deg)));
const turnBy = (m: Motion, r: number) => ((((Math.round((r + m.deg) * 10) / 10) % 360) + 360) % 360);

const GEOMETRY: (keyof PlanStairs)[] = ["x", "y", "rotation", "widthIn", "shape", "flip", "toLevelId"];
const sameGeometry = (a: PlanStairs, b: PlanStairs) => GEOMETRY.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Move every member of a stack the same way, on every floor, except what's in `done` (already moved by the edit). */
function moveStack(plans: Plans, before: Plans, stackId: string, m: Motion, done: Set<string>): Plans {
  const next: Plans = { ...plans };
  for (const [lid, p] of Object.entries(plans)) {
    const was = planOf(before, lid);
    if (!p.stairs.some((s) => s.stackId === stackId)) continue;
    next[lid] = {
      ...p,
      stairs: p.stairs.map((s) => {
        if (s.stackId !== stackId || done.has(s.id)) return s;
        const o = was.stairs.find((x) => x.id === s.id) ?? s;
        return { ...s, ...moveBy(m, o), rotation: turnBy(m, o.rotation), flip: m.flip && o.shape === "l" ? !o.flip : o.flip };
      }),
    };
  }
  return next;
}

export type Reconciled = { plans: Plans; note: string | null };

/**
 * After an edit to one floor, keep every stack whole: anchored stairs stay
 * put (railings can change; deleted ones come back), and unanchored stacks
 * follow their stairs on every floor.
 */
export function reconcileStacks(before: Plans, after: Plans, levelId: string, ctx: StackCtx): Reconciled {
  void ctx;
  const a = planOf(before, levelId);
  const b = planOf(after, levelId);
  if (a === b) return { plans: after, note: null };
  const ids = new Set([...a.stairs.map((s) => s.stackId), ...b.stairs.map((s) => s.stackId)].filter((x): x is string => !!x));
  let plans = after;
  let note: string | null = null;
  for (const stackId of ids) {
    const r = reconcileOne(before, plans, levelId, stackId);
    plans = r.plans;
    note = note ?? r.note;
  }
  return { plans, note };
}

function reconcileOne(before: Plans, after: Plans, levelId: string, stackId: string): Reconciled {
  const a = planOf(before, levelId);
  const b = planOf(after, levelId);
  const stairsA = a.stairs.filter((s) => s.stackId === stackId);

  if (isAnchored(before, stackId)) {
    let restored = false;
    const stairs = b.stairs.map((s) => {
      const was = stairsA.find((x) => x.id === s.id);
      if (!was || !was.anchored || sameGeometry(was, s)) return s;
      restored = true;
      return { ...s, ...Object.fromEntries(GEOMETRY.map((k) => [k, was[k]])) } as PlanStairs;
    });
    const gone = stairsA.filter((s) => s.anchored && !b.stairs.some((x) => x.id === s.id));
    if (!restored && !gone.length) return { plans: after, note: null };
    return { plans: { ...after, [levelId]: { ...b, stairs: [...stairs, ...gone] } }, note: LOCKED_STAIRS };
  }

  // A stack that's free moves together: follow the stairs that moved.
  const moved = stairsA.map((s) => ({ was: s, now: b.stairs.find((x) => x.id === s.id) })).find(({ was, now }) => now && (was.x !== now.x || was.y !== now.y || was.rotation !== now.rotation || was.flip !== now.flip) && was.widthIn === now.widthIn && was.shape === now.shape);
  if (!moved?.now) return { plans: after, note: null };
  const { was, now } = moved;
  const m: Motion = { from: { x: was.x, y: was.y }, to: { x: now.x, y: now.y }, deg: Math.round((now.rotation - was.rotation) * 10) / 10, flip: was.flip !== now.flip };
  if (m.flip) m.deg = 0;
  return { plans: moveStack(after, before, stackId, m, new Set([now.id])), note: null };
}
