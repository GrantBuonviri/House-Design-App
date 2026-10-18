import type { AddOn, Fixture, FurnitureItem } from "@/lib/model/schema";
import { furnitureType } from "@/lib/plan/furniture";
import { COLORS } from "./colors";
import { handle } from "./cabinets3d";
import { ItemFrame, shade, type Ring } from "./detail";
import { PATTERN } from "./finishes";
import { drawDecorFurniture } from "./decor3d";
import { hex, type Frame, type MeshBuilder, type RGB } from "./mesh";

/**
 * Furniture in detail, for Pretty graphics: sofas with arms, seat and back
 * cushions by length and legs; beds with a frame, headboard, mattress, duvet
 * and pillows; tables with rounded tops and turned legs; chairs with frames;
 * a desk, dresser and nightstands with drawers by width; bookcases with a
 * shelf about every foot and books on them; a TV stand with its TV; closet
 * shelves and rods. Each is drawn inside the piece's saved size, in its
 * frame (back toward -y, as on the plan). Fast keeps the boxes in fixtures.ts.
 */

const WOOD = hex("#9c6f43");
const LINEN = hex("#f2efe8");
const DARK = hex("#3a3632");
const BLACK = hex("#121314");
const SCREEN = hex("#0b0c0e");
const LEAF = hex("#4f7a3a");
const SOIL = hex("#3b2b1e");
const POT = hex("#c9c3b8");
const SHELF_WHITE = hex("#f4f2ee");
const BOOKS = ["#7a2e2a", "#2f4a63", "#d8cdb5", "#3f5b45", "#c6a15b", "#5b4a6b", "#1f1f1f", "#a9653b", "#e9e4da", "#476f80"].map(hex);
const LEATHER = new Set(["#9a5b3c"]);

/** The widest one seat cushion gets: a longer sofa takes more of them. */
export const SEAT_CUSHION_IN = 28;
/** About how far apart bookcase shelves are. */
export const SHELF_GAP_IN = 12;
/** The widest one column of dresser drawers gets. */
export const DRAWER_COLUMN_IN = 32;

/** How many seat (and back) cushions fit along a seat this wide. */
export function seatCushions(seatWidthIn: number): number {
  return Math.max(1, Math.round(seatWidthIn / SEAT_CUSHION_IN));
}

/** Shelf heights (inches up from the bottom) in a bookcase this tall: a fixed shelf about every foot, between the bottom and the top. */
export function shelfHeights(heightIn: number, bottomIn = 3, topIn = 1): number[] {
  const inside = heightIn - bottomIn - topIn;
  const n = Math.max(1, Math.round(inside / SHELF_GAP_IN));
  const gap = inside / n;
  return Array.from({ length: n + 1 }, (_, i) => bottomIn + i * gap);
}

/** A grid of drawers on a chest this wide and tall: columns no wider than DRAWER_COLUMN_IN, rows about 7-9" tall. */
export function drawerGrid(widthIn: number, heightIn: number): { columns: number; rows: number } {
  return { columns: Math.max(1, Math.ceil((widthIn - 0.01) / DRAWER_COLUMN_IN)), rows: Math.max(1, Math.floor(heightIn / 7)) };
}

/** Kinds drawn here with Pretty (anything else keeps its simple shape in both settings). */
export const DETAILED_FURNITURE = new Set([
  "sofa",
  "loveseat",
  "sectional",
  "armchair",
  "coffee-table",
  "side-table",
  "tv-stand",
  "bookshelf",
  "rug-large",
  "rug-small",
  "dining-table",
  "bench",
  "bed-twin",
  "bed-full",
  "bed-queen",
  "bed-king",
  "nightstand",
  "dresser",
  "desk",
  "desk-chair",
  "bar-stools",
  "plant",
  // Decor, drawn in decor3d.ts.
  "rug-runner",
  "floor-lamp",
  "plant-snake",
  "plant-tree",
]);

