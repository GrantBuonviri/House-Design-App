import type { FloorPlan, FurnitureItem, Point } from "@/lib/model/schema";
import { add, pointInPolygon, project, rectangle, rotate, scale, sub } from "./geometry";
import { areaKind } from "./measure";
import { INTERIOR_WALL_IN } from "./basics";
import { openingGeometries } from "./walls";

/**
 * Furniture you place while walking through the house: a short built-in
 * list with common sizes (inches) and simple shapes. Not priced, since
 * furniture usually isn't part of the build cost.
 */

/** What a part of a piece is made of: its main color, wood, a cushion, metal legs or a soft rug. */
export type Material = "main" | "wood" | "light" | "dark" | "metal";

export type FurniturePiece = {
  /** Middle of the part across (x) and front to back (y, negative is the back), as a share of the piece's width and depth. */
  x?: number;
  y?: number;
  w?: number;
  d?: number;
  z0: number;
  z1: number;
  material: Material;
};

export type FurnitureType = {
  id: string;
  label: string;
  group: "Living" | "Dining" | "Bedroom" | "Office" | "Other";
  widthIn: number;
  depthIn: number;
  /** What its main color is: fabric follows the color answers, wood follows the wood tone. */
  main: "fabric" | "wood" | "rug";
  /** Rugs lie flat: you walk over them and they don't block doors. */
  flat?: boolean;
  pieces: FurniturePiece[];
};

const legs = (z1: number, inset = 0.42, material: Material = "dark"): FurniturePiece[] =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sy): FurniturePiece => ({ x: sx * inset, y: sy * inset, w: 0.06, d: 0.08, z0: 0, z1, material })));

const sofa = (seatW = 1): FurniturePiece[] => [
  { y: 0.08, w: seatW * 0.86, d: 0.78, z0: 4, z1: 18, material: "main" },
  { y: -0.4, d: 0.22, z0: 4, z1: 32, material: "main" },
  { x: -0.46, w: 0.08, z0: 4, z1: 25, material: "main" },
  { x: 0.46, w: 0.08, z0: 4, z1: 25, material: "main" },
  ...legs(4, 0.44),
];

const table = (h: number): FurniturePiece[] => [{ z0: h - 1.5, z1: h, material: "main" }, ...legs(h - 1.5, 0.44, "main")];

const bed = (): FurniturePiece[] => [
  { y: 0.04, d: 0.92, z0: 6, z1: 14, material: "wood" },
  { y: 0.05, w: 0.96, d: 0.9, z0: 14, z1: 24, material: "light" },
  { y: 0.2, w: 0.97, d: 0.6, z0: 24, z1: 25.5, material: "main" },
  { y: -0.32, w: 0.4, d: 0.12, x: -0.24, z0: 24, z1: 29, material: "light" },
  { y: -0.32, w: 0.4, d: 0.12, x: 0.24, z0: 24, z1: 29, material: "light" },
  { y: -0.48, d: 0.04, z0: 0, z1: 48, material: "wood" },
  ...legs(6, 0.44, "wood"),
];

const box = (h: number, material: Material = "main"): FurniturePiece[] => [{ z0: 0, z1: h, material }];

