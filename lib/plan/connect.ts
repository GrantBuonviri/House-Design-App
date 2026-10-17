import type { FloorPlan, Opening, OpeningHost, PlanRoom, Point } from "@/lib/model/schema";
import { roomType } from "@/lib/brief/rooms";
import { openingType } from "./catalog";
import { add, collinearOverlap, edgesOf, pointInPolygon, polygonArea, polygonCenter, round1, scale, sub, subtractIntervals, unit } from "./geometry";
import { INTERIOR_WALL_IN } from "./basics";
import { listHits, swingArcs, swingClear, type SwingExtras } from "./swing";
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
  const fits = spotFits(plan, host, width, gap);
  const lo = t0 + width / 2 + 2;
  const hi = t1 - width / 2 - 2;
  const mid = (t0 + t1) / 2;
  const tries = [mid, lo + 4, hi - 4, (lo + mid) / 2, (mid + hi) / 2].map((t) => Math.min(hi, Math.max(lo, t)));
  return tries.find(fits) ?? null;
}

/**
 * Whether an opening `width` wide, centered `t` inches along a straight host
 * wall, stays clear of the other openings on that line (by `gap`) and of
 * removed wall.
 */
export function spotFits(plan: FloorPlan, host: OpeningHost, width: number, gap = 6): (t: number) => boolean {
  const seg = hostSegment(plan, host);
  if (!seg) return () => false;
  const others = spans(plan);
  const gone = openSpans(plan, seg.a, seg.b);
  const u = unit(sub(seg.b, seg.a));
  return (t: number) => {
    const half = width / 2 + gap;
    if (t - width / 2 < 0 || t + width / 2 > seg.length) return false;
    // Not where the wall was taken out: there's nothing to hang a door in.
    if (gone.some(([g0, g1]) => Math.min(g1, t + half) - Math.max(g0, t - half) > 0)) return false;
    const a = add(seg.a, scale(u, t - half));
    const b = add(seg.a, scale(u, t + half));
    return others.every((g) => !collinearOverlap(a, b, g.a, g.b, 4));
  };
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
  /** The narrowest door allowed here: 30" by default, 24" for closets and pantries. Narrower walls get no door. */
  minWidthIn?: number;
  /** Which room the door swings into. By default: not a hallway, the bedroom, bath or closet side, else the smaller room. */
  swingInto?: string;
  /** Why it's this wide, added to the door's reason: "36\" for the primary bedroom." */
  widthWhy?: string;
  /** Stairs and cabinets the swing should stay clear of. */
  near?: SwingExtras;
};

/** A placed door and a short, plain reason for where it went (shown when it's selected, never saved). */
export type PlacedDoor = { opening: Opening; reason: string };

/** Space left between a door and the corner on its hinge side, from the wall face: room for the casing. */
export const DOOR_RETURN_IN = 4;
/** Clear wall wanted past a door's latch side, so it can be reached and pulled open. */
export const LATCH_CLEAR_IN = 18;
const SMALL_ROLES = new Set<Role>(["private", "suite", "closet", "pantry"]);

/** Which of two rooms a door between them swings into: never a hallway; a bedroom, bath or closet over a living space; else the smaller room. */
export function swingIntoOf(a: PlanRoom, b: PlanRoom): string {
  if (roleOf(b) === "hall") return a.id;
  if (roleOf(a) === "hall") return b.id;
  const small = (r: PlanRoom) => SMALL_ROLES.has(roleOf(r)) || roleOf(r) === "garage";
  if (small(a) !== small(b)) return small(a) ? a.id : b.id;
  // A closet or suite room off a bedroom: into the closet or bath.
  const inner = (r: PlanRoom) => roleOf(r) === "closet" || roleOf(r) === "suite" || roleOf(r) === "pantry";
  if (inner(a) !== inner(b)) return inner(a) ? a.id : b.id;
  return polygonArea(b.polygon) <= polygonArea(a.polygon) ? b.id : a.id;
}

