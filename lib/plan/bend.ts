import type { FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { bulgeOf, isCurved, roomEdgeArc, roomEdgeLength, withBulges, wallArc, wallLength } from "./arcs";
import { add, dist, leftNormal, round1, scale, signedArea, sub, unit } from "./geometry";
import { clampOffset } from "./walls";

/**
 * Bending a wall: the helpers behind the diamond handle and the Radius and
 * Bow depth boxes. A bend is one number, how far the middle of the wall sits
 * from the straight line between its ends (see arcs.ts). Pure functions.
 */

/** A room edge or a wall drawn on its own. */
export type BendTarget = { roomId: string; edge: number } | { wallId: string };

export type BendInfo = {
  a: Point;
  b: Point;
  chord: number;
  /** Bulge to the left of a→b (negative: right). */
  left: number;
  /** Multiply a left bulge by this to get the number the room stores (out of the room is positive). 1 for a wall. */
  out: 1 | -1;
  /** Length along the wall: the arc length when it's curved. */
  length: number;
  /** Radius, or null when straight. */
  radius: number | null;
};

/** A curve may bow at most to a half circle. */
export const maxBow = (chord: number) => chord / 2;

const outOf = (room: Pick<PlanRoom, "polygon">): 1 | -1 => (signedArea(room.polygon) >= 0 ? 1 : -1);

export function bendInfo(plan: FloorPlan, t: BendTarget): BendInfo | null {
  if ("roomId" in t) {
    const room = plan.rooms.find((r) => r.id === t.roomId);
    if (!room || t.edge >= room.polygon.length) return null;
    const a = room.polygon[t.edge];
    const b = room.polygon[(t.edge + 1) % room.polygon.length];
    const out = outOf(room);
    const arc = roomEdgeArc(room, t.edge);
    return { a, b, chord: dist(a, b), left: bulgeOf(room, t.edge) * out, out, length: roomEdgeLength(room, t.edge), radius: arc?.radius ?? null };
  }
  const w = plan.walls.find((x) => x.id === t.wallId);
  if (!w) return null;
  const arc = wallArc(w);
  return { a: w.a, b: w.b, chord: dist(w.a, w.b), left: w.bulge ?? 0, out: 1, length: wallLength(w), radius: arc?.radius ?? null };
}

/** Radius of the circle through a chord's ends that bows `bow` inches (any sign). */
export function radiusFor(chord: number, bow: number): number {
  const s = Math.abs(bow);
  const h = chord / 2;
  return s < 1e-6 ? Infinity : (h * h + s * s) / (2 * s);
}

/** How far a chord's middle bows for a circle of this radius (at least half the chord, or it can't reach). */
export function bowForRadius(chord: number, radius: number): number {
  const h = chord / 2;
  const r = Math.max(radius, h);
  return r - Math.sqrt(Math.max(0, r * r - h * h));
}

/** Where the pointer says the middle of the wall should be: its distance to the left of the chord, clamped to a half circle. */
export function bowFromPoint(a: Point, b: Point, p: Point): number {
  const n = leftNormal(unit(sub(b, a)));
  const mid = scale(add(a, b), 0.5);
  const d = (p.x - mid.x) * n.x + (p.y - mid.y) * n.y;
  const max = maxBow(dist(a, b));
  return Math.max(-max, Math.min(max, d));
}

export type BendSnap = "flat" | "half" | "radius" | null;

/**
 * Pull a bow toward the shapes people mean: straight, a half circle, or the
 * radius of a curve already on the plan. `s` is the zoom (pixels per inch),
 * so the pull is the same few pixels at any zoom.
 */
export function snapBow(chord: number, left: number, radii: number[], s: number, off = false): { left: number; snap: BendSnap } {
  if (off) return { left, snap: null };
  const px = 8 / s;
  const sign = left < 0 ? -1 : 1;
  const mag = Math.abs(left);
  if (mag < px) return { left: 0, snap: "flat" };
  const half = maxBow(chord);
  if (Math.abs(mag - half) < px) return { left: sign * half, snap: "half" };
  const r = radiusFor(chord, mag);
  let best: { r: number; gap: number } | null = null;
  for (const other of radii) {
    if (other < half - 0.01) continue;
    const gap = Math.abs(bowForRadius(chord, other) - mag);
    if (gap < px && (!best || gap < best.gap)) best = { r: other, gap };
  }
  if (best && Math.abs(best.r - r) > 0.05) return { left: sign * bowForRadius(chord, best.r), snap: "radius" };
  return { left, snap: null };
}

/** Radii of the curves on a plan, for snapping a new bend to a nearby one. */
export function planRadii(plan: FloorPlan, skip: BendTarget[] = []): number[] {
  const out: number[] = [];
  const skipped = (t: BendTarget) => skip.some((k) => ("roomId" in k && "roomId" in t ? k.roomId === t.roomId && k.edge === t.edge : "wallId" in k && "wallId" in t && k.wallId === t.wallId));
  for (const r of plan.rooms)
    r.polygon.forEach((_, i) => {
      const arc = roomEdgeArc(r, i);
      if (arc && !skipped({ roomId: r.id, edge: i })) out.push(arc.radius);
    });
  for (const w of plan.walls) {
    const arc = wallArc(w);
    if (arc && !skipped({ wallId: w.id })) out.push(arc.radius);
  }
  return out;
}

const SAME_IN = 1;

/** Other rooms' edges that are the same wall: same two ends, either way round. `flip` is true when they run the other way. */
export function sharedEdges(plan: FloorPlan, roomId: string, edge: number): { roomId: string; edge: number; flip: boolean }[] {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % room.polygon.length];
  const out: { roomId: string; edge: number; flip: boolean }[] = [];
  for (const o of plan.rooms) {
    if (o.id === roomId) continue;
    o.polygon.forEach((c, j) => {
      const d = o.polygon[(j + 1) % o.polygon.length];
      if (dist(c, a) <= SAME_IN && dist(d, b) <= SAME_IN) out.push({ roomId: o.id, edge: j, flip: false });
      else if (dist(c, b) <= SAME_IN && dist(d, a) <= SAME_IN) out.push({ roomId: o.id, edge: j, flip: true });
    });
  }
  return out;
}