export const FURNITURE: FurnitureType[] = [
  { id: "sofa", label: "Sofa", group: "Living", widthIn: 84, depthIn: 38, main: "fabric", pieces: sofa() },
  { id: "loveseat", label: "Loveseat", group: "Living", widthIn: 60, depthIn: 36, main: "fabric", pieces: sofa() },
  {
    id: "sectional",
    label: "Sectional",
    group: "Living",
    widthIn: 110,
    depthIn: 84,
    main: "fabric",
    pieces: [
      { y: -0.27, d: 0.46, z0: 4, z1: 18, material: "main" },
      { x: 0.33, y: 0.2, w: 0.34, d: 0.5, z0: 4, z1: 18, material: "main" },
      { y: -0.45, d: 0.1, z0: 4, z1: 32, material: "main" },
      { x: 0.46, y: -0.05, w: 0.08, d: 0.9, z0: 4, z1: 32, material: "main" },
      { x: -0.47, y: -0.27, w: 0.06, d: 0.46, z0: 4, z1: 25, material: "main" },
    ],
  },
  { id: "armchair", label: "Armchair", group: "Living", widthIn: 34, depthIn: 34, main: "fabric", pieces: sofa(0.9) },
  { id: "coffee-table", label: "Coffee table", group: "Living", widthIn: 48, depthIn: 24, main: "wood", pieces: table(18) },
  { id: "side-table", label: "Side table", group: "Living", widthIn: 22, depthIn: 22, main: "wood", pieces: table(24) },
  {
    id: "tv-stand",
    label: "TV stand",
    group: "Living",
    widthIn: 60,
    depthIn: 18,
    main: "wood",
    pieces: [...box(22), { y: -0.2, w: 0.9, d: 0.1, z0: 26, z1: 56, material: "dark" }, { y: -0.2, w: 0.1, d: 0.3, z0: 22, z1: 26, material: "dark" }],
  },
  { id: "bookshelf", label: "Bookshelf", group: "Living", widthIn: 36, depthIn: 14, main: "wood", pieces: box(72) },
  { id: "rug-large", label: "Rug, 8' × 10'", group: "Living", widthIn: 120, depthIn: 96, main: "rug", flat: true, pieces: [{ z0: 0, z1: 0.5, material: "main" }] },
  { id: "rug-small", label: "Rug, 5' × 8'", group: "Living", widthIn: 96, depthIn: 60, main: "rug", flat: true, pieces: [{ z0: 0, z1: 0.5, material: "main" }] },
  {
    id: "dining-table",
    label: "Dining table and 6 chairs",
    group: "Dining",
    widthIn: 72,
    depthIn: 38,
    main: "wood",
    pieces: [
      { w: 0.95, d: 0.95, z0: 28.5, z1: 30, material: "main" },
      ...legs(28.5, 0.4, "main"),
      // Chairs tucked in on the long sides, one at each end.
      ...[-0.3, 0, 0.3].flatMap((x) => [-1, 1].map((s): FurniturePiece => ({ x, y: s * 0.5, w: 0.22, d: 0.38, z0: 0, z1: 18, material: "wood" }))),
    ],
  },
  { id: "bench", label: "Bench", group: "Dining", widthIn: 48, depthIn: 16, main: "wood", pieces: table(18) },
  { id: "bed-twin", label: "Twin bed", group: "Bedroom", widthIn: 41, depthIn: 80, main: "fabric", pieces: bed() },
  { id: "bed-full", label: "Full bed", group: "Bedroom", widthIn: 56, depthIn: 80, main: "fabric", pieces: bed() },
  { id: "bed-queen", label: "Queen bed", group: "Bedroom", widthIn: 64, depthIn: 86, main: "fabric", pieces: bed() },
  { id: "bed-king", label: "King bed", group: "Bedroom", widthIn: 80, depthIn: 86, main: "fabric", pieces: bed() },
  { id: "nightstand", label: "Nightstand", group: "Bedroom", widthIn: 22, depthIn: 18, main: "wood", pieces: box(26) },
  { id: "dresser", label: "Dresser", group: "Bedroom", widthIn: 60, depthIn: 20, main: "wood", pieces: box(34) },
  { id: "desk", label: "Desk", group: "Office", widthIn: 54, depthIn: 26, main: "wood", pieces: table(30) },
  {
    id: "desk-chair",
    label: "Desk chair",
    group: "Office",
    widthIn: 24,
    depthIn: 24,
    main: "fabric",
    pieces: [{ w: 0.8, d: 0.8, z0: 16, z1: 19, material: "main" }, { y: -0.38, w: 0.8, d: 0.1, z0: 19, z1: 38, material: "main" }, { w: 0.12, d: 0.12, z0: 0, z1: 16, material: "metal" }],
  },
  { id: "bar-stools", label: "Bar stools (3)", group: "Other", widthIn: 66, depthIn: 18, main: "wood", pieces: [-0.33, 0, 0.33].flatMap((x) => [{ x, w: 0.25, d: 0.9, z0: 26, z1: 28, material: "main" as Material }, { x, w: 0.06, d: 0.15, z0: 0, z1: 26, material: "metal" as Material }]) },
  { id: "plant", label: "Floor plant", group: "Other", widthIn: 20, depthIn: 20, main: "wood", pieces: [{ w: 0.7, d: 0.7, z0: 0, z1: 14, material: "dark" }, { z0: 14, z1: 54, material: "light" }] },
];

