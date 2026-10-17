import { STYLES, brands, catalog, type CatalogProduct, type StyleId } from "@/lib/catalog/catalog";
import { interiorCategory, lightKindsFor, tileKindsFor, type InteriorCategoryId } from "@/lib/catalog/categories";

/**
 * The interior style questions, and matching products to the answers. All
 * code: each answer becomes tags, and a product scores by the tags it shares.
 */

export type Answers = Record<string, string>;

export type Question = {
  id: string;
  label: string;
  hint?: string;
  options: { id: string; label: string; swatch: string[] }[];
  optional?: boolean;
};

const STYLE_SWATCH: Record<StyleId, string[]> = {
  "modern-farmhouse": ["#f2efe8", "#2b2b2b", "#c19a6b"],
  "mountain-modern": ["#8a6a4f", "#4a4f4a", "#d9d4c7"],
  scandinavian: ["#f5f3ee", "#e2d3b8", "#9aa59b"],
  craftsman: ["#6e4b2a", "#8c8a5c", "#d8c9a3"],
  transitional: ["#e8e4dc", "#a9a39a", "#5b6670"],
  industrial: ["#3b3b3b", "#9a8f84", "#b5651d"],
  modern: ["#ffffff", "#1c1c1c", "#9ea3a8"],
};

export const QUESTIONS: Question[] = [
  {
    id: "style",
    label: "Overall style",
    options: STYLES.map((s) => ({ id: s.id, label: s.label, swatch: STYLE_SWATCH[s.id] })),
  },
  {
    id: "style2",
    label: "A second style to mix in",
    hint: "Optional.",
    optional: true,
    options: STYLES.map((s) => ({ id: s.id, label: s.label, swatch: STYLE_SWATCH[s.id] })),
  },
  {
    id: "wood",
    label: "Wood tone",
    options: [
      { id: "light-wood", label: "Light", swatch: ["#e3cfa9", "#d8bf94"] },
      { id: "medium-wood", label: "Medium", swatch: ["#b07f4f", "#9c6f43"] },
      { id: "dark-wood", label: "Dark", swatch: ["#5a3b25", "#4a301e"] },
      { id: "none", label: "Little or no wood", swatch: ["#e9e9e6", "#cfd1d2"] },
    ],
  },
  {
    id: "colors",
    label: "Colors",
    options: [
      { id: "warm", label: "Warm", swatch: ["#efe3d0", "#c9a27e", "#a9744f"] },
      { id: "cool", label: "Cool", swatch: ["#e6ecef", "#a8b8c4", "#5f7685"] },
      { id: "neutral", label: "Neutral", swatch: ["#f1efea", "#cfcac0", "#8d877d"] },
      { id: "bold", label: "Bold", swatch: ["#22384f", "#3e5b47", "#1e1e1e"] },
    ],
  },
  {
    id: "metal",
    label: "Metal finish",
    hint: "Faucets, cabinet pulls and lights.",
    options: [
      { id: "matte-black", label: "Matte black", swatch: ["#2a2a2a"] },
      { id: "brushed-nickel", label: "Brushed nickel", swatch: ["#b7b5ad"] },
      { id: "brass", label: "Brass or gold", swatch: ["#c3a35a"] },
      { id: "chrome", label: "Chrome", swatch: ["#d9dde0"] },
    ],
  },
  {
    id: "counters",
    label: "Countertops",
    options: [
      { id: "quartz", label: "Quartz", swatch: ["#f1f0ec", "#d8d6d0"] },
      { id: "granite", label: "Granite", swatch: ["#5c5752", "#8e877f"] },
      { id: "butcher-block", label: "Butcher block", swatch: ["#c08a52", "#a8743f"] },
      { id: "concrete-look", label: "Concrete look", swatch: ["#a9a7a2", "#8f8d88"] },
    ],
  },
  {
    id: "floors",
    label: "Floors",
    options: [
      { id: "wood", label: "Wood", swatch: ["#b4895a", "#9b7349"] },
      { id: "lvp", label: "Wood-look vinyl", swatch: ["#c3a27c", "#a98a66"] },
    ],
  },
  {
    id: "carpet",
    label: "Carpet in bedrooms",
    options: [
      { id: "yes", label: "Yes", swatch: ["#d6cfc3"] },
      { id: "no", label: "No", swatch: ["#b4895a"] },
    ],
  },
];

const FEEL_STYLES: [RegExp, StyleId][] = [
  [/farmhouse|barn|rustic/i, "modern-farmhouse"],
  [/mountain|lodge|cabin|timber|ski/i, "mountain-modern"],
  [/scandi|nordic|hygge|minimal/i, "scandinavian"],
  [/craftsman|bungalow|arts and crafts/i, "craftsman"],
  [/industrial|loft|warehouse/i, "industrial"],
  [/transitional|classic|timeless|traditional/i, "transitional"],
  // "Modern" on its own, not as part of "modern farmhouse" or "mountain modern".
  [/(?<!mountain )\bmodern\b(?! farmhouse)|contemporary|sleek|clean lines/i, "modern"],
];

/**
 * Answers guessed from "how the house should feel" on the Rooms page, used
 * until the user answers that question themselves.
 */
