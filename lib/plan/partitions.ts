import type { FloorPlan, Opening, OpeningHost, PlanRoom, PlanWall, Point } from "@/lib/model/schema";
import { cleanRing } from "@/lib/house3d/footprint";
import { makeRoom } from "./edit";
import { pruneOpenWalls } from "./openWalls";
import {
  clockwise,
  collinearOverlap,
  cross,
  dist,
  dot,
  edgesOf,
  lerp,
  pointInPolygon,
  polygonArea,
  polygonsOverlap,
  project,
  round1,
  roundPoint,
  signedArea,
  sub,
  subtractIntervals,
  unit,
} from "./geometry";
import { hostSegment, openingGeometry } from "./walls";

/**
 * Drawing walls inside rooms: a wall drawn from one wall of a room to
 * another splits the room in two (`splitRoom`), and walls drawn first can
 * be turned into a room by clicking inside the space they close in (`fillRoomAt`).
 */

/** How close (inches) a wall's end has to be to a room's wall to count as touching it. */
const TOUCH_IN = 2;
/** The smallest room a split can make: a small closet. */
const MIN_PIECE_SQIN = 4 * 144;

/** The next free "Room 2", "Room 3" name on the plan. */
export function nextRoomName(plan: FloorPlan): string {
  const used = new Set(plan.rooms.map((r) => r.name));
  let n = 2;
  while (used.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}

/** Where a point sits on a room's outline: which edge and how far along it, or null when it's off the outline. */
function onOutline(poly: Point[], p: Point, tol: number): { edge: number; t: number; at: Point } | null {
  let best: { edge: number; t: number; at: Point; d: number } | null = null;
  for (const e of edgesOf(poly)) {
    const pr = project(p, e.a, e.b);
    if (pr.d <= tol && (!best || pr.d < best.d)) best = { edge: e.i, t: pr.t, at: pr.point, d: pr.d };
  }
  return best;
}

const distToOutline = (poly: Point[], p: Point) => Math.min(...edgesOf(poly).map((e) => project(p, e.a, e.b).d));

/**
 * How a line of walls cuts across a room: both ends on the room's outline,
 * everything between inside it. The two outlines it makes, or null when it
 * doesn't run from wall to wall (then it's a divider wall inside the room).
 */
export function splitOutlines(poly: Point[], path: Point[]): [Point[], Point[]] | null {
  if (path.length < 2) return null;
  const first = onOutline(poly, path[0], TOUCH_IN);
  const last = onOutline(poly, path[path.length - 1], TOUCH_IN);
  if (!first || !last) return null;
  const inner = path.slice(1, -1);
  // The turns in between stay inside the room, clear of its walls.
  if (inner.some((p) => !pointInPolygon(p, poly) || distToOutline(poly, p) < TOUCH_IN)) return null;
  const line = [first.at, ...inner, last.at];
  for (let k = 0; k < line.length - 1; k++) {
    for (let s = 1; s < 8; s++) {
      const q = lerp(line[k], line[k + 1], s / 8);
      if (!pointInPolygon(q, poly) || distToOutline(poly, q) < 0.5) return null;
    }
  }
  // The outline with both ends put in as corners, in order around it (an end on a corner is that corner).
  const n = poly.length;
  const ends = [first, last].map((e) => {
    const L = dist(poly[e.edge], poly[(e.edge + 1) % n]);
    return { ...e, point: e.t < 0.5 ? poly[e.edge] : e.t > L - 0.5 ? poly[(e.edge + 1) % n] : null };
  });
  const ring: Point[] = [];
  poly.forEach((v, i) => {
    ring.push(v);
    for (const e of ends.filter((x) => x.edge === i && !x.point).sort((x, y) => x.t - y.t)) {
      e.point = { ...e.at };
      ring.push(e.point);
    }
  });
  const where = ends.map((e) => ring.indexOf(e.point!));
  const [iA, iB] = where;
  if (iA < 0 || iB < 0 || iA === iB) return null;
  const chain = (from: number, to: number) => {
    const out: Point[] = [];
    for (let i = from; ; i = (i + 1) % ring.length) {
      out.push(ring[i]);
      if (i === to) break;
    }
    return out;
  };
  const one = cleanRing([...chain(iA, iB), ...[...inner].reverse()].map(roundPoint));
  const two = cleanRing([...chain(iB, iA), ...inner].map(roundPoint));
  if (one.length < 3 || two.length < 3) return null;
  const [a1, a2, whole] = [polygonArea(one), polygonArea(two), polygonArea(poly)];
  if (a1 < MIN_PIECE_SQIN || a2 < MIN_PIECE_SQIN || Math.abs(a1 + a2 - whole) > Math.max(2, whole * 0.002)) return null;
  return [clockwise(one), clockwise(two)];
}

/** The room a line of walls cuts across, if any (the first one it splits cleanly). */
export function roomSplitBy(plan: FloorPlan, path: Point[]): PlanRoom | null {
  return plan.rooms.find((r) => splitOutlines(r.polygon, path)) ?? null;
}

/**
 * Split a room along a line of walls drawn across it. The bigger piece keeps
 * the room (its id, name, type and finishes); the other is a new room named
 * "Room 2" (or the next free number). Doors and windows stay where they are,
 * on whichever piece now holds that wall; fixtures and furniture go with the
 * piece they stand in. Null when the line doesn't cut across a room.
 */
export function splitRoom(plan: FloorPlan, path: Point[]): { plan: FloorPlan; roomId: string; newRoomId: string } | null {
  const room = roomSplitBy(plan, path);
  if (!room) return null;
  const [one, two] = splitOutlines(room.polygon, path)!;
  const [big, small] = polygonArea(one) >= polygonArea(two) ? [one, two] : [two, one];
  const kept: PlanRoom = { ...room, polygon: big };
  const made = makeRoom(small, nextRoomName(plan));
  const rooms = plan.rooms.flatMap((r) => (r.id === room.id ? [kept, made] : [r]));
  const into = (x: { x: number; y: number }) => (pointInPolygon(x, small) ? made.id : room.id);
  const regroup = <T extends { x: number; y: number; roomId?: string }>(x: T): T => (x.roomId === room.id ? { ...x, roomId: into(x) } : x);
  const next: FloorPlan = { ...plan, rooms, fixtures: plan.fixtures.map(regroup), furniture: plan.furniture.map(regroup) };
  return { plan: pruneOpenWalls(rehost(plan, next, new Set([room.id]))), roomId: room.id, newRoomId: made.id };
}

// ---------- Fill room ----------

type Seg = { a: Point; b: Point };

/** The walls of a floor, as plain lines: every room edge and every wall drawn on its own. */
function planLines(plan: FloorPlan): Seg[] {
  return [...plan.rooms.flatMap((r) => edgesOf(r.polygon).map((e) => ({ a: e.a, b: e.b }))), ...plan.walls.map((w) => ({ a: w.a, b: w.b }))].filter((s) => dist(s.a, s.b) > 0.5);
}

/** Where two lines cross or touch (an end on the other line, a T), as inches along the first. */
function cutsAlong(s: Seg, o: Seg, tol: number): number[] {
  const L = dist(s.a, s.b);
  const r = sub(s.b, s.a);
  const q = sub(o.b, o.a);
  const out: number[] = [];
  const den = cross(r, q);
  if (Math.abs(den) > 1e-9) {
    const t = cross(sub(o.a, s.a), q) / den;
    const u = cross(sub(o.a, s.a), r) / den;
    const slackS = tol / L;
    const slackO = tol / dist(o.a, o.b);
    if (t >= -slackS && t <= 1 + slackS && u >= -slackO && u <= 1 + slackO) out.push(Math.max(0, Math.min(L, t * L)));
  }
  // Ends of the other line lying on this one (also collinear overlaps).
  for (const p of [o.a, o.b]) {
    const pr = project(p, s.a, s.b);
    if (pr.d <= tol) out.push(pr.t);
  }
  return out;
}

/**
 * The closed spaces the walls on a floor make, as outlines: every line is
 * cut where others cross or meet it, loose ends are trimmed off, and each
 * face of what's left is traced.
 */
function closedSpaces(lines: Seg[]): Point[][] {
  const tol = 1;
  const verts: Point[] = [];
  const vid = (p: Point) => {
    const i = verts.findIndex((v) => dist(v, p) <= tol);
    if (i >= 0) return i;
    verts.push(p);
    return verts.length - 1;
  };
  const edges = new Set<string>();
  for (const s of lines) {
    const L = dist(s.a, s.b);
    const ts = [0, L, ...lines.filter((o) => o !== s).flatMap((o) => cutsAlong(s, o, tol))].sort((x, y) => x - y);
    let prev = vid(s.a);
    for (const t of ts.slice(1)) {
      const cur = vid(t >= L - 0.01 ? s.b : lerp(s.a, s.b, t / L));
      if (cur !== prev) edges.add(prev < cur ? `${prev}:${cur}` : `${cur}:${prev}`);
      prev = cur;
    }
  }
  const nbrs = new Map<number, Set<number>>();
  for (const e of edges) {
    const [i, j] = e.split(":").map(Number);
    if (!nbrs.has(i)) nbrs.set(i, new Set());
    if (!nbrs.has(j)) nbrs.set(j, new Set());
    nbrs.get(i)!.add(j);
    nbrs.get(j)!.add(i);
  }
  // Loose ends (a divider poking into a space) don't close anything in.
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (const [v, ns] of nbrs) {
      if (ns.size >= 2) continue;
      for (const n of ns) nbrs.get(n)?.delete(v);
      nbrs.delete(v);
      trimmed = true;
    }
  }
  const angle = (from: number, to: number) => Math.atan2(verts[to].y - verts[from].y, verts[to].x - verts[from].x);
  const sorted = new Map([...nbrs].map(([v, ns]) => [v, [...ns].sort((p, q) => angle(v, p) - angle(v, q))]));
  const used = new Set<string>();
  const faces: Point[][] = [];
  for (const [v, ns] of sorted) {
    for (const w of ns) {
      if (used.has(`${v}>${w}`)) continue;
      const face: number[] = [];
      let [u, x] = [v, w];
      while (!used.has(`${u}>${x}`) && face.length <= edges.size * 2) {
        used.add(`${u}>${x}`);
        face.push(u);
        // Turn the tightest way at each corner, so each trace goes round one space.
        const around = sorted.get(x)!;
        const k = around.indexOf(u);
        [u, x] = [x, around[(k - 1 + around.length) % around.length]];
      }
      if (face.length >= 3) faces.push(face.map((i) => verts[i]));
    }
  }
  return faces;
}

