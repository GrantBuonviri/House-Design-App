import { CABINET_KINDS, DEVICE_KINDS, type DeviceKind, type WallHeight } from "@/lib/model/schema";
import { FIXTURE_TYPES, OPENING_TYPES } from "@/lib/plan/catalog";
import { CABINET_LABEL, cabinetSize } from "@/lib/plan/cabinets";
import { DEVICE_INFO, isHookup } from "@/lib/plan/devices";
import { FURNITURE, furnitureHeight } from "@/lib/plan/furniture";
import { fixtureSpan } from "@/lib/house3d/fixtures";

/**
 * Everything Furnish can place, in one grouped list: fixtures and
 * appliances, cabinets, devices and hookups, built-ins and extras
 * (add-ons), furniture, closet pieces, and the doors, windows and walls it
 * hands off to the floor plan's own placers. It wraps the existing lists
 * (fixture types, cabinet kinds, device kinds, furniture) rather than
 * copying them, so there is one source for each. The 2D Furnish page and
 * the walkthrough both read this list.
 */

export type FurnishKind = "fixture" | "cabinet" | "device" | "hookup" | "addon" | "furniture" | "closet" | "opening" | "wall";

export const FURNISH_GROUPS = [
  "Kitchen and appliances",
  "Bath",
  "Laundry",
  "Cabinets and counters",
  "Closets and storage",
  "Electrical",
  "Plumbing and gas",
  "Heating and air",
  "Built-ins and extras",
  "Furniture",
  "Doors and windows",
  "Walls",
] as const;
export type FurnishGroup = (typeof FURNISH_GROUPS)[number];

/** Where it sits: standing on the floor, flat on a wall at a height, or on the ceiling. */
export type Mount = "floor" | "wall" | "ceiling";

export type CatalogEntry = {
  /** Unique across the catalog: "<kind>:<type>", like "fixture:toilet" or "addon:bookcase". */
  id: string;
  kind: FurnishKind;
  /** The kind stored on the saved item (fixture kind, cabinet kind, device kind, add-on kind, furniture id, opening style, wall height). */
  type: string;
  label: string;
  group: FurnishGroup;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  mount: Mount;
  /** Height of its bottom above the floor. */
  bottomIn: number;
  /** Part of the build cost (furniture isn't). */
  priced: boolean;
  /** Can be stretched along its width. */
  stretch?: boolean;
};

// ---------- Add-ons: built-ins and extras ----------

export type AddOnType = {
  id: string;
  label: string;
  group: FurnishGroup;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  mount: Mount;
  bottomIn: number;
  stretch?: boolean;
};

export const ADDON_TYPES: AddOnType[] = [
  { id: "shelving", label: "Wall shelves", group: "Built-ins and extras", widthIn: 36, depthIn: 10, heightIn: 2, mount: "wall", bottomIn: 60, stretch: true },
  { id: "bookcase", label: "Built-in bookcase", group: "Built-ins and extras", widthIn: 36, depthIn: 12, heightIn: 84, mount: "floor", bottomIn: 0, stretch: true },
  { id: "window-seat", label: "Window seat", group: "Built-ins and extras", widthIn: 60, depthIn: 20, heightIn: 18, mount: "floor", bottomIn: 0, stretch: true },
  { id: "bench", label: "Built-in bench", group: "Built-ins and extras", widthIn: 48, depthIn: 16, heightIn: 18, mount: "floor", bottomIn: 0, stretch: true },
  { id: "desk", label: "Built-in desk", group: "Built-ins and extras", widthIn: 60, depthIn: 24, heightIn: 30, mount: "floor", bottomIn: 0, stretch: true },
  { id: "ceiling-fan", label: "Ceiling fan", group: "Built-ins and extras", widthIn: 52, depthIn: 52, heightIn: 12, mount: "ceiling", bottomIn: 84 },
  { id: "mirror", label: "Mirror", group: "Bath", widthIn: 30, depthIn: 1, heightIn: 36, mount: "wall", bottomIn: 40 },
  { id: "towel-bar", label: "Towel bar", group: "Bath", widthIn: 24, depthIn: 3, heightIn: 2, mount: "wall", bottomIn: 46 },
  { id: "grab-bar", label: "Grab bar", group: "Bath", widthIn: 36, depthIn: 3, heightIn: 2, mount: "wall", bottomIn: 34 },
  { id: "medicine-cabinet", label: "Medicine cabinet", group: "Bath", widthIn: 16, depthIn: 5, heightIn: 26, mount: "wall", bottomIn: 48 },
  { id: "coat-hooks", label: "Coat hooks", group: "Closets and storage", widthIn: 36, depthIn: 3, heightIn: 6, mount: "wall", bottomIn: 60, stretch: true },
  { id: "lockers", label: "Mudroom lockers", group: "Closets and storage", widthIn: 60, depthIn: 18, heightIn: 72, mount: "floor", bottomIn: 0, stretch: true },
];

