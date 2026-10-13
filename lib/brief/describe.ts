import type { Plot } from "@/lib/model/schema";
import { describeSlope, plotAcres } from "@/lib/land/generate";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import { ruleSqft, type BriefContext } from "./rules";
import { levelIdsFor, levelName } from "./levels";
import { sqftFromDims } from "./rooms";

/** Plain-text descriptions of the answers and the land, for Claude's prompts. */

const SIDE = { N: "north", E: "east", S: "south", W: "west" } as const;

export function describePlot(plot: Plot | null): string {
  if (!plot) return "No land chosen yet.";
  const imp = plotImplications(plot);
  const lines = [
    `${plotAcres(plot).toFixed(2)} acres, ${Math.round(plot.widthIn / 12)} ft wide by ${Math.round(plot.depthIn / 12)} ft deep`,
    `Slope: ${describeSlope(plot)}${plot.slope.percent >= 2 ? `, downhill to the ${compassName(plot.slope.downhillDeg)}` : ""}`,
    `Road on the ${SIDE[plot.roadSide]} side`,
    `Foundation: ${imp.foundation.label}. ${imp.foundation.note}`,
    `Sun: ${imp.sun.note}`,
    `Drainage: ${plot.drainage.rating}. ${plot.drainage.reason}`,
    ...imp.notes,
  ];
  return lines.join("\n");
}

/** The rooms page, for Claude: floors, each room as JSON, the user's connections and the feel. */
export function describeRooms(ctx: Pick<BriefContext, "answers">): string {
  const a = ctx.answers;
  const levels = levelIdsFor(a.floorsAbove, a.floorsBelow);
  const name = new Map(a.rooms.map((r) => [r.id, r.name]));
  const rooms = a.rooms.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description.trim() || undefined,
    sizeFromUser: sqftFromDims(r.lengthIn, r.widthIn) ?? undefined,
    typicalSqft: ruleSqft({ type: r.type }, a.garageCars),
    floor: r.levelId && levels.includes(r.levelId) ? r.levelId : "decide",
  }));
  return [
    `Floors above ground: ${a.floorsAbove}. Floors below ground: ${a.floorsBelow}.`,
    `Floor ids: ${levels.map((id) => `${id} (${levelName(id)})`).join(", ")}`,
    a.rooms.some((r) => r.type === "garage") ? `Garage: ${a.garageCars} cars` : "No garage",
    `Rooms (JSON):\n${JSON.stringify(rooms)}`,
    a.connections.length
      ? `The client's own connections (keep these): ${a.connections.map((e) => `${name.get(e.a)} ${e.strength} ${name.get(e.b)}`).join("; ")}`
      : "The client gave no connections.",
    a.feel.trim() ? `How the house should feel, in their words: ${a.feel.trim()}` : "They didn't describe the feel.",
  ].join("\n");
}
