import { z } from "zod";
import { Product } from "@/lib/model/schema";
import brandsRaw from "@/config/brands.json";
import flooring from "@/data/catalog/flooring.json";
import tile from "@/data/catalog/tile.json";
import paint from "@/data/catalog/paint.json";
import trim from "@/data/catalog/trim.json";
import interiorDoors from "@/data/catalog/interior-doors.json";
import cabinets from "@/data/catalog/cabinets.json";
import counters from "@/data/catalog/counters.json";
import hardware from "@/data/catalog/hardware.json";
import kitchenSinks from "@/data/catalog/kitchen-sinks.json";
import kitchenFaucets from "@/data/catalog/kitchen-faucets.json";
import potFillers from "@/data/catalog/pot-fillers.json";
import barFaucets from "@/data/catalog/bar-faucets.json";
import fridges from "@/data/catalog/fridges.json";
import ranges from "@/data/catalog/ranges.json";
import dishwashers from "@/data/catalog/dishwashers.json";
import hoods from "@/data/catalog/hoods.json";
import vanities from "@/data/catalog/vanities.json";
import bathFaucets from "@/data/catalog/bath-faucets.json";
import toilets from "@/data/catalog/toilets.json";
import showers from "@/data/catalog/showers.json";
import lighting from "@/data/catalog/lighting.json";
import type { InteriorCategoryId } from "./categories";

/**
 * The built-in product catalog: real products with links, prices and the date
 * each was checked, one file per category in data/catalog/. Checked when the
 * app loads, so a typo in a file shows a clear message instead of a broken page.
 */

export const STYLES = [
  { id: "modern-farmhouse", label: "Modern farmhouse" },
  { id: "mountain-modern", label: "Mountain modern" },
  { id: "scandinavian", label: "Scandinavian" },
  { id: "craftsman", label: "Craftsman" },
  { id: "transitional", label: "Transitional" },
  { id: "industrial", label: "Industrial" },
  { id: "modern", label: "Modern" },
] as const;
export type StyleId = (typeof STYLES)[number]["id"];

export const TAGS = [
  "warm",
  "cool",
  "neutral",
  "bold",
  "light-wood",
  "medium-wood",
  "dark-wood",
  "matte-black",
  "brushed-nickel",
  "brass",
  "chrome",
  "stainless",
  "white",
  "black",
  "quartz",
  "granite",
  "butcher-block",
  "concrete-look",
] as const;

export const CatalogProduct = Product.extend({
  id: z.string().min(1),
  priceNote: z.string().optional(),
  kind: z.string().min(1),
  styles: z.array(z.enum(STYLES.map((s) => s.id) as [StyleId, ...StyleId[]])).min(1),
  tags: z.array(z.enum(TAGS)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "should be a color like #c8a77e"),
  pattern: z.enum(["plank", "tile", "stone", "carpet", "solid", "metal"]),
});
export type CatalogProduct = z.infer<typeof CatalogProduct> & { category: InteriorCategoryId };

const FILES: Record<InteriorCategoryId, unknown> = {
  flooring,
  tile,
  paint,
  trim,
  "interior-doors": interiorDoors,
  cabinets,
  counters,
  hardware,
  "kitchen-sinks": kitchenSinks,
  "kitchen-faucets": kitchenFaucets,
  "pot-fillers": potFillers,
  "bar-faucets": barFaucets,
  fridges,
  ranges,
  dishwashers,
  hoods,
  vanities,
  "bath-faucets": bathFaucets,
  toilets,
  showers,
  lighting,
};

export const Brands = z.object({
  suppliers: z.array(z.string()).default([]),
  categories: z.record(z.string(), z.array(z.string())).default({}),
});
export type Brands = z.infer<typeof Brands>;

/** Check every catalog file. Throws with the file and product named when something's wrong. */
export function parseCatalog(files: Record<string, unknown>): CatalogProduct[] {
  const out: CatalogProduct[] = [];
  const ids = new Set<string>();
  for (const [category, data] of Object.entries(files)) {
    const list = z.array(z.unknown()).safeParse(data);
    if (!list.success) throw new Error(`data/catalog/${category}.json should be a list of products`);
    list.data.forEach((item, i) => {
      const r = CatalogProduct.safeParse(item);
      if (!r.success) {
        const name = (item as { name?: string })?.name ?? `product ${i + 1}`;
        const issue = r.error.issues[0];
        throw new Error(`data/catalog/${category}.json, "${name}": ${issue.path.join(".")} ${issue.message}`);
      }
      if (ids.has(r.data.id)) throw new Error(`data/catalog/${category}.json: the id "${r.data.id}" is used twice`);
      ids.add(r.data.id);
      out.push({ ...r.data, category: category as InteriorCategoryId });
    });
  }
  return out;
}

let cached: CatalogProduct[] | null = null;
let cachedBrands: Brands | null = null;

/** Every product in data/catalog/. */
export function catalog(): CatalogProduct[] {
  if (!cached) cached = parseCatalog(FILES);
  return cached;
}

/** The preferred brands in config/brands.json. */
export function brands(): Brands {
  if (!cachedBrands) cachedBrands = Brands.parse(brandsRaw);
  return cachedBrands;
}

export function productsIn(category: InteriorCategoryId): CatalogProduct[] {
  return catalog().filter((p) => p.category === category);
}

export function findProduct(id: string | undefined): CatalogProduct | undefined {
  return id ? catalog().find((p) => p.id === id) : undefined;
}