/** What the free wall in a room is good for, for the reason line. */
function wallUse(room: PlanRoom): string {
  switch (room.type) {
    case "bedroom":
    case "primary-bedroom":
    case "guest-suite":
      return "the bed wall";
    case "kitchen":
      return "the counter wall";
    case "living":
    case "family":
      return "the sofa wall";
    case "bathroom":
    case "half-bath":
    case "primary-bath":
      return "the vanity wall";
    case "office":
      return "the desk wall";
    case "closet":
    case "primary-closet":
    case "pantry":
      return "the shelf wall";
    default:
      return "the longest wall";
  }
}

/** The longest unbroken stretch of straight wall left in a room once a door (and its swing) is in. */
function longestFreeWall(plan: FloorPlan, room: PlanRoom, door: Opening, arcs: Point[][]): number {
  const geoms = [...spans(plan), ...[openingGeometry({ ...plan, openings: [...plan.openings, door] }, door)].filter((g): g is OpeningGeometry => g !== null)];
  let best = 0;
  for (const e of edgesOf(room.polygon)) {
    const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    if (L < 1) continue;
    const u = unit(sub(e.b, e.a));
    const n = { x: -u.y, y: u.x };
    const cuts: [number, number][] = [];
    for (const g of geoms) {
      const o = collinearOverlap(e.a, e.b, g.a, g.b, 3);
      if (o) cuts.push(o);
    }
    // Where the open leaf stands against this wall (inside the room, which is to the right of a clockwise edge).
    for (const arc of arcs) {
      const near = arc.filter((p) => {
        const d = (p.x - e.a.x) * n.x + (p.y - e.a.y) * n.y;
        return d >= -1 && d <= 14;
      });
      if (near.length < 2) continue;
      const ts = near.map((p) => (p.x - e.a.x) * u.x + (p.y - e.a.y) * u.y);
      cuts.push([Math.min(...ts), Math.max(...ts)]);
    }
    for (const [x0, x1] of subtractIntervals(L, cuts)) best = Math.max(best, x1 - x0);
  }
  return best;
}

/** A corner of the room within a few inches of a point. */
const cornerAt = (room: PlanRoom, p: Point) => room.polygon.some((v) => Math.hypot(v.x - p.x, v.y - p.y) <= 3);

/**
 * Where a door between two rooms goes, on the longest wall they share:
 * - by a corner of the room it swings into, 4" from the wall, hinged on the
 *   corner side so it opens flat against that wall, with 18" of wall past
 *   the latch; the corner that leaves the longest free wall in the room wins
 *   (then the one nearer the room you come from);
 * - if the swing hits something (another door, a fixture, the stairs, a
 *   closet, the far wall): the other hinge, then the other corner, then a
 *   pocket door when the wall is long enough, then the middle of the wall.
 * Doors are at least 30" (24" for closets); a wall too short for that gets no door.
 */
