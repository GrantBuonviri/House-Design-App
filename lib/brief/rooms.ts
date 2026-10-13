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
  { id: "other", label: "Other", category: "living", sqft: 120, min: 10, max: 1500 },
];

export const ROOM_TYPE_IDS = ROOM_TYPES.map((r) => r.id);

export function roomType(id: string): RoomType {
  return ROOM_TYPES.find((r) => r.id === id) ?? ROOM_TYPES[ROOM_TYPES.length - 1];
}

/** Extra rooms offered on the questions page, mapped to room types. */
export const EXTRA_ROOM_OPTIONS: { label: string; type: string }[] = [
  { label: "Family room", type: "family" },
  { label: "Bonus room", type: "bonus" },
  { label: "Media room", type: "media" },
  { label: "Home gym", type: "gym" },
  { label: "Workshop", type: "workshop" },
  { label: "Craft room", type: "craft" },
  { label: "Playroom", type: "playroom" },
  { label: "Sunroom", type: "sunroom" },
  { label: "Guest suite", type: "guest-suite" },
];

export const OUTDOOR_OPTIONS: { label: string; type: string }[] = [
  { label: "Covered patio", type: "patio" },
  { label: "Deck", type: "deck" },
  { label: "Front porch", type: "porch" },
  { label: "Outdoor kitchen", type: "outdoor-kitchen" },
];

export const ACCESSIBILITY_OPTIONS = [
  "Everything needed on one floor",
  "No-step entry",
  "Wide doorways and halls",
  "Curbless shower",
  "Room for a future elevator",
];

export const STYLE_WORD_SUGGESTIONS = [
  "Modern farmhouse",
  "Mountain modern",
  "Craftsman",
  "Scandinavian",
  "Mid-century",
  "Warm minimal",
  "Rustic",
  "Contemporary",
  "Cottage",
  "Natural wood",
  "Lots of light",
  "Stone and timber",
];

/** Heated (conditioned) rooms: everything but garages and outdoor spaces. */
export function isHeated(typeId: string): boolean {
  const c = roomType(typeId).category;
  return c !== "garage" && c !== "outdoor";
}
