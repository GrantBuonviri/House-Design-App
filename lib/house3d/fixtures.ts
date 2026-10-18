import type { AddOn, Device, Fixture, FurnitureItem, Point } from "@/lib/model/schema";
import { furnitureType, piecePlace, type Material } from "@/lib/plan/furniture";
import { add, rotate } from "@/lib/plan/geometry";
import { COLORS } from "./colors";
import { hex, MeshBuilder, type Frame, type RGB } from "./mesh";
import { PATTERN, type RoomLook } from "./finishes";

/**
 * Fixtures and appliances as simple 3D shapes. Each is drawn in its own
 * frame (its back toward -y, as on the plan) and turned into place.
 */

type Piece = {
  /** Middle of the piece across (x) and front to back (y, negative is the back), as a share of the fixture's width and depth. */
  x?: number;
  y?: number;
  /** Size as a share of the fixture's width and depth. */
  w?: number;
  d?: number;
  z0: number;
  z1: number;
  color: RGB;
  glass?: boolean;
};

const counter = (h = 36): Piece[] => [
  { w: 0.98, d: 0.94, y: 0.03, z0: 0, z1: h - 1.5, color: COLORS.cabinet },
  { z0: h - 1.5, z1: h, color: COLORS.counter },
];

const SHAPES: Record<string, Piece[]> = {
  counter: counter(),
  island: counter(),
  sink: [...counter(), { w: 0.75, d: 0.6, z0: 36, z1: 36.2, color: COLORS.steel }],
  "prep-sink": [...counter(), { w: 0.7, d: 0.6, z0: 36, z1: 36.2, color: COLORS.steel }],
  range: [{ z0: 0, z1: 35.5, color: COLORS.steel }, { z0: 35.5, z1: 36, color: COLORS.dark }, { d: 0.12, y: -0.44, z0: 36, z1: 44, color: COLORS.steel }],
  fridge: [{ z0: 0, z1: 70, color: COLORS.steel }],
  dishwasher: [{ z0: 0, z1: 34.5, color: COLORS.steel }, { z0: 34.5, z1: 36, color: COLORS.counter }],
  toilet: [
    { w: 0.9, d: 0.3, y: -0.35, z0: 14, z1: 30, color: COLORS.porcelain },
    { w: 0.72, d: 0.65, y: 0.17, z0: 0, z1: 15, color: COLORS.porcelain },
  ],
  vanity: [{ w: 0.98, d: 0.94, y: 0.03, z0: 0, z1: 32, color: COLORS.cabinet }, { z0: 32, z1: 34, color: COLORS.counter }, { w: 0.5, d: 0.55, z0: 34, z1: 34.2, color: COLORS.porcelain }],
  tub: [{ z0: 0, z1: 20, color: COLORS.porcelain }],
  shower: [
    { z0: 0, z1: 4, color: COLORS.tile },
    { d: 0.02, y: 0.49, z0: 4, z1: 76, color: COLORS.glass, glass: true },
  ],
  washer: [{ z0: 0, z1: 38, color: COLORS.porcelain }],
  dryer: [{ z0: 0, z1: 38, color: COLORS.porcelain }],
  "laundry-sink": [{ z0: 0, z1: 34, color: COLORS.porcelain }],
  closet: [
    { d: 0.55, y: -0.22, z0: 66, z1: 67.5, color: COLORS.trim },
    { w: 0.98, d: 0.06, y: 0, z0: 62, z1: 63.5, color: COLORS.steel },
  ],
  "water-heater": [{ w: 0.9, d: 0.9, z0: 0, z1: 60, color: COLORS.mechanical }],
  furnace: [{ z0: 0, z1: 48, color: COLORS.mechanical }],
  fireplace: [
    { z0: 0, z1: 48, color: COLORS.patio },
    { w: 0.5, d: 0.1, y: 0.46, z0: 6, z1: 30, color: COLORS.dark },
    { w: 1.08, d: 0.5, y: 0.2, z0: 52, z1: 54, color: COLORS.wood },
  ],
};

/** How high a fixture's solid parts reach above its floor (glass left out). */
export function fixtureSpan(kind: string): { z0: number; z1: number } {
  const solid = (SHAPES[kind] ?? [{ z0: 0, z1: 30 }]).filter((p) => !("glass" in p && p.glass));
  return { z0: Math.min(...solid.map((p) => p.z0)), z1: Math.max(...solid.map((p) => p.z1)) };
}

