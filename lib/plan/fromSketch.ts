import type { BubbleDiagram, DesignBrief, FloorPlan, Level, Opening, PlanBasics, PlanRoom, PlanStairs, Plot, Point } from "@/lib/model/schema";
import { isDrawn, type Bubble } from "@/lib/bubbles/shapes";
import { roomType } from "@/lib/brief/rooms";
import { exteriorWallIn, levelAbove, levelBelow, riseBetween } from "./basics";
import { openingType } from "./catalog";
import { emptyPlan, type Plans } from "./edit";
import { add, boundsOf, clockwise, collinearOverlap, dist, dot, edgesOf, leftNormal, polygonArea, rectangle, rotate, round1, roundPoint, sub, unit } from "./geometry";
import { DEFAULT_STAIRS_WIDTH_IN, stairsDrawing } from "./stairs";
import { wallPieces } from "./walls";

/**
 * Turn the flow sketch into a starting floor plan. Each bubble becomes a
 * rectangle with the same area, in the same spot (a room drawn in any shape
 * keeps a straight-walled version of its outline). Then the rooms are pushed
 * together toward the middle of the floor until they touch, so neighbors
 * share walls, and edges that nearly line up are lined up. Rooms connected in
 * the sketch get a door where they share a wall. The stairs stay put on every
 * floor, and rooms make way for them.
 */

export type PlanContext = { brief: DesignBrief | null; plot: Plot | null; levels: Level[]; basics: PlanBasics | null };

export type FromSketchResult = {
  plans: Plans;
  /** Connected rooms that ended up not sharing a wall: they'll need a hallway. */
  needHall: { levelId: string; a: string; b: string }[];
};

type Rect = { id: string; x0: number; y0: number; x1: number; y1: number; fixed: boolean; poly?: Point[] };

/** Sizes are rounded to whole half-feet. */
const STEP_IN = 6;
const MIN_SIDE_IN = 36;
/** Edges this close (inches) are lined up with each other. */
const ALIGN_IN = 15;
/** Doors need at least this much shared wall. */
const DOOR_ROOM_IN = 30;

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const cx = (r: Rect) => (r.x0 + r.x1) / 2;
const cy = (r: Rect) => (r.y0 + r.y1) / 2;
const overlapX = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const overlapY = (a: Rect, b: Rect) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);

function shift(r: Rect, dx: number, dy: number) {
  r.x0 += dx;
  r.x1 += dx;
  r.y0 += dy;
  r.y1 += dy;
  if (r.poly) r.poly = r.poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** The angle of a bubble's long side, in degrees from east, 0 to 180. */
function longAxisDeg(b: Pick<Bubble, "rx" | "ry" | "rotation">): number {
  const a = (b.rotation ?? 0) + (b.rx >= b.ry ? 0 : 90);
  return ((a % 180) + 180) % 180;
}

/** Ramer–Douglas–Peucker on a closed outline, then corners that hardly turn are dropped. */
export function straightenOutline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 4) return points;
  // Split the ring at its two farthest-apart points so RDP has two open runs.
  let far = 0;
  for (let i = 1; i < points.length; i++) if (dist(points[0], points[i]) > dist(points[0], points[far])) far = i;
  const runA = points.slice(0, far + 1);
  const runB = [...points.slice(far), points[0]];
  const out = [...rdp(runA, tolerance).slice(0, -1), ...rdp(runB, tolerance).slice(0, -1)];
  const kept = out.filter((p, i) => {
    const prev = out[(i - 1 + out.length) % out.length];
    const next = out[(i + 1) % out.length];
    const u = unit(sub(p, prev));
    const v = unit(sub(next, p));
    return Math.abs(u.x * v.y - u.y * v.x) > 0.08;
  });
  return kept.length >= 3 ? kept : out.length >= 3 ? out : points;
}

function rdp(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  let worst = -1;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDistance(points[i], a, b);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [...rdp(points.slice(0, at + 1), tolerance).slice(0, -1), ...rdp(points.slice(at), tolerance)];
}

function segDistance(p: Point, a: Point, b: Point): number {
  const L = dist(a, b);
  if (!L) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), sub(b, a)) / (L * L)));
  return dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}

