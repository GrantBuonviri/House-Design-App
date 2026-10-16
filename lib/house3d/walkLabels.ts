import type { Level, PlanBasics, PlanRoom, Project, WalkLabels } from "@/lib/model/schema";
import { ceilingFor } from "@/lib/plan/basics";
import { formatLength, roomSizeText } from "@/lib/plan/labels";
import { areaKind, roomSqft } from "@/lib/plan/measure";
import { roomFinishes } from "@/lib/interior/picks";
import { shortMoney } from "@/lib/cost/estimate";

/**
 * What a floor label in the walkthrough says. Pure functions, drawn by
 * components/walk/FloorLabels.tsx. The settings (`house3d.walkLabels`) say
 * which lines show; the label settings panel is components/walk/LabelSettingsPanel.tsx.
 */

export type LabelLine = { text: string; bold?: boolean; small?: boolean };

/** Inches of floor each line of text covers, by text size. */
export const LABEL_LINE_IN: Record<WalkLabels["textSize"], number> = { small: 5, medium: 7, large: 10 };

type RoomInfo = {
  room: PlanRoom;
  level: Level;
  basics: PlanBasics | null;
  selections: Project["interior"]["selections"];
  /** This room's share of the cost estimate (0 to 1) and the estimate's likely total, if there is one. */
  cost?: { share: number; total: number };
};

/** The lines of one room's label, in order, for the settings given. */
export function labelLines(info: RoomInfo, s: WalkLabels): LabelLine[] {
  const { room, level } = info;
  const out: LabelLine[] = [];
  if (s.name) out.push({ text: room.name, bold: true });
  if (s.size) out.push({ text: roomSizeText(room.polygon, s.units, room.bulges) });
  if (s.sqft) out.push({ text: `${roomSqft(room).toLocaleString("en-US")} sq ft` });
  if (s.floorName) out.push({ text: level.name, small: true });
  if (s.ceiling) out.push({ text: `Ceiling ${formatLength(ceilingFor(info.basics, level), s.units)}`, small: true });
  if (s.finishes) {
    const f = roomFinishes(info.selections, room.id);
    const floor = f.get("flooring") ?? f.get("tile");
    const paint = f.get("paint");
    if (floor) out.push({ text: `Floor: ${floor.name}`, small: true });
    if (paint) out.push({ text: `Paint: ${paint.name}`, small: true });
  }
  if (s.costShare && info.cost && info.cost.total > 0) {
    out.push({ text: `About ${shortMoney(info.cost.total * info.cost.share)} of the estimate`, small: true });
  }
  return out;
}

/** Each living room's share of the heated floor area, for the cost line (the estimate isn't split by room). */
export function costShares(rooms: PlanRoom[][]): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (const list of rooms) for (const r of list) if (areaKind(r) === "living") total += roomSqft(r);
  if (total <= 0) return out;
  for (const list of rooms) for (const r of list) if (areaKind(r) === "living") out.set(r.id, roomSqft(r) / total);
  return out;
}

/** Dark or light text for a floor color ("#c8a77e"); `auto` picks whichever reads better. */
export function labelInk(color: WalkLabels["textColor"], floorColor?: string): "dark" | "light" {
  if (color !== "auto") return color;
  const m = floorColor && /^#([0-9a-f]{6})$/i.exec(floorColor.trim());
  if (!m) return "dark";
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.45 ? "light" : "dark";
}

/** The flooring color a room shows (its own pick, else the whole house's). */
export function floorColorOf(selections: Project["interior"]["selections"], roomId: string): string | undefined {
  const f = roomFinishes(selections, roomId);
  return (f.get("flooring") ?? f.get("tile"))?.color;
}

