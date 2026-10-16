import type { Level, PlanBasics, PlanRoom, Point, Project, TopLabels } from "@/lib/model/schema";
import { labelInk, floorColorOf, labelLines, type LabelLine } from "@/lib/house3d/walkLabels";
import { insidePoint } from "@/lib/house3d/walk";
import { pointInPolygon } from "@/lib/plan/geometry";

/**
 * What a room's label says and where it sits in the 3D Top view. The lines come from
 * the walkthrough's `labelLines`, so both views say the same thing. Settings: `house3d.topLabels`;
 * drawn by components/house3d/TopLabels.tsx.
 */

export type TopLabel = {
  roomId: string;
  lines: LabelLine[];
  /** Where it sits on the plan, inches. */
  at: Point;
  ink: "dark" | "light";
};

/** The label for one room, or null if it is hidden (one room or all) or has nothing to say. */
export function topLabelFor(
  room: PlanRoom,
  level: Level,
  basics: PlanBasics | null,
  selections: Project["interior"]["selections"],
  s: TopLabels,
): TopLabel | null {
  if (s.hideAll) return null;
  const mine = s.rooms[room.id];
  if (mine?.hidden) return null;
  const text = mine?.text?.trim();
  const lines = labelLines({ room: text ? { ...room, name: text } : room, level, basics, selections }, s);
  if (!lines.length) return null;
  const base = insidePoint(room.polygon);
  const at = mine?.offset ? clampLabelOffset(room, mine.offset, base).at : base;
  // Over a white box the ink is dark unless asked otherwise; with no box "auto" follows the flooring.
  const ink = labelInk(s.background === "soft" && s.textColor === "auto" ? "dark" : s.textColor, floorColorOf(selections, room.id));
  return { roomId: room.id, lines, at, ink };
}

/** Keeps a moved label inside its room: a spot outside slides back along the line to the normal spot. */
export function clampLabelOffset(room: PlanRoom, offset: Point, base: Point = insidePoint(room.polygon)): { offset: Point; at: Point } {
  const want = { x: base.x + offset.x, y: base.y + offset.y };
  if (pointInPolygon(want, room.polygon)) return { offset, at: want };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (pointInPolygon({ x: base.x + offset.x * mid, y: base.y + offset.y * mid }, room.polygon)) lo = mid;
    else hi = mid;
  }
  const kept = { x: offset.x * lo, y: offset.y * lo };
  return { offset: kept, at: { x: base.x + kept.x, y: base.y + kept.y } };
}

/** The saved per-room choices without rooms that no longer exist. */
export function pruneTopLabels(s: TopLabels, roomIds: Set<string>): TopLabels {
  const rooms = Object.fromEntries(Object.entries(s.rooms).filter(([id]) => roomIds.has(id)));
  return Object.keys(rooms).length === Object.keys(s.rooms).length ? s : { ...s, rooms };
}
