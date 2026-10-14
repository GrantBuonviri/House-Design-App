import type { BubbleDiagram, DesignBrief, Point } from "@/lib/model/schema";
import { roomType, type RoomCategory } from "@/lib/brief/rooms";

/**
 * Bubble sizes and colors. A bubble's area matches its room's target area at
 * real scale: positions and radii are in inches, like everything else.
 */

export type Bubble = BubbleDiagram["bubbles"][number];
/** Enough of a bubble to know its size. */
type Sized = Pick<Bubble, "rx" | "ry"> & Partial<Pick<Bubble, "shape" | "outline">>;
type BriefRoom = DesignBrief["rooms"][number];

const SQ_IN_PER_SQ_FT = 144;

/** The smallest and largest bubble the editor allows, in square feet. */
export const MIN_SQFT = 10;
export const MAX_SQFT = 3000;

/** A bubble is drawn as an oval once it's this much longer than wide. */
const OVAL_FROM = 1.15;

/** Typical long-to-short ratio of a room, so garages and porches come out as ovals. */
const ASPECT: Record<string, number> = {
  porch: 2.4,
  deck: 1.6,
  patio: 1.5,
  "outdoor-kitchen": 1.3,
  mudroom: 1.3,
  laundry: 1.2,
  pantry: 1.2,
  "primary-closet": 1.4,
  "primary-bath": 1.2,
  workshop: 1.3,
};
const GARAGE_ASPECT = [1.4, 1.4, 1.1, 1.6, 2.1];

export const STAIRS_SQFT = 45;
const STAIRS_ASPECT = 1.8;

/** Fill colors by kind of room. */
export const CATEGORY_COLOR: Record<RoomCategory, string> = {
  living: "#f3cf91",
  sleeping: "#a9cbe9",
  work: "#b5dbac",
  service: "#d8d2c6",
  garage: "#bfc6cf",
  outdoor: "#cfe6bf",
};
export const STAIRS_COLOR = "#d6c7b4";
export const FREE_COLOR = "#ead9f0";

export function radiiFor(sqft: number, aspect = 1): { rx: number; ry: number } {
  const area = clampSqft(sqft) * SQ_IN_PER_SQ_FT;
  const a = Math.max(1, aspect);
  return { rx: Math.sqrt((area / Math.PI) * a), ry: Math.sqrt(area / Math.PI / a) };
}

export function clampSqft(sqft: number): number {
  return Number.isFinite(sqft) ? Math.min(MAX_SQFT, Math.max(MIN_SQFT, sqft)) : 100;
}

/** A bubble's area in square inches: an ellipse, or a drawn room's outline. */
function areaIn(b: Sized): number {
  return isDrawn(b) ? polygonArea(b.outline) : Math.PI * b.rx * b.ry;
}

/** A bubble's area in square feet, rounded. */
export function bubbleSqft(b: Sized): number {
  return Math.round(areaIn(b) / SQ_IN_PER_SQ_FT);
}

/** A room drawn in any shape, with a usable outline. */
export function isDrawn<T extends Sized>(b: T): b is T & { outline: Point[] } {
  return b.shape === "free" && Array.isArray(b.outline) && b.outline.length >= 3;
}

/** Change a bubble's area and keep its proportions. */
export function resized<T extends Sized>(b: T, sqft: number): T {
  if (isDrawn(b)) {
    const k = Math.sqrt((clampSqft(sqft) * SQ_IN_PER_SQ_FT) / Math.max(1, polygonArea(b.outline)));
    return scaledOutline(b, k, k);
  }
  const { rx, ry } = radiiFor(sqft, b.rx / b.ry);
  return b.rx >= b.ry ? { ...b, rx, ry } : { ...b, rx: ry, ry: rx };
}

/**
 * Switch between circle and oval, keeping the area. A drawn room can become
 * a circle or an oval (lying the same way as its outline), but not back.
 */
export function reshaped<T extends Bubble>(b: T, shape: Bubble["shape"]): T {
  if (shape === "free" || shape === b.shape) return b;
  const sqft = areaIn(b) / SQ_IN_PER_SQ_FT;
  const drawn = isDrawn(b);
  const aspect = drawn ? Math.max(b.rx, b.ry) / Math.min(b.rx, b.ry) : 1.5;
  const { rx, ry } = radiiFor(sqft, shape === "oval" ? Math.max(1.3, aspect) : 1);
  const turn = drawn && b.ry > b.rx ? 90 : 0;
  const { outline: _outline, ...rest } = b;
  void _outline;
  return { ...rest, shape, rx, ry, rotation: shape === "circle" ? 0 : (b.rotation + turn) % 360 } as T;
}

