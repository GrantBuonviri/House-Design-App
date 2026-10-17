import { z } from "zod";
import { ChosenRoom, DiscoveryAnswers } from "@/lib/model/schema";
import { newRoomId } from "./rooms";

/**
 * Quick starts on "Your rooms and brief": a typical house the page fills in,
 * or one the user saved from their own picks. A start holds floors, rooms
 * (with whatever was typed), connections and, for saved ones, the feel,
 * priorities and accessibility. It never holds the land, place or profile.
 */

const KEYS = {
  floorsAbove: true,
  floorsBelow: true,
  rooms: true,
  garageCars: true,
  connections: true,
  removedConnections: true,
  feel: true,
  openKitchen: true,
  priorities: true,
  accessible: true,
} as const;

/** What a start fills in. Built-in starts leave the feel, priorities and accessibility alone. */
export const StartAnswers = DiscoveryAnswers.pick(KEYS).partial().required({ rooms: true });
export type StartAnswers = z.infer<typeof StartAnswers>;

/** A start the user saved: kept in the browser's database and in "Export all houses". */
export const SavedStart = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  updatedAt: z.string(),
  answers: StartAnswers,
});
export type SavedStart = z.infer<typeof SavedStart>;

export type QuickStart = { id: string; name: string; blurb: string; builtIn: boolean; answers: StartAnswers };

const r = (id: string, type: string, name: string, extra: Partial<ChosenRoom> = {}): ChosenRoom => ({ id, type, name, description: "", ...extra });

const RANCH: StartAnswers = {
  floorsAbove: 1,
  floorsBelow: 0,
  garageCars: 2,
  rooms: [
    r("entry", "entry", "Entry"),
    r("living", "living", "Living room"),
    r("kitchen", "kitchen", "Kitchen"),
    r("dining", "dining", "Dining"),
    r("pbed", "primary-bedroom", "Primary bedroom"),
    r("pbath", "primary-bath", "Primary bath"),
    r("pcloset", "primary-closet", "Primary closet"),
    r("bed1", "bedroom", "Bedroom 1"),
    r("bed2", "bedroom", "Bedroom 2"),
    r("bath", "bathroom", "Bathroom"),
    r("laundry", "laundry", "Laundry"),
    r("garage", "garage", "Garage"),
  ],
  connections: [
    { a: "kitchen", b: "dining", strength: "must" },
    { a: "kitchen", b: "living", strength: "nice" },
    { a: "pbed", b: "pbath", strength: "must" },
    { a: "garage", b: "laundry", strength: "nice" },
    { a: "pbed", b: "garage", strength: "avoid" },
  ],
  removedConnections: [],
};

const TWO_STORY: StartAnswers = {
  floorsAbove: 2,
  floorsBelow: 0,
  garageCars: 2,
  rooms: [
    r("entry", "entry", "Entry", { levelId: "floor-1" }),
    r("living", "living", "Living room", { levelId: "floor-1" }),
    r("family", "family", "Family room", { levelId: "floor-1" }),
    r("kitchen", "kitchen", "Kitchen", { levelId: "floor-1" }),
    r("dining", "dining", "Dining", { levelId: "floor-1" }),
    r("office", "office", "Office", { levelId: "floor-1" }),
    r("half", "half-bath", "Half bath", { levelId: "floor-1" }),
    r("mudroom", "mudroom", "Mudroom", { levelId: "floor-1" }),
    r("garage", "garage", "Garage", { levelId: "floor-1" }),
    r("pbed", "primary-bedroom", "Primary bedroom", { levelId: "floor-2" }),
    r("pbath", "primary-bath", "Primary bath", { levelId: "floor-2" }),
    r("pcloset", "primary-closet", "Primary closet", { levelId: "floor-2" }),
    r("bed1", "bedroom", "Bedroom 1", { levelId: "floor-2" }),
    r("bed2", "bedroom", "Bedroom 2", { levelId: "floor-2" }),
    r("bed3", "bedroom", "Bedroom 3", { levelId: "floor-2" }),
    r("bath", "bathroom", "Bathroom", { levelId: "floor-2" }),
    r("laundry", "laundry", "Laundry", { levelId: "floor-2" }),
  ],
  connections: [
    { a: "kitchen", b: "dining", strength: "must" },
    { a: "kitchen", b: "family", strength: "nice" },
    { a: "mudroom", b: "garage", strength: "must" },
    { a: "pbed", b: "pbath", strength: "must" },
    { a: "bed1", b: "bath", strength: "nice" },
  ],
  removedConnections: [],
};

