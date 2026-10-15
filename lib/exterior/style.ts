import type { Question, Answers } from "@/lib/interior/style";
import {
  EXTERIOR_STYLES,
  exteriorCatalog,
  exteriorCategory,
  exteriorProductsFor,
  paintable,
  type ExteriorCategoryId,
  type ExteriorProduct,
  type ExteriorStyleId,
  type ExteriorTag,
} from "@/lib/catalog/exterior";
import { brands } from "@/lib/catalog/catalog";

/**
 * The exterior style questions, guesses from the interior answers, and
 * matching products to the answers. All code, like the interior: each answer
 * becomes tags and kinds, and a product scores by what it shares.
 */

export type { Answers };

const STYLE_SWATCH: Record<ExteriorStyleId, string[]> = {
  "modern-farmhouse": ["#f4f2ec", "#232323", "#a37a52"],
  "mountain-modern": ["#4a4740", "#8b6a4c", "#9a9a92"],
  craftsman: ["#6f7559", "#d9cdb2", "#8a6446"],
  contemporary: ["#2f3133", "#e8e6e1", "#b58a5c"],
  ranch: ["#c9b9a0", "#8c3f2e", "#f0ece4"],
  traditional: ["#f2efe9", "#38495c", "#7a7a76"],
};

export const EXTERIOR_QUESTIONS: Question[] = [
  {
    id: "style",
    label: "Overall look",
    options: EXTERIOR_STYLES.map((s) => ({ id: s.id, label: s.label, swatch: STYLE_SWATCH[s.id] })),
  },
  {
    id: "siding",
    label: "Main siding",
    options: [
      { id: "lap", label: "Lap boards", swatch: ["#e9e5dc", "#d4cfc4", "#e9e5dc", "#d4cfc4"] },
      { id: "batten", label: "Board and batten", swatch: ["#f2f0ea", "#d9d6cf", "#f2f0ea", "#d9d6cf", "#f2f0ea"] },
      { id: "shake", label: "Shingles or shakes", swatch: ["#8e7a5f", "#7b694f", "#8e7a5f"] },
      { id: "panel", label: "Smooth panels", swatch: ["#3a3c3e", "#46484a"] },
      { id: "stucco", label: "Stucco", swatch: ["#ddd2bf", "#d6cab6"] },
      { id: "brick", label: "Brick", swatch: ["#9b4a36", "#b2593f", "#8a4130"] },
    ],
  },
  {
    id: "body",
    label: "House color",
    options: [
      { id: "light", label: "White or light", swatch: ["#f4f2ec", "#e8e4da"] },
      { id: "neutral", label: "Warm neutral", swatch: ["#cfc5b4", "#b4a993"] },
      { id: "dark", label: "Dark", swatch: ["#2f3133", "#45484a"] },
      { id: "bold", label: "Color", swatch: ["#3d5a6c", "#5b6b4e", "#7d3a2f"] },
    ],
  },
  {
    id: "accent",
    label: "Accents",
    hint: "A band of stone or brick along the base, or wood on the gables.",
    options: [
      { id: "none", label: "None", swatch: ["#e9e5dc"] },
      { id: "stone", label: "Stone", swatch: ["#9b9384", "#7f786b", "#b2aa9a"] },
      { id: "brick", label: "Brick", swatch: ["#9b4a36", "#b2593f"] },
      { id: "wood", label: "Wood", swatch: ["#a7774b", "#8c6038"] },
    ],
  },
  {
    id: "roof",
    label: "Roof",
    options: [
      { id: "shingle", label: "Asphalt shingles", swatch: ["#4b4d50", "#3e4043", "#55575a"] },
      { id: "metal", label: "Standing-seam metal", swatch: ["#2d2f31", "#3a3c3e", "#2d2f31"] },
    ],
  },
  {
    id: "roofColor",
    label: "Roof color",
    options: [
      { id: "dark", label: "Black or charcoal", swatch: ["#2a2b2d"] },
      { id: "gray", label: "Gray", swatch: ["#6f7174"] },
      { id: "earthy", label: "Brown", swatch: ["#5b4636"] },
    ],
  },
  {
    id: "frames",
    label: "Window frames",
    options: [
      { id: "white", label: "White", swatch: ["#f4f4f1"] },
      { id: "black", label: "Black", swatch: ["#232323"] },
      { id: "bronze", label: "Bronze", swatch: ["#4a3a2c"] },
      { id: "wood-tone", label: "Wood look", swatch: ["#a8794b"] },
    ],
  },
];

