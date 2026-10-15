import type { PlanRoom, Product, Selection } from "@/lib/model/schema";
import { roomFinishes, wallPicks } from "@/lib/interior/picks";
import { TILE_ROOMS } from "@/lib/catalog/categories";
import { floorColor, COLORS } from "./colors";
import { hex, type RGB } from "./mesh";

/**
 * The picked interior finishes as 3D colors and floor patterns, room by
 * room. Rooms with nothing picked keep the plain colors.
 */

/**
 * Patterns drawn by the 3D material (see components/house3d/patternMaterial.ts):
 * floors, and since milestone 10 siding, roofs and the yard.
 */
export const PATTERN = {
  none: 0,
  plank: 1,
  tile: 2,
  carpet: 3,
  stone: 4,
  lap: 5,
  batten: 6,
  shake: 7,
  brick: 8,
  stucco: 9,
  shingle: 10,
  seam: 11,
  grass: 12,
  mulch: 13,
} as const;
export type PatternId = (typeof PATTERN)[keyof typeof PATTERN];

export type RoomLook = {
  floor: RGB;
  floorPattern: PatternId;
  wall: RGB;
  cabinet: RGB;
  counter: RGB;
  vanity: RGB;
  sink: RGB;
  fridge: RGB;
  range: RGB;
  dishwasher: RGB;
  door: RGB;
  trim: RGB;
  /** Accent walls: paint for one wall of the room, by wall key ("e3"). */
  accents: Map<string, RGB>;
};

const patternOf = (p: Product | undefined): PatternId => {
  switch (p?.pattern) {
    case "plank":
      return PATTERN.plank;
    case "tile":
      return PATTERN.tile;
    case "carpet":
      return PATTERN.carpet;
    case "stone":
      return PATTERN.stone;
    default:
      return PATTERN.none;
  }
};

const colorOf = (p: Product | undefined, fallback: RGB): RGB => (p?.color ? hex(p.color) : fallback);

/** How a room looks with what's picked for it (and for the whole house). */
export function roomLook(selections: Selection[] | undefined, room: Pick<PlanRoom, "id" | "type">): RoomLook {
  const picks = selections?.length ? roomFinishes(selections, room.id) : new Map<string, Product>();
  const type = room.type ?? "";
  const plain = floorColor(room);
  const floorPick = TILE_ROOMS.has(type) ? picks.get("tile") : plain === COLORS.wood || plain === COLORS.carpet ? picks.get("flooring") : undefined;
  // Tile picks meant for showers only don't go on the floor.
  const floor = floorPick && !(floorPick.kind === "shower" || floorPick.kind === "wall") ? floorPick : undefined;
  return {
    floor: colorOf(floor, plain),
    floorPattern: floor ? patternOf(floor) : plain === COLORS.wood ? PATTERN.plank : plain === COLORS.tile ? PATTERN.tile : plain === COLORS.carpet ? PATTERN.carpet : PATTERN.none,
    wall: colorOf(picks.get("paint"), COLORS.drywall),
    cabinet: colorOf(picks.get("cabinets"), COLORS.cabinet),
    counter: colorOf(picks.get("counters"), COLORS.counter),
    vanity: colorOf(picks.get("vanities"), COLORS.cabinet),
    sink: colorOf(picks.get("kitchen-sinks"), COLORS.steel),
    fridge: colorOf(picks.get("fridges"), COLORS.steel),
    range: colorOf(picks.get("ranges"), COLORS.steel),
    dishwasher: colorOf(picks.get("dishwashers"), COLORS.steel),
    door: colorOf(picks.get("interior-doors"), COLORS.door),
    trim: colorOf(picks.get("trim"), COLORS.trim),
    accents: new Map([...(selections?.length ? wallPicks(selections, room.id) : new Map())].map(([k, s]) => [k, colorOf(s.product, COLORS.drywall)])),
  };
}