/** A fixture piece's color with the room's picked finishes: cabinets, counters, the sink and appliances. */
export function finished(kind: string, color: RGB, look?: RoomLook): RGB {
  if (!look) return color;
  if (color === COLORS.cabinet) return kind === "vanity" ? look.vanity : look.cabinet;
  if (color === COLORS.counter) return look.counter;
  if (color === COLORS.steel) {
    if (kind === "sink" || kind === "prep-sink") return look.sink;
    if (kind === "fridge") return look.fridge;
    if (kind === "range") return look.range;
    if (kind === "dishwasher") return look.dishwasher;
  }
  return color;
}

/** A fixture piece's surface for Pretty graphics, by its plain color: painted cabinets, the counter's stone, steel, porcelain... */
export function finishPattern(color: RGB, look?: RoomLook): number {
  switch (color) {
    case COLORS.cabinet:
      return PATTERN.cabinet;
    case COLORS.counter:
      return look?.counterPattern ?? PATTERN.marble;
    case COLORS.steel:
      return PATTERN.metal;
    case COLORS.porcelain:
      return PATTERN.ceramic;
    case COLORS.tile:
      return PATTERN.tile;
    case COLORS.wood:
      return PATTERN.wood;
    case COLORS.trim:
      return PATTERN.paint;
    case COLORS.patio:
      return PATTERN.stone;
    case COLORS.dark:
    case COLORS.mechanical:
      return PATTERN.satin;
    default:
      return PATTERN.none;
  }
}

export function drawFixture(solid: MeshBuilder, glass: MeshBuilder, f: Frame, fx: Fixture, floorIn: number, look?: RoomLook) {
  const pieces = SHAPES[fx.kind] ?? [{ z0: 0, z1: 30, color: COLORS.cabinet }];
  const c: Point = { x: fx.x, y: fx.y };
  for (const p of pieces) {
    const local = { x: (p.x ?? 0) * fx.widthIn, y: (p.y ?? 0) * fx.depthIn };
    const mid = add(c, rotate(local, fx.rotation ?? 0));
    const w = (p.w ?? 1) * fx.widthIn;
    const d = (p.d ?? 1) * fx.depthIn;
    const mb = p.glass ? glass : solid;
    mb.pattern = p.glass ? 0 : finishPattern(p.color, look);
    mb.block(f, mid, fx.rotation ?? 0, w, d, floorIn + p.z0, floorIn + p.z1, finished(fx.kind, p.color, look));
    mb.pattern = 0;
  }
}


const FURNITURE_WOOD = hex("#9c6f43");
const FURNITURE_LIGHT = hex("#f2efe8");
const FURNITURE_DARK = hex("#3a3632");

/** A piece of furniture as simple boxes: its main color, with wood, bedding and dark legs where they go. */
export function drawFurniture(mb: MeshBuilder, f: Frame, item: FurnitureItem, floorIn: number) {
  const t = furnitureType(item.kind);
  const main = hex(item.color ?? "#cfcac0");
  const colors: Record<Material, RGB> = {
    main,
    wood: t?.main === "wood" ? main : FURNITURE_WOOD,
    light: FURNITURE_LIGHT,
    dark: FURNITURE_DARK,
    metal: COLORS.steel,
  };
  // Surfaces for Pretty graphics: fabric or wood, a rug's pile, bedding, dark legs, metal.
  const patterns: Record<Material, number> = {
    main: t?.main === "wood" ? PATTERN.wood : t?.main === "rug" ? PATTERN.rug : PATTERN.fabric,
    wood: PATTERN.wood,
    light: PATTERN.fabric,
    dark: PATTERN.satin,
    metal: PATTERN.metal,
  };
  for (const p of t?.pieces ?? [{ z0: 0, z1: 30, material: "main" as Material }]) {
    const { mid, w, d } = piecePlace(item, p);
    mb.pattern = patterns[p.material];
    mb.block(f, mid, item.rotation ?? 0, w, d, floorIn + p.z0, floorIn + p.z1, colors[p.material]);
  }
  mb.pattern = 0;
}

const ADDON_WOOD = hex("#a57a52");
const ADDON_WHITE = hex("#f4f2ee");
const GAS_YELLOW = hex("#d9b23a");

/** An add-on's main color: its own, or wood. */
export const addOnColor = (a: Pick<AddOn, "color">): RGB => (a.color ? hex(a.color) : ADDON_WOOD);

