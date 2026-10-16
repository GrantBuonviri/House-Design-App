import type { FloorPlan, OpenWall, Opening, OpeningHost, Point, WallHeight } from "@/lib/model/schema";
import { INTERIOR_WALL_IN } from "./basics";
import { areaKind } from "./measure";
import { arcBetween, leftBulge, projectOnEdge, roomEdgeLength, wallLength } from "./arcs";
import { add, collinearOverlap, dist, dot, edgesOf, leftNormal, lerp, polygonCenter, project, scale, sub, subtractIntervals, unit } from "./geometry";

/**
 * Walls are worked out from the rooms. Every room edge is a wall; where two
 * rooms share an edge (on the same line, overlapping), that stretch is one
 * interior wall, and the rest of the edge is an outside wall. Walls drawn on
 * their own are interior walls too. Doors and windows cut gaps in them.
 * An inside wall between two rooms can be removed (`plan.openWalls`): that
 * stretch becomes an open piece with no wall, and the rooms open onto each other.
 */

/** A wall a door or window can sit in. `length` is along the wall (around the curve, when `bulge` is set: how far it bows to the left of a→b). */
export type HostSegment = { a: Point; b: Point; host: OpeningHost; length: number; bulge?: number };

export type WallPiece = {
  a: Point;
  b: Point;
  thicknessIn: number;
  /** An outside wall of the house. */
  exterior: boolean;
  /** The open edge of a porch, deck or patio, or a removed wall: drawn as a dashed line, not a wall. */
  open: boolean;
  /** An inside wall that was taken out (one of `plan.openWalls`): open, and the rooms on both sides count as one space. */
  removed?: boolean;
  /** A wall drawn on its own that stops short of the ceiling (left out for full height). */
  height?: Exclude<WallHeight, "full">;
  host: OpeningHost;
  /** Where the piece starts and ends along its host, inches from the host's start. */
  t0: number;
  t1: number;
};

export type OpeningGeometry = {
  opening: Opening;
  /** The opening's two ends and middle, on the host wall's line. */
  a: Point;
  b: Point;
  center: Point;
  /** Along the host wall, from its start toward its end. */
  u: Point;
  /** The left side of the host wall (outside, for a room edge). */
  n: Point;
  hostLength: number;
};

/** How tall a half wall stands, and how thick the counter cap on top of one is, in inches. */
export const HALF_WALL_IN = 42;
export const WALL_CAP_IN = 1.5;
/** How far a counter cap hangs past each face of its half wall. */
export const WALL_CAP_OVERHANG_IN = 1.5;

export const isHalfWall = (h: WallHeight | undefined): h is Exclude<WallHeight, "full"> => h === "half" || h === "half-cap";

/** How high a wall stands above its floor: the ceiling, or a half wall's height (with its cap). */
export function wallTopIn(piece: Pick<WallPiece, "height">, ceilingIn: number): number {
  if (!piece.height) return ceilingIn;
  return Math.min(ceilingIn, HALF_WALL_IN + (piece.height === "half-cap" ? WALL_CAP_IN : 0));
}

/** Collinear edges closer than this many inches count as one wall. */
const SAME_LINE_IN = 1;

export const sameHost = (a: OpeningHost, b: OpeningHost) =>
  "roomId" in a ? "roomId" in b && a.roomId === b.roomId && a.edge === b.edge : "wallId" in b && a.wallId === b.wallId;

export function hostSegment(plan: FloorPlan, host: OpeningHost): HostSegment | null {
  if ("roomId" in host) {
    const room = plan.rooms.find((r) => r.id === host.roomId);
    if (!room || host.edge >= room.polygon.length) return null;
    const a = room.polygon[host.edge];
    const b = room.polygon[(host.edge + 1) % room.polygon.length];
    return withBulge({ a, b, host, length: dist(a, b) }, leftBulge(room, host.edge), roomEdgeLength(room, host.edge));
  }
  const wall = plan.walls.find((w) => w.id === host.wallId);
  return wall ? withBulge({ a: wall.a, b: wall.b, host, length: dist(wall.a, wall.b) }, wall.bulge ?? 0, wallLength(wall)) : null;
}

export function hostSegments(plan: FloorPlan): HostSegment[] {
  const out: HostSegment[] = [];
  for (const r of plan.rooms) for (const e of edgesOf(r.polygon)) out.push(withBulge({ a: e.a, b: e.b, host: { roomId: r.id, edge: e.i }, length: dist(e.a, e.b) }, leftBulge(r, e.i), roomEdgeLength(r, e.i)));
  for (const w of plan.walls) out.push(withBulge({ a: w.a, b: w.b, host: { wallId: w.id }, length: dist(w.a, w.b) }, w.bulge ?? 0, wallLength(w)));
  return out.filter((s) => s.length > 0.5);
}