/** Stretch a drawn room's outline (or an ellipse's radii) by sx across and sy down, before rotation. */
export function scaledOutline<T extends Sized>(b: T, sx: number, sy: number): T {
  if (!isDrawn(b)) return { ...b, rx: b.rx * sx, ry: b.ry * sy };
  return { ...b, outline: b.outline.map((p) => ({ x: round1(p.x * sx), y: round1(p.y * sy) })), rx: b.rx * sx, ry: b.ry * sy };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Area of a polygon in square units (always positive). */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * A drawn outline (in drawing coordinates) as a room's center, half-size and
 * outline relative to the center. The center is the middle of its bounding box.
 */
export function outlineShape(points: Point[]): Pick<Bubble, "x" | "y" | "rx" | "ry"> & { outline: Point[] } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  return {
    x: Math.round(x),
    y: Math.round(y),
    rx: Math.max(1, (x1 - x0) / 2),
    ry: Math.max(1, (y1 - y0) / 2),
    outline: points.map((p) => ({ x: round1(p.x - Math.round(x)), y: round1(p.y - Math.round(y)) })),
  };
}

/**
 * Tidy a freehand outline: drop points that add nothing (within `tolerance`),
 * then round off the corners a little. The shape is closed: the end joins the start.
 */
export function tidyOutline(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const simple = simplify(points, tolerance);
  if (simple.length < 3) return simple;
  // One pass of corner cutting (Chaikin), on the closed shape.
  const smooth: Point[] = [];
  for (let i = 0; i < simple.length; i++) {
    const a = simple[i];
    const b = simple[(i + 1) % simple.length];
    smooth.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
  }
  return simplify(smooth, tolerance / 3);
}

/** Ramer–Douglas–Peucker line simplification. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distanceToSegment(points[k], points[i], points[j]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = true;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function roomAspect(room: Pick<BriefRoom, "type" | "lengthIn" | "widthIn">, garageCars: number): number {
  if (room.lengthIn && room.widthIn) return Math.max(room.lengthIn, room.widthIn) / Math.min(room.lengthIn, room.widthIn);
  if (room.type === "garage") return GARAGE_ASPECT[Math.min(4, Math.max(0, garageCars))];
  return ASPECT[room.type] ?? 1;
}

/** The bubble for a room in the brief, centered on the origin. */
export function bubbleForRoom(room: BriefRoom, garageCars: number): Bubble {
  const aspect = roomAspect(room, garageCars);
  const { rx, ry } = radiiFor(room.targetSqFt, aspect);
  return {
    id: bubbleIdFor(room.id),
    roomId: room.id,
    label: room.name,
    shape: aspect >= OVAL_FROM ? "oval" : "circle",
    x: 0,
    y: 0,
    rx,
    ry,
    rotation: 0,
    color: CATEGORY_COLOR[roomType(room.type).category],
  };
}

/** A room keeps one bubble id everywhere, so alternatives can be compared room by room. */
export function bubbleIdFor(roomId: string): string {
  return `b-${roomId}`;
}

export function stairsBubble(levelId: string): Bubble {
  const { rx, ry } = radiiFor(STAIRS_SQFT, STAIRS_ASPECT);
  return {
    id: `stairs-${levelId}`,
    label: "Stairs",
    shape: "oval",
    x: 0,
    y: 0,
    rx,
    ry,
    rotation: 0,
    color: STAIRS_COLOR,
    stairs: true,
  };
}

/**
 * The distance from an ellipse's center to its edge in direction (ux, uy),
 * a unit vector. Used to keep bubbles from overlapping.
 */
export function radiusToward(b: Pick<Bubble, "rx" | "ry" | "rotation">, ux: number, uy: number): number {
  const t = (-(b.rotation ?? 0) * Math.PI) / 180;
  const lx = ux * Math.cos(t) - uy * Math.sin(t);
  const ly = ux * Math.sin(t) + uy * Math.cos(t);
  return 1 / Math.sqrt((lx * lx) / (b.rx * b.rx) + (ly * ly) / (b.ry * b.ry));
}

export function emptyDiagram(): BubbleDiagram {
  return { bubbles: [], flows: [], strokes: [], notes: [] };
}
