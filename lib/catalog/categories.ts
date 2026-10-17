import type { Product } from "@/lib/model/schema";
import type { RateId } from "@/lib/cost/rates";
import { isHeated } from "@/lib/brief/rooms";

/**
 * The kinds of products picked in the Interior design window (I in the Walkthrough), which rooms each one
 * belongs in, and which cost line its price replaces.
 *
 * `share` is how much of that line's mid-range material allowance the pick
 * replaces (a kitchen faucet is part of the "kitchen sink + faucet" line, a
 * fridge part of the appliance package). `perUnit` turns the line's unit into
 * the product's (paint is priced per gallon but the line is per sq ft of floor).
 */

export type InteriorCategoryId =
  | "flooring"
  | "tile"
  | "paint"
  | "trim"
  | "interior-doors"
  | "cabinets"
  | "counters"
  | "hardware"
  | "kitchen-sinks"
  | "kitchen-faucets"
  | "pot-fillers"
  | "bar-faucets"
  | "fridges"
  | "ranges"
  | "dishwashers"
  | "hoods"
  | "vanities"
  | "bath-faucets"
  | "toilets"
  | "showers"
  | "lighting";

export type InteriorCategory = {
  id: InteriorCategoryId;
  label: string;
  /** One product, as a word for "Pick a …". */
  one: string;
  group: "Floors and walls" | "Kitchen" | "Bath" | "Lighting";
  line: RateId;
  share: number;
  perUnit: number;
  unit: Product["unit"];
  /** Whether rooms can have their own pick, or it's for the whole house only. */
  perRoom: boolean;
  /** Room types it belongs in. */
  fits: (roomType: string) => boolean;
};

export const BATHS = new Set(["bathroom", "primary-bath", "half-bath"]);
export const FULL_BATHS = new Set(["bathroom", "primary-bath"]);
/** Rooms that get tile floors instead of the flooring pick. */
export const TILE_ROOMS = new Set(["bathroom", "primary-bath", "half-bath", "laundry", "mudroom"]);
const KITCHEN = new Set(["kitchen"]);

const heated = (t: string) => isHeated(t);
const floorRoom = (t: string) => heated(t) && !TILE_ROOMS.has(t) && t !== "mechanical";

