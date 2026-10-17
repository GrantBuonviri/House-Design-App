import { z } from "zod";
import { PATTERNS, Product } from "@/lib/model/schema";
import type { RateId } from "@/lib/cost/rates";
import roofing from "@/data/catalog/roofing.json";
import siding from "@/data/catalog/siding.json";
import stoneBrick from "@/data/catalog/stone-brick.json";
import exteriorPaint from "@/data/catalog/exterior-paint.json";
import gutters from "@/data/catalog/gutters.json";
import windows from "@/data/catalog/windows.json";
import entryDoors from "@/data/catalog/entry-doors.json";
import patioDoors from "@/data/catalog/patio-doors.json";
import garageDoors from "@/data/catalog/garage-doors.json";
import exteriorLighting from "@/data/catalog/exterior-lighting.json";
import decking from "@/data/catalog/decking.json";
import pavers from "@/data/catalog/pavers.json";
import landscaping from "@/data/catalog/landscaping.json";

/**
 * The exterior half of the built-in catalog (milestone 10): roofing, siding,
 * windows, doors, decking, pavers and plants, one file per kind in
 * data/catalog/. Same idea as the interior catalog (lib/catalog/catalog.ts),
 * with outside styles and tags.
 */

export const EXTERIOR_STYLES = [
  { id: "modern-farmhouse", label: "Modern farmhouse" },
  { id: "mountain-modern", label: "Mountain modern" },
  { id: "craftsman", label: "Craftsman" },
  { id: "contemporary", label: "Contemporary" },
  { id: "ranch", label: "Ranch" },
  { id: "traditional", label: "Traditional" },
] as const;
export type ExteriorStyleId = (typeof EXTERIOR_STYLES)[number]["id"];

export const EXTERIOR_TAGS = ["white", "light", "neutral", "warm", "dark", "earthy", "bold", "black", "bronze", "gray", "wood-tone", "red", "blue", "green"] as const;
export type ExteriorTag = (typeof EXTERIOR_TAGS)[number];

export const EXTERIOR_FILES = {
  roofing,
  siding,
  "stone-brick": stoneBrick,
  "exterior-paint": exteriorPaint,
  gutters,
  windows,
  "entry-doors": entryDoors,
  "patio-doors": patioDoors,
  "garage-doors": garageDoors,
  "exterior-lighting": exteriorLighting,
  decking,
  pavers,
  landscaping,
} as const;
export type ExteriorFile = keyof typeof EXTERIOR_FILES;

export const ExteriorProduct = Product.extend({
  id: z.string().min(1),
  priceNote: z.string().optional(),
  kind: z.string().min(1),
  styles: z.array(z.enum(EXTERIOR_STYLES.map((s) => s.id) as [ExteriorStyleId, ...ExteriorStyleId[]])).min(1),
  tags: z.array(z.enum(EXTERIOR_TAGS)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "should be a color like #c8a77e"),
  pattern: z.enum(PATTERNS),
});
export type ExteriorProduct = z.infer<typeof ExteriorProduct> & { file: ExteriorFile };

/** The parts of the outside a product can be picked for, grouped as in the Exterior design window. */
export type ExteriorCategoryId =
  | "roofing"
  | "siding"
  | "siding-paint"
  | "accent"
  | "trim-paint"
  | "gutters"
  | "windows"
  | "entry-doors"
  | "patio-doors"
  | "garage-doors"
  | "exterior-lighting"
  | "decking"
  | "patio"
  | "walk"
  | "driveway"
  | "lawn"
  | "beds"
  | "shrubs"
  | "trees";

export type ExteriorCategory = {
  id: ExteriorCategoryId;
  label: string;
  /** One product, as a word for "Pick a …". */
  one: string;
  group: "Roof and walls" | "Windows and doors" | "Outdoor living" | "Yard";
  file: ExteriorFile;
  /** Only these kinds from the file (all of them when left out). */
  kinds?: string[];
  /** The cost line it changes. */
  line: string;
  /** The rate the line uses: the mid-range allowance until something's picked. */
  rate: RateId;
  /** Some kinds cost a different amount to put up (a metal roof, brick, pavers): their rate instead. */
  rateByKind?: Record<string, RateId>;
  /** How much of the line's material allowance the pick replaces (the rest is underlayment, fasteners, flashing and so on). */
  share: number;
  /** Product units per unit of the line (waste, coverage: siding paint is gallons per sq ft of wall). */
  perUnit: number;
};