/** A small repeatable random number from a string and a counter, so books and leaves stay put between redraws. */
function rand(seed: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** A soft box with rolled edges (a cushion, a mattress, a pillow), from x0..x1, y0..y1, z0..z1. */
export function cushion(it: ItemFrame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: RGB, pattern: number, round = 1.5, segments = 16) {
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const r = Math.max(0.05, Math.min(round, rx * 0.4, ry * 0.4, ((z1 - z0) / 2) * 0.9));
  const at = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, power: 6 };
  const rings: Ring[] = [
    { z: z0, rx: 0, ry: 0, ...at },
    { z: z0, rx: rx - r, ry: ry - r, ...at },
    { z: z0 + r * 0.35, rx: rx - r * 0.25, ry: ry - r * 0.25, ...at },
    { z: z0 + r, rx, ry, ...at },
    { z: z1 - r, rx, ry, ...at },
    { z: z1 - r * 0.35, rx: rx - r * 0.25, ry: ry - r * 0.25, ...at },
    { z: z1, rx: rx - r, ry: ry - r, ...at },
    { z: z1, rx: 0, ry: 0, ...at },
  ];
  it.loft(rings, color, pattern, segments);
}

/** A flat top with an eased edge: an ellipse (power 2) or a rounded rectangle (higher powers). */
export function roundTop(it: ItemFrame, cx: number, cy: number, rx: number, ry: number, z0: number, z1: number, color: RGB, pattern: number, power = 8, segments = 24) {
  const e = Math.min(0.4, (z1 - z0) / 3);
  const at = { cx, cy, power };
  it.loft(
    [
      { z: z0, rx: 0, ry: 0, ...at },
      { z: z0, rx: rx - e, ry: ry - e, ...at },
      { z: z0 + e, rx, ry, ...at },
      { z: z1 - e, rx, ry, ...at },
      { z: z1, rx: rx - e, ry: ry - e, ...at },
      { z: z1, rx: 0, ry: 0, ...at },
    ],
    color,
    pattern,
    segments,
  );
}

/** A round leg or post from z0 to z1, r0 wide at the bottom and r1 at the top. */
export function post(it: ItemFrame, x: number, y: number, z0: number, z1: number, r0: number, r1: number, color: RGB, pattern: number, segments = 8) {
  it.loft(
    [
      { z: z0, rx: 0, ry: 0, cx: x, cy: y },
      { z: z0, rx: r0, ry: r0, cx: x, cy: y },
      { z: z1, rx: r1, ry: r1, cx: x, cy: y },
      { z: z1, rx: 0, ry: 0, cx: x, cy: y },
    ],
    color,
    pattern,
    segments,
  );
}

/** A frame turned a quarter turn at a local point, so a loft along its y runs along this item's x (rods, rails). */
function sideways(it: ItemFrame, x: number, y: number): ItemFrame {
  return new ItemFrame(it.mb, it.f, it.at(x, y), it.rotation + 90, it.floorIn);
}

/** A round rod from x0 to x1 at (y, z), radius r. */
function rodAlongX(it: ItemFrame, x0: number, x1: number, y: number, z: number, r: number, color: RGB, pattern: number) {
  const s = sideways(it, (x0 + x1) / 2, y);
  const h = (x1 - x0) / 2;
  s.loft(
    [
      { z: -h, rx: 0, ry: 0, cy: z },
      { z: -h, rx: r, ry: r, cy: z },
      { z: h, rx: r, ry: r, cy: z },
      { z: h, rx: 0, ry: 0, cy: z },
    ],
    color,
    pattern,
    10,
    "y",
  );
}

/** A frame for one part of a piece (a chair round a table, a stool), at a local spot and turned by `turn` degrees. */
function partFrame(it: ItemFrame, x: number, y: number, turn: number): ItemFrame {
  return new ItemFrame(it.mb, it.f, it.at(x, y), it.rotation + turn, it.floorIn);
}

/** Drawer fronts in a grid on a face at y, from x0..x1 and z0..z1, each with a centered pull. */
function drawerFronts(it: ItemFrame, x0: number, x1: number, z0: number, z1: number, y: number, columns: number, rows: number, color: RGB, pattern: number) {
  const gap = 0.2;
  const w = (x1 - x0) / columns;
  const h = (z1 - z0) / rows;
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const a = x0 + c * w + gap / 2;
      const b = a + w - gap;
      const lo = z0 + r * h + gap / 2;
      const hi = lo + h - gap;
      it.box(a, b, y, y + 0.75, lo, hi, color, pattern);
      // A thin raised lip round the front, like a shaker drawer.
      const s = Math.min(1.25, h * 0.18);
      it.box(a, b, y + 0.75, y + 1, lo, lo + s, color, pattern);
      it.box(a, b, y + 0.75, y + 1, hi - s, hi, color, pattern);
      handle(it, { x: (a + b) / 2, z: (lo + hi) / 2, pull: true }, y + 1, Math.min(5, (b - a) * 0.35));
    }
  }
}

