import type { BubbleDiagram, DesignBrief, FloorPlan, Level, Opening, PlanBasics, PlanRoom, PlanStairs, Plot, Point } from "@/lib/model/schema";
import { isDrawn, type Bubble } from "@/lib/bubbles/shapes";
import { roomType } from "@/lib/brief/rooms";
import { exteriorWallIn, levelAbove, levelBelow, riseBetween } from "./basics";
import { freeSpot, newOpening, sharedWall } from "./connect";
import { emptyPlan, type Plans } from "./edit";
import { largestInside, supportOf, tooBigNote } from "./support";
import { regionArea, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { add, boundsOf, type Bounds, clockwise, pointInPolygon, dist, dot, leftNormal, polygonArea, rectangle, rotate, roundPoint, sub, unit } from "./geometry";
import { DEFAULT_STAIRS_WIDTH_IN, stairsDrawing } from "./stairs";
import { sameHost, wallPieces } from "./walls";

/**
 * Turn the flow sketch into a starting floor plan. Each bubble becomes a
 * rectangle with the same area, in the same spot (a room drawn in any shape
 * keeps a straight-walled version of its outline). Then the rooms are pushed
 * together toward the middle of the floor until they touch, so neighbors
 * share walls, and edges that nearly line up are lined up. Rooms connected in
 * the sketch get a door where they share a wall. The stairs stay put on every
 * floor, and rooms make way for them. An upper floor is laid out inside the
 * floor below it, so nothing hangs in the air.
 */

export type PlanContext = { brief: DesignBrief | null; plot: Plot | null; levels: Level[]; basics: PlanBasics | null };

export type FromSketchResult = {
  plans: Plans;
  /** Connected rooms that ended up not sharing a wall: they'll need a hallway. */
  needHall: { levelId: string; a: string; b: string }[];
  /** Floors that needed more room than the floor below holds, so their rooms were made smaller. */
  notes: string[];
};

export type Rect = { id: string; x0: number; y0: number; x1: number; y1: number; fixed: boolean; poly?: Point[] };

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
export function compact(rects: Rect[], center: Point, rounds = 60, box?: Bounds): void {
  for (let k = 0; k < rounds; k++) {
    let total = 0;
    const order = rects.filter((r) => !r.fixed).sort((a, b) => Math.hypot(cx(a) - center.x, cy(a) - center.y) - Math.hypot(cx(b) - center.x, cy(b) - center.y));
    for (const r of order) {
      for (const axis of ["x", "y"] as const) {
        const want = axis === "x" ? center.x - cx(r) : center.y - cy(r);
        if (Math.abs(want) < 0.5) continue;
        const dir = Math.sign(want);
        let travel = Math.abs(want);
        // Inside the box, when there is one.
        if (box) travel = Math.min(travel, axis === "x" ? (dir > 0 ? box.x1 - r.x1 : r.x0 - box.x0) : dir > 0 ? box.y1 - r.y1 : r.y0 - box.y0);
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

/**
 * Close gaps of up to `most` inches between rooms that face each other, so
 * they share one wall instead of having two walls a few inches apart. The
 * smaller room grows to meet the bigger one.
 */
export function closeGaps(rects: Rect[], most = 18): void {
  const sides = [
    ["x1", 1],
    ["x0", -1],
    ["y1", 1],
    ["y0", -1],
  ] as const;
  for (const r of [...rects].sort((a, b) => rectArea(a) - rectArea(b))) {
    if (r.fixed || r.poly) continue;
    for (const [key, sign] of sides) {
      const alongX = key === "x0" || key === "x1";
      let gap = Infinity;
      for (const o of rects) {
        if (o === r || (alongX ? overlapY(r, o) : overlapX(r, o)) <= 12) continue;
        const g = sign > 0 ? (alongX ? o.x0 - r.x1 : o.y0 - r.y1) : alongX ? r.x0 - o.x1 : r.y0 - o.y1;
        if (g >= -0.5) gap = Math.min(gap, g);
      }
      if (gap <= 0.5 || gap > most) continue;
      const before = r[key];
      r[key] += sign * gap;
      if (rects.some((o) => o !== r && overlapX(r, o) > 0.5 && overlapY(r, o) > 0.5)) r[key] = before;
    }
  }
}

function rectArea(r: Rect) {
  return (r.x1 - r.x0) * (r.y1 - r.y0);
}

/** Upper floor rooms take up at most this share of the floor below, leaving room to shuffle them in. */
const FIT_SHARE = 0.95;

function scaleRect(r: Rect, k: number) {
  const c = { x: cx(r), y: cy(r) };
  const w = (r.x1 - r.x0) * k;
  const h = (r.y1 - r.y0) * k;
  Object.assign(r, { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 });
  if (r.poly) r.poly = r.poly.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

/** Move a room inside a box, trimming it to the box if it's wider or taller. */
function clampInto(r: Rect, box: Bounds) {
  if (r.x1 - r.x0 > box.x1 - box.x0) Object.assign(r, { x0: box.x0, x1: box.x1 });
  if (r.y1 - r.y0 > box.y1 - box.y0) Object.assign(r, { y0: box.y0, y1: box.y1 });
  shift(r, Math.max(0, box.x0 - r.x0) - Math.max(0, r.x1 - box.x1), Math.max(0, box.y0 - r.y0) - Math.max(0, r.y1 - box.y1));
}

const outside = (r: Rect, box: Bounds) => r.x0 < box.x0 - 0.5 || r.y0 < box.y0 - 0.5 || r.x1 > box.x1 + 0.5 || r.y1 > box.y1 + 0.5;

/** An area cut into boxes along the lines of its own corners (exact for straight walls that run east-west and north-south). */
function boxesOf(regions: Region[]): Bounds[] {
  const pts = regions.flatMap((r) => [r.outline, ...r.holes]).flat();
  const xs = [...new Set(pts.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map((p) => Math.round(p.y)))].sort((a, b) => a - b);
  const inside = (p: Point) => regions.some((r) => pointInPolygon(p, r.outline) && !r.holes.some((h) => pointInPolygon(p, h)));
  // Each row's runs of cells that are in the area, then runs that repeat on the next row are joined.
  let open: Bounds[] = [];
  const out: Bounds[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const runs: Bounds[] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      if (!inside({ x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 })) continue;
      const last = runs[runs.length - 1];
      if (last && last.x1 === xs[i]) last.x1 = xs[i + 1];
      else runs.push({ x0: xs[i], x1: xs[i + 1], y0: ys[j], y1: ys[j + 1] });
    }
    const next: Bounds[] = [];
    for (const r of runs) {
      const same = open.find((o) => o.x0 === r.x0 && o.x1 === r.x1);
      if (same) {
        same.y1 = r.y1;
        next.push(same);
      } else next.push(r);
    }
    out.push(...open.filter((o) => !next.includes(o)));
    open = next;
  }
  return [...out, ...open].filter((b) => (b.x1 - b.x0) * (b.y1 - b.y0) > 144);
}

const fits = (r: Rect, box: Bounds, others: Rect[]) => !outside(r, box) && !others.some((o) => o !== r && overlapX(r, o) > 0.5 && overlapY(r, o) > 0.5);

/** The top-left corner nearest where a room is now that puts it inside the box, clear of the others, against a wall or another room. */
function nearestSpot(r: Rect, box: Bounds, others: Rect[]): Point | null {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const xs = [box.x0, box.x1 - w, ...others.flatMap((o) => [o.x1, o.x0 - w])].filter((x) => x >= box.x0 - 0.5 && x + w <= box.x1 + 0.5);
  const ys = [box.y0, box.y1 - h, ...others.flatMap((o) => [o.y1, o.y0 - h])].filter((y) => y >= box.y0 - 0.5 && y + h <= box.y1 + 0.5);
  let best: Point | null = null;
  let bestD = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const d = Math.hypot(x - r.x0, y - r.y0);
      if (d >= bestD) continue;
      const at = { ...r, x0: x, y0: y, x1: x + w, y1: y + h, poly: undefined };
      if (fits(at, box, others)) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best;
}

/**
 * Shuffle an upper floor's rooms inside the floor below. Rooms are shrunk
 * when they need more room than the floor below holds (the returned share is
 * how much was asked for, over what's there). The parts of the floor below's
 * bounding box that aren't floor (the notch of an L) hold rooms off like the
 * stairs do. Anything still past the edge is cut off when the rooms are made.
 */
export function fitInside(rects: Rect[], regions: Region[]): { needSqIn: number; haveSqIn: number } {
  const box = boundsOf(regions.flatMap((r) => r.outline))!;
  const haveSqIn = regions.reduce((t, r) => t + regionArea(r), 0);
  const movable = rects.filter((r) => !r.fixed);
  const needSqIn = rects.reduce((t, r) => t + rectArea(r), 0);
  const fixedSqIn = needSqIn - movable.reduce((t, r) => t + rectArea(r), 0);
  if (needSqIn > haveSqIn * FIT_SHARE) {
    const k = Math.sqrt(Math.max(0.1, (haveSqIn * FIT_SHARE - fixedSqIn) / Math.max(1, needSqIn - fixedSqIn)));
    for (const r of movable) scaleRect(r, k);
  }
  const boxRegion: Region = { outline: rectangle((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.x1 - box.x0, box.y1 - box.y0), holes: [] };
  const notches = boxesOf(subtractRegions([boxRegion], regions)).map((b, i): Rect => ({ id: `notch-${i}`, ...b, fixed: true }));
  const all = [...rects, ...notches];
  for (const r of movable) clampInto(r, box);
  // Biggest rooms first: each stays where it is if it fits, or moves to the nearest spot that does.
  const placed = all.filter((r) => r.fixed);
  for (const r of [...movable].sort((x, y) => rectArea(y) - rectArea(x))) {
    for (let tries = 0; tries < 6 && !fits(r, box, placed); tries++) {
      const spot = nearestSpot(r, box, placed);
      if (spot) shift(r, spot.x - r.x0, spot.y - r.y0);
      else scaleRect(r, 0.9);
    }
    placed.push(r);
  }
  // Pull the rooms back together around the stairs (or the middle of the floor below), staying clear of the notches.
  const stairs = rects.filter((r) => r.fixed);
  const c = stairs.length
    ? { x: stairs.reduce((t, r) => t + cx(r), 0) / stairs.length, y: stairs.reduce((t, r) => t + cy(r), 0) / stairs.length }
    : { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  compact(all, c, 30, box);
  closeGaps(all, 36);
  return { needSqIn, haveSqIn };
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
  // From a porch into the entry is the front door.
  if ((a.type === "porch" && b.type === "entry") || (a.type === "entry" && b.type === "porch")) return newOpening("door-entry", host, mid, a.type === "entry" ? -1 : 1, 36);
  if ((outdoor(a) || outdoor(b)) && room >= 84) return newOpening("door-slider", host, mid, 1, 72);
  // Doors swing into the smaller room. Room corners run clockwise, so the left of a's edge is b.
  const side = polygonArea(b.polygon) <= polygonArea(a.polygon) ? 1 : -1;
  return newOpening("door-hinged", host, mid, side, Math.min(32, roundTo(room - 4, 2)));
}

/** A door on the outside wall of a room that best faces a direction (at least `minFacing`, from -1 to 1). */
export function outsideDoor(plan: FloorPlan, room: PlanRoom | undefined, facing: Point, style: string, widthIn: number, exteriorIn: number, minFacing = 0.5): Opening | null {
  if (!room) return null;
  let best: { score: number; host: Opening["host"]; mid: number } | null = null;
  for (const p of wallPieces(plan, exteriorIn)) {
    if (!p.exterior || p.open || !("roomId" in p.host) || p.host.roomId !== room.id) continue;
    const length = p.t1 - p.t0;
    if (length < widthIn + 12) continue;
    const out = leftNormal(unit(sub(p.b, p.a)));
    const score = dot(out, facing) * 1000 + length;
    // Clear of doors already in that wall.
    const at = freeSpot(plan, p.host, p.t0, p.t1, widthIn);
    if (at !== null && dot(out, facing) > minFacing && (!best || score > best.score)) best = { score, host: p.host, mid: at };
  }
  return best ? newOpening(style, best.host, best.mid, -1, widthIn) : null;
}

export function plansFromSketch(diagrams: Record<string, BubbleDiagram>, ctx: PlanContext): FromSketchResult {
  const plans: Plans = {};
  const needHall: FromSketchResult["needHall"] = [];
  const notes: string[] = [];
  const stairs = stairsFor(diagrams, ctx);
  const exteriorIn = exteriorWallIn(ctx.basics);

  // From the bottom up, so each floor's rooms can be fit on the floor below.
  for (const level of [...ctx.levels].sort((a, b) => a.elevationIn - b.elevationIn)) {
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
      const support = supportOf(plans, ctx.levels, level);
      if (support) {
        const fit = fitInside(rects, support.regions);
        if (fit.needSqIn > fit.haveSqIn) notes.push(tooBigNote(level, support.below, fit.needSqIn / 144, fit.haveSqIn / 144));
      }
      closeGaps(rects);

      const byBubble = new Map(rects.map((r) => [r.id, r]));
      for (const b of bubbles) {
        const r = byBubble.get(b.id)!;
        let polygon = (r.poly ?? rectangle(cx(r), cy(r), r.x1 - r.x0, r.y1 - r.y0)).map(roundPoint);
        // Whatever still reaches past the floor below is cut off.
        if (support) polygon = (largestInside(polygon, support.regions) ?? polygon).map(roundPoint);
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
      const porchDoor = plan.openings.some((o) => o.style === "door-entry");
      const front =
        porchDoor ? null :
        outsideDoor(plan, entry, road, "door-entry", 36, exteriorIn) ??
        outsideDoor(plan, entry, road, "door-entry", 36, exteriorIn, -0.5) ??
        outsideDoor(plan, byType("living") ?? byType("family"), road, "door-entry", 36, exteriorIn);
      if (front) plan.openings.push(front);
      const garage = byType("garage");
      if (garage && ctx.basics?.garage !== "none") {
        const facing = ctx.basics?.garage === "side" ? { x: road.y, y: -road.x } : road;
        const bays = ctx.brief?.garageBays ?? 2;
        // Three bays or more: a 16' double door plus a 9' single beside it (the usual 3-car front), else one 18' door.
        const pair = () => {
          const big = outsideDoor(plan, garage, facing, "door-garage", 192, exteriorIn);
          if (!big) return null;
          const small = outsideDoor({ ...plan, openings: [...plan.openings, big] }, garage, facing, "door-garage", 108, exteriorIn);
          return small && sameHost(small.host, big.host) ? [big, small] : null;
        };
        // Narrower doors when the wall is too short for the first choice.
        const widths = bays >= 3 ? [216, 192, 96] : bays >= 2 ? [192, 96] : [96];
        const single = () => widths.map((w) => outsideDoor(plan, garage, facing, "door-garage", w, exteriorIn)).find((o) => o !== null);
        const doors = (bays >= 3 ? pair() : null) ?? [single()].filter((o): o is Opening => !!o);
        plan.openings.push(...doors);
      }
    }
    plans[level.id] = plan;
  }
  return { plans, needHall, notes };
}
