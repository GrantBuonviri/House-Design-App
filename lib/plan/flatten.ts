import type { FloorPlan, OpenWall, Opening, PlanRoom, PlanWall, Point, Project } from "@/lib/model/schema";
import type { Plans } from "./edit";
import { type Arc, angleAlong, isCurved, pointAtAngle, pointOnArc, projectOnArc, roomEdgeArc, roomHasCurves, wallArc } from "./arcs";
import { dist } from "./geometry";

/**
 * Curved walls, flattened for everything outside the 2D editor: each curve
 * becomes short straight pieces, so 3D, the roof, cost, the PDF sheets and
 * the code checks keep working on straight-walled outlines.
 *
 * Pieces end at whole multiples of the step angle around the curve's circle,
 * so two rooms sharing one curved wall flatten to exactly the same points and
 * the usual shared-wall matching still finds it. A door or window on a curve
 * gets one straight piece of its own (it's set in as a flat unit), and every
 * curve on that circle gets the same break, so the wall stays shared.
 */

export const FLAT_STEP_DEG = 5;
/** The roof is built from a coarser outline, so the roof maker isn't handed hundreds of corners. */
export const ROOF_STEP_DEG = 15;
/** A flat unit in a curve gets this much straight wall either side, for its frame. */
const UNIT_PAD_IN = 2;
/** Grid points closer than this to an end or a break (radians, about 1/4°) are skipped. */
const NEAR = (0.25 * Math.PI) / 180;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r2p = (p: Point): Point => ({ x: r2(p.x), y: r2(p.y) });

/** A straight piece of a flattened room: which saved edge it came from, and where it starts along that edge. */
type Piece = { edge: number; t0: number; t1: number };
const pieceMap = new WeakMap<PlanRoom, Piece[]>();

const savedRooms = new WeakMap<PlanRoom, PlanRoom>();

/** The room as saved (with its curves) behind a flattened one, for exact areas. The room itself otherwise. */
export function savedRoom<R extends Pick<PlanRoom, "polygon" | "bulges">>(room: R): R | PlanRoom {
  return savedRooms.get(room as unknown as PlanRoom) ?? room;
}

/** The saved edge a flattened room's edge i came from (accent paint and the like are saved per edge). */
export function sourceEdge(room: PlanRoom, i: number): number {
  return pieceMap.get(room)?.[i]?.edge ?? i;
}

/** A straight stretch of a curve set aside for a door or window, as two points on its circle. */
type Break = { center: Point; radius: number; a: Point; b: Point };

const sameCircle = (arc: Arc, br: Break) => dist(arc.center, br.center) < 0.5 && Math.abs(arc.radius - br.radius) < 0.5;

function hostArc(plan: FloorPlan, o: Opening): Arc | null {
  if ("roomId" in o.host) {
    const room = plan.rooms.find((r) => r.id === (o.host as { roomId: string }).roomId);
    return room && o.host.edge < room.polygon.length ? roomEdgeArc(room, o.host.edge) : null;
  }
  const wall = plan.walls.find((w) => w.id === (o.host as { wallId: string }).wallId);
  return wall ? wallArc(wall) : null;
}

function breaksOf(plan: FloorPlan): Break[] {
  const out: Break[] = [];
  for (const o of plan.openings) {
    const arc = hostArc(plan, o);
    if (!arc) continue;
    const mid = Math.max(0, Math.min(arc.length, o.offsetIn));
    const half = Math.asin(Math.min(1, (o.widthIn / 2 + UNIT_PAD_IN) / arc.radius)) * arc.radius;
    out.push({ center: arc.center, radius: arc.radius, a: pointOnArc(arc, Math.max(0, mid - half)), b: pointOnArc(arc, Math.min(arc.length, mid + half)) });
  }
  return out;
}

/**
 * The corners of an arc after flattening, from `a` to `b` (both ends included),
 * each with how far along the curve it sits (inches).
 */