/** A bookcase: sides, top, kick and back, a shelf about every foot, and some books on most shelves. */
export function bookcase(it: ItemFrame, W: number, D: number, H: number, color: RGB, pattern: number, seed: string) {
  const x0 = -W / 2;
  const x1 = W / 2;
  const y0 = -D / 2;
  const y1 = D / 2;
  const side = Math.min(0.75, W * 0.04);
  it.box(x0, x0 + side, y0, y1, 0, H, color, pattern);
  it.box(x1 - side, x1, y0, y1, 0, H, color, pattern);
  it.box(x0 + side, x1 - side, y0, y0 + 0.4, 0, H, shade(color, 0.85), pattern);
  it.box(x0, x1, y0, y1, H - 1, H, color, pattern);
  it.box(x0 + side, x1 - side, y1 - 1.25, y1 - 0.5, 0, 3, color, pattern);
  const shelves = shelfHeights(H);
  shelves.forEach((z) => it.box(x0 + side, x1 - side, y0 + 0.4, y1 - 0.25, z - 0.75, z, color, pattern));
  // Books stand on each shelf but the top one, leaving room above them.
  for (let s = 0; s + 1 < shelves.length; s++) {
    const z = shelves[s];
    const room = shelves[s + 1] - z - 1;
    if (room < 6 || rand(seed, s * 97) < 0.15) continue;
    let x = x0 + side + 0.5 + rand(seed, s) * 4;
    const end = x1 - side - 0.5 - rand(seed, s + 50) * (W * 0.35);
    let i = 0;
    while (x < end) {
      const k = s * 1000 + i++;
      const t = 0.8 + rand(seed, k) * 1.4;
      if (x + t > end) break;
      const h = Math.min(room, 7 + rand(seed, k + 1) * 4);
      const deep = Math.min(D - 2, 6 + rand(seed, k + 2) * 3);
      it.box(x, x + t, y0 + 0.6, y0 + 0.6 + deep, z, z + h, BOOKS[Math.floor(rand(seed, k + 3) * BOOKS.length)], PATTERN.satin);
      x += t + (rand(seed, k + 4) < 0.08 ? 3 : 0.05);
    }
  }
}

/**
 * A piece of furniture in detail. Returns false for kinds without a detailed
 * shape (those keep their simple boxes in both settings).
 */
