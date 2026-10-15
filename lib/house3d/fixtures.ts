import type { Fixture, Point } from "@/lib/model/schema";
import { add, rotate } from "@/lib/plan/geometry";
import { COLORS } from "./colors";
import { MeshBuilder, type Frame, type RGB } from "./mesh";
import type { RoomLook } from "./finishes";

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
function finished(kind: string, color: RGB, look?: RoomLook): RGB {
  if (!look) return color;
  if (color === COLORS.cabinet) return kind === "vanity" ? look.vanity : look.cabinet;
  if (color === COLORS.counter) return look.counter;
  if (color === COLORS.steel) {
    if (kind === "sink") return look.sink;
    if (kind === "fridge") return look.fridge;
    if (kind === "range") return look.range;
    if (kind === "dishwasher") return look.dishwasher;
  }
  return color;
}

export function drawFixture(solid: MeshBuilder, glass: MeshBuilder, f: Frame, fx: Fixture, floorIn: number, look?: RoomLook) {
  const pieces = SHAPES[fx.kind] ?? [{ z0: 0, z1: 30, color: COLORS.cabinet }];
  const c: Point = { x: fx.x, y: fx.y };
  for (const p of pieces) {
    const local = { x: (p.x ?? 0) * fx.widthIn, y: (p.y ?? 0) * fx.depthIn };
    const mid = add(c, rotate(local, fx.rotation ?? 0));
    const w = (p.w ?? 1) * fx.widthIn;
    const d = (p.d ?? 1) * fx.depthIn;
    (p.glass ? glass : solid).block(f, mid, fx.rotation ?? 0, w, d, floorIn + p.z0, floorIn + p.z1, finished(fx.kind, p.color, look));
  }
}