/** Why the space at a point can't be filled with a room, or null when it can. */
export function whyNotFill(plan: FloorPlan, p: Point): string | null {
  const inRoom = plan.rooms.find((r) => pointInPolygon(p, r.polygon));
  if (inRoom) return `That spot is already part of ${inRoom.name || "a room"}. Draw a wall across it with the Wall tool to split it.`;
  return fillOutline(plan, p) ? null : "There's no closed space there. Draw walls all the way around it first, then click inside.";
}

/** The outline of the smallest closed space around a point, made by walls and room edges. */
export function fillOutline(plan: FloorPlan, p: Point): Point[] | null {
  let best: Point[] | null = null;
  for (const face of closedSpaces(planLines(plan))) {
    if (!pointInPolygon(p, face)) continue;
    if (!best || Math.abs(signedArea(face)) < Math.abs(signedArea(best))) best = face;
  }
  if (!best) return null;
  const ring = cleanRing(best.map(roundPoint));
  if (ring.length < 3 || polygonArea(ring) < 10 * 144) return null;
  // A space that holds another room inside it isn't one room.
  if (plan.rooms.some((r) => polygonsOverlap(ring, r.polygon))) return null;
  return clockwise(ring);
}

/**
 * Make a room from the space walls close in around a point. The walls drawn
 * on their own that now run along the room's edges become the room's walls
 * (doors and windows in them move onto the room); any part of them that
 * sticks out stays a wall. Null when there's no closed space there.
 */
