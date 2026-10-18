import type { AddOn, FloorPlan, Point } from "@/lib/model/schema";
import { add, angleOf, dot, pointInPolygon, project, rectangle, round1, scale, sub } from "@/lib/plan/geometry";
import { openingGeometries, type OpeningGeometry } from "@/lib/plan/walls";
import { areaKind } from "@/lib/plan/measure";
import { furnitureHeight, furnitureOutline, furnitureType } from "@/lib/plan/furniture";
import { fixtureSpan } from "@/lib/house3d/fixtures";
import { addOnType, type Covering } from "./catalog";

/**
 * Decor that needs more than a spot on the floor: curtains and blinds hang
 * on a window and follow it (their saved `openingId`), and table lamps and
 * throw pillows rest on top of whatever furniture is under them.
 */

/** From the wall's line to a wall-hung item's back, as the wall snap does. */
const OFF_WALL_IN = 2.5;
/** How far curtains reach past each side of the window, and above its top. */
export const CURTAIN_SIDE_IN = 12;
export const CURTAIN_ABOVE_IN = 8;
/** How far a window can be from where you point and still get the curtains. */
const REACH_IN = 60;

export type CoveringFit = { x: number; y: number; rotation: number; widthIn: number; depthIn: number; heightIn: number; bottomIn: number; openingId: string };

/** The covering an add-on kind is, if any. */
export const coveringOf = (kind: string): Covering | undefined => addOnType(kind)?.covering;

/** Which side of a window's wall is indoors, seen from `p` (the side `p` is on, unless that side is outdoors). */
function insideSide(plan: FloorPlan, og: OpeningGeometry, p: Point): 1 | -1 {
  const indoor = (s: number) => {
    const q = add(og.center, scale(og.n, s * 12));
    return plan.rooms.some((r) => areaKind(r) !== "outdoor" && pointInPolygon(q, r.polygon));
  };
  const s = dot(sub(p, og.center), og.n) >= 0 ? 1 : -1;
  if (indoor(s)) return s;
  return indoor(-s) ? (-s as 1 | -1) : s;
}

/** Curtains or blinds sized to a window, on its `side` of the wall. */
function fitTo(og: OpeningGeometry, covering: Covering, side: 1 | -1, depthIn: number, ceilingIn: number): CoveringFit {
  const o = og.opening;
  const sill = o.sillIn ?? 30;
  const head = sill + o.heightIn;
  const inward = scale(og.n, side);
  // Turned so the back faces the wall: the item's +y points into the room.
  const rotation = (((Math.round(angleOf(inward) - 90) % 360) + 360) % 360);
  if (covering === "curtains") {
    const top = Math.min(head + CURTAIN_ABOVE_IN, ceilingIn - 1);
    const c = add(og.center, scale(inward, depthIn / 2 + OFF_WALL_IN + 1.5));
    return { x: round1(c.x), y: round1(c.y), rotation, widthIn: round1(o.widthIn + CURTAIN_SIDE_IN * 2), depthIn, heightIn: round1(top - 0.5), bottomIn: 0.5, openingId: o.id };
  }
  // Blinds hang just outside the window's trim, a little wider and taller than the glass.
  const c = add(og.center, scale(inward, depthIn / 2 + OFF_WALL_IN + 1));
  const bottom = Math.max(0, sill - 1.5);
  return { x: round1(c.x), y: round1(c.y), rotation, widthIn: round1(o.widthIn + 3), depthIn, heightIn: round1(Math.min(head + 2.5, ceilingIn - 1) - bottom), bottomIn: round1(bottom), openingId: o.id };
}

/** Curtains or blinds on the window nearest `p` (within reach), facing into the room `p` is in. Null with no window close by. */
export function coveringFit(plan: FloorPlan, kind: string, p: Point, ceilingIn = 96): CoveringFit | null {
  const covering = coveringOf(kind);
  if (!covering) return null;
  let best: OpeningGeometry | null = null;
  let bestD = REACH_IN;
  for (const og of openingGeometries(plan)) {
    if (og.opening.kind !== "window") continue;
    const d = project(p, og.a, og.b).d;
    if (d < bestD) {
      bestD = d;
      best = og;
    }
  }
  if (!best) return null;
  return fitTo(best, covering, insideSide(plan, best, p), addOnType(kind)!.depthIn, ceilingIn);
}

/** A covering refit to its window as the window is now (unchanged when the window is gone). */
export function fitCovering(plan: FloorPlan, a: AddOn, ceilingIn = 96, windows = openingGeometries(plan)): AddOn {
  const covering = coveringOf(a.kind);
  if (!covering || !a.openingId) return a;
  const og = windows.find((g) => g.opening.id === a.openingId && g.opening.kind === "window");
  if (!og) return a;
  const fit = fitTo(og, covering, insideSide(plan, og, { x: a.x, y: a.y }), a.depthIn, ceilingIn);
  return { ...a, ...fit };
}

/** Every add-on on a floor, with curtains and blinds following their windows. */
export function fittedAddOns(plan: FloorPlan, ceilingIn = 96): AddOn[] {
  const list = plan.addOns ?? [];
  if (!list.some((a) => a.openingId)) return list;
  const windows = openingGeometries(plan);
  return list.map((a) => fitCovering(plan, a, ceilingIn, windows));
}

/** Seats you set pillows on, and how high their seat is. */
const SEAT_IN: Record<string, number> = { sofa: 18, loveseat: 18, armchair: 18, sectional: 18, "bed-twin": 25, "bed-full": 25, "bed-queen": 25, "bed-king": 25 };

/**
 * How high something set down at `p` rests: on the top of the furniture,
 * counter or built-in under it (a sofa's or bed's seat), or the floor.
 */
export function restHeight(plan: FloorPlan, p: Point, selfId?: string): number {
  let top = 0;
  for (const f of plan.furniture) {
    const t = furnitureType(f.kind);
    if (t?.flat || !pointInPolygon(p, furnitureOutline(f))) continue;
    top = Math.max(top, SEAT_IN[f.kind] ?? furnitureHeight(f.kind));
  }
  for (const fx of plan.fixtures) {
    if (fx.kind === "closet" || !pointInPolygon(p, rectangle(fx.x, fx.y, fx.widthIn, fx.depthIn, fx.rotation ?? 0))) continue;
    top = Math.max(top, fixtureSpan(fx.kind).z1);
  }
  for (const a of plan.addOns ?? []) {
    const t = addOnType(a.kind);
    if (a.id === selfId || t?.onTop || t?.mount !== "floor" || a.bottomIn > 0 || a.heightIn > 48) continue;
    if (pointInPolygon(p, rectangle(a.x, a.y, a.widthIn, a.depthIn, a.rotation ?? 0))) top = Math.max(top, a.heightIn);
  }
  return round1(top);
}
