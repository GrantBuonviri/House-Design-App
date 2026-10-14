import type { Opening } from "@/lib/model/schema";

/**
 * What can go in a wall (doors, windows, openings) and what can go in a
 * room (fixtures and appliances), with common sizes. Sizes are in inches.
 */

export type OpeningType = {
  id: string;
  label: string;
  kind: Opening["kind"];
  /** Widths to pick from; the first is the default. */
  widths: number[];
  heightIn: number;
  sillIn?: number;
  /** Swings into a room (draws an arc). */
  swings?: boolean;
  /** Two leaves, each swinging from its own end. */
  double?: boolean;
};

export const OPENING_TYPES: OpeningType[] = [
  { id: "door-hinged", label: "Door", kind: "door", widths: [32, 24, 28, 30, 36], heightIn: 80, swings: true },
  { id: "door-entry", label: "Front door", kind: "door", widths: [36, 42], heightIn: 80, swings: true },
  { id: "door-double", label: "Double door", kind: "door", widths: [60, 48, 72], heightIn: 80, swings: true, double: true },
  { id: "door-pocket", label: "Pocket door", kind: "door", widths: [30, 24, 28, 32, 36], heightIn: 80 },
  { id: "door-barn", label: "Barn door", kind: "door", widths: [36, 32, 42, 48], heightIn: 84 },
  { id: "door-slider", label: "Sliding glass door", kind: "door", widths: [72, 60, 96, 120], heightIn: 80 },
  { id: "door-garage", label: "Garage door", kind: "door", widths: [96, 108, 192, 216], heightIn: 84 },
  { id: "window", label: "Window", kind: "window", widths: [36, 24, 30, 48, 60, 72, 96], heightIn: 60, sillIn: 30 },
  { id: "window-picture", label: "Picture window", kind: "window", widths: [72, 60, 96, 120], heightIn: 72, sillIn: 18 },
  { id: "window-high", label: "High window", kind: "window", widths: [48, 36, 60, 72], heightIn: 24, sillIn: 66 },
  { id: "opening", label: "Opening (no door)", kind: "opening", widths: [36, 48, 60, 72, 96], heightIn: 84 },
];

export function openingType(id: string): OpeningType {
  return OPENING_TYPES.find((t) => t.id === id) ?? OPENING_TYPES[0];
}

export type FixtureGroup = "Kitchen" | "Bath" | "Laundry" | "Other";

export type FixtureType = {
  id: string;
  label: string;
  group: FixtureGroup;
  widthIn: number;
  depthIn: number;
  /** Can be stretched along its width (counters, islands, vanities, closet shelves). */
  stretch?: boolean;
};

export const FIXTURE_TYPES: FixtureType[] = [
  { id: "counter", label: "Counter", group: "Kitchen", widthIn: 96, depthIn: 25, stretch: true },
  { id: "island", label: "Island", group: "Kitchen", widthIn: 72, depthIn: 36, stretch: true },
  { id: "sink", label: "Kitchen sink", group: "Kitchen", widthIn: 33, depthIn: 22 },
  { id: "range", label: "Range", group: "Kitchen", widthIn: 30, depthIn: 26 },
  { id: "fridge", label: "Refrigerator", group: "Kitchen", widthIn: 36, depthIn: 30 },
  { id: "dishwasher", label: "Dishwasher", group: "Kitchen", widthIn: 24, depthIn: 24 },
  { id: "toilet", label: "Toilet", group: "Bath", widthIn: 20, depthIn: 28 },
  { id: "vanity", label: "Vanity", group: "Bath", widthIn: 36, depthIn: 21, stretch: true },
  { id: "tub", label: "Bathtub", group: "Bath", widthIn: 60, depthIn: 30 },
  { id: "shower", label: "Shower", group: "Bath", widthIn: 48, depthIn: 36, stretch: true },
  { id: "washer", label: "Washer", group: "Laundry", widthIn: 27, depthIn: 30 },
  { id: "dryer", label: "Dryer", group: "Laundry", widthIn: 27, depthIn: 30 },
  { id: "laundry-sink", label: "Laundry sink", group: "Laundry", widthIn: 24, depthIn: 22 },
  { id: "closet", label: "Closet rod and shelf", group: "Other", widthIn: 60, depthIn: 24, stretch: true },
  { id: "water-heater", label: "Water heater", group: "Other", widthIn: 24, depthIn: 24 },
  { id: "furnace", label: "Furnace", group: "Other", widthIn: 30, depthIn: 30 },
  { id: "fireplace", label: "Fireplace", group: "Other", widthIn: 60, depthIn: 24, stretch: true },
];

export const FIXTURE_GROUPS: FixtureGroup[] = ["Kitchen", "Bath", "Laundry", "Other"];

export function fixtureType(id: string): FixtureType {
  return FIXTURE_TYPES.find((t) => t.id === id) ?? FIXTURE_TYPES[0];
}
