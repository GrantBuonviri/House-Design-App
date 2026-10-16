import type { FloorPlan, Opening, OpeningHost, PlanRoom, Point } from "@/lib/model/schema";
import { roomType } from "@/lib/brief/rooms";
import { openingType } from "./catalog";
import { add, collinearOverlap, edgesOf, pointInPolygon, polygonArea, round1, scale, sub, unit } from "./geometry";
import { hostSegment, openSpans, openingGeometry, sameHost, wallPieces, type OpeningGeometry } from "./walls";

/**
 * How rooms connect: which rooms a door or opening joins, which rooms are
 * linked, and adding a door where two rooms share a wall.
 */

/** What a room is for, as far as getting around the house goes. */
export type Role = "public" | "hall" | "private" | "suite" | "pantry" | "closet" | "garage" | "outdoor";

const ROLE: Record<string, Role> = {
  hall: "hall",
  bedroom: "private",
  "primary-bedroom": "private",
  "guest-suite": "private",
  bathroom: "private",
  "half-bath": "private",
  office: "private",
  laundry: "private",
  gym: "private",
  craft: "private",
  workshop: "private",
  storage: "private",
  mechanical: "private",
  "primary-bath": "suite",
  "primary-closet": "suite",
  pantry: "pantry",
  closet: "closet",
  garage: "garage",
  patio: "outdoor",
  deck: "outdoor",
  porch: "outdoor",
  "outdoor-kitchen": "outdoor",
};

export function roleOf(room: Pick<PlanRoom, "type">): Role {
  return (room.type && ROLE[room.type]) || "public";
}

/** Rooms you walk through to get to others: living spaces and hallways. */
export const isCirculation = (room: Pick<PlanRoom, "type">) => roleOf(room) === "public" || roleOf(room) === "hall";

export function newOpening(styleId: string, host: Opening["host"], offsetIn: number, side: 1 | -1, widthIn?: number): Opening {
  const t = openingType(styleId);
  return {
    id: `o-${Math.random().toString(36).slice(2, 10)}`,
    host,
    offsetIn: round1(offsetIn),
    kind: t.kind,
    style: t.id,
    widthIn: widthIn ?? t.widths[0],
    heightIn: t.heightIn,
    ...(t.sillIn !== undefined ? { sillIn: t.sillIn } : {}),
    side,
    hinge: "start",
  };
}

/** The longest stretch of wall two rooms share: on which edge of `a`, and where along it. */
export function sharedWall(a: PlanRoom, b: PlanRoom): { edge: number; t0: number; t1: number } | null {
  let best: { edge: number; t0: number; t1: number } | null = null;
  for (const e of edgesOf(a.polygon)) {
    for (const f of edgesOf(b.polygon)) {
      const o = collinearOverlap(e.a, e.b, f.a, f.b, 1);
      if (o && (!best || o[1] - o[0] > best.t1 - best.t0)) best = { edge: e.i, t0: o[0], t1: o[1] };
    }
  }
  return best;
}

export const OUTSIDE = "outside";

/** The rooms on either side of a door, window or opening (null is outside or no room). */
export function openingRooms(plan: FloorPlan, o: Opening): [string | null, string | null] {
  const g = openingGeometry(plan, o);
  if (!g) return [null, null];
  const roomAt = (p: Point) => plan.rooms.find((r) => pointInPolygon(p, r.polygon))?.id ?? null;
  return [roomAt(add(g.center, scale(g.n, 8))), roomAt(add(g.center, scale(g.n, -8)))];
}

/** A removed wall this long or more lets you walk between the rooms on either side. */
const OPEN_LINK_IN = 24;

/** Which rooms each room can walk into through a door, an opening or a removed wall ("outside" for doors to the outside). */
export function roomLinks(plan: FloorPlan): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>(plan.rooms.map((r) => [r.id, new Set<string>()]));
  if (plan.openWalls?.length) {
    const roomAt = (p: Point) => plan.rooms.find((r) => pointInPolygon(p, r.polygon))?.id ?? null;
    for (const w of wallPieces(plan, 0)) {
      if (!w.removed || Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) < OPEN_LINK_IN) continue;
      const mid = scale(add(w.a, w.b), 0.5);
      const n = scale(unit(sub(w.b, w.a)), 8);
      const [a, b] = [roomAt(add(mid, { x: n.y, y: -n.x })), roomAt(add(mid, { x: -n.y, y: n.x }))];
      if (a && b && a !== b) {
        links.get(a)!.add(b);
        links.get(b)!.add(a);
      }
    }
  }
  for (const o of plan.openings) {
    if (o.kind === "window") continue;
    const [a, b] = openingRooms(plan, o);
    if (a && b && a !== b) {
      links.get(a)!.add(b);
      links.get(b)!.add(a);
    } else if (a || b) links.get((a ?? b)!)!.add(OUTSIDE);
  }
  return links;
}