/** About 350 sq ft a gallon, two coats. */
const PAINT_PER_SQFT = 2 / 350;

export const EXTERIOR_CATEGORIES: ExteriorCategory[] = [
  // Shingles or panels, starter, ridge caps and waste; underlayment, flashing and vents (45%) stay.
  { id: "roofing", label: "Roofing", one: "roof", group: "Roof and walls", file: "roofing", line: "roof-shingle", rate: "roof-shingle", rateByKind: { metal: "roof-metal" }, share: 0.55, perUnit: 1.12 },
  // The siding itself plus 10% waste; house wrap, flashing, trim pieces and paint (40%) stay.
  { id: "siding", label: "Siding", one: "siding", group: "Roof and walls", file: "siding", line: "siding", rate: "siding", rateByKind: { stucco: "siding-stucco", brick: "siding-brick" }, share: 0.6, perUnit: 1.1 },
  { id: "siding-paint", label: "Siding color", one: "siding color", group: "Roof and walls", file: "exterior-paint", line: "siding", rate: "siding", share: 0.08, perUnit: PAINT_PER_SQFT },
  { id: "accent", label: "Accent", one: "accent", group: "Roof and walls", file: "stone-brick", line: "accent", rate: "siding", rateByKind: { stone: "stone-veneer", brick: "stone-veneer" }, share: 0.7, perUnit: 1.05 },
  // About 0.04 gallons per foot of trim (fascia, soffit edge, corners and window trim).
  { id: "trim-paint", label: "Trim color", one: "trim color", group: "Roof and walls", file: "exterior-paint", line: "ext-trim", rate: "ext-trim", share: 0.1, perUnit: 0.04 },
  { id: "gutters", label: "Gutters", one: "gutter", group: "Roof and walls", file: "gutters", line: "gutters", rate: "gutters", share: 1, perUnit: 1 },
  // The line is per sq ft of window and the products are priced each, about 15 sq ft; flashing and trim (15%) stay.
  { id: "windows", label: "Windows", one: "window", group: "Windows and doors", file: "windows", line: "window", rate: "window", share: 0.85, perUnit: 1 / 15 },
  // The door; the lockset and threshold (30%) stay.
  { id: "entry-doors", label: "Front door", one: "front door", group: "Windows and doors", file: "entry-doors", line: "entry-door", rate: "entry-door", share: 0.7, perUnit: 1 },
  { id: "patio-doors", label: "Patio doors", one: "patio door", group: "Windows and doors", file: "patio-doors", line: "patio-door", rate: "patio-door", share: 0.85, perUnit: 1 },
  // The door; the opener (25%) stays.
  { id: "garage-doors", label: "Garage door", one: "garage door", group: "Windows and doors", file: "garage-doors", line: "garage-door", rate: "garage-door", share: 0.75, perUnit: 1 },
  { id: "exterior-lighting", label: "Outdoor lights", one: "outdoor light", group: "Windows and doors", file: "exterior-lighting", line: "exterior-lights", rate: "exterior-lights", share: 1, perUnit: 1 },
  // The deck boards; footings, framing and railing (60%) stay.
  { id: "decking", label: "Decking", one: "decking", group: "Outdoor living", file: "decking", line: "deck", rate: "deck", share: 0.4, perUnit: 1.1 },
  { id: "patio", label: "Patio", one: "patio", group: "Outdoor living", file: "pavers", kinds: ["patio", "walk"], line: "patio", rate: "garage-slab", rateByKind: { patio: "pavers", walk: "pavers" }, share: 1, perUnit: 1.05 },
  { id: "walk", label: "Front walk", one: "walk", group: "Outdoor living", file: "pavers", kinds: ["walk", "patio"], line: "front-walk", rate: "front-walk", rateByKind: { patio: "pavers", walk: "pavers" }, share: 1, perUnit: 1.05 },
  { id: "driveway", label: "Driveway", one: "driveway", group: "Outdoor living", file: "pavers", kinds: ["driveway", "gravel"], line: "driveway", rate: "driveway", rateByKind: { driveway: "driveway-pavers", gravel: "driveway-gravel" }, share: 1, perUnit: 1.05 },
  // Sod or seed; soil prep and sprinklers (50%) stay.
  { id: "lawn", label: "Lawn", one: "lawn", group: "Yard", file: "landscaping", kinds: ["lawn"], line: "lawn", rate: "lawn", share: 0.5, perUnit: 1.05 },
  // Mulch; edging, soil and drip lines (60%) stay.
  { id: "beds", label: "Planting beds", one: "mulch", group: "Yard", file: "landscaping", kinds: ["mulch"], line: "planting-beds", rate: "planting-beds", share: 0.4, perUnit: 1 },
  { id: "shrubs", label: "Shrubs", one: "shrub", group: "Yard", file: "landscaping", kinds: ["shrub"], line: "shrubs", rate: "shrub", share: 1, perUnit: 1 },
  { id: "trees", label: "Trees", one: "tree", group: "Yard", file: "landscaping", kinds: ["tree"], line: "trees", rate: "tree", share: 1, perUnit: 1 },
];