/** The rectangle (or straightened outline) for one bubble. */
function rectFor(b: Bubble, brief: DesignBrief | null): Rect {
  if (isDrawn(b)) {
    const outline = straightenOutline(b.outline, STEP_IN).map((p) => add(rotate(p, b.rotation ?? 0), { x: b.x, y: b.y }));
    const bb = boundsOf(outline)!;
    return { id: b.id, ...bb, fixed: false, poly: outline };
  }
  const area = Math.PI * b.rx * b.ry;
  const room = brief?.rooms.find((r) => r.id === b.roomId);
  let aspect = Math.min(2.5, Math.max(b.rx, b.ry) / Math.min(b.rx, b.ry));
  let vertical = Math.abs(longAxisDeg(b) - 90) < 45;
  if (b.shape === "circle" && room?.lengthIn && room.widthIn) {
    aspect = Math.max(room.lengthIn, room.widthIn) / Math.min(room.lengthIn, room.widthIn);
    vertical = false;
  }
  const long = Math.max(MIN_SIDE_IN, roundTo(Math.sqrt(area * aspect), STEP_IN));
  const short = Math.max(MIN_SIDE_IN, roundTo(area / long, STEP_IN));
  const [w, h] = vertical ? [short, long] : [long, short];
  return { id: b.id, x0: b.x - w / 2, y0: b.y - h / 2, x1: b.x + w / 2, y1: b.y + h / 2, fixed: false };
}

/** Push apart anything that overlaps, along whichever direction needs the smaller push. */
export function resolveOverlaps(rects: Rect[], rounds = 400): void {
  for (let k = 0; k < rounds; k++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.fixed && b.fixed) continue;
        const ox = overlapX(a, b);
        const oy = overlapY(a, b);
        if (ox <= 0.5 || oy <= 0.5) continue;
        moved = true;
        const alongX = ox < oy;
        const dir = (alongX ? cx(a) - cx(b) : cy(a) - cy(b)) >= 0 ? 1 : -1;
        const amount = alongX ? ox : oy;
        const [ka, kb] = a.fixed ? [0, 1] : b.fixed ? [1, 0] : [0.5, 0.5];
        if (alongX) {
          shift(a, dir * amount * ka, 0);
          shift(b, -dir * amount * kb, 0);
        } else {
          shift(a, 0, dir * amount * ka);
          shift(b, 0, -dir * amount * kb);
        }
      }
    }
    if (!moved) return;
  }
}

/**
 * Slide every room toward the middle of the floor, across then down, until it
 * reaches the middle or touches another room. Nearest rooms go first.
 */
export function compact(rects: Rect[], center: Point, rounds = 60): void {
  for (let k = 0; k < rounds; k++) {
    let total = 0;
    const order = rects.filter((r) => !r.fixed).sort((a, b) => Math.hypot(cx(a) - center.x, cy(a) - center.y) - Math.hypot(cx(b) - center.x, cy(b) - center.y));
    for (const r of order) {
      for (const axis of ["x", "y"] as const) {
        const want = axis === "x" ? center.x - cx(r) : center.y - cy(r);
        if (Math.abs(want) < 0.5) continue;
        const dir = Math.sign(want);
        let travel = Math.abs(want);
        for (const o of rects) {
          if (o === r) continue;
          if (axis === "x") {
            if (overlapY(r, o) <= 0.5) continue;
            if (dir > 0 && o.x0 >= r.x1 - 0.5) travel = Math.min(travel, o.x0 - r.x1);
            if (dir < 0 && o.x1 <= r.x0 + 0.5) travel = Math.min(travel, r.x0 - o.x1);
          } else {
            if (overlapX(r, o) <= 0.5) continue;
            if (dir > 0 && o.y0 >= r.y1 - 0.5) travel = Math.min(travel, o.y0 - r.y1);
            if (dir < 0 && o.y1 <= r.y0 + 0.5) travel = Math.min(travel, r.y0 - o.y1);
          }
        }
        travel = Math.max(0, travel);
        if (travel < 0.01) continue;
        if (axis === "x") shift(r, dir * travel, 0);
        else shift(r, 0, dir * travel);
        total += travel;
      }
    }
    if (total < 1) return;
  }
}

