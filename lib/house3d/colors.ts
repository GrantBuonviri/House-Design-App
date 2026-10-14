import type { PlanRoom } from "@/lib/model/schema";
import { roomType } from "@/lib/brief/rooms";
import { hex, type RGB } from "./mesh";

/**
 * Plain finishes for the 3D house until real ones are picked (interior and
 * exterior design, milestones 9 and 10): light walls, wood floors, tile in
 * wet rooms, a grey roof.
 */
export const COLORS = {
  siding: hex("#e7e1d6"),
  drywall: hex("#f3f0ea"),
  /** The cut top of a wall, seen when the floor above is lifted off. */
  wallTop: hex("#b9b1a3"),
  foundation: hex("#a9a59d"),
  roof: hex("#5b5f66"),
  fascia: hex("#f1efe9"),
  ceiling: hex("#f6f4ef"),
  slabEdge: hex("#c8c1b4"),
  wood: hex("#c39a6b"),
  tile: hex("#d6d2c8"),
  concrete: hex("#b4b0a8"),
  deck: hex("#9c7652"),
  patio: hex("#b9afa0"),
  carpet: hex("#cfc6b8"),
  trim: hex("#f8f7f3"),
  door: hex("#efede7"),
  frontDoor: hex("#4c3b2d"),
  garageDoor: hex("#eeece6"),
  frame: hex("#f4f3ef"),
  glass: hex("#b5d3e6"),
  stair: hex("#b88d5f"),
  counter: hex("#f0eee9"),
  cabinet: hex("#e9e5dc"),
  steel: hex("#b9bcbf"),
  porcelain: hex("#fbfbf9"),
  dark: hex("#3a3836"),
  mechanical: hex("#d7d9d6"),
} satisfies Record<string, RGB>;

const WET = new Set(["primary-bath", "bathroom", "half-bath", "laundry", "mudroom", "entry"]);
const CARPET = new Set(["bedroom", "primary-bedroom", "guest-suite", "media", "playroom"]);
const CONCRETE = new Set(["garage", "mechanical", "workshop", "storage"]);

export function floorColor(room: Pick<PlanRoom, "type">): RGB {
  const t = room.type ?? "";
  if (t === "deck") return COLORS.deck;
  if (t === "patio" || t === "porch" || t === "outdoor-kitchen" || (t && roomType(t).category === "outdoor")) return COLORS.patio;
  if (WET.has(t)) return COLORS.tile;
  if (CONCRETE.has(t)) return COLORS.concrete;
  if (CARPET.has(t)) return COLORS.carpet;
  return COLORS.wood;
}
