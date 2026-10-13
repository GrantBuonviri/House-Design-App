import type { Plot } from "@/lib/model/schema";
import { compassName } from "./sun";

/**
 * What a plot means for the house. Later stages use these: the flow sketch
 * suggests room placement from them and the cost model prices the
 * foundation and drainage work.
 */

export type FoundationType = "slab" | "crawlspace" | "walkout" | "stepped";

export type PlotImplications = {
  foundation: { type: FoundationType; label: string; note: string };
  sun: { rating: "excellent" | "good" | "fair" | "limited"; note: string };
  drainageWork: "none" | "some" | "major";
  notes: string[];
};

const SIDE_NAME = { N: "north", E: "east", S: "south", W: "west" } as const;

/** How directly the land faces south (1 = due south, -1 = due north). */
function southness(facingDeg: number): number {
  return Math.cos(((facingDeg - 180) * Math.PI) / 180);
}

export function plotImplications(plot: Plot): PlotImplications {
  const slope = plot.slope.percent;
  const downhill = compassName(plot.slope.downhillDeg);
  const notes: string[] = [];

  let foundation: PlotImplications["foundation"];
  if (slope < 3) {
    foundation = { type: "slab", label: "Slab or crawlspace", note: "Little grading needed. The simplest and cheapest foundation." };
  } else if (slope < 8) {
    foundation = {
      type: "crawlspace",
      label: "Crawlspace with stepped stem walls",
      note: "Some grading, and the foundation walls get taller on the downhill side.",
    };
  } else if (slope < 15) {
    foundation = {
      type: "walkout",
      label: "Walkout basement",
      note: `The slope suits a walkout basement opening to the ${downhill}.`,
    };
  } else {
    foundation = {
      type: "stepped",
      label: "Stepped foundation or split-level",
      note: `Steep ground: expect retaining walls and a split-level design that steps down to the ${downhill}.`,
    };
  }

  const s = southness(plot.facingDeg);
  let sun: PlotImplications["sun"];
  if (plot.isFlat || slope < 2) {
    sun = { rating: "excellent", note: "Open to sun from every side. Put the main living spaces on the south side." };
  } else if (s > 0.85) {
    sun = {
      rating: "excellent",
      note: `Faces ${compassName(plot.facingDeg)}: great winter sun. Put living spaces and big windows on the south side.`,
    };
  } else if (s > 0) {
    sun = {
      rating: "good",
      note: `Faces ${compassName(plot.facingDeg)}: good sun. Angle the living spaces toward the south.`,
    };
  } else if (s > -0.7 || slope < 6) {
    sun = {
      rating: "fair",
      note: `Faces ${compassName(plot.facingDeg)}: the uphill side blocks some low winter sun. Lift south windows higher.`,
    };
  } else {
    sun = {
      rating: "limited",
      note: "Faces north: less winter sun. Clerestory windows and skylights on the south side will help.",
    };
  }

  const drainageWork = plot.drainage.rating === "good" ? "none" : plot.drainage.rating === "fair" ? "some" : "major";
  if (drainageWork === "some") notes.push("Fair drainage: plan for extra grading and gutters that carry water away.");
  if (drainageWork === "major")
    notes.push("Poor drainage: plan for French drains, a sump pump and grading away from the house (adds cost).");

  for (const w of plot.waterFeatures) {
    if (w.kind === "creek") notes.push("A creek runs through: keep the house back from the banks and frame views toward it.");
    if (w.kind === "pond") notes.push("A pond sits on the low side: a nice view from the main rooms.");
    if (w.kind === "lake")
      notes.push(`Lake frontage to the ${downhill}: turn the main rooms toward the water.`);
    if (w.kind === "wash")
      notes.push("A seasonal wash crosses the land: keep the house out of its path, since it can run fast in spring.");
  }

  notes.push(`Road on the ${SIDE_NAME[plot.roadSide]} side: the entry and garage likely go there.`);

  return { foundation, sun, drainageWork, notes };
}
