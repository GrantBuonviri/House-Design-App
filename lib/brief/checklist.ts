import type { ChosenRoom, DesignBrief, DiscoveryAnswers } from "@/lib/model/schema";
import { levelIdsFor, levelsFor, nearestLevel } from "./levels";
import { newRoomId, roomType, sqftFromDims } from "./rooms";

/**
 * The room checklist on "Your rooms and brief": checking a type adds one
 * room, each room is a row that can be duplicated, and unchecking a type
 * takes its rooms out (asking first when that would lose work).
 */

/** "Bedroom 2" → "Bedroom"; names without a number stay as they are. */
function baseName(name: string): string {
  return name.replace(/\s+\d+$/, "").trim();
}

/** The first "<base> N" not already used, from 2 up (or 1 up when `fromOne`). */
function nextName(base: string, rooms: ChosenRoom[], fromOne = false): string {
  const taken = new Set(rooms.map((r) => r.name.trim().toLowerCase()));
  let n = fromOne ? 1 : 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** Rooms with one more room of this type, named after the type ("Bedroom", or "Bedroom 2" when there is one). "other" adds "My room 1". */
export function addRoomOfType(rooms: ChosenRoom[], type: string): ChosenRoom[] {
  const label = type === "other" ? "My room" : roomType(type).label;
  const taken = rooms.some((r) => r.name.trim().toLowerCase() === label.toLowerCase());
  const name = type === "other" ? nextName(label, rooms, true) : taken ? nextName(label, rooms) : label;
  return [...rooms, { id: newRoomId(), type, name, description: "" }];
}

/**
 * Rooms with a copy of one room placed right after it: same type, size,
 * floor and notes, named with the next free number ("Bedroom 2" → "Bedroom 3").
 * A room still named just "Bedroom" becomes "Bedroom 1" so the two read well.
 */
export function duplicateRoom(rooms: ChosenRoom[], id: string): ChosenRoom[] {
  const i = rooms.findIndex((r) => r.id === id);
  if (i < 0) return rooms;
  const src = rooms[i];
  const base = baseName(src.name) || roomType(src.type).label;
  const out = [...rooms];
  if (src.name.trim() === base && !rooms.some((r, j) => j !== i && r.name.trim().toLowerCase() === `${base} 1`.toLowerCase())) {
    out[i] = { ...src, name: `${base} 1` };
  }
  const copy: ChosenRoom = { ...src, id: newRoomId(), name: nextName(base, out) };
  out.splice(i + 1, 0, copy);
  return out;
}

/** True when the user changed anything on a room beyond checking its type. */
export function roomEdited(r: ChosenRoom): boolean {
  const named = baseName(r.name).toLowerCase() === roomType(r.type).label.toLowerCase() || (r.type === "other" && baseName(r.name) === "My room");
  return Boolean(r.lengthIn || r.widthIn || r.sqft || r.levelId || r.description.trim() || !named);
}

/** The question to ask before unchecking a type, or null when nothing would be lost (one untouched room). */
export function uncheckQuestion(rooms: ChosenRoom[], type: string): string | null {
  const mine = rooms.filter((r) => r.type === type);
  if (mine.length === 0) return null;
  if (mine.length === 1 && !roomEdited(mine[0])) return null;
  const label = roomType(type).label.toLowerCase();
  if (mine.length === 1) return `Remove ${mine[0].name}? You changed it, and those changes go with it.`;
  return `Remove all ${mine.length} ${label === "other" ? "of your own rooms" : plural(label)}?`;
}

function plural(label: string): string {
  if (/(s|sh|ch|x)$/.test(label)) return `${label}es`;
  return `${label}s`;
}

/** Rooms without any of this type, and connections still pointing at rooms on the list. */
export function removeType(answers: Pick<DiscoveryAnswers, "rooms" | "connections" | "removedConnections">, type: string) {
  const rooms = answers.rooms.filter((r) => r.type !== type);
  const ids = new Set(rooms.map((r) => r.id));
  return {
    rooms,
    connections: answers.connections.filter((e) => ids.has(e.a) && ids.has(e.b)),
    removedConnections: answers.removedConnections.filter((e) => ids.has(e.a) && ids.has(e.b)),
  };
}

/** One room, as the collapsed row shows it: the brief's room, and whether the user typed its size and floor. */
export type RoomRowInfo = {
  room: ChosenRoom;
  sqft: number;
  /** "12' × 14'" when both lengths are typed. */
  dims: string | null;
  sizeTyped: boolean;
  levelId: string;
  levelTyped: boolean;
};

const ft = (inches: number) => `${Math.round((inches / 12) * 10) / 10}'`;

/** The rooms grouped by the floor they end up on (top floor first), each with its brief size and floor. */
export function roomsByFloor(answers: DiscoveryAnswers, brief: Pick<DesignBrief, "rooms"> | null) {
  const allowed = levelIdsFor(answers.floorsAbove, answers.floorsBelow);
  const rows: RoomRowInfo[] = answers.rooms.map((r) => {
    const b = brief?.rooms.find((x) => x.id === r.id);
    const levelTyped = Boolean(r.levelId && allowed.includes(r.levelId));
    return {
      room: r,
      sqft: b?.targetSqFt ?? sqftFromDims(r.lengthIn, r.widthIn) ?? r.sqft ?? roomType(r.type).sqft,
      dims: r.lengthIn && r.widthIn ? `${ft(r.lengthIn)} × ${ft(r.widthIn)}` : null,
      sizeTyped: Boolean(sqftFromDims(r.lengthIn, r.widthIn) || r.sqft),
      levelId: nearestLevel(levelTyped ? r.levelId : b?.levelId, allowed),
      levelTyped,
    };
  });
  return levelsFor(answers.floorsAbove, answers.floorsBelow)
    .slice()
    .reverse()
    .map((level) => ({ level, rows: rows.filter((x) => x.levelId === level.id) }))
    .filter((g) => g.rows.length > 0);
}
