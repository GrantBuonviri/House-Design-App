import type { Plot, Profile } from "@/lib/model/schema";
import { describeSlope, plotAcres } from "@/lib/land/generate";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import type { BriefContext } from "./rules";

/** Plain-text descriptions of the answers and the land, for Claude's prompts. */

const SIDE = { N: "north", E: "east", S: "south", W: "west" } as const;

export function describeHousehold(p: Profile): string {
  const lines: string[] = [];
  if (p.adults !== undefined) lines.push(`Adults: ${p.adults}`);
  if (p.kids !== undefined) lines.push(`Kids: ${p.kids}`);
  if (p.pets) lines.push(`Pets: ${p.pets}`);
  if (p.olderRelatives) lines.push("Older relatives live here or visit often");
  if (p.workFromHome !== undefined) lines.push(`People who work from home: ${p.workFromHome}`);
  if (p.budget?.low || p.budget?.high) {
    lines.push(`Budget: $${(p.budget.low ?? 0).toLocaleString("en-US")} to $${(p.budget.high ?? 0).toLocaleString("en-US")}`);
  }
  return lines.join("\n") || "Not given";
}

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

export function describeAnswers(ctx: Pick<BriefContext, "answers">): string {
  const a = ctx.answers;
  const lines = [
    `Bedrooms: ${a.bedrooms}; full baths: ${a.fullBaths}; half baths: ${a.halfBaths}`,
    `Primary suite: ${a.primarySuite === "either" ? "either floor" : `${a.primarySuite} floor`}`,
    `Offices: ${a.offices}`,
    `Kitchen: ${a.kitchen}; dining: ${a.dining}; pantry: ${a.pantry}`,
    `Mudroom: ${a.mudroom ? "yes" : "no"}; laundry: ${a.laundry}`,
    `Extra rooms: ${a.extraRooms.join(", ") || "none"}`,
    `Floors above ground: ${a.floors}; basement: ${a.basement}`,
    `Garage bays: ${a.garageBays}; storage needs: ${a.storage}`,
    `Outdoor spaces: ${a.outdoor.join(", ") || "none"}`,
    `Accessibility: ${a.accessibility.join(", ") || "none"}`,
    `Cozy (0) to airy (100): ${a.cozyAiry}`,
    `Open plan (0) to defined rooms (100): ${a.openDefined}`,
    `Quiet retreat (0) to entertaining (100): ${a.quietEntertaining}`,
    `Bedroom privacy: ${a.bedroomPrivacy}`,
    `Indoor-outdoor connection: ${a.indoorOutdoor}`,
    `Style words: ${a.styleWords.join(", ") || "none"}`,
  ];
  if (a.dailyRoutine.trim()) lines.push(`A typical day, in their words: ${a.dailyRoutine.trim()}`);
  if (a.anythingElse.trim()) lines.push(`Anything else, in their words: ${a.anythingElse.trim()}`);
  return lines.join("\n");
}