/** Line up edges that nearly line up, so walls run straight. Rooms keep roughly their size. */
export function alignEdges(rects: Rect[], tolerance = ALIGN_IN): void {
  for (const axis of ["x", "y"] as const) {
    const lo: "x0" | "y0" = axis === "x" ? "x0" : "y0";
    const hi: "x1" | "y1" = axis === "x" ? "x1" : "y1";
    const edges = rects
      .filter((r) => !r.poly)
      .flatMap((r) => [
        { r, key: lo as "x0" | "y0" | "x1" | "y1", v: r[lo] },
        { r, key: hi as "x0" | "y0" | "x1" | "y1", v: r[hi] },
      ])
      .sort((a, b) => a.v - b.v);
    const clusters: (typeof edges)[] = [];
    for (const e of edges) {
      const last = clusters[clusters.length - 1];
      if (last && e.v - last[last.length - 1].v <= tolerance && e.v - last[0].v <= tolerance * 2) last.push(e);
      else clusters.push([e]);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      const fixed = [...new Set(c.filter((e) => e.r.fixed).map((e) => e.v))];
      if (fixed.length > 1) continue;
      const value = fixed.length ? fixed[0] : Math.round(c.reduce((s, e) => s + e.v, 0) / c.length);
      const ok = c.every((e) => {
        if (e.r.fixed) return true;
        const size = e.key === lo ? e.r[hi] - value : value - e.r[lo];
        const before = e.r[hi] - e.r[lo];
        return size >= MIN_SIDE_IN - 6 && Math.abs(size - before) / before <= 0.2;
      });
      // Both sides of one room in the same group would squash it.
      if (!ok || new Set(c.map((e) => e.r)).size < c.length) continue;
      for (const e of c) if (!e.r.fixed) e.r[e.key] = value;
    }
  }
}

function rectArea(r: Rect) {
  return (r.x1 - r.x0) * (r.y1 - r.y0);
}

/** Where the stairs go on each level, from the sketch's stairs bubbles. */
function stairsFor(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): Record<string, PlanStairs> {
  const out: Record<string, PlanStairs> = {};
  for (const level of ctx.levels) {
    const above = levelAbove(ctx.levels, level);
    const bubble = diagrams[level.id]?.bubbles.find((b) => b.stairs);
    if (!above || !bubble) continue;
    // The sketch draws stairs long side across; at rotation 0 plan stairs climb north.
    const rotation = Math.round((longAxisDeg(bubble) - 90) / 90) % 2 === 0 ? 0 : 90;
    out[level.id] = {
      id: `st-${level.id}`,
      x: Math.round(bubble.x),
      y: Math.round(bubble.y),
      rotation,
      widthIn: DEFAULT_STAIRS_WIDTH_IN,
      shape: ctx.basics?.stairs ?? "straight",
      flip: false,
      toLevelId: above.id,
    };
  }
  return out;
}

const ROAD_DIR: Record<Plot["roadSide"], Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };
const OPEN_PLAN = new Set(["kitchen", "dining", "living", "family"]);

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

/** A door, or a wide opening for open-plan living spaces, between two connected rooms that share a wall. */
function connectRooms(a: PlanRoom, b: PlanRoom, openKitchen: boolean): Opening | null {
  const wall = sharedWall(a, b);
  if (!wall || wall.t1 - wall.t0 < DOOR_ROOM_IN) return null;
  const room = wall.t1 - wall.t0;
  const mid = (wall.t0 + wall.t1) / 2;
  const host = { roomId: a.id, edge: wall.edge };
  if (openKitchen && OPEN_PLAN.has(a.type ?? "") && OPEN_PLAN.has(b.type ?? "") && room >= 60) {
    return newOpening("opening", host, mid, 1, Math.min(144, roundTo(room - 24, STEP_IN)));
  }
  const outdoor = (r: PlanRoom) => (r.type ? roomType(r.type).category === "outdoor" : false);
  if ((outdoor(a) || outdoor(b)) && room >= 84) return newOpening("door-slider", host, mid, 1, 72);
  // Doors swing into the smaller room. Room corners run clockwise, so the left of a's edge is b.
  const side = polygonArea(b.polygon) <= polygonArea(a.polygon) ? 1 : -1;
  return newOpening("door-hinged", host, mid, side, Math.min(32, roundTo(room - 4, 2)));
}

/** A door on the outside wall of a room that best faces a direction (at least `minFacing`, from -1 to 1). */
function outsideDoor(plan: FloorPlan, room: PlanRoom | undefined, facing: Point, style: string, widthIn: number, exteriorIn: number, minFacing = 0.5): Opening | null {
  if (!room) return null;
  let best: { score: number; host: Opening["host"]; mid: number } | null = null;
  for (const p of wallPieces(plan, exteriorIn)) {
    if (!p.exterior || p.open || !("roomId" in p.host) || p.host.roomId !== room.id) continue;
    const length = p.t1 - p.t0;
    if (length < widthIn + 12) continue;
    const out = leftNormal(unit(sub(p.b, p.a)));
    const score = dot(out, facing) * 1000 + length;
    if (dot(out, facing) > minFacing && (!best || score > best.score)) best = { score, host: p.host, mid: (p.t0 + p.t1) / 2 };
  }
  return best ? newOpening(style, best.host, best.mid, -1, widthIn) : null;
}

