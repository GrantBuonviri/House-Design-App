import { addRiders, mapRiders, ridersIn, type Rider } from "@/lib/furnish/ride";
import { mirrorRailingEdits } from "./railings";
import { mirrorFaucet } from "@/lib/furnish/faucets";
import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { reverseBulges, roomEdgeLength, withBulges } from "./arcs";
import { boundsOf, dist, edgesOf, isRectangle, round1, roundPoint } from "./geometry";
import { moveMany, newPlanId, reshapeRoom } from "./edit";
import { pruneOpenWalls } from "./openWalls";
import { isLocked, unlocked } from "./locks";

/**
 * Whole-selection helpers: copy things (`duplicateMany`), flip them
 * (`mirrorMany`), and line rooms up (`alignMany`).
 */

/** How far a copy sits from the original, inches, so it can be seen and grabbed. */
export const COPY_OFFSET_IN = 24;

/** Everything on the plan that goes with these ids: rooms bring their doors, windows, fixtures and furniture. */
function members(plan: FloorPlan, ids: string[]) {
  const picked = new Set(ids);
  const rooms = plan.rooms.filter((r) => picked.has(r.id));
  const walls = plan.walls.filter((w) => picked.has(w.id));
  const roomIds = new Set(rooms.map((r) => r.id));
  const wallIds = new Set(walls.map((w) => w.id));
  const inRoom = <T extends { roomId?: string }>(x: T & { id: string }) => picked.has(x.id) || (x.roomId !== undefined && roomIds.has(x.roomId));
  return {
    rooms,
    walls,
    roomIds,
    wallIds,
    stairs: plan.stairs.filter((s) => picked.has(s.id)),
    fixtures: plan.fixtures.filter(inRoom),
    furniture: plan.furniture.filter((f) => f.roomId !== undefined && roomIds.has(f.roomId)),
    openings: plan.openings.filter((o) => picked.has(o.id) || ("roomId" in o.host ? roomIds.has(o.host.roomId) : wallIds.has(o.host.wallId))),
  };
}

/** The ids duplicate and mirror can work on (not doors alone, or single walls of a room). */
export const copyableIds = (plan: FloorPlan, ids: string[]) => {
  const m = members(plan, ids);
  return [...m.rooms.map((r) => r.id), ...m.walls.map((w) => w.id), ...m.stairs.map((s) => s.id), ...plan.fixtures.filter((f) => ids.includes(f.id)).map((f) => f.id)];
};

