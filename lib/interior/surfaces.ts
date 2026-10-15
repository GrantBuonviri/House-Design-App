import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { exteriorWallIn } from "@/lib/plan/basics";
import { areaKind } from "@/lib/plan/measure";
import { furnitureType } from "@/lib/plan/furniture";
import { add, pointInPolygon, scale } from "@/lib/plan/geometry";
import { edgeCompass, openingGeometries, roomEdgeAt, wallPieces } from "@/lib/plan/walls";
import { fixtureType } from "@/lib/plan/catalog";
import { hostPiece, type Layer, type Pick } from "@/lib/house3d/build";
import { interiorCategory, TILE_ROOMS, type InteriorCategoryId } from "@/lib/catalog/categories";
import { wallKey } from "./picks";

/**
 * What you're aiming at in the walkthrough, as the room and the kinds of
 * products that can change it: the kitchen counter is "kitchen, counters"
 * (with the cabinets and hardware next to it), the hall side of a wall is
 * "hall, paint". Pure, so it can be tested without a 3D view.
 */

export type Aim =
  | {
      kind: "finish";
      levelId: string;
      room: { id: string; name: string; type: string } | null;
      /** "Kitchen counter", "Living room, north wall". */
      label: string;
      /** The kinds of products that fit here, the main one first. */
      categories: InteriorCategoryId[];
      /** The wall aimed at, for accent paint. */
      wall?: { key: string; label: string };
    }
  | { kind: "furniture"; levelId: string; id: string; label: string }
  | { kind: "none"; label?: string; hint?: string };

/** The part of the house a triangle came from. */
export type AimPart = { layer: Layer; levelId: string; pick?: Pick; furnitureId?: string };

/** Where the aim landed: a plan point, its height above that floor, and which way the surface faces (plan x and y, and up). */
export type AimHit = { p: Point; heightIn: number; normal: { x: number; y: number; up: number } };

/** Room types that get no interior finishes picked (garages, porches and decks). */
function finished(room: PlanRoom) {
  return areaKind(room) === "living";
}

function roomRef(room: PlanRoom) {
  return { id: room.id, name: room.name, type: room.type ?? "other" };
}

/** Only the categories that fit this room type (whole-house-only ones like trim and doors too, where they fit). */
function fitting(cats: InteriorCategoryId[], roomType: string): InteriorCategoryId[] {
  return cats.filter((id) => interiorCategory(id)?.fits(roomType));
}

const indoorRoomAt = (plan: FloorPlan, p: Point) => plan.rooms.find((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon)) ?? plan.rooms.find((r) => pointInPolygon(p, r.polygon));

/** The categories for a fixture, by what part of it you're aiming at (a counter's top, or its cabinets below). */
function fixtureCategories(kind: string, heightIn: number, faceUp: boolean): { label: string; cats: InteriorCategoryId[] } | null {
  const top = faceUp && heightIn > 33;
  switch (kind) {
    case "counter":
    case "island":
      return top ? { label: "counter", cats: ["counters", "cabinets", "hardware"] } : { label: "cabinets", cats: ["cabinets", "hardware", "counters"] };
    case "sink":
      return top ? { label: "sink", cats: ["kitchen-sinks", "kitchen-faucets", "counters", "cabinets"] } : { label: "sink cabinet", cats: ["cabinets", "hardware", "kitchen-sinks"] };
    case "range":
      return { label: "range", cats: ["ranges", "hoods"] };
    case "fridge":
      return { label: "refrigerator", cats: ["fridges"] };
    case "dishwasher":
      return { label: "dishwasher", cats: ["dishwashers"] };
    case "toilet":
      return { label: "toilet", cats: ["toilets"] };
    case "vanity":
      return { label: "vanity", cats: ["vanities", "bath-faucets", "hardware"] };
    case "tub":
      return { label: "tub", cats: ["showers", "tile"] };
    case "shower":
      return { label: "shower", cats: ["showers", "tile"] };
    default:
      return null;
  }
}