export function addOnType(id: string): AddOnType | undefined {
  return ADDON_TYPES.find((t) => t.id === id);
}

// ---------- The catalog ----------

const FIXTURE_GROUP: Record<string, FurnishGroup> = {
  counter: "Cabinets and counters",
  island: "Cabinets and counters",
  closet: "Closets and storage",
  "water-heater": "Plumbing and gas",
  furnace: "Heating and air",
  // The fireplace stays a fixture (cost, CO alarms and the PDF read it there) but is listed with the built-ins.
  fireplace: "Built-ins and extras",
};
const FIXTURE_GROUP_BY_OLD: Record<string, FurnishGroup> = { Kitchen: "Kitchen and appliances", Bath: "Bath", Laundry: "Laundry", Other: "Built-ins and extras" };

/** Hookups and other wall devices at their usual height; ceiling ones under a standard ceiling. */
const DEVICE_GROUP = (k: DeviceKind): FurnishGroup => {
  const sys = DEVICE_INFO[k].system;
  if (k === "fan") return "Heating and air";
  return sys === "electrical" ? "Electrical" : sys === "plumbing" ? "Plumbing and gas" : "Heating and air";
};
/** Standard ceiling for catalog heights; placing an item uses the real ceiling. */
const CEILING_IN = 96;