export function flattenArc(arc: Arc, stepDeg = FLAT_STEP_DEG, breaks: Break[] = []): { p: Point; t: number }[] {
  const total = Math.abs(arc.sweep);
  const sgn = Math.sign(arc.sweep);
  const along = (ang: number) => {
    const v = angleAlong(arc, ang);
    return v > Math.PI * 2 - 1e-6 ? 0 : v;
  };
  // Angles along the arc, each with the circle angle it sits at.
  let marks: { u: number; ang: number }[] = [];
  const step = (stepDeg * Math.PI) / 180;
  for (let k = 0; k * stepDeg < 360; k++) {
    const u = along(k * step);
    if (u > NEAR && u < total - NEAR) marks.push({ u, ang: k * step });
  }
  for (const br of breaks) {
    if (!sameCircle(arc, br)) continue;
    const ua = along(Math.atan2(br.a.y - arc.center.y, br.a.x - arc.center.x));
    const ub = along(Math.atan2(br.b.y - arc.center.y, br.b.x - arc.center.x));
    const lo = Math.min(ua, ub);
    const hi = Math.max(ua, ub);
    if (hi > total + NEAR) continue; // Not on this stretch of the circle.
    marks = marks.filter((m) => m.u < lo - NEAR || m.u > hi + NEAR);
    for (const u of [lo, hi]) if (u > NEAR && u < total - NEAR) marks.push({ u, ang: arc.start + sgn * u });
  }
  marks.sort((m, n) => m.u - n.u);
  return [
    { p: arc.a, t: 0 },
    ...marks.map((m) => ({ p: r2p(pointAtAngle(arc, m.ang)), t: m.u * arc.radius })),
    { p: arc.b, t: arc.length },
  ];
}

/** Whether a floor plan has any curved walls. */
export const planHasCurves = (plan: FloorPlan): boolean => plan.rooms.some(roomHasCurves) || plan.walls.some((w) => isCurved(w.bulge));

/**
 * A copy of the plan with every curved wall replaced by short straight
 * pieces. Doors and windows move to the piece they sit on (same ids), with
 * offsets along that piece. A plan with no curves comes back as it is.
 */