/** What's being aimed at, from the part of the house that was hit and where. */
export function aimAt(
  plan: FloorPlan,
  part: AimPart,
  hit: AimHit,
  basics: Parameters<typeof exteriorWallIn>[0],
  /** The floor below, whose ceiling is the underside of this floor. */
  below?: { levelId: string; plan: FloorPlan },
): Aim {
  const L = part.levelId;
  const faceUp = hit.normal.up > 0.7;
  const faceDown = hit.normal.up < -0.7;

  if (part.layer === "furniture" && part.furnitureId) {
    const item = plan.furniture.find((f) => f.id === part.furnitureId);
    if (!item) return { kind: "none" };
    return { kind: "furniture", levelId: L, id: item.id, label: furnitureType(item.kind)?.label ?? "Furniture" };
  }

  if (part.layer === "floors" && part.pick?.kind === "room") {
    const room = plan.rooms.find((r) => r.id === part.pick!.id);
    if (!room) return { kind: "none" };
    if (faceDown) return below ? ceilingAim(below.plan, below.levelId, hit.p) : { kind: "none" };
    if (!faceUp) return { kind: "none" };
    if (!finished(room)) return { kind: "none", label: room.name, hint: "Porches, decks and garages come with exterior design." };
    const type = room.type ?? "other";
    const cats = fitting(TILE_ROOMS.has(type) ? ["tile"] : ["flooring"], type);
    if (!cats.length) return { kind: "none", label: `${room.name} floor` };
    return { kind: "finish", levelId: L, room: roomRef(room), label: `${room.name} floor`, categories: cats };
  }

  if (part.layer === "ceilings") return ceilingAim(plan, L, hit.p);

  if (part.layer === "walls") {
    const n = { x: hit.normal.x, y: hit.normal.y };
    if (Math.hypot(n.x, n.y) < 0.7) return { kind: "none" };
    // Just in front of the wall, on the side you're looking at.
    const front = add(hit.p, scale(n, 6));
    const room = plan.rooms.find((r) => pointInPolygon(front, r.polygon));
    if (!room || areaKind(room) === "outdoor") return { kind: "none", label: "Outside wall", hint: "Siding comes with exterior design." };
    if (!finished(room)) return { kind: "none", label: `${room.name} wall`, hint: "Garages come with exterior design." };
    const type = room.type ?? "other";
    const cats = fitting(["paint", "trim"], type);
    if (!cats.length) return { kind: "none", label: `${room.name} wall` };
    // Which of the room's walls: the edge of its outline behind the point you're looking at.
    const edge = roomEdgeAt(room.polygon, add(hit.p, scale(n, -2)), exteriorWallIn(basics) + 2, n);
    const wall = edge !== null ? { key: wallKey(edge), label: `${edgeCompass(room.polygon, edge)} wall` } : undefined;
    return { kind: "finish", levelId: L, room: roomRef(room), label: wall ? `${room.name}, ${wall.label}` : `${room.name} wall`, categories: cats, ...(wall ? { wall } : {}) };
  }

  if (part.layer === "openings" && part.pick?.kind === "opening") {
    const og = openingGeometries(plan).find((g) => g.opening.id === part.pick!.id);
    if (!og) return { kind: "none" };
    if (og.opening.kind === "window") return { kind: "none", label: "Window", hint: "Windows come with exterior design." };
    const host = hostPiece(wallPieces(plan, exteriorWallIn(basics)), og);
    if (!host || host.exterior) return { kind: "none", label: "Outside door", hint: "Outside doors come with exterior design." };
    const room = indoorRoomAt(plan, add(og.center, scale(og.n, 12))) ?? indoorRoomAt(plan, add(og.center, scale(og.n, -12)));
    const type = room?.type ?? "other";
    return { kind: "finish", levelId: L, room: room ? roomRef(room) : null, label: "Door", categories: room ? fitting(["interior-doors", "trim"], type) : ["interior-doors", "trim"] };
  }

  if (part.layer === "fixtures" && part.pick?.kind === "fixture") {
    const fx = plan.fixtures.find((f) => f.id === part.pick!.id);
    if (!fx) return { kind: "none" };
    const room = (fx.roomId && plan.rooms.find((r) => r.id === fx.roomId)) || indoorRoomAt(plan, { x: fx.x, y: fx.y });
    const what = fixtureCategories(fx.kind, hit.heightIn, faceUp);
    const name = fixtureType(fx.kind).label;
    if (!what || !room) return { kind: "none", label: name };
    const cats = fitting(what.cats, room.type ?? "other");
    if (!cats.length) return { kind: "none", label: name };
    return { kind: "finish", levelId: L, room: roomRef(room), label: `${room.name} ${what.label}`, categories: cats };
  }

  return { kind: "none" };
}

function ceilingAim(plan: FloorPlan, levelId: string, p: Point): Aim {
  const room = plan.rooms.find((r) => pointInPolygon(p, r.polygon));
  if (!room || !finished(room)) return { kind: "none" };
  const cats = fitting(["lighting"], room.type ?? "other");
  if (!cats.length) return { kind: "none", label: `${room.name} ceiling` };
  return { kind: "finish", levelId, room: roomRef(room), label: `${room.name} ceiling light`, categories: cats };
}