function build(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const t of FIXTURE_TYPES) {
    const span = fixtureSpan(t.id);
    out.push({
      id: `fixture:${t.id}`,
      kind: "fixture",
      type: t.id,
      label: t.label,
      group: FIXTURE_GROUP[t.id] ?? FIXTURE_GROUP_BY_OLD[t.group],
      widthIn: t.widthIn,
      depthIn: t.depthIn,
      heightIn: span.z1 - span.z0,
      mount: "floor",
      bottomIn: 0,
      priced: true,
      stretch: t.stretch,
    });
  }
  for (const k of CABINET_KINDS) {
    const s = cabinetSize(k, CEILING_IN);
    const width = k === "filler" ? 3 : k === "corner" ? 36 : k === "vanity" ? 36 : k === "open-shelf" ? 30 : k === "wine" ? 18 : k === "pantry" || k === "tall" ? 24 : k === "appliance-garage" ? 24 : 30;
    out.push({ id: `cabinet:${k}`, kind: "cabinet", type: k, label: CABINET_LABEL[k], group: k === "vanity" ? "Bath" : "Cabinets and counters", widthIn: width, depthIn: s.d, heightIn: s.h, mount: s.z > 24 ? "wall" : "floor", bottomIn: s.z, priced: true, stretch: true });
  }
  for (const k of DEVICE_KINDS) {
    const info = DEVICE_INFO[k];
    out.push({
      id: `device:${k}`,
      kind: isHookup(k) || k === "outlet-240" ? "hookup" : "device",
      type: k,
      label: info.label,
      group: DEVICE_GROUP(k),
      widthIn: 4,
      depthIn: 2,
      heightIn: 4,
      mount: info.wall ? "wall" : "ceiling",
      bottomIn: info.wall ? (info.mountIn ?? 16) : CEILING_IN,
      priced: true,
    });
  }
  for (const t of ADDON_TYPES) out.push({ id: `addon:${t.id}`, kind: "addon", type: t.id, label: t.label, group: t.group, widthIn: t.widthIn, depthIn: t.depthIn, heightIn: t.heightIn, mount: t.mount, bottomIn: t.bottomIn, priced: true, stretch: t.stretch });
  for (const t of FURNITURE) out.push({ id: `furniture:${t.id}`, kind: "furniture", type: t.id, label: t.label, group: "Furniture", widthIn: t.widthIn, depthIn: t.depthIn, heightIn: furnitureHeight(t.id), mount: "floor", bottomIn: 0, priced: false });
  out.push(
    { id: "closet:reach-in", kind: "closet", type: "reach-in", label: "Reach-in closet", group: "Closets and storage", widthIn: 72, depthIn: 26, heightIn: 96, mount: "floor", bottomIn: 0, priced: true, stretch: true },
    { id: "closet:walk-in", kind: "closet", type: "walk-in", label: "Walk-in closet", group: "Closets and storage", widthIn: 72, depthIn: 72, heightIn: 96, mount: "floor", bottomIn: 0, priced: true, stretch: true },
  );
  for (const t of OPENING_TYPES) out.push({ id: `opening:${t.id}`, kind: "opening", type: t.id, label: t.label, group: "Doors and windows", widthIn: t.widths[0], depthIn: 6, heightIn: t.heightIn, mount: "wall", bottomIn: t.sillIn ?? 0, priced: true });
  const walls: [WallHeight, string, number][] = [
    ["full", "Wall", CEILING_IN],
    ["half", "Half wall", 42],
    ["half-cap", "Half wall with a cap", 42],
  ];
  for (const [h, label, height] of walls) out.push({ id: `wall:${h}`, kind: "wall", type: h, label, group: "Walls", widthIn: 48, depthIn: 4.5, heightIn: height, mount: "floor", bottomIn: 0, priced: true });
  return out;
}

export const FURNISH_CATALOG: CatalogEntry[] = build();
const BY_ID = new Map(FURNISH_CATALOG.map((e) => [e.id, e]));

export function catalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

/** The entry for a saved item: its kind on the layer and its stored kind. */
export function entryFor(kind: "fixture" | "cabinet" | "device" | "addon" | "furniture", type: string): CatalogEntry | undefined {
  if (kind === "device") return BY_ID.get(`device:${type}`);
  return BY_ID.get(`${kind}:${type}`);
}

/** The catalog by group, in group order, optionally narrowed by a search. */
export function catalogGroups(search = ""): { group: FurnishGroup; entries: CatalogEntry[] }[] {
  const q = search.trim().toLowerCase();
  const hit = (e: CatalogEntry) => !q || e.label.toLowerCase().includes(q) || e.group.toLowerCase().includes(q) || e.type.toLowerCase().includes(q);
  return FURNISH_GROUPS.map((group) => ({ group, entries: FURNISH_CATALOG.filter((e) => e.group === group && hit(e)) })).filter((g) => g.entries.length);
}

/** Entries that can stand in for this one in "Swap for…": the same group, and something stored the same way where that matters. */
export function swapChoices(id: string): CatalogEntry[] {
  const e = BY_ID.get(id);
  if (!e) return [];
  const placeable = (x: CatalogEntry) => x.kind !== "opening" && x.kind !== "wall" && x.kind !== "closet";
  return FURNISH_CATALOG.filter((x) => x.id !== id && x.group === e.group && placeable(x) && x.mount === e.mount);
}