export function exteriorCategory(id: string): ExteriorCategory | undefined {
  return EXTERIOR_CATEGORIES.find((c) => c.id === id);
}

/** Check every exterior catalog file. Throws with the file and product named when something's wrong. */
export function parseExteriorCatalog(files: Record<string, unknown>, taken: Set<string> = new Set()): ExteriorProduct[] {
  const out: ExteriorProduct[] = [];
  const ids = new Set(taken);
  for (const [file, data] of Object.entries(files)) {
    const list = z.array(z.unknown()).safeParse(data);
    if (!list.success) throw new Error(`data/catalog/${file}.json should be a list of products`);
    list.data.forEach((item, i) => {
      const r = ExteriorProduct.safeParse(item);
      if (!r.success) {
        const name = (item as { name?: string })?.name ?? `product ${i + 1}`;
        const issue = r.error.issues[0];
        throw new Error(`data/catalog/${file}.json, "${name}": ${issue.path.join(".")} ${issue.message}`);
      }
      if (ids.has(r.data.id)) throw new Error(`data/catalog/${file}.json: the id "${r.data.id}" is used twice`);
      ids.add(r.data.id);
      out.push({ ...r.data, file: file as ExteriorFile });
    });
  }
  return out;
}

let cached: ExteriorProduct[] | null = null;

/** Every exterior product in data/catalog/. */
export function exteriorCatalog(): ExteriorProduct[] {
  if (!cached) cached = parseExteriorCatalog(EXTERIOR_FILES);
  return cached;
}

/** The products that can be picked for a part of the outside. */
export function exteriorProductsFor(category: ExteriorCategoryId, all: ExteriorProduct[] = exteriorCatalog()): ExteriorProduct[] {
  const c = exteriorCategory(category);
  if (!c) return [];
  return all.filter((p) => p.file === c.file && (!c.kinds || c.kinds.includes(p.kind)));
}

export function findExteriorProduct(id: string | undefined): ExteriorProduct | undefined {
  return id ? exteriorCatalog().find((p) => p.id === id) : undefined;
}

/** The rate a part uses with this product picked (or none picked). */
export function rateFor(c: ExteriorCategory, kind: string | undefined): RateId {
  return (kind && c.rateByKind?.[kind]) || c.rate;
}

/** Siding kinds that get painted (fiber cement, engineered wood, panels). Brick, stucco and vinyl keep their own color. */
export function paintable(kind: string | undefined): boolean {
  return !kind || ["lap", "batten", "shake", "panel"].includes(kind);
}