/** What each style usually looks like, used until the questions are answered. */
const STYLE_DEFAULTS: Record<ExteriorStyleId, Answers> = {
  "modern-farmhouse": { siding: "batten", body: "light", accent: "wood", roof: "metal", roofColor: "dark", frames: "black" },
  "mountain-modern": { siding: "panel", body: "dark", accent: "wood", roof: "metal", roofColor: "dark", frames: "black" },
  craftsman: { siding: "lap", body: "bold", accent: "stone", roof: "shingle", roofColor: "earthy", frames: "white" },
  contemporary: { siding: "panel", body: "dark", accent: "wood", roof: "metal", roofColor: "dark", frames: "black" },
  ranch: { siding: "lap", body: "neutral", accent: "brick", roof: "shingle", roofColor: "gray", frames: "white" },
  traditional: { siding: "lap", body: "light", accent: "stone", roof: "shingle", roofColor: "gray", frames: "white" },
};

const FROM_INTERIOR: Record<string, ExteriorStyleId> = {
  "modern-farmhouse": "modern-farmhouse",
  "mountain-modern": "mountain-modern",
  scandinavian: "contemporary",
  craftsman: "craftsman",
  transitional: "traditional",
  industrial: "contemporary",
  modern: "contemporary",
};

/**
 * Answers guessed from the interior style (and its metal finish, for window
 * frames), used until the exterior questions are answered.
 */
export function guessExterior(interior: Answers): Answers {
  const style = interior.style ? FROM_INTERIOR[interior.style] : undefined;
  if (!style) return {};
  const out: Answers = { style, ...STYLE_DEFAULTS[style] };
  if (interior.metal === "matte-black") out.frames = "black";
  return out;
}

/** The user's answers, with guesses filling the gaps: from their answer to "Overall look" first, then the interior. */
export function effectiveExterior(answers: Answers, interior: Answers): Answers {
  const guess = guessExterior(interior);
  const style = (answers.style ?? guess.style) as ExteriorStyleId | undefined;
  return { ...guess, ...(style ? { style, ...STYLE_DEFAULTS[style] } : {}), ...answers };
}

/** The guesses shown on the questions page (where the user hasn't answered). */
export function exteriorGuesses(answers: Answers, interior: Answers): Answers {
  const all = effectiveExterior(answers, interior);
  const out: Answers = {};
  for (const [k, v] of Object.entries(all)) if (answers[k] === undefined) out[k] = v;
  return out;
}

const BODY_TAGS: Record<string, ExteriorTag[]> = {
  light: ["white", "light"],
  neutral: ["neutral", "warm", "gray"],
  dark: ["dark", "black"],
  bold: ["bold", "blue", "green", "red", "earthy"],
};
const ROOF_TAGS: Record<string, ExteriorTag[]> = { dark: ["dark", "black"], gray: ["gray"], earthy: ["earthy", "warm", "bronze"] };
const has = (p: ExteriorProduct, tags: ExteriorTag[] | undefined) => !!tags && p.tags.some((t) => tags.includes(t));

