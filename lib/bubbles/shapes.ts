import type { BubbleDiagram, DesignBrief } from "@/lib/model/schema";
import { roomType, type RoomCategory } from "@/lib/brief/rooms";

/**
 * Bubble sizes and colors. A bubble's area matches its room's target area at
 * real scale: positions and radii are in inches, like everything else.
 */

export type Bubble = BubbleDiagram["bubbles"][number];
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

/** A bubble's area in square feet, rounded. */
export function bubbleSqft(b: Pick<Bubble, "rx" | "ry">): number {
  return Math.round((Math.PI * b.rx * b.ry) / SQ_IN_PER_SQ_FT);
}

/** Change a bubble's area and keep its proportions. */
export function resized<T extends Pick<Bubble, "rx" | "ry">>(b: T, sqft: number): T {
  const { rx, ry } = radiiFor(sqft, b.rx / b.ry);
  return b.rx >= b.ry ? { ...b, rx, ry } : { ...b, rx: ry, ry: rx };
}

/** Switch between circle and oval, keeping the area. */
export function reshaped<T extends Bubble>(b: T, shape: Bubble["shape"]): T {
  const sqft = (Math.PI * b.rx * b.ry) / SQ_IN_PER_SQ_FT;
  const { rx, ry } = radiiFor(sqft, shape === "oval" ? 1.5 : 1);
  return { ...b, shape, rx, ry, rotation: shape === "circle" ? 0 : b.rotation };
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
