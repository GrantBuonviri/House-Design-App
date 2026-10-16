import type { FloorPlan, Level, PlanRoom, Point } from "@/lib/model/schema";
import { freeSpot, newOpening } from "./connect";
import { add, collinearOverlap, dist, dot, edgesOf, leftNormal, lerp, pointInPolygon, scale, sub, subtractIntervals, unit } from "./geometry";
import { areaKind } from "./measure";
import { BEDROOMS } from "./closets";
import { isCurved, roomEdgeArc, roomEdgeLength } from "./arcs";
import { sharedEdges, widestUnit } from "./bend";

/** Suggest a plan: windows on outside walls, more and bigger on the sunny south side. */

const SOUTH: Point = { x: 0, y: 1 };

// ---------- Windows ----------

const NO_WINDOWS = new Set(["hall", "closet", "pantry", "primary-closet", "mechanical", "storage", "garage", "entry"]);
const BATHS = new Set(["bathroom", "half-bath", "primary-bath"]);
const SUNNY = new Set(["living", "family", "dining", "sunroom", "kitchen"]);
const ONE_SMALL = new Set(["laundry", "mudroom"]);
const END_IN = 18;

type Placement = { style: string; widthIn: number };

/** `t0`, `t1` are inches along the wall (along the curve on a curved one, which also has its `radius`). */
export type Stretch = { a: Point; b: Point; t0: number; t1: number; host: { roomId: string; edge: number }; radius?: number };

/** Stretches of a room's walls with nothing indoors on the other side: open air, or a porch, patio or deck. */
export function outsideStretches(plan: FloorPlan, room: PlanRoom): Stretch[] {
  const indoor = plan.rooms.filter((r) => r.id !== room.id && areaKind(r) !== "outdoor");
  const out: Stretch[] = [];
  for (const e of edgesOf(room.polygon)) {
    const L = dist(e.a, e.b);
    if (L < 1) continue;
    if (isCurved(room.bulges?.[e.i])) {
      // A curved wall: the whole curve, inches along it, unless an indoor room shares it.
      const shared = indoor.some((o) => o.polygon.some((p) => dist(p, e.a) < 1) && o.polygon.some((p) => dist(p, e.b) < 1) && sharedEdges(plan, room.id, e.i).some((x) => x.roomId === o.id));
      if (!shared) out.push({ a: e.a, b: e.b, t0: 0, t1: roomEdgeLength(room, e.i), host: { roomId: room.id, edge: e.i }, radius: roomEdgeArc(room, e.i)!.radius });
      continue;
    }
    const cuts: [number, number][] = [];
    for (const other of indoor) {
      for (const f of edgesOf(other.polygon)) {
        const o = collinearOverlap(e.a, e.b, f.a, f.b, 1);
        if (o) cuts.push(o);
      }
    }
    for (const [t0, t1] of subtractIntervals(L, cuts)) out.push({ a: e.a, b: e.b, t0, t1, host: { roomId: room.id, edge: e.i } });
  }
  return out;
}

/** Is an indoor room just outside this stretch of wall (a few inches away, so a window would look into it)? */
export function roomJustOutside(plan: FloorPlan, s: Stretch): boolean {
  if (s.radius) return false; // A shared curve was already left out; nothing sits a few inches off a curve.
  const n = leftNormal(unit(sub(s.b, s.a)));
  const L = dist(s.a, s.b);
  return [0.25, 0.5, 0.75].some((k) => {
    const p = add(lerp(s.a, s.b, (s.t0 + (s.t1 - s.t0) * k) / L), scale(n, 12));
    return plan.rooms.some((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon));
  });
}