export function fillRoomAt(plan: FloorPlan, p: Point): { plan: FloorPlan; roomId: string } | null {
  if (whyNotFill(plan, p)) return null;
  const outline = fillOutline(plan, p)!;
  const room = makeRoom(outline);
  const absorbed = new Set<string>();
  const walls: PlanWall[] = [];
  for (const w of plan.walls) {
    const L = dist(w.a, w.b);
    const covered = edgesOf(room.polygon)
      .map((e) => collinearOverlap(w.a, w.b, e.a, e.b, 1))
      .filter((o): o is [number, number] => o !== null);
    if (!covered.length) {
      walls.push(w);
      continue;
    }
    absorbed.add(w.id);
    subtractIntervals(L, covered)
      .filter(([t0, t1]) => t1 - t0 > 1)
      .forEach(([t0, t1], k) => walls.push({ ...w, id: k === 0 ? w.id : `${w.id}-${k}`, a: roundPoint(lerp(w.a, w.b, t0 / L)), b: roundPoint(lerp(w.a, w.b, t1 / L)) }));
  }
  const next: FloorPlan = { ...plan, rooms: [...plan.rooms, room], walls };
  return { plan: rehost(plan, next, absorbed), roomId: room.id };
}

// ---------- Keeping doors and windows in place ----------