const withBulge = (seg: HostSegment, bulge: number, length: number): HostSegment => (bulge ? { ...seg, bulge, length } : seg);

export const openWallsOf = (plan: FloorPlan): OpenWall[] => plan.openWalls ?? [];

/** The stretches of segment a-b (inches from a) where a wall was removed. */
export function openSpans(plan: FloorPlan, a: Point, b: Point): [number, number][] {
  const out: [number, number][] = [];
  for (const w of openWallsOf(plan)) {
    const o = collinearOverlap(a, b, w.a, w.b, SAME_LINE_IN);
    if (o) out.push(o);
  }
  return out;
}

/** Whether the point `t` inches along a-b is on a removed wall. */
export const inSpans = (spans: [number, number][], t: number) => spans.some(([t0, t1]) => t0 - 0.01 <= t && t <= t1 + 0.01);

/** Every wall on a level, each stretch once, before doors and windows are cut in. */
export function wallPieces(plan: FloorPlan, exteriorIn: number): WallPiece[] {
  const pieces: WallPiece[] = [];
  const outdoor = new Set(plan.rooms.filter((r) => areaKind(r) === "outdoor").map((r) => r.id));
  for (const room of plan.rooms) {
    for (const e of edgesOf(room.polygon)) {
      const L = dist(e.a, e.b);
      if (L < 0.5) continue;
      // Stretches of this edge that other rooms' edges lie along.
      const covers: { t0: number; t1: number; roomId: string }[] = [];
      for (const other of plan.rooms) {
        if (other.id === room.id) continue;
        for (const f of edgesOf(other.polygon)) {
          const o = collinearOverlap(e.a, e.b, f.a, f.b, SAME_LINE_IN);
          if (o) covers.push({ t0: o[0], t1: o[1], roomId: other.id });
        }
      }
      const gone = covers.length ? openSpans(plan, e.a, e.b) : [];
      const cuts = [...new Set([0, L, ...covers.flatMap((c) => [c.t0, c.t1]), ...gone.flat()])].filter((t) => t >= 0 && t <= L).sort((p, q) => p - q);
      let run: { t0: number; t1: number; exterior: boolean; open: boolean; removed: boolean; emit: boolean } | null = null;
      const flush = () => {
        if (run && run.emit && run.t1 - run.t0 > 0.01) {
          pieces.push({
            a: lerp(e.a, e.b, run.t0 / L),
            b: lerp(e.a, e.b, run.t1 / L),
            thicknessIn: run.open ? 0 : run.exterior ? exteriorIn : INTERIOR_WALL_IN,
            exterior: run.exterior,
            open: run.open,
            ...(run.removed ? { removed: true } : {}),
            host: { roomId: room.id, edge: e.i },
            t0: run.t0,
            t1: run.t1,
          });
        }
        run = null;
      };
      for (let k = 0; k < cuts.length - 1; k++) {
        const [p, q] = [cuts[k], cuts[k + 1]];
        if (q - p < 0.01) continue;
        const mid = (p + q) / 2;
        const by = covers.filter((c) => c.t0 <= mid && mid <= c.t1).map((c) => c.roomId);
        const sides = [room.id, ...by];
        const indoors = sides.filter((id) => !outdoor.has(id)).length;
        // Nothing on the other side, or a porch or deck there: an outside wall.
        // A porch's own edges, away from the house, have no wall at all.
        const shut = indoors > 0 && (by.length === 0 || indoors < sides.length);
        // Only an inside wall between two rooms can be taken out; outside walls always stay.
        const removed = !shut && indoors > 0 && inSpans(gone, mid);
        const open = indoors === 0 || removed;
        const exterior = shut;
        // A shared stretch is drawn once, from the room with the smallest id.
        const emit = by.length === 0 || by.every((id) => room.id < id);
        if (run && run.exterior === exterior && run.open === open && run.removed === removed && run.emit === emit) run.t1 = q;
        else {
          flush();
          run = { t0: p, t1: q, exterior, open, removed, emit };
        }
      }
      flush();
    }
  }
  for (const w of plan.walls) {
    const L = dist(w.a, w.b);
    if (L > 0.5) pieces.push({ a: w.a, b: w.b, thicknessIn: w.thicknessIn, exterior: false, open: false, ...(isHalfWall(w.height) ? { height: w.height } : {}), host: { wallId: w.id }, t0: 0, t1: L });
  }
  return pieces;
}

export function openingGeometry(plan: FloorPlan, o: Opening): OpeningGeometry | null {
  const seg = hostSegment(plan, o.host);
  if (!seg || seg.length < 1) return null;
  const u = unit(sub(seg.b, seg.a));
  const center = add(seg.a, scale(u, o.offsetIn));
  const half = o.widthIn / 2;
  return { opening: o, a: add(center, scale(u, -half)), b: add(center, scale(u, half)), center, u, n: leftNormal(u), hostLength: seg.length };
}