export function guessAnswers(feel: string): Answers {
  const out: Answers = {};
  const styles = FEEL_STYLES.filter(([re]) => re.test(feel)).map(([, s]) => s);
  if (styles[0]) out.style = styles[0];
  if (styles[1]) out.style2 = styles[1];
  if (/cozy|cosy|warm|inviting|earthy/i.test(feel)) out.colors = "warm";
  else if (/moody|dramatic|bold|dark/i.test(feel)) out.colors = "bold";
  else if (/calm|serene|cool|coastal|crisp/i.test(feel)) out.colors = "cool";
  if (/bright|airy|light and|open and light|scandi/i.test(feel)) out.wood = "light-wood";
  return out;
}

/** The user's answers, filled in with guesses from the Rooms page where they haven't answered. */
export function effectiveAnswers(answers: Answers, feel: string): Answers {
  return { ...guessAnswers(feel), ...answers };
}

const METAL_CATS = new Set<InteriorCategoryId>(["kitchen-faucets", "pot-fillers", "bar-faucets", "bath-faucets", "showers", "hardware", "lighting"]);
const WOOD_CATS = new Set<InteriorCategoryId>(["flooring", "cabinets", "vanities", "interior-doors", "counters"]);
const SLEEP = /bedroom|guest-suite/;

/** How well a product fits the answers (and the room, when there is one). Higher is better. */
export function score(p: CatalogProduct, a: Answers, roomType?: string): number {
  let s = 0;
  if (a.style && p.styles.includes(a.style as StyleId)) s += 3;
  if (a.style2 && p.styles.includes(a.style2 as StyleId)) s += 1.5;
  if (a.colors && p.tags.includes(a.colors as never)) s += 1.5;
  if (WOOD_CATS.has(p.category) && a.wood) {
    if (a.wood === "none") {
      if (!p.tags.some((t) => t.endsWith("-wood"))) s += 1;
    } else if (p.tags.includes(a.wood as never)) s += 2;
  }
  if (METAL_CATS.has(p.category) && a.metal && p.tags.includes(a.metal as never)) s += 2.5;
  if (p.category === "counters" && a.counters && (p.kind === a.counters || p.tags.includes(a.counters as never))) s += 3;
  if (p.category === "flooring") {
    const bedroom = !!roomType && SLEEP.test(roomType);
    if (bedroom && a.carpet === "yes") s += p.kind === "carpet" ? 4 : 0;
    else if (p.kind === "carpet") s -= 3;
    if (a.floors && p.kind === a.floors) s += 2;
  }
  if (p.category === "tile" && roomType && !tileKindsFor(roomType).includes(p.kind)) s -= 2;
  if (p.category === "lighting" && roomType && !lightKindsFor(roomType).includes(p.kind)) s -= 4;
  const preferred = brands().categories[p.category] ?? [];
  if (preferred.some((b) => p.brand.toLowerCase().includes(b.toLowerCase()))) s += 0.5;
  return s;
}

/** Products in a category, best match first. Ties go to the mid-priced one. */
export function ranked(category: InteriorCategoryId, a: Answers, roomType?: string, all: CatalogProduct[] = catalog()): CatalogProduct[] {
  const list = all.filter((p) => p.category === category);
  const prices = list.map((p) => p.price ?? 0).sort((x, y) => x - y);
  const median = prices[Math.floor(prices.length / 2)] ?? 0;
  const midness = (p: CatalogProduct) => (median > 0 ? Math.min(1, Math.abs((p.price ?? median) - median) / median) : 0);
  return list
    .map((p) => ({ p, s: score(p, a, roomType) - 0.4 * midness(p) }))
    .sort((x, y) => y.s - x.s || x.p.name.localeCompare(y.p.name))
    .map((x) => x.p);
}

export type MoodBoard = {
  /** Paint colors that fit, as swatches. */
  palette: CatalogProduct[];
  /** One product from each main category. */
  picks: CatalogProduct[];
};

const BOARD_CATEGORIES: InteriorCategoryId[] = ["flooring", "cabinets", "counters", "tile", "kitchen-faucets", "lighting", "hardware", "vanities"];

/**
 * The mood board: paint colors and the best match in each main category.
 * Shuffling swaps each one for the next-best match.
 */
export function moodBoard(a: Answers, shuffle = 0, all: CatalogProduct[] = catalog()): MoodBoard {
  const paints = ranked("paint", a, undefined, all);
  const n = Math.min(5, paints.length);
  const palette = paints.length ? Array.from({ length: n }, (_, i) => paints[(i + shuffle * 2) % Math.min(paints.length, n + 4)]) : [];
  const picks = BOARD_CATEGORIES.flatMap((c) => {
    const r = ranked(c, a, c === "lighting" ? "dining" : c === "tile" ? "bathroom" : undefined, all);
    if (!r.length) return [];
    return [r[shuffle % Math.min(r.length, 3)]];
  });
  return { palette: [...new Map(palette.map((p) => [p.id, p])).values()], picks };
}

export function categoryLabel(id: string): string {
  return interiorCategory(id)?.label ?? id;
}