/** How well a product fits the answers for a part of the outside. Higher is better. */
export function exteriorScore(p: ExteriorProduct, category: ExteriorCategoryId, a: Answers): number {
  let s = 0;
  if (a.style && p.styles.includes(a.style as ExteriorStyleId)) s += 3;
  switch (category) {
    case "roofing":
      if (a.roof && p.kind === a.roof) s += 4;
      if (has(p, ROOF_TAGS[a.roofColor])) s += 2;
      break;
    case "siding":
      if (a.siding && p.kind === a.siding) s += 4;
      if (has(p, BODY_TAGS[a.body])) s += 2;
      break;
    case "siding-paint":
      if (p.kind === "body") s += 1.5;
      if (has(p, BODY_TAGS[a.body])) s += 3;
      break;
    case "trim-paint":
      if (p.kind === "trim") s += 1.5;
      // Light houses get white or black trim; dark and colored ones get light trim.
      if (a.body === "light" ? has(p, ["white", "black"]) : has(p, ["white", "light"])) s += 2;
      break;
    case "accent":
      if (a.accent && a.accent !== "none" && p.kind === a.accent) s += 4;
      break;
    case "windows":
    case "patio-doors":
      if (a.frames && p.tags.includes(a.frames as ExteriorTag)) s += 3;
      break;
    case "gutters":
    case "exterior-lighting":
      if (a.frames && p.tags.includes(a.frames as ExteriorTag)) s += 1.5;
      if (category === "gutters" && has(p, BODY_TAGS[a.body])) s += 1;
      break;
    case "entry-doors":
    case "garage-doors":
      if (has(p, BODY_TAGS[a.body])) s += 0.5;
      break;
  }
  const preferred = brands().categories[exteriorCategory(category)?.file ?? ""] ?? [];
  if (preferred.some((b) => p.brand.toLowerCase().includes(b.toLowerCase()))) s += 0.5;
  return s;
}

/** Products for a part of the outside, best match first. Ties go to the mid-priced one. */
export function rankedExterior(category: ExteriorCategoryId, a: Answers, all: ExteriorProduct[] = exteriorCatalog()): ExteriorProduct[] {
  const list = exteriorProductsFor(category, all);
  const prices = list.map((p) => p.price ?? 0).sort((x, y) => x - y);
  const median = prices[Math.floor(prices.length / 2)] ?? 0;
  const midness = (p: ExteriorProduct) => (median > 0 ? Math.min(1, Math.abs((p.price ?? median) - median) / median) : 0);
  return list
    .map((p) => ({ p, s: exteriorScore(p, category, a) - 0.4 * midness(p) }))
    .sort((x, y) => y.s - x.s || x.p.name.localeCompare(y.p.name))
    .map((x) => x.p);
}

export type ExteriorBoard = {
  /** The house's colors: siding, trim, roof, window frames and the front door. */
  palette: { label: string; product: ExteriorProduct }[];
  /** The best match for each main part. */
  picks: { category: ExteriorCategoryId; product: ExteriorProduct }[];
};

const BOARD: ExteriorCategoryId[] = ["siding", "roofing", "accent", "windows", "entry-doors", "garage-doors", "exterior-lighting", "decking", "patio", "trees"];

/** The exterior mood board. Shuffling swaps each one for the next-best match. */
export function exteriorBoard(a: Answers, shuffle = 0, all: ExteriorProduct[] = exteriorCatalog()): ExteriorBoard {
  const nth = (c: ExteriorCategoryId, k = 0) => {
    const r = rankedExterior(c, a, all);
    return r.length ? r[(k + shuffle) % Math.min(r.length, 3)] : undefined;
  };
  const siding = nth("siding");
  const palette: ExteriorBoard["palette"] = [];
  const push = (label: string, p: ExteriorProduct | undefined) => p && palette.push({ label, product: p });
  // Painted siding shows its paint color; brick, stucco and vinyl show their own.
  push("Siding", siding && paintable(siding.kind) ? (nth("siding-paint") ?? siding) : siding);
  push("Trim", nth("trim-paint"));
  push("Roof", nth("roofing"));
  push("Windows", nth("windows"));
  push("Front door", nth("entry-doors"));
  const picks = BOARD.filter((c) => c !== "accent" || (a.accent && a.accent !== "none")).flatMap((c) => {
    const p = nth(c);
    return p ? [{ category: c, product: p }] : [];
  });
  return { palette, picks };
}