export function openingGeometries(plan: FloorPlan): OpeningGeometry[] {
  return plan.openings.map((o) => openingGeometry(plan, o)).filter((g): g is OpeningGeometry => g !== null);
}

/** How thick a wall is drawn in the 2D floor plan: every full-height or half wall at the outside wall width so joins line up; open edges 0. Real thickness stays `thicknessIn`. */
export function drawThickness(w: { thicknessIn: number; open?: boolean }, exteriorIn: number): number {
  return w.open || w.thicknessIn <= 0 ? 0 : exteriorIn;
}

export type SolidWall = {
  a: Point;
  b: Point;
  thicknessIn: number;
  exterior: boolean;
  open: boolean;
  /** Ends at a corner (not at a door or window), so the wall should run on past it by half its thickness to make a clean corner. */
  capA: boolean;
  capB: boolean;
  piece: WallPiece;
};

/** The walls with gaps where doors, windows and openings are. */
export function solidWalls(pieces: WallPiece[], openings: OpeningGeometry[]): SolidWall[] {
  const out: SolidWall[] = [];
  for (const p of pieces) {
    const L = dist(p.a, p.b);
    const cuts: [number, number][] = [];
    for (const g of openings) {
      const o = collinearOverlap(p.a, p.b, g.a, g.b, Math.max(2, p.thicknessIn / 2 + 0.5));
      if (o) cuts.push(o);
    }
    for (const [t0, t1] of subtractIntervals(L, cuts)) {
      out.push({
        a: lerp(p.a, p.b, t0 / L),
        b: lerp(p.a, p.b, t1 / L),
        thicknessIn: p.thicknessIn,
        exterior: p.exterior,
        open: p.open,
        capA: t0 < 0.01,
        capB: t1 > L - 0.01,
        piece: p,
      });
    }
  }
  return out;
}

/** The closest wall to a point, within `maxDist` inches: where along it, and which side the point is on. */
export function nearestHost(plan: FloorPlan, p: Point, maxDist: number): { seg: HostSegment; t: number; d: number; side: 1 | -1; point: Point; u: Point } | null {
  let best: { seg: HostSegment; t: number; d: number; side: 1 | -1; point: Point; u: Point } | null = null;
  for (const seg of hostSegments(plan)) {
    const pr = projectOnEdge(p, seg.a, seg.b, seg.bulge);
    if (pr.d > maxDist || (best && pr.d >= best.d - 0.01)) continue;
    const arc = arcBetween(seg.a, seg.b, seg.bulge ?? 0);
    // Which way the wall runs where the point lands (square to the radius on a curve).
    const radial = arc ? unit(sub(pr.point, arc.center)) : null;
    const u = arc && radial ? (Math.sign(arc.sweep) >= 0 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x }) : unit(sub(seg.b, seg.a));
    const n = leftNormal(u);
    best = { seg, t: pr.t, d: pr.d, side: dot(sub(p, pr.point), n) >= 0 ? 1 : -1, point: pr.point, u };
  }
  return best;
}

/** Keep an opening's middle far enough from the ends of its wall that it fits. */
export function clampOffset(offset: number, width: number, hostLength: number): number {
  const half = width / 2;
  if (hostLength <= width) return hostLength / 2;
  return Math.min(hostLength - half, Math.max(half, offset));
}

/**
 * The edge of a room's outline that a point on a wall lies along (within
 * `maxD` inches), for telling which of the room's walls it is. Null when
 * the point isn't on one of the room's own edges (a wall drawn inside it).
 * With `facing` (the way the wall's face points), only edges along that wall count.
 */
export function roomEdgeAt(polygon: Point[], p: Point, maxD: number, facing?: Point): number | null {
  let best: { i: number; d: number } | null = null;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    // Only edges running across the way the wall faces (near a corner, the other wall is close too).
    if (facing && Math.abs(dot(unit(sub(b, a)), facing)) > 0.4) return;
    const pr = project(p, a, b);
    if (pr.t < -1 || pr.t > pr.length + 1 || pr.d > maxD) return;
    if (!best || pr.d < best.d) best = { i, d: pr.d };
  });
  return best ? (best as { i: number }).i : null;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

/** Which side of a room an edge is on, as a compass word ("north"), from the way it faces out. */
export function edgeCompass(polygon: Point[], edge: number): string {
  const a = polygon[edge];
  const b = polygon[(edge + 1) % polygon.length];
  // The side facing away from the room's middle is outside (y points south).
  let out = { x: b.y - a.y, y: a.x - b.x };
  if (dot(out, sub(lerp(a, b, 0.5), polygonCenter(polygon))) < 0) out = { x: -out.x, y: -out.y };
  const deg = ((Math.atan2(out.x, -out.y) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}
