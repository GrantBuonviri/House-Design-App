import type { ChosenRoom } from "@/lib/model/schema";

/**
 * The kinds of rooms a brief can hold, with typical sizes for a new house in
 * Boise. Sizes are in square feet. min and max are used to repair sizes that
 * come back from Claude or get typed in by mistake.
 */
export type RoomCategory = "living" | "sleeping" | "work" | "service" | "garage" | "outdoor";

export type RoomType = {
  id: string;
  label: string;
  category: RoomCategory;
  sqft: number;
  min: number;
  max: number;
  /** Made by the floor plan (hallways, closets), not picked on the rooms page. */
  planOnly?: boolean;
};

export const ROOM_TYPES: RoomType[] = [
  { id: "entry", label: "Entry", category: "living", sqft: 80, min: 30, max: 300 },
  { id: "living", label: "Living room", category: "living", sqft: 320, min: 150, max: 900 },
  { id: "family", label: "Family room", category: "living", sqft: 300, min: 150, max: 800 },
  { id: "kitchen", label: "Kitchen", category: "living", sqft: 220, min: 100, max: 600 },
  { id: "dining", label: "Dining", category: "living", sqft: 160, min: 80, max: 450 },
  { id: "pantry", label: "Pantry", category: "service", sqft: 40, min: 10, max: 150 },
  { id: "primary-bedroom", label: "Primary bedroom", category: "sleeping", sqft: 240, min: 150, max: 500 },
  { id: "primary-bath", label: "Primary bath", category: "sleeping", sqft: 120, min: 50, max: 300 },
  { id: "primary-closet", label: "Primary closet", category: "sleeping", sqft: 70, min: 25, max: 200 },
  { id: "bedroom", label: "Bedroom", category: "sleeping", sqft: 140, min: 90, max: 300 },
  { id: "bathroom", label: "Bathroom", category: "service", sqft: 55, min: 35, max: 150 },
  { id: "half-bath", label: "Half bath", category: "service", sqft: 25, min: 15, max: 60 },
  { id: "office", label: "Office", category: "work", sqft: 120, min: 60, max: 300 },
  { id: "laundry", label: "Laundry", category: "service", sqft: 60, min: 30, max: 160 },
  { id: "mudroom", label: "Mudroom", category: "service", sqft: 70, min: 30, max: 200 },
  { id: "storage", label: "Storage", category: "service", sqft: 60, min: 15, max: 400 },
  { id: "mechanical", label: "Mechanical room", category: "service", sqft: 60, min: 30, max: 200 },
  { id: "bonus", label: "Bonus room", category: "living", sqft: 300, min: 120, max: 800 },
  { id: "media", label: "Media room", category: "living", sqft: 250, min: 120, max: 600 },
  { id: "gym", label: "Home gym", category: "work", sqft: 180, min: 80, max: 500 },
  { id: "workshop", label: "Workshop", category: "work", sqft: 220, min: 80, max: 800 },
  { id: "craft", label: "Craft room", category: "work", sqft: 140, min: 60, max: 400 },
  { id: "playroom", label: "Playroom", category: "living", sqft: 160, min: 80, max: 400 },
  { id: "sunroom", label: "Sunroom", category: "living", sqft: 180, min: 80, max: 450 },
  { id: "guest-suite", label: "Guest suite", category: "sleeping", sqft: 220, min: 120, max: 450 },
  { id: "garage", label: "Garage", category: "garage", sqft: 480, min: 200, max: 1400 },
  { id: "patio", label: "Covered patio", category: "outdoor", sqft: 220, min: 60, max: 800 },
  { id: "deck", label: "Deck", category: "outdoor", sqft: 250, min: 60, max: 900 },
  { id: "porch", label: "Porch", category: "outdoor", sqft: 140, min: 40, max: 600 },
  { id: "outdoor-kitchen", label: "Outdoor kitchen", category: "outdoor", sqft: 120, min: 40, max: 400 },
  { id: "hall", label: "Hallway", category: "living", sqft: 60, min: 15, max: 400, planOnly: true },
  { id: "closet", label: "Closet", category: "service", sqft: 15, min: 6, max: 120, planOnly: true },
  { id: "other", label: "Other", category: "living", sqft: 120, min: 10, max: 1500 },
];

/** The room types a brief can hold (hallways and closets come later, with the floor plan). */
export const BRIEF_ROOM_TYPES = ROOM_TYPES.filter((r) => !r.planOnly);
export const ROOM_TYPE_IDS = BRIEF_ROOM_TYPES.map((r) => r.id);

export function roomType(id: string): RoomType {
  return ROOM_TYPES.find((r) => r.id === id) ?? ROOM_TYPES[ROOM_TYPES.length - 1];
}

export const CATEGORIES: { id: RoomCategory; label: string }[] = [
  { id: "living", label: "Living" },
  { id: "sleeping", label: "Sleeping" },
  { id: "work", label: "Work and hobbies" },
  { id: "service", label: "Service and storage" },
  { id: "garage", label: "Garage" },
  { id: "outdoor", label: "Outdoor" },
];

/** Typical garage sizes by number of cars (0 uses the room type's default). */
export const GARAGE_SQFT = [0, 288, 528, 792, 1056];

/** Floor area from a length and width in inches, rounded to whole square feet. */
export function sqftFromDims(lengthIn: number | undefined, widthIn: number | undefined): number | null {
  if (!lengthIn || !widthIn) return null;
  return Math.max(1, Math.round((lengthIn * widthIn) / 144));
}

export function newRoomId(): string {
  return `room-${Math.random().toString(36).slice(2, 10)}`;
}

/** Heated (conditioned) rooms: everything but garages and outdoor spaces. */
export function isHeated(typeId: string): boolean {
  const c = roomType(typeId).category;
  return c !== "garage" && c !== "outdoor";
}

/** The most rooms of one type on the rooms page. */
export const MAX_PER_TYPE = 10;

/**
 * Rooms of a type after changing how many there are. New rooms are named
 * "Bedroom 1", "Bedroom 2" and so on; a single room just gets the type's name.
 */
export function setTypeCount(rooms: ChosenRoom[], type: string, count: number): ChosenRoom[] {
  const label = roomType(type).label;
  const mine = rooms.filter((r) => r.type === type);
  let next = [...mine];
  if (count > mine.length) {
    if (mine.length === 1 && mine[0].name === label) next[0] = { ...mine[0], name: `${label} 1` };
    for (let i = mine.length; i < count; i++) {
      next.push({ id: newRoomId(), type, name: count === 1 ? label : `${label} ${i + 1}`, description: "" });
    }
  } else {
    next = mine.slice(0, count);
    if (count === 1 && next[0].name === `${label} 1`) next[0] = { ...next[0], name: label };
  }
  // Keep the other types where they were and this type's rooms together.
  const firstIndex = rooms.findIndex((r) => r.type === type);
  const others = rooms.filter((r) => r.type !== type);
  const at = firstIndex === -1 ? others.length : rooms.slice(0, firstIndex).filter((r) => r.type !== type).length;
  return [...others.slice(0, at), ...next, ...others.slice(at)];
}