export function drawFurnitureDetail(mb: MeshBuilder, f: Frame, item: FurnitureItem, floorIn: number, glow: MeshBuilder = mb): boolean {
  if (!DETAILED_FURNITURE.has(item.kind)) return false;
  const t = furnitureType(item.kind);
  const it = new ItemFrame(mb, f, { x: item.x, y: item.y }, item.rotation ?? 0, floorIn);
  const W = item.widthIn;
  const D = item.depthIn;
  const main = hex(item.color ?? "#cfcac0");
  const isWood = t?.main === "wood";
  const wood = isWood ? main : WOOD;
  const cloth = LEATHER.has((item.color ?? "").toLowerCase()) ? PATTERN.leather : PATTERN.fabric;
  const mainPattern = isWood ? PATTERN.wood : cloth;
  const legColor = isWood ? main : DARK;
  const legPattern = isWood ? PATTERN.wood : PATTERN.satin;
  // Lamps, plants and rugs (a lamp's shade goes in `glow`).
  if (drawDecorFurniture(mb, glow, f, item, floorIn, { color: wood, pattern: PATTERN.wood })) return true;

  switch (item.kind) {
    case "sofa":
    case "loveseat":
    case "armchair":
      sofa(it, W, D, main, cloth, legColor, legPattern, item.kind === "sofa" ? "track" : "rolled");
      break;
    case "sectional":
      sectional(it, W, D, main, cloth, legColor, legPattern);
      break;
    case "coffee-table": {
      roundTop(it, 0, 0, W / 2, D / 2, 16.5, 18, main, mainPattern, 10);
      it.box(-W / 2 + 4, W / 2 - 4, -D / 2 + 3, D / 2 - 3, 5, 5.75, main, mainPattern);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) post(it, sx * (W / 2 - 3), sy * (D / 2 - 3), 0, 16.5, 0.6, 1, legColor, legPattern);
      break;
    }
    case "side-table": {
      roundTop(it, 0, 0, W / 2, D / 2, 22.75, 24, main, mainPattern, 2);
      post(it, 0, 0, 1, 22.75, 1.6, 1.1, main, mainPattern, 12);
      roundTop(it, 0, 0, W * 0.3, D * 0.3, 0, 1, main, mainPattern, 2, 16);
      break;
    }
    case "tv-stand":
      tvStand(it, W, D, main, mainPattern, legColor);
      break;
    case "bookshelf":
      bookcase(it, W, D, 72, main, mainPattern, item.id);
      break;
    case "dining-table": {
      roundTop(it, 0, 0, (W * 0.95) / 2, (D * 0.95) / 2, 28.5, 30, main, mainPattern, 10);
      const ax = (W * 0.95) / 2 - 3;
      const ay = (D * 0.95) / 2 - 3;
      it.box(-ax, ax, -ay, -ay + 0.9, 25, 28.5, main, mainPattern);
      it.box(-ax, ax, ay - 0.9, ay, 25, 28.5, main, mainPattern);
      it.box(-ax, -ax + 0.9, -ay, ay, 25, 28.5, main, mainPattern);
      it.box(ax - 0.9, ax, -ay, ay, 25, 28.5, main, mainPattern);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) post(it, sx * (ax - 0.6), sy * (ay - 0.6), 0, 28.5, 1, 1.5, main, mainPattern);
      // Chairs tucked in on the long sides, their backs away from the table.
      for (const x of [-0.3, 0, 0.3]) for (const s of [-1, 1]) chair(partFrame(it, x * W, s * 0.5 * D, s < 0 ? 0 : 180), W * 0.22, D * 0.38, main, mainPattern, shade(LINEN, 0.92));
      break;
    }
    case "bench": {
      roundTop(it, 0, 0, W / 2, D / 2, 16.5, 18, main, mainPattern, 10);
      for (const sx of [-1, 1]) {
        it.box(sx * (W / 2 - 3) - 0.9, sx * (W / 2 - 3) + 0.9, -D / 2 + 1.5, D / 2 - 1.5, 2, 16.5, main, mainPattern);
        it.box(sx * (W / 2 - 3) - 1.1, sx * (W / 2 - 3) + 1.1, -D / 2 + 1, D / 2 - 1, 0, 2, main, mainPattern);
      }
      it.box(-W / 2 + 3, W / 2 - 3, -0.6, 0.6, 5, 6.5, main, mainPattern);
      break;
    }
    case "bed-twin":
    case "bed-full":
    case "bed-queen":
    case "bed-king":
      bed(it, W, D, main, cloth, wood);
      break;
    case "nightstand":
    case "dresser": {
      const top = item.kind === "dresser" ? 34 : 26;
      const legs = 4;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) post(it, sx * (W / 2 - 1.5), sy * (D / 2 - 1.5), 0, legs, 0.6, 0.9, main, mainPattern);
      it.box(-W / 2, W / 2, -D / 2, D / 2 - 1, legs, top - 1, main, mainPattern);
      roundTop(it, 0, 0.25, W / 2 + 0.25, D / 2 + 0.25, top - 1, top, main, mainPattern, 10);
      const g = drawerGrid(W, top - 1 - legs - 1);
      drawerFronts(it, -W / 2 + 0.75, W / 2 - 0.75, legs + 0.75, top - 1.25, D / 2 - 1, g.columns, item.kind === "nightstand" ? Math.min(2, g.rows) : g.rows, main, mainPattern);
      break;
    }
    case "desk": {
      roundTop(it, 0, 0, W / 2, D / 2, 28.5, 30, main, mainPattern, 10);
      for (const sy of [-1, 1]) post(it, -W / 2 + 2, sy * (D / 2 - 2), 0, 28.5, 0.8, 1.1, main, mainPattern);
      const px = W / 2 - Math.min(16, W * 0.32);
      it.box(px, W / 2 - 1, -D / 2 + 1, D / 2 - 1.75, 1, 28.5, main, mainPattern);
      drawerFronts(it, px + 0.5, W / 2 - 1.5, 2, 28, D / 2 - 1.75, 1, 3, main, mainPattern);
      it.box(-W / 2 + 2, px, -D / 2 + 1, -D / 2 + 1.75, 14, 28.5, main, mainPattern);
      break;
    }
    case "desk-chair":
      deskChair(it, W, D, main, cloth);
      break;
    case "bar-stools":
      for (const x of [-0.33, 0, 0.33]) {
        const s = partFrame(it, x * W, 0, 0);
        const r = Math.min(W * 0.12, D * 0.45);
        roundTop(s, 0, 0, r, r, 26, 28.5, main, mainPattern, 2, 18);
        for (const k of [0, 1, 2, 3]) {
          const a = (Math.PI / 2) * k + Math.PI / 4;
          post(s, Math.cos(a) * (r - 1.5), Math.sin(a) * (r - 1.5), 0, 26, 0.45, 0.45, COLORS.steel, PATTERN.metal, 6);
        }
        const ring = r - 1.4;
        s.box(-ring, ring, -ring - 0.3, -ring + 0.3, 8.5, 9.1, COLORS.steel, PATTERN.metal);
        s.box(-ring, ring, ring - 0.3, ring + 0.3, 8.5, 9.1, COLORS.steel, PATTERN.metal);
      }
      break;
    case "plant": {
      const r = Math.min(W, D) * 0.35;
      it.loft(
        [
          { z: 0, rx: 0, ry: 0 },
          { z: 0, rx: r * 0.75, ry: r * 0.75 },
          { z: 14, rx: r, ry: r },
          { z: 14, rx: r * 0.9, ry: r * 0.9 },
          { z: 12.5, rx: r * 0.88, ry: r * 0.88 },
          { z: 12.5, rx: 0, ry: 0 },
        ],
        POT,
        PATTERN.ceramic,
        16,
      );
      it.box(-r * 0.6, r * 0.6, -r * 0.6, r * 0.6, 12.4, 12.8, SOIL, PATTERN.satin);
      for (let i = 0; i < 7; i++) {
        const a = rand(item.id, i) * Math.PI * 2;
        // Kept inside the piece's footprint.
        const half = Math.min(W, D) / 2;
        const s = Math.min(half * 0.65, 5 + rand(item.id, i + 30) * 3);
        const out = i === 0 ? 0 : (0.45 + rand(item.id, i + 9) * 0.55) * (half - s);
        const z = 26 + rand(item.id, i + 20) * 22;
        foliage(it, Math.cos(a) * out, Math.sin(a) * out, z, s, shade(LEAF, 0.8 + rand(item.id, i + 40) * 0.45));
      }
      post(it, 0, 0, 12.5, 40, 0.5, 0.3, hex("#6b5137"), PATTERN.wood, 5);
      break;
    }
  }
  mb.pattern = 0;
  return true;
}