/** Stretches of removed wall that lie on the outlines of these rooms at both ends. */
function ownOpenWalls(plan: FloorPlan, rooms: PlanRoom[]) {
  const onOutline = (p: Point) => rooms.some((r) => edgesOf(r.polygon).some((e) => distToSegment(p, e.a, e.b) <= 1));
  return (plan.openWalls ?? []).filter((w) => onOutline(w.a) && onOutline(w.b));
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

/** The name a copy of a room gets: "Bedroom" becomes "Bedroom 2", "Bedroom 2" becomes "Bedroom 3". */
function copyName(plan: FloorPlan, name: string): string {
  const base = name.replace(/\s+\d+$/, "");
  const used = new Set(plan.rooms.map((r) => r.name));
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Copy rooms (with their doors, windows, fixtures and furniture), walls,
 * stairs and fixtures, a little way over. Returns the new plan and the ids
 * of the copies, to select them.
 */
export function duplicateMany(plan: FloorPlan, ids: string[], d: Point = { x: COPY_OFFSET_IN, y: COPY_OFFSET_IN }): { plan: FloorPlan; ids: string[] } {
  const m = members(plan, ids);
  if (!m.rooms.length && !m.walls.length && !m.stairs.length && !plan.fixtures.some((f) => ids.includes(f.id))) return { plan, ids: [] };
  const mv = (p: Point) => roundPoint({ x: p.x + d.x, y: p.y + d.y });
  const map = new Map<string, string>();
  const fresh = (old: string, prefix: string) => {
    const id = newPlanId(prefix);
    map.set(old, id);
    return id;
  };
  let working = plan;
  const rooms = m.rooms.map((r) => {
    const { briefRoomId: _brief, stairStack: _stack, anchored: _anchored, ...rest } = r;
    void _brief;
    void _stack;
    void _anchored;
    const copy = { ...rest, id: fresh(r.id, "r"), name: copyName(working, r.name), polygon: r.polygon.map(mv) };
    working = { ...working, rooms: [...working.rooms, copy] };
    return copy;
  });
  const walls = m.walls.map((w) => ({ ...w, id: fresh(w.id, "w"), a: mv(w.a), b: mv(w.b) }));
  // Copies of anchored or stacked stairs start free, on their own.
  const stairs = m.stairs.map(({ stackId: _stack, anchored: _anchored, ...s }) => (void _stack, void _anchored, { ...s, id: fresh(s.id, "s"), x: round1(s.x + d.x), y: round1(s.y + d.y) }));
  const fixtures = m.fixtures.map((f) => ({ ...f, id: fresh(f.id, "f"), x: round1(f.x + d.x), y: round1(f.y + d.y), roomId: f.roomId && map.has(f.roomId) ? map.get(f.roomId) : f.roomId }));
  const furniture = m.furniture.map((f) => ({ ...f, id: newPlanId("m"), x: round1(f.x + d.x), y: round1(f.y + d.y), roomId: f.roomId ? map.get(f.roomId) : f.roomId }));
  const riders = ridersIn(plan, m.roomIds);
  const copy = <T extends Rider>(x: T, prefix: string): T => ({ ...x, id: newPlanId(prefix), x: round1(x.x + d.x), y: round1(x.y + d.y), roomId: x.roomId ? map.get(x.roomId) : x.roomId });
  const openings: Opening[] = m.openings
    .filter((o) => !ids.includes(o.id) || ("roomId" in o.host ? m.roomIds.has(o.host.roomId) : m.wallIds.has(o.host.wallId)))
    .map((o) => ({ ...o, id: newPlanId("o"), host: "roomId" in o.host ? { roomId: map.get(o.host.roomId)!, edge: o.host.edge } : { wallId: map.get(o.host.wallId)! } }));
  const open = ownOpenWalls(plan, m.rooms).map((w) => ({ a: mv(w.a), b: mv(w.b) }));
  const next: FloorPlan = {
    ...plan,
    ...(open.length || plan.openWalls ? { openWalls: [...(plan.openWalls ?? []), ...open] } : {}),
    rooms: [...plan.rooms, ...rooms],
    walls: [...plan.walls, ...walls],
    openings: [...plan.openings, ...openings],
    stairs: [...plan.stairs, ...stairs],
    fixtures: [...plan.fixtures, ...fixtures],
    furniture: [...plan.furniture, ...furniture],
  };
  const withRiders = addRiders(next, { addOns: riders.addOns.map((x) => copy(x, "ao")), cabinets: riders.cabinets.map((x) => copy(x, "cab")), devices: riders.devices.map((x) => copy(x, "dev")) });
  return { plan: pruneOpenWalls(withRiders), ids: [...rooms.map((r) => r.id), ...walls.map((w) => w.id), ...stairs.map((s) => s.id), ...fixtures.filter((f) => !f.roomId || !map.has(f.roomId) || ids.includes(f.id)).map((f) => f.id)] };
}

export type Flip = "left-right" | "top-bottom";

/**
 * Flip rooms (with their doors, windows, fixtures and furniture), walls,
 * stairs and fixtures, left-right or top-bottom, around the middle of the
 * whole selection, so the group stays where it is.
 */
export function mirrorMany(plan: FloorPlan, ids: string[], flip: Flip): FloorPlan {
  const m = members(plan, unlocked(plan, ids));
  const pts = [...m.rooms.flatMap((r) => r.polygon), ...m.walls.flatMap((w) => [w.a, w.b]), ...m.stairs, ...m.fixtures];
  const box = boundsOf(pts.map((p) => ({ x: p.x, y: p.y })));
  if (!box) return plan;
  const lr = flip === "left-right";
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const mp = (p: Point): Point => roundPoint(lr ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: 2 * cy - p.y });
  // A direction that faces rotation r (degrees clockwise from north) faces -r after a left-right flip, and 180 - r after a top-bottom one.
  const turn = (r: number) => (((Math.round((lr ? -r : 180 - r) * 10) / 10) % 360) + 360) % 360;
  const flipped = new Map<string, number>(); // room id -> number of corners
  const rooms = plan.rooms.map((r) => {
    if (!m.roomIds.has(r.id)) return r;
    flipped.set(r.id, r.polygon.length);
    // Flipping turns the outline counter-clockwise; reversing puts it back clockwise.
    // Bulges count outward from the room, so they keep their values and just follow their edges.
    return withBulges({ ...r, polygon: r.polygon.map(mp).reverse() }, reverseBulges(r.bulges, r.polygon.length));
  });
  const openings = plan.openings.map((o) => {
    if ("roomId" in o.host) {
      const n = flipped.get(o.host.roomId);
      if (n === undefined) return o;
      const room = plan.rooms.find((r) => r.id === (o.host as { roomId: string }).roomId)!;
      // Old edge i becomes edge n - 2 - i, running the other way: offsets measure from the other end and the hinge swaps ends.
      return { ...o, host: { roomId: o.host.roomId, edge: (2 * n - 2 - o.host.edge) % n }, offsetIn: round1(roomEdgeLength(room, o.host.edge) - o.offsetIn), hinge: o.hinge === "start" ? ("end" as const) : ("start" as const) };
    }
    if (!m.wallIds.has(o.host.wallId)) return o;
    // A loose wall keeps its direction, so the swing side is what flips.
    return { ...o, side: o.side === 1 ? (-1 as const) : (1 as const) };
  });
  const own = ownOpenWalls(plan, m.rooms);
  const openWalls = plan.openWalls ? plan.openWalls.map((w) => (own.includes(w) ? { a: mp(w.a), b: mp(w.b) } : w)) : undefined;
  const next: FloorPlan = {
    ...plan,
    ...(openWalls ? { openWalls } : {}),
    rooms,
    // A loose wall keeps its direction, so a curve that bowed to its left now bows to its right.
    walls: plan.walls.map((w) => (m.wallIds.has(w.id) ? { ...w, a: mp(w.a), b: mp(w.b), ...(w.bulge ? { bulge: -w.bulge } : {}) } : w)),
    openings,
    stairs: plan.stairs.map((s) => (m.stairs.includes(s) ? { ...s, ...mp(s), rotation: turn(s.rotation), flip: s.shape === "l" ? !s.flip : s.flip, ...(s.railings ? { railings: mirrorRailingEdits(s) } : {}) } : s)),
    fixtures: plan.fixtures.map((f) => (m.fixtures.includes(f) ? { ...f, ...mp(f), rotation: turn(f.rotation), ...(f.faucet ? { faucet: mirrorFaucet(f) } : {}) } : f)),
    furniture: plan.furniture.map((f) => (m.furniture.includes(f) ? { ...f, ...mp(f), rotation: turn(f.rotation) } : f)),
    ...mapRiders(plan, (x) => (x.roomId && m.roomIds.has(x.roomId) ? { ...x, ...mp(x), rotation: turn(x.rotation) } : x)),
  };
  return pruneOpenWalls(next);
}

export type Align = "tops" | "bottoms" | "lefts" | "rights" | "same-width" | "same-depth";

/** Why rooms can't be lined up this way, or null when they can. */
export function whyNotAlign(plan: FloorPlan, ids: string[], how: Align): string | null {
  const rooms = plan.rooms.filter((r) => ids.includes(r.id));
  if (rooms.length < 2) return "Pick two or more rooms.";
  if (rooms.some((r) => isLocked(plan, r.id))) return "Anchored stair halls stay where they are. Click Unanchor on the stairs to line them up.";
  if ((how === "same-width" || how === "same-depth") && !rooms.every((r) => isRectangle(r.polygon) && axisAligned(r.polygon))) return "Making sizes match works on straight rectangular rooms.";
  return null;
}

const axisAligned = (poly: Point[]) => edgesOf(poly).every((e) => Math.abs(e.a.x - e.b.x) < 0.5 || Math.abs(e.a.y - e.b.y) < 0.5);

/**
 * Line rooms up with the topmost / bottommost / leftmost / rightmost one, or
 * make them all the width or depth of the first room picked (kept at their top-left corners).
 */
export function alignMany(plan: FloorPlan, ids_: string[], how: Align): FloorPlan {
  const ids = unlocked(plan, ids_);
  if (whyNotAlign(plan, ids, how)) return plan;
  const rooms = ids.map((id) => plan.rooms.find((r) => r.id === id)).filter((r): r is PlanRoom => !!r);
  const box = (r: PlanRoom) => boundsOf(r.polygon)!;
  if (how === "same-width" || how === "same-depth") {
    const ref = box(rooms[0]);
    let next = plan;
    for (const r of rooms.slice(1)) {
      const b = box(r);
      const kx = how === "same-width" ? (ref.x1 - ref.x0) / (b.x1 - b.x0) : 1;
      const ky = how === "same-depth" ? (ref.y1 - ref.y0) / (b.y1 - b.y0) : 1;
      next = reshapeRoom(next, r.id, r.polygon.map((p) => ({ x: b.x0 + (p.x - b.x0) * kx, y: b.y0 + (p.y - b.y0) * ky })));
    }
    return next;
  }
  const edge = how === "tops" ? Math.min(...rooms.map((r) => box(r).y0)) : how === "bottoms" ? Math.max(...rooms.map((r) => box(r).y1)) : how === "lefts" ? Math.min(...rooms.map((r) => box(r).x0)) : Math.max(...rooms.map((r) => box(r).x1));
  let next = plan;
  for (const r of rooms) {
    const b = box(r);
    const dx = how === "lefts" ? edge - b.x0 : how === "rights" ? edge - b.x1 : 0;
    const dy = how === "tops" ? edge - b.y0 : how === "bottoms" ? edge - b.y1 : 0;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) next = moveMany(next, [r.id], dx, dy);
  }
  return next;
}
