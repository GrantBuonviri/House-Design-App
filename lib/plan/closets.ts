import type { DesignBrief, Fixture, FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { addDoor, neighbors, roleOf, roomLinks, sharedWall } from "./connect";
import { makeRoom, newPlanId, reshapeRoom } from "./edit";
import { add, angleOf, dist, edgesOf, isRectangle, leftNormal, pointInPolygon, polygonArea, round1, scale, sub, unit } from "./geometry";
import { openingGeometry, wallPieces } from "./walls";

/** Suggest a plan: a closet in each bedroom (a walk-in for a big primary bedroom). */

// ---------- Closets ----------

export const BEDROOMS = new Set(["bedroom", "guest-suite", "primary-bedroom"]);
const REACH_IN_IN = 26;
const WALK_IN_IN = 66;

/** A closet in the corner of a bedroom, against an inside wall and clear of doors. */
export function addClosets(plan: FloorPlan, exteriorIn: number, brief: DesignBrief | null = null): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  const briefHasCloset = Boolean(brief?.rooms.some((r) => r.type === "primary-closet"));
  for (const bed of plan.rooms.filter((r) => BEDROOMS.has(r.type ?? ""))) {
    const now = p.rooms.find((r) => r.id === bed.id);
    if (!now || !isRectangle(now.polygon)) continue;
    // Already has a closet of its own.
    if ([...(roomLinks(p).get(now.id) ?? [])].some((id) => p.rooms.find((r) => r.id === id)?.type === "closet")) continue;
    if (now.type === "primary-bedroom" && briefHasCloset) continue;
    const sqft = polygonArea(now.polygon) / 144;
    if (sqft < 90) continue;
    const sides = edgesOf(now.polygon).map((e) => dist(e.a, e.b));
    const walkIn = now.type === "primary-bedroom" && sqft >= 200 && Math.min(...sides) >= 144;
    const depth = walkIn ? WALK_IN_IN : REACH_IN_IN;
    const pieces = wallPieces(p, exteriorIn).filter((w) => "roomId" in w.host && w.host.roomId === now.id);
    const geos = p.openings.map((o) => ({ o, ...openingEnds(p, o) })).filter((g) => g.a);

    let best: { score: number; poly: Point[]; closet: Point[]; back: [Point, Point]; n: Point; L: number } | null = null;
    for (const e of edgesOf(now.polygon)) {
      const len = dist(e.a, e.b);
      const L = walkIn ? Math.min(len - 36, 84) : Math.min(len - 30, 96);
      const perp = sides[(e.i + 1) % 4];
      if (L < (walkIn ? 60 : 48) || perp < depth + 60) continue;
      const u = unit(sub(e.b, e.a));
      const n = scale(leftNormal(u), -1);
      const outside = pieces.filter((w) => "edge" in w.host && w.host.edge === e.i && w.exterior).reduce((s, w) => s + (w.t1 - w.t0), 0);
      const next = neighbors(p, now, 24).filter((x) => sharedOnEdge(now, e.i, x.room));
      const quiet = next.some((x) => BEDROOMS.has(x.room.type ?? "") || roleOf(x.room) === "suite" || x.room.type === "bathroom" || x.room.type === "closet");
      for (const atStart of [true, false]) {
        const C = atStart ? e.a : e.b;
        const w = atStart ? u : scale(u, -1);
        const grown = [add(C, add(scale(w, -4), scale(n, -4))), add(C, add(scale(w, L + 4), scale(n, -4))), add(C, add(scale(w, L + 4), scale(n, depth + 4))), add(C, add(scale(w, -4), scale(n, depth + 4)))];
        if (geos.some((g) => [g.a!, g.center!, g.b!].some((q) => pointInPolygon(q, grown)))) continue;
        const inner = [add(C, scale(n, depth)), add(C, add(scale(w, L), scale(n, depth))), add(C, scale(w, L))];
        const poly = [...now.polygon];
        const i = atStart ? e.i : (e.i + 1) % 4;
        // Going clockwise, the corner is reached along the wall the closet's depth runs on.
        poly.splice(i, 1, ...(atStart ? inner : [...inner].reverse()));
        const score = 10 - (outside / len) * 8 + (quiet ? 3 : 0) + (atStart ? 0.1 : 0);
        if (!best || score > best.score) best = { score, poly, closet: [C, add(C, scale(w, L)), add(C, add(scale(w, L), scale(n, depth))), add(C, scale(n, depth))], back: [C, add(C, scale(w, L))], n, L };
      }
    }
    if (!best) continue;
    p = reshapeRoom(p, now.id, best.poly);
    const closet = makeRoom(best.closet, walkIn ? "Walk-in closet" : "Closet", { type: "closet" });
    p = { ...p, rooms: [...p.rooms, closet] };
    const bedNow = p.rooms.find((r) => r.id === now.id)!;
    p = addDoor(p, closet, bedNow, walkIn ? { widthIn: 28, swingInto: bedNow.id } : best.L >= 60 ? { style: "door-double", widthIn: 48, swingInto: bedNow.id } : { widthIn: 24, swingInto: bedNow.id }) ?? p;
    const mid = scale(add(best.back[0], best.back[1]), 0.5);
    const shelf = walkIn ? 24 : 20;
    const at = add(mid, scale(best.n, 3 + shelf / 2));
    const rod: Fixture = { id: newPlanId("f"), kind: "closet", x: round1(at.x), y: round1(at.y), rotation: Math.round(angleOf(best.n) - 90), widthIn: Math.round(best.L - 10), depthIn: shelf, roomId: closet.id };
    p = { ...p, fixtures: [...p.fixtures, rod] };
    added++;
  }
  return { plan: p, added };
}

function openingEnds(plan: FloorPlan, o: FloorPlan["openings"][number]) {
  const g = openingGeometry(plan, o);
  return g ? { a: g.a, b: g.b, center: g.center } : { a: undefined, b: undefined, center: undefined };
}

/** Does `other` share some of edge `i` of `room`? */
function sharedOnEdge(room: PlanRoom, i: number, other: PlanRoom): boolean {
  const w = sharedWall(room, other);
  return Boolean(w && w.edge === i);
}