/** A soft ball of leaves. */
function foliage(it: ItemFrame, x: number, y: number, z: number, r: number, color: RGB) {
  const rings: Ring[] = [0, 0.2, 0.42, 0.62, 0.8, 0.94, 1].map((k) => {
    const a = Math.PI * k;
    return { z: z - Math.cos(a) * r * 0.8, rx: Math.sin(a) * r, ry: Math.sin(a) * r * 0.9, cx: x, cy: y };
  });
  it.loft(rings, color, PATTERN.satin, 9);
}

/** A sofa, loveseat or armchair: a base, back, two arms (track: square; rolled: a round top), seat and back cushions by length, short legs. */
function sofa(it: ItemFrame, W: number, D: number, main: RGB, cloth: number, leg: RGB, legPattern: number, arms: "track" | "rolled") {
  const a = arms === "track" ? Math.min(6, W * 0.12) : Math.min(7, W * 0.15);
  const y0 = -D / 2;
  const y1 = D / 2;
  const back = Math.min(7, D * 0.2);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) post(it, sx * (W / 2 - 2.5), sy * (D / 2 - 2.5), 0, 4, 0.6, 0.9, leg, legPattern);
  // Base under the seat, and the back.
  cushion(it, -W / 2 + a - 0.5, W / 2 - a + 0.5, y0 + 1, y1 - 0.5, 4, 10, main, cloth, 1);
  cushion(it, -W / 2, W / 2, y0, y0 + back, 4, 30, main, cloth, 2);
  for (const sx of [-1, 1]) {
    const xa = sx < 0 ? -W / 2 : W / 2 - a;
    if (arms === "track") cushion(it, xa, xa + a, y0, y1, 4, 24, main, cloth, 1.2);
    else {
      cushion(it, xa, xa + a, y0, y1 - 1, 4, 20, main, cloth, 1);
      // The roll runs front to back along the arm's top.
      const r = a / 2 + 0.6;
      const at = { cx: xa + a / 2, cy: 20 };
      it.loft(
        [
          { z: y0, rx: 0, ry: 0, ...at },
          { z: y0, rx: r, ry: r, ...at },
          { z: y1 - 1.5, rx: r, ry: r, ...at },
          { z: y1 - 0.5, rx: r * 0.8, ry: r * 0.8, ...at },
          { z: y1 - 0.5, rx: 0, ry: 0, ...at },
        ],
        main,
        cloth,
        12,
        "y",
      );
    }
  }
  const sx0 = -W / 2 + a;
  const sx1 = W / 2 - a;
  const n = seatCushions(sx1 - sx0);
  const cw = (sx1 - sx0) / n;
  const soft = shade(main, 1.04);
  for (let i = 0; i < n; i++) {
    const c0 = sx0 + i * cw + 0.15;
    const c1 = c0 + cw - 0.3;
    cushion(it, c0, c1, y0 + back, y1 - 0.5, 10, 16, soft, cloth, 2);
    cushion(it, c0, c1, y0 + back - 0.5, y0 + back + 5.5, 16, 32, soft, cloth, 2.5);
  }
}