export const INTERIOR_CATEGORIES: InteriorCategory[] = [
  { id: "flooring", label: "Flooring", one: "floor", group: "Floors and walls", line: "flooring", share: 1, perUnit: 1, unit: "sqft", perRoom: true, fits: floorRoom },
  { id: "tile", label: "Tile", one: "tile", group: "Floors and walls", line: "tile", share: 1, perUnit: 1, unit: "sqft", perRoom: true, fits: (t) => TILE_ROOMS.has(t) },
  // About 3.5 sq ft of wall and ceiling per sq ft of floor, two coats at 350 sq ft a gallon: 0.02 gallons per sq ft of floor.
  // The pick is the wall color; primer and ceiling paint (about 40% of the allowance) stay.
  { id: "paint", label: "Wall paint", one: "paint color", group: "Floors and walls", line: "interior-paint", share: 0.6, perUnit: 0.02, unit: "gallon", perRoom: true, fits: (t) => heated(t) && t !== "mechanical" },
  // About 0.6 ft of baseboard and casing per sq ft of floor; closet shelves and sills (40%) stay.
  { id: "trim", label: "Baseboard and casing", one: "trim", group: "Floors and walls", line: "trim-millwork", share: 0.6, perUnit: 0.6, unit: "linft", perRoom: false, fits: heated },
  { id: "interior-doors", label: "Interior doors", one: "door", group: "Floors and walls", line: "interior-door", share: 0.75, perUnit: 1, unit: "each", perRoom: false, fits: heated },
  { id: "cabinets", label: "Cabinets", one: "cabinet", group: "Kitchen", line: "kitchen-cabinets", share: 1, perUnit: 1, unit: "linft", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "counters", label: "Countertops", one: "countertop", group: "Kitchen", line: "countertops", share: 1, perUnit: 1, unit: "sqft", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "hardware", label: "Cabinet hardware", one: "pull or knob", group: "Kitchen", line: "cabinet-hardware", share: 1, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) || BATHS.has(t) },
  { id: "kitchen-sinks", label: "Kitchen sink", one: "sink", group: "Kitchen", line: "kitchen-sink-faucet", share: 0.35, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "kitchen-faucets", label: "Kitchen faucet", one: "faucet", group: "Kitchen", line: "kitchen-sink-faucet", share: 0.45, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "pot-fillers", label: "Pot filler", one: "pot filler", group: "Kitchen", line: "pot-filler", share: 0.6, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "bar-faucets", label: "Bar or prep faucet", one: "bar faucet", group: "Kitchen", line: "prep-sink-faucet", share: 0.45, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "fridges", label: "Refrigerator", one: "refrigerator", group: "Kitchen", line: "appliance-package", share: 0.38, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "ranges", label: "Range", one: "range", group: "Kitchen", line: "appliance-package", share: 0.32, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "dishwashers", label: "Dishwasher", one: "dishwasher", group: "Kitchen", line: "appliance-package", share: 0.15, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "hoods", label: "Range hood", one: "hood", group: "Kitchen", line: "appliance-package", share: 0.15, perUnit: 1, unit: "each", perRoom: true, fits: (t) => KITCHEN.has(t) },
  { id: "vanities", label: "Vanity", one: "vanity", group: "Bath", line: "vanity", share: 1, perUnit: 1, unit: "each", perRoom: true, fits: (t) => BATHS.has(t) },
  { id: "bath-faucets", label: "Bath faucet", one: "faucet", group: "Bath", line: "bath-sink-faucet", share: 0.75, perUnit: 1, unit: "each", perRoom: true, fits: (t) => BATHS.has(t) },
  { id: "toilets", label: "Toilet", one: "toilet", group: "Bath", line: "toilet", share: 1, perUnit: 1, unit: "each", perRoom: true, fits: (t) => BATHS.has(t) },
  // The valve trim and shower head; the tub or pan, valve body and glass (70%) stay.
  { id: "showers", label: "Shower trim", one: "shower set", group: "Bath", line: "tub-shower-trim", share: 1, perUnit: 1, unit: "set", perRoom: true, fits: (t) => FULL_BATHS.has(t) },
  { id: "lighting", label: "Lighting", one: "light", group: "Lighting", line: "lighting-fixtures", share: 1, perUnit: 1, unit: "each", perRoom: true, fits: (t) => heated(t) && t !== "mechanical" },
];

export function interiorCategory(id: string): InteriorCategory | undefined {
  return INTERIOR_CATEGORIES.find((c) => c.id === id);
}

/** Light fixture kinds that suit a room type (any kind suits the whole house). */
export function lightKindsFor(roomType: string): string[] {
  if (roomType === "kitchen") return ["pendant", "flush"];
  if (roomType === "dining") return ["chandelier", "pendant"];
  if (BATHS.has(roomType)) return ["vanity", "sconce", "flush"];
  if (roomType === "entry" || roomType === "living" || roomType === "family") return ["chandelier", "flush", "sconce", "pendant"];
  return ["flush", "sconce", "pendant"];
}

/** Tile kinds that suit a room type. */
export function tileKindsFor(roomType: string): string[] {
  if (FULL_BATHS.has(roomType)) return ["floor", "shower"];
  return ["floor"];
}

/** How many ceiling or wall lights a room of this type usually gets from the light allowance (recessed cans are in electrical). */
export function lightsFor(roomType: string, sqft: number): number {
  if (!isHeated(roomType) || roomType === "mechanical") return 0;
  if (roomType === "kitchen") return 3;
  if (roomType === "closet" || roomType === "primary-closet" || roomType === "pantry" || roomType === "storage") return sqft >= 25 ? 1 : 0;
  if (roomType === "hall") return Math.max(1, Math.round(sqft / 60));
  if (BATHS.has(roomType)) return roomType === "primary-bath" ? 2 : 1;
  if (roomType === "living" || roomType === "family" || roomType === "bonus") return 2;
  return 1;
}
