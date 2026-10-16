import { WHOLE_HOUSE, type DesignChoices, type Project, type Selection } from "@/lib/model/schema";
import { EXTERIOR_CATEGORIES, exteriorCategory, paintable, type ExteriorCategory, type ExteriorCategoryId } from "@/lib/catalog/exterior";
import { pickFor } from "@/lib/interior/picks";
import { flatProject } from "@/lib/plan/flatten";

/**
 * Exterior picks: one product per part of the outside, for the whole house.
 * Saved in `project.exterior.selections` with targetId "house" and the part
 * as the category.
 */

export function exteriorPick(selections: Selection[], category: ExteriorCategoryId): Selection | undefined {
  return pickFor(selections, WHOLE_HOUSE, category);
}

/** The parts this house has: no garage door pick without a garage door, no decking without a deck. Everything shows before there's a floor plan. */
export function exteriorPartsFor(p: Pick<Project, "floorPlans" | "house3d">): ExteriorCategory[] {
  p = flatProject(p);
  const plans = Object.values(p.floorPlans);
  if (!plans.some((pl) => pl.rooms.length)) return EXTERIOR_CATEGORIES;
  const styles = new Set(plans.flatMap((pl) => pl.openings.map((o) => o.style)));
  const types = new Set(plans.flatMap((pl) => pl.rooms.map((r) => r.type ?? "")));
  const flat = p.house3d.roof.style === "flat";
  return EXTERIOR_CATEGORIES.filter((c) => {
    switch (c.id) {
      case "garage-doors":
        return styles.has("door-garage");
      case "patio-doors":
        return styles.has("door-slider");
      case "decking":
        return types.has("deck");
      case "patio":
        return types.has("patio");
      case "roofing":
      case "gutters":
        return !flat;
      default:
        return true;
    }
  });
}

/** Whether the siding color pick shows: painted siding only (brick, stucco and vinyl keep their own color). */
export function sidingPaintApplies(selections: Selection[]): boolean {
  return paintable(exteriorPick(selections, "siding")?.product.kind);
}

export function exteriorLabel(id: string): string {
  return exteriorCategory(id)?.label ?? id;
}

/** How tall a stone or brick band along the base of the walls is, in feet. */
export const ACCENT_BAND_FT = 3;

/** Where the accent goes: what was picked, else wood on the gables (when there are any) and stone or brick along the base. */
export function accentPlaceFor(ext: Pick<DesignChoices, "selections" | "accentPlace">, hasGables: boolean): "base" | "gables" {
  if (!hasGables) return "base";
  if (ext.accentPlace) return ext.accentPlace;
  const pick = ext.selections.find((s) => s.targetId === WHOLE_HOUSE && s.category === "accent");
  return pick?.product.kind === "wood" ? "gables" : "base";
}