/** Windows on each room's outside walls: more and bigger facing south, fewer facing north. */
export function addWindows(plan: FloorPlan, level: Pick<Level, "kind">): { plan: FloorPlan; added: number } {
  let p = plan;
  let added = 0;
  for (const room of plan.rooms) {
    const type = room.type ?? "other";
    if (areaKind(room) !== "living" || NO_WINDOWS.has(type)) continue;
    if (p.openings.some((o) => o.kind === "window" && "roomId" in o.host && o.host.roomId === room.id)) continue;
    const mine = outsideStretches(plan, room)
      .map((w) => ({ w, n: leftNormal(unit(sub(w.b, w.a))), usable: w.t1 - w.t0 - 2 * END_IN }))
      // Not where another room is just a few inches away.
      .filter((x) => x.usable >= 24 && !roomJustOutside(plan, x.w))
      .map((x) => ({ ...x, facing: dot(x.n, SOUTH) }))
      // Sunniest first, then east and west, north last; longer walls first.
      .sort((a, b) => b.facing - a.facing || b.usable - a.usable);
    if (!mine.length) continue;

    const plans: { piece: (typeof mine)[number]; count: number; place: Placement }[] = [];
    const bedroom = BEDROOMS.has(type);
    if (level.kind === "basement") {
      // Below ground: an egress window for bedrooms, a high window elsewhere.
      plans.push({ piece: mine[0], count: 1, place: bedroom ? { style: "window", widthIn: 36 } : { style: "window-high", widthIn: 48 } });
    } else if (BATHS.has(type)) {
      const longest = [...mine].sort((a, b) => b.usable - a.usable)[0];
      plans.push({ piece: longest, count: 1, place: { style: "window-high", widthIn: type === "half-bath" ? 24 : 36 } });
    } else if (ONE_SMALL.has(type)) {
      plans.push({ piece: mine[0], count: 1, place: { style: "window", widthIn: 30 } });
    } else if (bedroom) {
      const most = type === "primary-bedroom" ? 3 : 2;
      for (const piece of mine.slice(0, most)) plans.push({ piece, count: 1, place: { style: "window", widthIn: type === "primary-bedroom" ? 48 : 36 } });
    } else {
      let total = 0;
      let picture = SUNNY.has(type) && type !== "kitchen";
      for (const piece of mine) {
        const south = piece.facing > 0.6;
        const north = piece.facing < -0.6;
        let count = south ? Math.max(1, Math.floor(piece.usable / 108)) : north ? (piece.usable >= 192 ? 2 : piece.usable >= 48 ? 1 : 0) : Math.min(2, Math.max(piece.usable >= 48 ? 1 : 0, Math.floor(piece.usable / 120)));
        if (type === "kitchen") count = Math.min(count, 2 - total);
        count = Math.min(count, 5 - total);
        if (count <= 0) continue;
        if (south && picture && piece.usable >= 96) {
          plans.push({ piece, count: 1, place: { style: "window-picture", widthIn: Math.min(96, Math.floor((piece.usable - 12) / 12) * 12) } });
          picture = false;
          total += 1;
          continue;
        }
        const room_ = piece.usable / count - 24;
        const widthIn = south ? Math.min(72, Math.max(36, Math.floor(room_ / 12) * 12)) : north ? 36 : room_ >= 48 ? 48 : 36;
        plans.push({ piece, count, place: { style: "window", widthIn } });
        total += count;
      }
    }

    for (const { piece, count, place } of plans) {
      const { w } = piece;
      const slot = (w.t1 - w.t0) / count;
      for (let k = 0; k < count; k++) {
        const t0 = w.t0 + k * slot + (k === 0 ? END_IN : 6);
        const t1 = w.t0 + (k + 1) * slot - (k === count - 1 ? END_IN : 6);
        // On a curve, windows are spaced along it and kept narrow enough to sit in it flat.
        const fitsCurve = w.radius ? Math.floor(widestUnit(w.radius) / 6) * 6 : Infinity;
        const widthIn = Math.min(place.widthIn, fitsCurve, Math.floor((t1 - t0 - 4) / 6) * 6);
        if (widthIn < 24) continue;
        const at = freeSpot(p, w.host, t0, t1, widthIn, 12);
        if (at === null) continue;
        p = { ...p, openings: [...p.openings, newOpening(place.style, w.host, at, 1, widthIn)] };
        added++;
      }
    }
  }
  return { plan: p, added };
}
