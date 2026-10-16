import type { FloorPlan, Point } from "@/lib/model/schema";
import { add, dist, lerp, pointInPolygon, scale, sub } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { openingGeometries, wallPieces } from "@/lib/plan/walls";
import { flatPlan } from "@/lib/plan/flatten";

/**
 * Steps down to the ground: outside doors and the open edges of porches and
 * decks that sit above the ground get a few concrete steps (and, at a door,
 * a small landing), so the 3D house looks right on a slope and you can walk
 * in and out in the walkthrough.
 */

const RISE_IN = 7.5;
const TREAD_IN = 11;
const LANDING_IN = 42;
/** Less of a drop than this needs no step. */
const DROP_IN = 4;
const MAX_STEPS = 24;

export type EntryStep = { outline: Point[]; top: number };

/** A run of steps going out from the middle of an edge (`n` points away from the house). */
function stepsOut(at: Point, n: Point, width: number, floorIn: number, landing: number, groundAt: (p: Point) => number): EntryStep[] {
  const u = { x: -n.y, y: n.x };
  const box = (d0: number, d1: number): Point[] => {
    const c0 = add(at, scale(n, d0));
    const c1 = add(at, scale(n, d1));
    return [add(c0, scale(u, -width / 2)), add(c0, scale(u, width / 2)), add(c1, scale(u, width / 2)), add(c1, scale(u, -width / 2))];
  };
  const mid = (d0: number, d1: number) => add(at, scale(n, (d0 + d1) / 2));
  const out: EntryStep[] = [];
  let d = 0;
  if (landing > 0) {
    if (floorIn - groundAt(mid(0, landing)) <= DROP_IN) return [];
    out.push({ outline: box(0, landing), top: floorIn });
    d = landing;
  }
  let top = floorIn;
  for (let k = 0; k < MAX_STEPS; k++) {
    const g = groundAt(mid(d, d + TREAD_IN));
    if (top - g <= DROP_IN + 1) break;
    // Even steps for what's left to go down.
    const n_ = Math.ceil((top - g) / RISE_IN);
    top -= (top - g) / n_;
    if (top - g < 1) break;
    out.push({ outline: box(d, d + TREAD_IN), top });
    d += TREAD_IN;
  }
  return out;
}

/** The steps for one floor (only floors near the ground have any). */
export function entrySteps(plan: FloorPlan, floorIn: number, exteriorIn: number, groundAt: (p: Point) => number): EntryStep[] {
  plan = flatPlan(plan);
  if (floorIn > 4 * 12 || !plan.rooms.length) return [];
  const indoor = plan.rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon);
  const all = plan.rooms.map((r) => r.polygon);
  const out: EntryStep[] = [];

  // Outside doors that open straight onto the ground.
  for (const g of openingGeometries(plan)) {
    const o = g.opening;
    if (o.kind === "window" || o.style === "door-garage") continue;
    const probe = (s: number) => add(g.center, scale(g.n, s * 24));
    const side = !all.some((p) => pointInPolygon(probe(1), p)) ? 1 : !all.some((p) => pointInPolygon(probe(-1), p)) ? -1 : 0;
    if (side === 0 || !indoor.some((p) => pointInPolygon(probe(-side), p))) continue;
    const n = scale(g.n, side);
    // The landing starts in the doorway (under the wall), so there's no gap between it and the floor.
    out.push(...stepsOut(g.center, n, o.widthIn + 24, floorIn, LANDING_IN + exteriorIn / 2, groundAt));
  }

  // Each porch, deck or patio above the ground: steps from the middle of its longest open edge.
  for (const room of plan.rooms) {
    if (areaKind(room) !== "outdoor") continue;
    const open = wallPieces(plan, exteriorIn)
      .filter((p) => p.open && "roomId" in p.host && p.host.roomId === room.id)
      .sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b))[0];
    if (!open || dist(open.a, open.b) < 36) continue;
    const m = lerp(open.a, open.b, 0.5);
    const d = sub(open.b, open.a);
    const len = Math.hypot(d.x, d.y);
    // Room outlines go clockwise on screen, so the left of each edge is outside.
    const n = { x: d.y / len, y: -d.x / len };
    out.push(...stepsOut(m, n, Math.min(60, len - 12), floorIn, 0, groundAt));
  }
  return out;
}