/** Rooms that share at least `minIn` inches of wall with a room. */
export function neighbors(plan: FloorPlan, room: PlanRoom, minIn = 36): { room: PlanRoom; length: number }[] {
  const out: { room: PlanRoom; length: number }[] = [];
  for (const other of plan.rooms) {
    if (other.id === room.id) continue;
    const w = sharedWall(room, other);
    if (w && w.t1 - w.t0 >= minIn) out.push({ room: other, length: w.t1 - w.t0 });
  }
  return out;
}

/** Every opening's ends, for checking that a new one doesn't run into it. */
function spans(plan: FloorPlan): OpeningGeometry[] {
  return plan.openings.map((o) => openingGeometry(plan, o)).filter((g): g is OpeningGeometry => g !== null);
}

/**
 * Somewhere along a stretch of wall (t0 to t1 inches along the host) where an
 * opening `width` wide fits without running into another one on the same
 * line. Tries the middle first, then toward each end.
 */
export function freeSpot(plan: FloorPlan, host: OpeningHost, t0: number, t1: number, width: number, gap = 6): number | null {
  const seg = hostSegment(plan, host);
  if (!seg || t1 - t0 < width + 2) return null;
  if (seg.bulge) return freeSpotOnCurve(plan, host, seg.length, t0, t1, width, gap);
  const others = spans(plan);
  const gone = openSpans(plan, seg.a, seg.b);
  const u = unit(sub(seg.b, seg.a));
  const fits = (t: number) => {
    const half = width / 2 + gap;
    // Not where the wall was taken out: there's nothing to hang a door in.
    if (gone.some(([g0, g1]) => Math.min(g1, t + half) - Math.max(g0, t - half) > 0)) return false;
    const a = add(seg.a, scale(u, t - half));
    const b = add(seg.a, scale(u, t + half));
    return others.every((g) => !collinearOverlap(a, b, g.a, g.b, 4));
  };
  const lo = t0 + width / 2 + 2;
  const hi = t1 - width / 2 - 2;
  const mid = (t0 + t1) / 2;
  const tries = [mid, lo + 4, hi - 4, (lo + mid) / 2, (mid + hi) / 2].map((t) => Math.min(hi, Math.max(lo, t)));
  return tries.find(fits) ?? null;
}

/** freeSpot on a curved wall: offsets there are inches along the curve, so the openings on it are compared by offset. */
function freeSpotOnCurve(plan: FloorPlan, host: OpeningHost, length: number, t0: number, t1: number, width: number, gap: number): number | null {
  const mine = plan.openings.filter((o) => sameHost(o.host, host));
  const fits = (t: number) => t - width / 2 >= 0 && t + width / 2 <= length && mine.every((o) => Math.abs(o.offsetIn - t) >= (o.widthIn + width) / 2 + gap);
  const lo = t0 + width / 2 + 2;
  const hi = t1 - width / 2 - 2;
  const mid = (t0 + t1) / 2;
  return [mid, lo + 4, hi - 4, (lo + mid) / 2, (mid + hi) / 2].map((t) => Math.min(hi, Math.max(lo, t))).find(fits) ?? null;
}

export type DoorOptions = {
  style?: string;
  widthIn?: number;
  /** Which room the door swings into. By default: not a hallway, and the smaller room. */
  swingInto?: string;
};

/** A door between two rooms on the longest wall they share, or null when they don't share enough wall. */
export function doorBetween(plan: FloorPlan, a: PlanRoom, b: PlanRoom, opts: DoorOptions = {}): Opening | null {
  const wall = sharedWall(a, b);
  if (!wall) return null;
  const t = openingType(opts.style ?? "door-hinged");
  const room = wall.t1 - wall.t0;
  const width = Math.min(opts.widthIn ?? t.widths[0], Math.floor(room - 6));
  if (width < 24) return null;
  const host = { roomId: a.id, edge: wall.edge };
  const at = freeSpot(plan, host, wall.t0, wall.t1, width);
  if (at === null) return null;
  // The left of a's edge is b (corners run clockwise, so left is outside a).
  const into = opts.swingInto ?? (roleOf(b) === "hall" ? a.id : roleOf(a) === "hall" ? b.id : polygonArea(b.polygon) <= polygonArea(a.polygon) ? b.id : a.id);
  return newOpening(t.id, host, at, into === b.id ? 1 : -1, width);
}

export function addDoor(plan: FloorPlan, a: PlanRoom, b: PlanRoom, opts: DoorOptions = {}): FloorPlan | null {
  const o = doorBetween(plan, a, b, opts);
  return o ? { ...plan, openings: [...plan.openings, o] } : null;
}

/** Rooms that can be reached from a starting set by walking through doors. */
export function reachable(plan: FloorPlan, from: string[]): Set<string> {
  const links = roomLinks(plan);
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of links.get(id) ?? []) {
      if (next === OUTSIDE || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

export const typeLabel = (room: Pick<PlanRoom, "type" | "name">) => (room.type ? roomType(room.type).label : room.name);