function setStored(room: PlanRoom, edge: number, stored: number): PlanRoom {
  const bulges = Array.from({ length: room.polygon.length }, (_, k) => (k === edge ? stored : bulgeOf(room, k)));
  return withBulges(room, bulges);
}

/** Doors and windows on a wall that changed length keep their place in proportion. */
function keepProportion(plan: FloorPlan, before: FloorPlan, hosts: BendTarget[]): FloorPlan {
  const openings = plan.openings.map((o): Opening => {
    const t = hosts.find((h) => ("roomId" in h && "roomId" in o.host ? h.roomId === o.host.roomId && h.edge === o.host.edge : "wallId" in h && "wallId" in o.host && h.wallId === o.host.wallId));
    if (!t) return o;
    const was = bendInfo(before, t);
    const now = bendInfo(plan, t);
    if (!was || !now || Math.abs(was.length - now.length) < 0.01) return o;
    return { ...o, offsetIn: round1(clampOffset((o.offsetIn / was.length) * now.length, o.widthIn, now.length)) };
  });
  return { ...plan, openings };
}

/**
 * Give a room edge or a loose wall a bend. `left` is the bow to the left of
 * a→b in inches. A wall two rooms share bends in both, unless `alone`.
 */
export function bendWall(plan: FloorPlan, t: BendTarget, left: number, alone = false): FloorPlan {
  const info = bendInfo(plan, t);
  if (!info) return plan;
  const clamped = Math.max(-maxBow(info.chord), Math.min(maxBow(info.chord), left));
  const bow = isCurved(clamped) ? round1(clamped) : 0;
  if (!("roomId" in t)) {
    const walls = plan.walls.map((w) => {
      if (w.id !== t.wallId) return w;
      const { bulge: _b, ...rest } = w;
      void _b;
      return bow ? { ...rest, bulge: bow } : rest;
    });
    return keepProportion({ ...plan, walls }, plan, [t]);
  }
  const touched: BendTarget[] = [t];
  const sets = new Map<string, { edge: number; stored: number }[]>();
  const put = (roomId: string, edge: number, stored: number) => sets.set(roomId, [...(sets.get(roomId) ?? []), { edge, stored }]);
  put(t.roomId, t.edge, bow * info.out);
  if (!alone) {
    for (const s of sharedEdges(plan, t.roomId, t.edge)) {
      const other = plan.rooms.find((r) => r.id === s.roomId)!;
      put(s.roomId, s.edge, (s.flip ? -bow : bow) * outOf(other));
      touched.push({ roomId: s.roomId, edge: s.edge });
    }
  }
  const rooms = plan.rooms.map((r) => (sets.has(r.id) ? sets.get(r.id)!.reduce((room, x) => setStored(room, x.edge, x.stored), r) : r));
  return keepProportion({ ...plan, rooms }, plan, touched);
}