export function flatPlan(plan: FloorPlan, stepDeg = FLAT_STEP_DEG): FloorPlan {
  if (!planHasCurves(plan)) return plan;
  const breaks = breaksOf(plan);
  const curves: { pts: { p: Point; t: number }[]; arc: Arc }[] = [];

  const roomPieces = new Map<string, Piece[]>();
  const rooms = plan.rooms.map((room) => {
    if (!roomHasCurves(room)) return room;
    const poly: Point[] = [];
    const pieces: Piece[] = [];
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const arc = roomEdgeArc(room, i);
      if (!arc) {
        poly.push(room.polygon[i]);
        pieces.push({ edge: i, t0: 0, t1: dist(room.polygon[i], room.polygon[(i + 1) % n]) });
        continue;
      }
      const pts = flattenArc(arc, stepDeg, breaks);
      curves.push({ pts, arc });
      for (let k = 0; k < pts.length - 1; k++) {
        poly.push(pts[k].p);
        pieces.push({ edge: i, t0: pts[k].t, t1: pts[k + 1].t });
      }
    }
    const { bulges: _b, ...rest } = room;
    void _b;
    const flat: PlanRoom = { ...rest, polygon: poly };
    pieceMap.set(flat, pieces);
    savedRooms.set(flat, room);
    roomPieces.set(room.id, pieces);
    return flat;
  });

  const wallPieces = new Map<string, { id: string; t0: number; t1: number }[]>();
  const walls = plan.walls.flatMap((w): PlanWall[] => {
    const arc = wallArc(w);
    if (!arc) return [w];
    const pts = flattenArc(arc, stepDeg, breaks);
    curves.push({ pts, arc });
    const { bulge: _b, ...rest } = w;
    void _b;
    const parts = pts.slice(0, -1).map((pt, k) => ({ ...rest, id: k === 0 ? w.id : `${w.id}~${k}`, a: pt.p, b: pts[k + 1].p }));
    wallPieces.set(w.id, parts.map((p, k) => ({ id: p.id, t0: pts[k].t, t1: pts[k + 1].t })));
    return parts;
  });

  // Doors and windows: onto the piece their middle is on, measured along that piece.
  const pick = <P extends { t0: number; t1: number }>(list: P[], t: number) => list.find((p) => t >= p.t0 - 0.01 && t <= p.t1 + 0.01) ?? list[list.length - 1];
  const openings = plan.openings.map((o): Opening => {
    if ("roomId" in o.host) {
      const pieces = roomPieces.get(o.host.roomId);
      if (!pieces) return o;
      const edge = o.host.edge;
      const mine = pieces.map((p, idx) => ({ ...p, idx })).filter((p) => p.edge === edge);
      if (!mine.length) return o;
      const curved = mine.length > 1;
      if (!curved) return { ...o, host: { roomId: o.host.roomId, edge: mine[0].idx } };
      const at = pick(mine, o.offsetIn);
      return { ...o, host: { roomId: o.host.roomId, edge: at.idx }, offsetIn: r2(onPiece(at.t0, at.t1, o.offsetIn, hostArc(plan, o)!)) };
    }
    const parts = wallPieces.get(o.host.wallId);
    if (!parts) return o;
    const at = pick(parts, o.offsetIn);
    return { ...o, host: { wallId: at.id }, offsetIn: r2(onPiece(at.t0, at.t1, o.offsetIn, hostArc(plan, o)!)) };
  });

  // Removed stretches of a curved wall become the pieces they cover.
  let openWalls: OpenWall[] | undefined = plan.openWalls;
  if (openWalls?.length && curves.length) {
    openWalls = openWalls.flatMap((ow) => {
      for (const c of curves) {
        const pa = projectOnArc(ow.a, c.arc);
        const pb = projectOnArc(ow.b, c.arc);
        if (pa.d > 1 || pb.d > 1) continue;
        const lo = Math.min(pa.t, pb.t);
        const hi = Math.max(pa.t, pb.t);
        const inner = c.pts.filter((q) => q.t > lo + 0.5 && q.t < hi - 0.5).map((q) => q.p);
        const chain = [pointOnArc(c.arc, lo), ...inner, pointOnArc(c.arc, hi)].map(r2p);
        return chain.slice(0, -1).map((a, k) => ({ a, b: chain[k + 1] }));
      }
      return [ow];
    });
  }

  return { ...plan, rooms, walls, openings, ...(openWalls ? { openWalls } : {}) };
}

/** Where a point `s` inches along a curve lands along the straight piece covering t0..t1 of it. */
function onPiece(t0: number, t1: number, s: number, arc: Arc): number {
  const a = pointOnArc(arc, t0);
  const b = pointOnArc(arc, t1);
  const p = pointOnArc(arc, Math.max(t0, Math.min(t1, s)));
  const len = dist(a, b);
  if (len < 1e-6) return 0;
  return ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
}

const caches = new Map<number, WeakMap<Plans, Plans>>();

/**
 * Every level's plan flattened (see flatPlan). Cheap to call more than once:
 * plans without curves come back as they are, and results are remembered.
 */
export function flatPlans(plans: Plans, stepDeg = FLAT_STEP_DEG): Plans {
  let cache = caches.get(stepDeg);
  if (!cache) caches.set(stepDeg, (cache = new WeakMap()));
  const hit = cache.get(plans);
  if (hit) return hit;
  let changed = false;
  const out: Plans = {};
  for (const [id, plan] of Object.entries(plans)) {
    out[id] = flatPlan(plan, stepDeg);
    if (out[id] !== plan) changed = true;
  }
  const result = changed ? out : plans;
  cache.set(plans, result);
  return result;
}

const projectCache = new WeakMap<object, object>();

/** The project with its floor plans flattened, for the PDF sheets, code checks and cost. The same object when nothing is curved. */
export function flatProject<P extends Pick<Project, "floorPlans">>(project: P): P {
  const hit = projectCache.get(project);
  if (hit) return hit as P;
  const floorPlans = flatPlans(project.floorPlans);
  const result = floorPlans === project.floorPlans ? project : { ...project, floorPlans };
  projectCache.set(project, result);
  return result;
}