export function furnitureType(id: string): FurnitureType | undefined {
  return FURNITURE.find((f) => f.id === id);
}

/** Colors offered for furniture: fabrics, woods and a few bolder ones. */
export const FURNITURE_COLORS = [
  { color: "#d8d2c6", label: "Oatmeal" },
  { color: "#8d877d", label: "Stone gray" },
  { color: "#4a4f55", label: "Charcoal" },
  { color: "#2f4a63", label: "Navy" },
  { color: "#5f6f52", label: "Olive" },
  { color: "#9a5b3c", label: "Cognac leather" },
  { color: "#e3cfa9", label: "Light wood" },
  { color: "#b07f4f", label: "Medium wood" },
  { color: "#5a3b25", label: "Dark wood" },
  { color: "#f2f0eb", label: "White" },
  { color: "#1f1f1f", label: "Black" },
];

const WOOD: Record<string, string> = { "light-wood": "#e3cfa9", "medium-wood": "#b07f4f", "dark-wood": "#5a3b25", none: "#f2f0eb" };
const FABRIC: Record<string, string> = { warm: "#c9b79c", cool: "#8a99a6", neutral: "#cfcac0", bold: "#2f4a63" };
const RUG: Record<string, string> = { warm: "#b98a68", cool: "#9eacb5", neutral: "#d6cfc3", bold: "#7a3b3b" };

/** The color a new piece gets from the style answers (wood tone and color feel). */
export function defaultFurnitureColor(kind: string, answers: Record<string, string>): string {
  const t = furnitureType(kind);
  if (!t) return "#cfcac0";
  if (t.main === "wood") return WOOD[answers.wood ?? ""] ?? WOOD["medium-wood"];
  if (t.main === "rug") return RUG[answers.colors ?? ""] ?? RUG.neutral;
  return FABRIC[answers.colors ?? ""] ?? FABRIC.neutral;
}

/** The wood used for legs and frames, from the wood tone answer. */
export function furnitureWood(answers: Record<string, string>): string {
  return WOOD[answers.wood ?? ""] && answers.wood !== "none" ? WOOD[answers.wood] : WOOD["medium-wood"];
}

/** The piece's outline on the plan. */
export function furnitureOutline(f: Pick<FurnitureItem, "x" | "y" | "widthIn" | "depthIn" | "rotation">): Point[] {
  return rectangle(f.x, f.y, f.widthIn, f.depthIn, f.rotation ?? 0);
}

/** A new piece of furniture of this kind at a spot, turned to `rotation` degrees. */
export function newFurniture(kind: string, at: Point, rotation: number, color: string, id: string): FurnitureItem {
  const t = furnitureType(kind)!;
  return { id, kind, x: Math.round(at.x), y: Math.round(at.y), rotation: ((Math.round(rotation) % 360) + 360) % 360, widthIn: t.widthIn, depthIn: t.depthIn, color };
}

export type PlaceCheck = {
  ok: boolean;
  /** The room it's in, when it fits in one. */
  roomId?: string;
  /** Why it can't go there. */
  problem?: string;
  /** Doors it's in the way of (it can still go there). */
  blocksDoors: string[];
};

/**
 * Whether furniture fits where it is: wholly inside one room (so not
 * through a wall), clear of the room's fixtures and other furniture, with a warning for any
 * door it's in front of.
 */