/** An L-shaped sectional: a back along the back and the right side, an arm on the left, a chaise on the right, cushions by length. */
function sectional(it: ItemFrame, W: number, D: number, main: RGB, cloth: number, leg: RGB, legPattern: number) {
  const back = 7;
  const a = 6;
  const y0 = -D / 2;
  const row = D * 0.46;
  const chaise = W * 0.34;
  for (const [x, y] of [[-W / 2 + 2.5, y0 + 2.5], [-W / 2 + 2.5, y0 + row - 2.5], [W / 2 - 2.5, y0 + 2.5], [W / 2 - 2.5, D / 2 - 2.5], [W / 2 - chaise + 2.5, D / 2 - 2.5]]) {
    post(it, x, y, 0, 4, 0.6, 0.9, leg, legPattern);
  }
  cushion(it, -W / 2, W / 2, y0, y0 + back, 4, 30, main, cloth, 2);
  cushion(it, W / 2 - back, W / 2, y0 + back - 1, D / 2, 4, 30, main, cloth, 2);
  cushion(it, -W / 2, -W / 2 + a, y0 + back - 1, y0 + row, 4, 24, main, cloth, 1.2);
  cushion(it, -W / 2 + a - 0.5, W / 2 - back + 0.5, y0 + back - 1, y0 + row, 4, 10, main, cloth, 1);
  cushion(it, W / 2 - chaise, W / 2 - back + 0.5, y0 + row - 1, D / 2 - 0.5, 4, 10, main, cloth, 1);
  const soft = shade(main, 1.04);
  // Seat and back cushions along the back run, then the chaise's own.
  const x0 = -W / 2 + a;
  const x1 = W / 2 - back;
  const n = seatCushions(x1 - x0);
  const cw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const c0 = x0 + i * cw + 0.15;
    cushion(it, c0, c0 + cw - 0.3, y0 + back, y0 + row - 0.5, 10, 16, soft, cloth, 2);
    cushion(it, c0, c0 + cw - 0.3, y0 + back - 0.5, y0 + back + 5.5, 16, 32, soft, cloth, 2.5);
  }
  cushion(it, W / 2 - chaise + 0.15, x1 - 0.15, y0 + row, D / 2 - 0.5, 10, 16, soft, cloth, 2);
  const along = D / 2 - (y0 + back) - 0.5;
  const m = seatCushions(along - row);
  const ch = (D / 2 - 0.5 - (y0 + row)) / m;
  for (let i = 0; i < m; i++) {
    const c0 = y0 + row + i * ch + 0.15;
    cushion(it, x1 - 5.5, x1 + 0.5, c0, c0 + ch - 0.3, 16, 32, soft, cloth, 2.5);
  }
}

/** A dining chair in its own frame (its back toward -y): legs, a padded seat, back posts and rails. */
function chair(it: ItemFrame, W: number, D: number, wood: RGB, pattern: number, seat: RGB) {
  const x = W / 2 - 1;
  const y = D / 2 - 1;
  for (const sx of [-1, 1]) {
    post(it, sx * x, y, 0, 17, 0.55, 0.65, wood, pattern, 6);
    post(it, sx * x, -y, 0, 34, 0.55, 0.65, wood, pattern, 6);
  }
  it.box(-x, x, -y - 0.5, y + 0.5, 16, 17, wood, pattern);
  cushion(it, -x + 0.3, x - 0.3, -y + 0.3, y + 0.2, 17, 18.75, seat, PATTERN.fabric, 0.8, 12);
  for (const z of [22, 27]) it.box(-x, x, -y - 0.4, -y + 0.4, z, z + 1, wood, pattern);
  it.box(-x - 0.3, x + 0.3, -y - 0.6, -y + 0.6, 31.5, 34, wood, pattern);
}