export function plansFromSketch(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): FromSketchResult {
  const plans: Plans = {};
  const needHall: FromSketchResult["needHall"] = [];
  const stairs = stairsFor(diagrams, ctx);
  const exteriorIn = exteriorWallIn(ctx.basics);

  for (const level of ctx.levels) {
    const d = diagrams[level.id];
    const plan = emptyPlan();
    const below = levelBelow(ctx.levels, level);
    const myStairs = stairs[level.id];
    const fromBelow = below ? stairs[below.id] : undefined;
    if (myStairs) plan.stairs.push(myStairs);

    // The stairs (going up from here, and coming up from below) hold their place.
    const obstacles: Rect[] = [];
    for (const [s, from] of [
      [myStairs, level],
      [fromBelow, below],
    ] as const) {
      if (!s || !from) continue;
      const to = ctx.levels.find((l) => l.id === s.toLevelId)!;
      const bb = boundsOf(stairsDrawing(s, riseBetween(ctx.basics, from, to)).footprint)!;
      obstacles.push({ id: `${s.id}-${level.id}`, ...bb, fixed: true });
    }

    const bubbles = d?.bubbles.filter((b) => !b.stairs) ?? [];
    if (bubbles.length) {
      const rects = [...obstacles, ...bubbles.map((b) => rectFor(b, ctx.brief))];
      const weight = rects.reduce((s, r) => s + rectArea(r), 0) || 1;
      const center = {
        x: rects.reduce((s, r) => s + cx(r) * rectArea(r), 0) / weight,
        y: rects.reduce((s, r) => s + cy(r) * rectArea(r), 0) / weight,
      };
      resolveOverlaps(rects);
      compact(rects, center);
      alignEdges(rects);
      resolveOverlaps(rects);
      compact(rects, center, 10);

      const byBubble = new Map(rects.map((r) => [r.id, r]));
      for (const b of bubbles) {
        const r = byBubble.get(b.id)!;
        const polygon = (r.poly ?? rectangle(cx(r), cy(r), r.x1 - r.x0, r.y1 - r.y0)).map(roundPoint);
        const type = ctx.brief?.rooms.find((x) => x.id === b.roomId)?.type;
        plan.rooms.push({
          id: `p-${b.id}`,
          name: b.label,
          ...(b.roomId ? { briefRoomId: b.roomId } : {}),
          ...(type ? { type } : {}),
          polygon: clockwise(polygon),
        });
      }

      // Doors between rooms that were connected in the sketch.
      const roomOf = new Map(plan.rooms.map((r) => [r.id.slice(2), r]));
      for (const f of d!.flows) {
        const a = roomOf.get(f.from);
        const b = roomOf.get(f.to);
        if (!a || !b) continue;
        const o = connectRooms(a, b, ctx.brief?.openKitchen ?? false);
        if (o) plan.openings.push(o);
        else needHall.push({ levelId: level.id, a: a.name, b: b.name });
      }

      // A front door toward the road, and a garage door.
      const road = ROAD_DIR[ctx.plot?.roadSide ?? "S"];
      const byType = (t: string) => plan.rooms.find((r) => r.type === t);
      const entry = byType("entry");
      const front =
        outsideDoor(plan, entry, road, "door-entry", 36, exteriorIn) ??
        outsideDoor(plan, entry, road, "door-entry", 36, exteriorIn, -0.5) ??
        outsideDoor(plan, byType("living") ?? byType("family"), road, "door-entry", 36, exteriorIn);
      if (front) plan.openings.push(front);
      const garage = byType("garage");
      if (garage && ctx.basics?.garage !== "none") {
        const facing = ctx.basics?.garage === "side" ? { x: road.y, y: -road.x } : road;
        const bays = ctx.brief?.garageBays ?? 2;
        const wide = outsideDoor(plan, garage, facing, "door-garage", bays >= 2 ? 192 : 96, exteriorIn);
        const door = wide ?? (bays >= 2 ? outsideDoor(plan, garage, facing, "door-garage", 96, exteriorIn) : null);
        if (door) plan.openings.push(door);
      }
    }
    plans[level.id] = plan;
  }
  return { plans, needHall };
}