export function checkPlacement(plan: FloorPlan, f: Pick<FurnitureItem, "id" | "kind" | "x" | "y" | "widthIn" | "depthIn" | "rotation">): PlaceCheck {
  const t = furnitureType(f.kind);
  const outline = furnitureOutline(f);
  const center = { x: f.x, y: f.y };
  const room = plan.rooms.find((r) => areaKind(r) !== "outdoor" && pointInPolygon(center, r.polygon))
    ?? plan.rooms.find((r) => pointInPolygon(center, r.polygon));
  if (!room) return { ok: false, problem: "It needs to go inside a room.", blocksDoors: [] };
  // Every corner inside the room, and at least half a wall's thickness from its walls.
  const half = INTERIOR_WALL_IN / 2;
  const inside = outline.every((c) => pointInPolygon(c, room.polygon) && room.polygon.every((a, i) => project(c, a, room.polygon[(i + 1) % room.polygon.length]).d >= half - 0.01));
  // Long pieces can cross a corner of an L-shaped room even with their corners inside.
  const edgesIn = outline.every((a, i) => {
    const b = outline[(i + 1) % 4];
    for (let k = 1; k < 4; k++) if (!pointInPolygon(add(a, scale(sub(b, a), k / 4)), room.polygon)) return false;
    return true;
  });
  if (!inside || !edgesIn) return { ok: false, roomId: room.id, problem: `It goes through a wall of the ${room.name.toLowerCase()}.`, blocksDoors: [] };
  if (!t?.flat) {
    for (const fx of plan.fixtures) {
      if (overlaps(outline, rectangle(fx.x, fx.y, fx.widthIn, fx.depthIn, fx.rotation ?? 0))) return { ok: false, roomId: room.id, problem: "It's on top of a counter or fixture.", blocksDoors: [] };
    }
    // Other furniture (rugs can go under anything).
    for (const other of plan.furniture) {
      if (other.id === f.id || furnitureType(other.kind)?.flat) continue;
      if (overlaps(outline, furnitureOutline(other))) {
        return { ok: false, roomId: room.id, problem: `It's on top of the ${(furnitureType(other.kind)?.label ?? "furniture").toLowerCase()}.`, blocksDoors: [] };
      }
    }
  }
  const blocksDoors: string[] = [];
  if (!t?.flat) {
    for (const og of openingGeometries(plan)) {
      if (og.opening.kind === "window") continue;
      // The space just inside and outside a door, about as deep as it is wide (where it swings and where you walk through).
      const depth = Math.min(36, og.opening.widthIn);
      const swing = [-1, 1].map((s) => rectangle(...centerOf(og.center, og.n, s * (depth / 2 + 2)), og.opening.widthIn, depth, angleOf(og.u)));
      if (swing.some((r) => overlaps(outline, r))) blocksDoors.push(og.opening.id);
    }
  }
  return { ok: true, roomId: room.id, blocksDoors };
}

const centerOf = (c: Point, n: Point, d: number): [number, number] => {
  const p = add(c, scale(n, d));
  return [p.x, p.y];
};
const angleOf = (u: Point) => (Math.atan2(u.y, u.x) * 180) / Math.PI;

/** Whether two convex outlines overlap (separating axis test), touching edges not counting. */
export function overlaps(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis = { x: q.y - p.y, y: p.x - q.x };
      const proj = (pts: Point[]) => pts.map((v) => v.x * axis.x + v.y * axis.y);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
    }
  }
  return true;
}

/** A part's middle on the plan. */
export function piecePlace(f: Pick<FurnitureItem, "x" | "y" | "widthIn" | "depthIn" | "rotation">, p: FurniturePiece): { mid: Point; w: number; d: number } {
  const local = { x: (p.x ?? 0) * f.widthIn, y: (p.y ?? 0) * f.depthIn };
  return { mid: add({ x: f.x, y: f.y }, rotate(local, f.rotation ?? 0)), w: (p.w ?? 1) * f.widthIn, d: (p.d ?? 1) * f.depthIn };
}

/** How tall a piece is, for bumping into it. */
export function furnitureHeight(kind: string): number {
  const t = furnitureType(kind);
  return t ? Math.max(...t.pieces.map((p) => p.z1)) : 30;
}