/** An office chair: a five-spoke base with casters, a gas column, a seat, a back on a support and two arms. */
function deskChair(it: ItemFrame, W: number, D: number, main: RGB, cloth: number) {
  const r = Math.min(W, D) / 2 - 1;
  for (let k = 0; k < 5; k++) {
    const s = partFrame(it, 0, 0, k * 72);
    s.box(-0.8, 0.8, 0, r, 2.5, 3.6, BLACK, PATTERN.satin);
    post(s, 0, r - 0.6, 0, 2.5, 0.9, 0.9, BLACK, PATTERN.satin, 6);
  }
  post(it, 0, 0, 2.5, 16, 1.4, 1.2, BLACK, PATTERN.satin, 10);
  post(it, 0, 0, 6, 15, 0.9, 0.9, COLORS.steel, PATTERN.metal, 8);
  cushion(it, -W * 0.4, W * 0.4, -D * 0.38, D * 0.4, 16, 19.5, main, cloth, 1.5);
  it.box(-1, 1, -D * 0.42, -D * 0.36, 17, 23, BLACK, PATTERN.satin);
  cushion(it, -W * 0.37, W * 0.37, -D * 0.47, -D * 0.38, 21, 39, main, cloth, 1.6);
  for (const sx of [-1, 1]) {
    it.box(sx * W * 0.42 - 0.5, sx * W * 0.42 + 0.5, -D * 0.1, D * 0.05, 19.5, 26, BLACK, PATTERN.satin);
    it.box(sx * W * 0.42 - 1.2, sx * W * 0.42 + 1.2, -D * 0.25, D * 0.15, 26, 27, BLACK, PATTERN.satin);
  }
}

/** A bed: legs and a wood frame, an upholstered headboard in a wood surround, mattress, duvet with the sheet folded over, and pillows. */
function bed(it: ItemFrame, W: number, D: number, main: RGB, cloth: number, wood: RGB) {
  const y0 = -D / 2;
  const y1 = D / 2;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) post(it, sx * (W / 2 - 2), sy * (D / 2 - 2), 0, 5, 0.9, 1.2, wood, PATTERN.wood);
  it.box(-W / 2, W / 2, y0 + 3, y1, 5, 12, wood, PATTERN.wood);
  // Headboard: posts, a top rail and a padded panel between them.
  for (const sx of [-1, 1]) it.box(sx * W / 2 - (sx < 0 ? 0 : 2), sx * W / 2 + (sx < 0 ? 2 : 0), y0, y0 + 3, 0, 48, wood, PATTERN.wood);
  it.box(-W / 2, W / 2, y0, y0 + 3, 46, 48, wood, PATTERN.wood);
  cushion(it, -W / 2 + 2, W / 2 - 2, y0 + 0.5, y0 + 3.5, 12, 46, shade(main, 0.82), cloth, 1.2);
  cushion(it, -W / 2 + 1, W / 2 - 1, y0 + 3.5, y1 - 1, 12, 22, LINEN, PATTERN.fabric, 2);
  // Duvet over the foot two thirds, a little wider than the mattress, then the sheet folded back.
  const fold = y0 + D * 0.32;
  cushion(it, -W / 2 - 0.6, W / 2 + 0.6, fold, y1 - 0.2, 15, 23.5, main, PATTERN.fabric, 2.5);
  cushion(it, -W / 2 - 0.4, W / 2 + 0.4, fold - 7, fold + 1.5, 16, 23.8, shade(LINEN, 0.97), PATTERN.fabric, 2.5);
  const n = W < 50 ? 1 : 2;
  const pw = (W - 6) / n;
  for (let i = 0; i < n; i++) {
    const p0 = -W / 2 + 3 + i * pw + 0.5;
    cushion(it, p0, p0 + pw - 1, y0 + 4.5, y0 + 21, 22, 28, LINEN, PATTERN.fabric, 3);
  }
  // Two shams behind the pillows on a queen or king.
  if (W >= 60) for (let i = 0; i < 2; i++) {
    const p0 = -W / 2 + 4 + i * ((W - 8) / 2) + 0.5;
    cushion(it, p0, p0 + (W - 8) / 2 - 1, y0 + 3.6, y0 + 9, 22, 41, shade(main, 0.9), cloth, 3);
  }
}

