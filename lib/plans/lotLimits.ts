import type { Project } from "@/lib/model/schema";
import { houseScene } from "./scene";
import { houseFootprintSqft, realLotOk, siteLayout } from "./lot";

/**
 * The zoning limits that aren't setbacks, checked against "My real lot": how much of the lot
 * the house may cover, how tall it may be, and a warning for a shed roof that climbs very high.
 * `ok` is null when no limit was entered (or there is no real lot), so nothing fails.
 */

export type LotLimit = { id: "coverage" | "height"; name: string; limit: number | null; actual: number; unit: "%" | "ft"; ok: boolean | null };

/** The main floor sits about this far above the ground (same figure as the elevation notes). */
const FLOOR_ABOVE_GROUND_IN = 8;
/** A shed roof rising more than this from low edge to high edge is flagged, inches. */
export const SHED_RISE_WARN_IN = 96;

/** Lot coverage and building height against the limits typed into My real lot. Empty without a real lot. */
export function lotLimits(project: Project): LotLimit[] {
  const lot = project.plans.lot;
  if (!realLotOk(lot)) return [];
  const site = siteLayout(project);
  if (!site?.real) return [];
  const pct = (houseFootprintSqft(project) / Math.max(1, site.areaSqft)) * 100;
  const heightFt = (houseScene(project).topIn + FLOOR_ABOVE_GROUND_IN) / 12;
  const cover = lot.coverageLimitPct;
  const high = lot.heightLimitFt;
  return [
    { id: "coverage", name: "Lot coverage", limit: cover, actual: pct, unit: "%", ok: cover ? pct <= cover + 0.05 : null },
    { id: "height", name: "Building height", limit: high, actual: heightFt, unit: "ft", ok: high ? heightFt <= high + 0.05 : null },
  ];
}

/** Plain-words number for a limit row: "34.2%" or "26.5 ft". */
export function limitText(n: number, unit: LotLimit["unit"]): string {
  return unit === "%" ? `${n.toFixed(1)}%` : `${n.toFixed(1)} ft`;
}

/**
 * A shed roof is one slope, so its high edge climbs with the house's width. Returns the rise
 * in inches (low edge to high edge) when it's past SHED_RISE_WARN_IN, else null.
 */
export function tallShedRise(project: Project): number | null {
  if (project.house3d.roof.style !== "shed") return null;
  let worst = 0;
  for (const r of houseScene(project).roofs) {
    if (r.shape.fellBack || r.flat) continue;
    const hs = r.shape.tris.flatMap((t) => t.h);
    if (hs.length) worst = Math.max(worst, Math.max(...hs) - Math.min(...hs));
  }
  return worst > SHED_RISE_WARN_IN ? worst : null;
}

export function shedWarning(riseIn: number): string {
  return `This shed roof rises ${(riseIn / 12).toFixed(1)} ft from its low edge to its high edge. That makes a very tall wall on the high side, more siding and framing to pay for, and a taller house against any height limit. A lower pitch, a gable or hip roof, or sloping across the narrow way keeps it down.`;
}