export function placeDoor(plan: FloorPlan, a: PlanRoom, b: PlanRoom, opts: DoorOptions = {}): PlacedDoor | null {
  const wall = sharedWall(a, b);
  if (!wall) return null;
  const t = openingType(opts.style ?? "door-hinged");
  const room = wall.t1 - wall.t0;
  const width = Math.min(opts.widthIn ?? t.widths[0], Math.floor(room - 6));
  if (width < (opts.minWidthIn ?? 24)) return null;
  const host = { roomId: a.id, edge: wall.edge };
  // The left of a's edge is b (corners run clockwise, so left is outside a).
  const into = opts.swingInto ?? swingIntoOf(a, b);
  const side = into === b.id ? 1 : -1;
  const swingIn = into === b.id ? b : a;
  const from = into === b.id ? a : b;
  const make = (style: string, at: number, hinge: "start" | "end"): Opening => ({ ...newOpening(style, host, at, side, width), hinge });
  const why = opts.widthWhy ? ` ${opts.widthWhy}` : "";
  const middle = (style: string, reason: string): PlacedDoor | null => {
    const at = freeSpot(plan, host, wall.t0, wall.t1, width);
    return at === null ? null : { opening: make(style, at, "start"), reason: reason + why };
  };
  const seg = hostSegment(plan, host);
  if (!seg) return null;
  if (!t.swings || seg.bulge) return middle(t.id, t.kind === "opening" ? "An opening, so the rooms flow together." : "In the middle of the shared wall.");

  const fits = spotFits(plan, host, width);
  const ret = DOOR_RETURN_IN + INTERIOR_WALL_IN / 2;
  const u = unit(sub(seg.b, seg.a));
  const pointAt = (s: number) => add(seg.a, scale(u, s));
  const near = opts.near ?? {};
  const clear = (o: Opening) => swingClear({ ...plan, openings: [...plan.openings, o] }, o, near);
  const fromCenter = polygonCenter(from.polygon);
  // The two corner spots: hinge on the corner side, latch toward the long wall.
  const corners = (["start", "end"] as const)
    .map((end) => {
      const at = end === "start" ? wall.t0 + ret + width / 2 : wall.t1 - ret - width / 2;
      const latchRoom = end === "start" ? wall.t1 - (at + width / 2) : at - width / 2 - wall.t0;
      if (latchRoom < LATCH_CLEAR_IN || !fits(at)) return null;
      const o = make(t.id, at, end);
      const g = openingGeometry({ ...plan, openings: [...plan.openings, o] }, o);
      const corner = cornerAt(swingIn, pointAt(end === "start" ? wall.t0 : wall.t1));
      return { end, at, o, corner, free: g ? longestFreeWall(plan, swingIn, o, swingArcs(g)) : 0, fromDist: Math.hypot(pointAt(at).x - fromCenter.x, pointAt(at).y - fromCenter.y) };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((x, y) => Number(y.corner) - Number(x.corner) || y.free - x.free || x.fromDist - y.fromDist);

  const hits: string[] = [];
  const note = (r: { hits: string[] }) => r.hits.forEach((h) => !hits.includes(h) && hits.push(h));
  for (const [k, c] of corners.entries()) {
    const flat = clear(c.o);
    if (flat.ok) {
      const where = c.corner ? `By the corner so ${wallUse(swingIn)} stays free` : "Toward the end of the wall";
      return { opening: c.o, reason: `${where}. It swings into ${swingIn.name} and opens flat against the wall.${why}` };
    }
    note(flat);
    const other = { ...c.o, hinge: c.end === "start" ? ("end" as const) : ("start" as const) };
    if (clear(other).ok) return { opening: other, reason: `By the ${k ? "other " : ""}corner, hinged on the far side so it doesn't hit ${listHits(flat.hits)}.${why}` };
  }
  // A pocket door slides into the wall beside it, toward the long wall: it needs a door's width of wall there.
  const pocket = corners.find((c) => (c.end === "start" ? wall.t1 - (c.at + width / 2) : c.at - width / 2 - wall.t0) >= width + 2);
  if (pocket && hits.length) {
    return { opening: make("door-pocket", pocket.at, pocket.end === "start" ? "end" : "start"), reason: `A pocket door, because a swinging door here would hit ${listHits(hits)}.${why}` };
  }
  const placed = middle(t.id, corners.length ? `In the middle of the wall: by the corners it would hit ${listHits(hits)}.` : "In the middle of the wall: there wasn't room by a corner.");
  if (!placed) return null;
  // Hinged toward the nearer end, so it opens against the shorter run of wall; the other way if that clears.
  const hinge = placed.opening.offsetIn - wall.t0 <= wall.t1 - placed.opening.offsetIn ? "start" : "end";
  const o = { ...placed.opening, hinge } as Opening;
  if (clear(o).ok) return { ...placed, opening: o };
  const flipped = { ...o, hinge: hinge === "start" ? ("end" as const) : ("start" as const) };
  return { ...placed, opening: clear(flipped).ok ? flipped : o };
}

/** A door between two rooms (see `placeDoor`), or null when they don't share enough wall. */
export function doorBetween(plan: FloorPlan, a: PlanRoom, b: PlanRoom, opts: DoorOptions = {}): Opening | null {
  return placeDoor(plan, a, b, opts)?.opening ?? null;
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