/** A TV stand: a low cabinet on legs with doors by width, and a flat TV on a stand foot. */
function tvStand(it: ItemFrame, W: number, D: number, main: RGB, pattern: number, leg: RGB) {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) post(it, sx * (W / 2 - 2), sy * (D / 2 - 2), 0, 4, 0.7, 0.9, leg, pattern);
  it.box(-W / 2, W / 2, -D / 2, D / 2 - 0.75, 4, 21, main, pattern);
  roundTop(it, 0, 0, W / 2, D / 2, 21, 22, main, pattern, 10);
  const n = Math.max(2, Math.ceil(W / 24));
  const dw = (W - 1.5) / n;
  for (let i = 0; i < n; i++) {
    const a = -W / 2 + 0.75 + i * dw + 0.1;
    const b = a + dw - 0.2;
    it.box(a, b, D / 2 - 0.75, D / 2, 4.75, 20.5, shade(main, 0.96), pattern);
    const left = i >= n / 2;
    handle(it, { x: left ? a + 1.5 : b - 1.5, z: 15, pull: true }, D / 2, 4);
  }
  const tw = Math.min(W * 0.9, 65);
  const th = (tw * 9) / 16;
  const z0 = 26;
  const y = -D / 2 + 3;
  it.box(-5, 5, y - 3, y + 3, 22, 22.6, BLACK, PATTERN.satin);
  it.box(-1, 1, y - 0.6, y + 0.6, 22.6, z0 + 2, BLACK, PATTERN.satin);
  it.box(-tw / 2, tw / 2, y - 0.6, y + 0.9, z0, z0 + th, BLACK, PATTERN.satin);
  it.box(-tw / 2 + 0.3, tw / 2 - 0.3, y + 0.9, y + 1, z0 + 0.3, z0 + th - 0.3, SCREEN, PATTERN.ceramic);
}

/** A closet's shelf and hanging rod in detail: a painted shelf on brackets, a round chrome rod with end sockets. */
export function drawClosetDetail(mb: MeshBuilder, f: Frame, fx: Fixture, floorIn: number): boolean {
  if (fx.kind !== "closet") return false;
  const it = new ItemFrame(mb, f, { x: fx.x, y: fx.y }, fx.rotation ?? 0, floorIn);
  const W = fx.widthIn;
  const D = fx.depthIn;
  const y0 = -D / 2;
  const shelfD = Math.min(14, D * 0.55);
  it.box(-W / 2, W / 2, y0, y0 + shelfD, 66, 66.75, SHELF_WHITE, PATTERN.paint);
  it.box(-W / 2, W / 2, y0 + shelfD - 0.75, y0 + shelfD, 65.25, 66, SHELF_WHITE, PATTERN.paint);
  it.box(-W / 2, W / 2, y0, y0 + 0.75, 62, 66, SHELF_WHITE, PATTERN.paint);
  const rodY = y0 + Math.min(12, D * 0.5);
  const n = Math.max(2, Math.ceil(W / 48) + 1);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 1 + (i * (W - 2)) / (n - 1);
    it.box(x - 0.4, x + 0.4, y0 + 0.75, y0 + shelfD - 1, 64.5, 66, SHELF_WHITE, PATTERN.paint);
  }
  rodAlongX(it, -W / 2 + 0.5, W / 2 - 0.5, rodY, 62.75, 0.62, COLORS.steel, PATTERN.metal);
  for (const sx of [-1, 1]) it.box(sx * (W / 2 - 0.25) - 0.25, sx * (W / 2 - 0.25) + 0.25, rodY - 1.25, rodY + 1.25, 61.5, 64, COLORS.steel, PATTERN.metal);
  mb.pattern = 0;
  return true;
}

/** A built-in bookcase in detail: shelves by its height, books on them. */
export function drawAddOnDetail(mb: MeshBuilder, f: Frame, a: AddOn, floorIn: number, color: RGB): boolean {
  if (a.kind !== "bookcase") return false;
  const it = new ItemFrame(mb, f, { x: a.x, y: a.y }, a.rotation ?? 0, floorIn + a.bottomIn);
  bookcase(it, a.widthIn, a.depthIn, a.heightIn, color, PATTERN.wood, a.id);
  mb.pattern = 0;
  return true;
}