const CABIN: StartAnswers = {
  floorsAbove: 1,
  floorsBelow: 0,
  garageCars: 0,
  rooms: [
    r("living", "living", "Living room"),
    r("kitchen", "kitchen", "Kitchen"),
    r("bed", "bedroom", "Bedroom"),
    r("bath", "bathroom", "Bathroom"),
    r("porch", "porch", "Porch"),
  ],
  connections: [{ a: "kitchen", b: "living", strength: "must" }],
  removedConnections: [],
};

export const BUILT_IN_STARTS: QuickStart[] = [
  { id: "ranch", name: "3-bed ranch", blurb: "One floor, 3 bedrooms, 2 baths, 2-car garage", builtIn: true, answers: RANCH },
  { id: "two-story", name: "4-bed two-story", blurb: "Living downstairs, bedrooms up, 2-car garage", builtIn: true, answers: TWO_STORY },
  { id: "cabin", name: "Small cabin", blurb: "One bedroom, one bath, a porch", builtIn: true, answers: CABIN },
];

/** The built-in starts, then the user's saved ones (newest first as given). */
export function allStarts(saved: SavedStart[]): QuickStart[] {
  return [...BUILT_IN_STARTS, ...saved.map((s) => ({ id: s.id, name: s.name, blurb: startBlurb(s.answers), builtIn: false, answers: s.answers }))];
}

/** "9 rooms, 2 floors" for a saved start. */
export function startBlurb(a: StartAnswers): string {
  const floors = (a.floorsAbove ?? 1) + (a.floorsBelow ?? 0);
  return `${a.rooms.length} ${a.rooms.length === 1 ? "room" : "rooms"}, ${floors} ${floors === 1 ? "floor" : "floors"}`;
}

/**
 * The answers to set when a start is applied. Every room gets a new id (so applying
 * twice never shares ids) and the connections follow. Fields the start leaves out stay as they are.
 */
export function startPatch(start: StartAnswers): Partial<DiscoveryAnswers> {
  const ids = new Map(start.rooms.map((x) => [x.id, newRoomId()]));
  const mapped = <T extends { a: string; b: string }>(list: T[] | undefined) =>
    (list ?? []).filter((e) => ids.has(e.a) && ids.has(e.b)).map((e) => ({ ...e, a: ids.get(e.a)!, b: ids.get(e.b)! }));
  const { rooms, connections, removedConnections, ...rest } = start;
  return {
    ...JSON.parse(JSON.stringify(rest)),
    rooms: rooms.map((x) => ({ ...x, id: ids.get(x.id)! })),
    connections: mapped(connections),
    removedConnections: mapped(removedConnections),
    // A start without a kitchen choice leaves the app to pick.
    openKitchen: start.openKitchen,
  };
}

/** The current page as a start to save: floors, rooms, connections, feel, priorities and accessibility. */
export function startFromAnswers(a: DiscoveryAnswers): StartAnswers {
  const out: StartAnswers = {
    floorsAbove: a.floorsAbove,
    floorsBelow: a.floorsBelow,
    garageCars: a.garageCars,
    rooms: a.rooms,
    connections: a.connections,
    removedConnections: a.removedConnections,
    feel: a.feel,
    priorities: a.priorities,
    accessible: a.accessible,
  };
  if (a.openKitchen !== undefined) out.openKitchen = a.openKitchen;
  return StartAnswers.parse(JSON.parse(JSON.stringify(out)));
}

/** Names the user can give a start: trimmed, not empty, at most 60 characters. */
export function cleanStartName(name: string): string | null {
  const n = name.trim().slice(0, 60);
  return n || null;
}