/** Add-on shapes, like the fixtures': shares of the item's width and depth, heights as shares of its own height (h) or inches (z). */
type AddOnPiece = { x?: number; y?: number; w?: number; d?: number; h0: number; h1: number; color?: RGB };
const ADDON_SHAPES: Record<string, AddOnPiece[]> = {
  bookcase: [
    { d: 0.1, y: -0.45, h0: 0, h1: 1 },
    { w: 0.04, x: -0.48, h0: 0, h1: 1 },
    { w: 0.04, x: 0.48, h0: 0, h1: 1 },
    ...[0, 0.25, 0.5, 0.75, 0.98].map((h) => ({ h0: h, h1: h + 0.02 })),
  ],
  "window-seat": [{ h0: 0, h1: 0.85 }, { h0: 0.85, h1: 1, color: ADDON_WHITE }],
  bench: [{ h0: 0.85, h1: 1 }, { w: 0.06, x: -0.45, h0: 0, h1: 0.85 }, { w: 0.06, x: 0.45, h0: 0, h1: 0.85 }],
  desk: [{ h0: 0.94, h1: 1 }, { w: 0.04, x: -0.48, h0: 0, h1: 0.94 }, { w: 0.3, x: 0.35, h0: 0, h1: 0.94 }],
  "ceiling-fan": [
    { w: 0.12, d: 0.12, h0: 0, h1: 1, color: ADDON_WHITE },
    { d: 0.1, h0: 0.1, h1: 0.2 },
    { w: 0.1, h0: 0.1, h1: 0.2 },
  ],
  mirror: [{ h0: 0, h1: 1, color: hex("#cfe0e6") }],
  "towel-bar": [{ d: 0.5, y: 0.25, h0: 0, h1: 1, color: COLORS.steel }],
  "grab-bar": [{ d: 0.5, y: 0.25, h0: 0, h1: 1, color: COLORS.steel }],
  "medicine-cabinet": [{ h0: 0, h1: 1, color: ADDON_WHITE }],
  "coat-hooks": [{ d: 0.3, y: -0.35, h0: 0, h1: 1 }, ...[-0.35, 0, 0.35].map((x) => ({ x, w: 0.04, h0: 0.2, h1: 0.6, color: COLORS.dark }))],
  lockers: [{ h0: 0, h1: 1 }, { d: 0.6, y: 0.2, h0: 0.25, h1: 0.27, color: ADDON_WHITE }],
};

/** A built-in or extra (shelving, a window seat, a mirror, a ceiling fan) as simple boxes. */
export function drawAddOn(mb: MeshBuilder, f: Frame, a: AddOn, floorIn: number) {
  const main = addOnColor(a);
  const pieces = ADDON_SHAPES[a.kind] ?? [{ h0: 0, h1: 1 }];
  const z0 = floorIn + a.bottomIn;
  for (const p of pieces) {
    const mid = add({ x: a.x, y: a.y }, rotate({ x: (p.x ?? 0) * a.widthIn, y: (p.y ?? 0) * a.depthIn }, a.rotation ?? 0));
    // Pretty graphics: a mirror reflects, steel shines, white parts are painted, the rest is wood.
    mb.pattern = a.kind === "mirror" ? PATTERN.mirror : p.color === COLORS.steel ? PATTERN.metal : p.color === ADDON_WHITE ? PATTERN.paint : p.color ? PATTERN.satin : PATTERN.wood;
    mb.block(f, mid, a.rotation ?? 0, (p.w ?? 1) * a.widthIn, (p.d ?? 1) * a.depthIn, z0 + p.h0 * a.heightIn, z0 + p.h1 * a.heightIn, p.color ?? main);
  }
  mb.pattern = 0;
}

/** A hookup where it comes through the wall: a valve plate, a drain stub, a gas cock or a vent hood. `mountIn` is its height. */
export function drawHookup(mb: MeshBuilder, f: Frame, d: Device, floorIn: number, mountIn: number) {
  const at = (x: number, y: number) => add({ x: d.x, y: d.y }, rotate({ x, y }, d.rotation ?? 0));
  const z = floorIn + mountIn;
  switch (d.kind) {
    case "water":
      mb.block(f, at(0, -0.5), d.rotation, 8, 1, z - 3, z + 3, ADDON_WHITE);
      mb.block(f, at(-2, 1), d.rotation, 1.2, 3, z - 0.6, z + 0.6, hex("#c0392b"));
      mb.block(f, at(2, 1), d.rotation, 1.2, 3, z - 0.6, z + 0.6, hex("#2e6fb7"));
      break;
    case "drain":
      mb.block(f, at(0, 1), d.rotation, 2, 4, z - 1, z + 1, COLORS.dark);
      break;
    case "gas":
      mb.block(f, at(0, 1), d.rotation, 1, 4, z - 0.5, z + 0.5, COLORS.steel);
      mb.block(f, at(0, 2.5), d.rotation, 3, 1, z - 0.5, z + 0.5, GAS_YELLOW);
      break;
    case "dryer-vent":
      mb.block(f, at(0, 0.5), d.rotation, 6, 2, z - 3, z + 3, ADDON_WHITE);
      break;
  }
}
