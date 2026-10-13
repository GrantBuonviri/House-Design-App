import type { Plot } from "@/lib/model/schema";
import { describeSlope, plotAcres } from "@/lib/land/generate";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";

/** Short, readable facts about a plot for cards and the detail panel. */
export function plotFacts(plot: Plot) {
  const acres = plotAcres(plot);
  const imp = plotImplications(plot);
  return {
    size: `${acres < 1 ? acres.toFixed(2) : acres.toFixed(1)} acres`,
    dims: `${Math.round(plot.widthIn / 12)}′ × ${Math.round(plot.depthIn / 12)}′`,
    slope: describeSlope(plot),
    facing: plot.isFlat || plot.slope.percent < 2 ? "Open on all sides" : `Faces ${compassName(plot.facingDeg)}`,
    sunRating: imp.sun.rating,
    water: plot.waterFeatures.map((w) => WATER_LABEL[w.kind]),
    road: `Road on the ${SIDE[plot.roadSide]}`,
    implications: imp,
  };
}

export const WATER_LABEL = {
  creek: "Creek",
  pond: "Pond",
  lake: "Lake frontage",
  wash: "Seasonal wash",
} as const;

const SIDE = { N: "north", E: "east", S: "south", W: "west" } as const;

export const DRAINAGE_STYLE = {
  good: "bg-emerald-50 text-emerald-800",
  fair: "bg-amber-50 text-amber-800",
  poor: "bg-red-50 text-red-800",
} as const;

export const SUN_LABEL = {
  excellent: "Excellent sun",
  good: "Good sun",
  fair: "Fair sun",
  limited: "Limited sun",
} as const;
