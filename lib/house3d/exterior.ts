import { WHOLE_HOUSE, type DesignChoices, type Product, type Selection } from "@/lib/model/schema";
import { paintable } from "@/lib/catalog/exterior";
import { accentPlaceFor, ACCENT_BAND_FT } from "@/lib/exterior/picks";
import { COLORS } from "./colors";
import { PATTERN, type PatternId } from "./finishes";
import { hex, type RGB } from "./mesh";

/**
 * The picked exterior finishes as 3D colors and patterns: siding, roof,
 * trim, window frames, doors, the deck and patio, and the yard. Anything
 * not picked keeps the plain look.
 */

export type Finish = { color: RGB; pattern: PatternId };

export type ExteriorLook = {
  siding: Finish;
  /** Stone, brick or wood on part of the walls, when picked. */
  accent: (Finish & { place: "base" | "gables"; heightIn: number }) | null;
  roof: Finish;
  trim: RGB;
  frame: RGB;
  patioFrame: RGB;
  frontDoor: RGB;
  garageDoor: RGB;
  deck: Finish;
  patio: Finish;
  driveway: Finish;
  walk: Finish;
  lawn: Finish;
  beds: Finish;
  shrub: RGB;
  tree: RGB;
  /** Pines and other evergreens are drawn as cones, other trees round. */
  treeCone: boolean;
  light: RGB;
};

/** A product's pattern as the 3D material draws it. */
export function patternId(pattern: Product["pattern"] | undefined): PatternId {
  switch (pattern) {
    case "plank":
      return PATTERN.plank;
    case "tile":
      return PATTERN.tile;
    case "carpet":
      return PATTERN.carpet;
    case "stone":
      return PATTERN.stone;
    case "lap":
      return PATTERN.lap;
    case "batten":
      return PATTERN.batten;
    case "shake":
      return PATTERN.shake;
    case "brick":
      return PATTERN.brick;
    case "stucco":
      return PATTERN.stucco;
    case "shingle":
      return PATTERN.shingle;
    case "seam":
      return PATTERN.seam;
    case "grass":
      return PATTERN.grass;
    case "mulch":
      return PATTERN.mulch;
    default:
      return PATTERN.none;
  }
}

export const YARD_COLORS = {
  concrete: hex("#bdb8ae"),
  lawn: hex("#6f9a4a"),
  mulch: hex("#5a3f2b"),
  shrub: hex("#4f7a3a"),
  tree: hex("#4a7436"),
  trunk: hex("#5b4330"),
  light: hex("#2b2b2b"),
};

const EVERGREEN = /pine|spruce|fir|juniper|cedar|arborvitae/i;

/** How the outside looks with what's picked. */
export function exteriorLook(ext: Pick<DesignChoices, "selections" | "accentPlace"> | undefined, hasGables = true): ExteriorLook {
  const picks = new Map<string, Product>();
  for (const s of (ext?.selections ?? []) as Selection[]) if (s.targetId === WHOLE_HOUSE && !s.wall) picks.set(s.category, s.product);
  const finish = (p: Product | undefined, color: RGB, pattern: PatternId = PATTERN.none): Finish =>
    p ? { color: p.color ? hex(p.color) : color, pattern: p.pattern ? patternId(p.pattern) : pattern } : { color, pattern };
  const siding = picks.get("siding");
  const paint = paintable(siding?.kind) ? picks.get("siding-paint") : undefined;
  const sidingFinish = finish(siding, COLORS.siding);
  if (paint?.color) sidingFinish.color = hex(paint.color);
  const accent = picks.get("accent");
  const tree = picks.get("trees");
  const col = (id: string, fallback: RGB) => {
    const p = picks.get(id);
    return p?.color ? hex(p.color) : fallback;
  };
  return {
    siding: sidingFinish,
    accent: accent && ext ? { ...finish(accent, COLORS.siding), place: accentPlaceFor(ext, hasGables), heightIn: ACCENT_BAND_FT * 12 } : null,
    roof: finish(picks.get("roofing"), COLORS.roof),
    trim: col("trim-paint", COLORS.fascia),
    frame: col("windows", COLORS.frame),
    patioFrame: col("patio-doors", col("windows", COLORS.frame)),
    frontDoor: col("entry-doors", COLORS.frontDoor),
    garageDoor: col("garage-doors", COLORS.garageDoor),
    deck: finish(picks.get("decking"), COLORS.deck, PATTERN.plank),
    patio: finish(picks.get("patio"), COLORS.patio),
    driveway: finish(picks.get("driveway"), YARD_COLORS.concrete),
    walk: finish(picks.get("walk"), YARD_COLORS.concrete),
    lawn: { color: col("lawn", YARD_COLORS.lawn), pattern: PATTERN.grass },
    beds: { color: col("beds", YARD_COLORS.mulch), pattern: PATTERN.mulch },
    shrub: col("shrubs", YARD_COLORS.shrub),
    tree: tree?.color ? hex(tree.color) : YARD_COLORS.tree,
    treeCone: !!tree && EVERGREEN.test(tree.name),
    light: col("exterior-lighting", YARD_COLORS.light),
  };
}
