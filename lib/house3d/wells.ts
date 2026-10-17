import type { Level, PlanBasics, Point } from "@/lib/model/schema";
import type { Plans } from "@/lib/plan/edit";
import { add, dist, lerp, scale, sub, unit } from "@/lib/plan/geometry";
import { windowWells, type WindowWell } from "@/lib/plan/wells";
import { hex, MeshBuilder, type Frame, type MeshData } from "./mesh";
import type { Site } from "./site";

/**
 * Window wells in 3D: a corrugated metal well around each basement escape
 * window (three sides, a few inches above the ground), gravel at the
 * bottom, and a ladder when it's deeper than 44". Where they go comes from
 * lib/plan/wells.ts.
 */

const METAL = hex("#a7acb0");
const RIB = hex("#8f959a");
const GRAVEL = hex("#9b968c");
const LADDER = hex("#6f7478");
/** How far the well's rim stands above the ground. */
const RIM_IN = 4;
const SHEET_IN = 1;
const GRAVEL_IN = 4;
/** Corrugation ribs this far apart along each side. */
const RIB_EVERY_IN = 8;

/** The wells around one basement floor's escape windows. */
export function wellsOf(plans: Plans, ctx: { levels: Level[]; basics: PlanBasics | null; site: Site }, levelId: string): WindowWell[] {
  return windowWells(plans, ctx.levels, ctx.basics, ctx.site.groundAt).filter((w) => w.levelId === levelId);
}

export function drawWells(f: Frame, wells: WindowWell[], site: Site): MeshData | null {
  if (!wells.length) return null;
  const mb = new MeshBuilder();
  for (const w of wells) {
    const [a, b, c, d] = w.outline;
    const ground = site.groundAt(lerp(a, c, 0.5));
    const top = ground + RIM_IN;
    const bottom = ground - w.depthIn;
    const color = { left: METAL, right: METAL, ends: METAL, top: METAL, bottom: METAL };
    // Three sides: the two ends running out from the wall, and the far side.
    for (const [p, q] of [[a, d], [d, c], [c, b]] as [Point, Point][]) {
      mb.box(f, p, q, SHEET_IN, bottom, top, color);
      const L = dist(p, q);
      const u = unit(sub(q, p));
      for (let t = RIB_EVERY_IN / 2; t < L; t += RIB_EVERY_IN) {
        const at = add(p, scale(u, t));
        mb.box(f, add(at, scale(u, -0.75)), add(at, scale(u, 0.75)), SHEET_IN * 2.5, bottom, top, { left: RIB, right: RIB, ends: RIB, top: RIB });
      }
    }
    // Gravel at the bottom.
    mb.prism(f, { outline: w.outline, holes: [] }, bottom - GRAVEL_IN, bottom, () => null, GRAVEL);
    // A ladder on the far side, from the gravel up to the rim.
    if (w.ladder) {
      const out = unit(sub(d, a));
      const mid = lerp(d, c, 0.5);
      const along = unit(sub(c, d));
      const inner = add(mid, scale(out, -3));
      for (const s of [-8, 8]) mb.box(f, add(inner, scale(along, s)), add(add(inner, scale(along, s)), scale(out, 1)), 1.5, bottom, top, { left: LADDER, right: LADDER, ends: LADDER, top: LADDER });
      for (let z = bottom + 12; z < top - 4; z += 12) mb.box(f, add(inner, scale(along, -8)), add(inner, scale(along, 8)), 1, z, z + 1, { left: LADDER, right: LADDER, ends: LADDER, top: LADDER, bottom: LADDER });
    }
  }
  return mb.empty ? null : mb.build();
}