/** Make a wall straight again. */
export const straighten = (plan: FloorPlan, t: BendTarget, alone = false): FloorPlan => bendWall(plan, t, 0, alone);

/** Bend to a typed radius, keeping the side it already bows to (a straight wall bows out of its room). */
export function bendToRadius(plan: FloorPlan, t: BendTarget, radius: number, alone = false): FloorPlan {
  const info = bendInfo(plan, t);
  if (!info) return plan;
  const sign = info.left !== 0 ? Math.sign(info.left) : info.out;
  return bendWall(plan, t, sign * bowForRadius(info.chord, radius), alone);
}

/** Bend to a typed bow depth, keeping the side it already bows to (a straight wall bows out of its room). */
export function bendToDepth(plan: FloorPlan, t: BendTarget, depth: number, alone = false): FloorPlan {
  const info = bendInfo(plan, t);
  if (!info) return plan;
  const sign = info.left !== 0 ? Math.sign(info.left) : info.out;
  return bendWall(plan, t, sign * Math.abs(depth), alone);
}

// ---------- Doors and windows on curves ----------

/** A flat unit may stand this far off the curve before it needs a narrower size. */
export const UNIT_SLACK_IN = 2;

/** How far a straight unit of this width sticks out of a wall of this radius, at its middle. */
export const unitStickOut = (width: number, radius: number): number => bowForRadius(width, radius);

/** The widest straight unit a wall of this radius can take, rounded down to a whole inch. */
export function widestUnit(radius: number): number {
  // Solve radius - sqrt(r² - (w/2)²) = slack.
  const w = 2 * Math.sqrt(radius * radius - (radius - UNIT_SLACK_IN) ** 2);
  return Math.floor(w);
}

/** Openings too wide for the curve they sit in. */
export function tooWideForCurve(plan: FloorPlan): { opening: Opening; radius: number; fits: number }[] {
  const out: { opening: Opening; radius: number; fits: number }[] = [];
  for (const o of plan.openings) {
    let radius: number | null = null;
    if ("roomId" in o.host) {
      const room = plan.rooms.find((r) => r.id === (o.host as { roomId: string }).roomId);
      radius = room && o.host.edge < room.polygon.length ? (roomEdgeArc(room, o.host.edge)?.radius ?? null) : null;
    } else {
      const w = plan.walls.find((x) => x.id === (o.host as { wallId: string }).wallId);
      radius = w ? (wallArc(w)?.radius ?? null) : null;
    }
    if (radius !== null && o.widthIn > 2 * radius) out.push({ opening: o, radius, fits: 0 });
    else if (radius !== null && unitStickOut(o.widthIn, radius) > UNIT_SLACK_IN) out.push({ opening: o, radius, fits: widestUnit(radius) });
  }
  return out;
}