/**
 * After rooms or walls are cut up, put each door and window whose wall
 * changed back where it was, on whichever wall now runs there. `changed` is
 * the ids of the rooms and walls that changed. Doors keep swinging the same
 * way even when their new wall runs the other way.
 */
function rehost(before: FloorPlan, after: FloorPlan, changed: Set<string>): FloorPlan {
  const hostId = (h: OpeningHost) => ("roomId" in h ? h.roomId : h.wallId);
  const openings: Opening[] = [];
  for (const o of after.openings) {
    if (!changed.has(hostId(o.host))) {
      openings.push(o);
      continue;
    }
    const g = openingGeometry(before, o);
    if (!g) continue;
    const spot = candidateHosts(after)
      .map((h) => ({ h, seg: hostSegment(after, h)! }))
      .filter((x) => x.seg && Math.abs(dot(unit(sub(x.seg.b, x.seg.a)), g.u)) > 0.99)
      .map((x) => ({ ...x, pr: project(g.center, x.seg.a, x.seg.b) }))
      .find((x) => x.pr.d < 1 && x.pr.t >= o.widthIn / 2 - 1 && x.pr.t <= x.seg.length - o.widthIn / 2 + 1);
    // Its wall is gone altogether: the door or window goes too.
    if (!spot) continue;
    const flipped = dot(unit(sub(spot.seg.b, spot.seg.a)), g.u) < 0;
    openings.push({
      ...o,
      host: spot.h,
      offsetIn: round1(spot.pr.t),
      ...(flipped ? { side: (o.side === 1 ? -1 : 1) as 1 | -1, hinge: o.hinge === "start" ? ("end" as const) : ("start" as const) } : {}),
    });
  }
  return { ...after, openings };
}

/** The walls a moved door or window could land on: every room edge, then walls drawn on their own. */
function candidateHosts(plan: FloorPlan): OpeningHost[] {
  const out: OpeningHost[] = [];
  for (const r of plan.rooms) r.polygon.forEach((_, edge) => out.push({ roomId: r.id, edge }));
  for (const w of plan.walls) out.push({ wallId: w.id });
  return out;
}
