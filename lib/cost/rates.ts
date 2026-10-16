import { z } from "zod";
import raw from "./data/cost-rates.json";

/**
 * The cost rates file, checked when the app loads so a typo in it shows a
 * clear message instead of a broken page. Every rate has material and labor
 * separately, each as [low, likely, high], with where the number came from.
 */

const Range = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]).refine(([lo, mid, hi]) => lo <= mid && mid <= hi, {
  message: "should be [low, likely, high] with low ≤ likely ≤ high",
});
export type Range = z.infer<typeof Range>;

const Source = {
  source: z.string(),
  url: z.string().nullable().optional(),
  checked: z.string(),
  note: z.string().optional(),
};

export const Rate = z.object({
  label: z.string(),
  unit: z.enum(["sqft", "linft", "each", "cuyd"]),
  material: Range,
  labor: Range,
  ...Source,
});
export type Rate = z.infer<typeof Rate>;

export const Percent = z.object({ label: z.string(), value: Range, ...Source });
export type Percent = z.infer<typeof Percent>;

/** Boise's building permit: the house's value from its size, then a fee from that value. */
export const Permit = z.object({
  /** Dollars of building value per sq ft, for heated space, garages, and porches and decks. */
  valuationPerSqft: z.object({ living: z.number(), garage: z.number(), porch: z.number() }),
  /** Fee brackets by building value: a base fee plus so much per $1,000 over `over`. */
  brackets: z.array(z.object({ upTo: z.number().nullable(), base: z.number(), over: z.number(), per1000: z.number() })).min(1),
  ...Source,
});
export type Permit = z.infer<typeof Permit>;

export const RatesFile = z.object({
  region: z.string(),
  checked: z.string(),
  rates: z.record(z.string(), Rate),
  percents: z.record(z.string(), Percent),
  permit: Permit,
  calibration: z.object({ label: z.string(), costPerSqft: Range, ...Source }),
});
export type RatesFile = z.infer<typeof RatesFile>;

/** Rate ids the estimate uses. The file must have every one. */
export const RATE_IDS = [
  "site-prep",
  "excavation",
  "backfill-grade",
  "driveway",
  "drainage-some",
  "drainage-major",
  "retaining-wall",
  "rock-removal",
  "utility-trench",
  "slab",
  "footing",
  "stem-wall",
  "basement-wall",
  "waterproofing",
  "garage-slab",
  "floor-framing",
  "ext-wall-framing",
  "int-wall-framing",
  "roof-framing",
  "stairs",
  "deck",
  "roof-shingle",
  "roof-flat",
  "roof-hip-valley",
  "gutters",
  "window",
  "patio-door",
  "entry-door",
  "interior-door",
  "pocket-door",
  "barn-door",
  "garage-door",
  "siding",
  "ext-trim",
  "wall-insulation",
  "attic-insulation",
  "drywall",
  "plumbing-fixture-rough",
  "water-heater",
  "water-service",
  "electrical",
  "electrical-service",
  "lighting-fixtures",
  "hvac",
  "flooring",
  "tile",
  "interior-paint",
  "trim-millwork",
  "kitchen-cabinets",
  "countertops",
  "cabinet-hardware",
  "vanity",
  "toilet",
  "bath-sink-faucet",
  "shower-tub",
  "kitchen-sink-faucet",
  "appliance-package",
  "laundry-hookup",
  "sewer-connection",
  "water-connection",
  "well",
  "septic",
  "impact-fees",
  "trade-permits",
  // Milestone 10: exterior picks that cost a different amount to put up, and the yard.
  "roof-metal",
  "siding-stucco",
  "siding-brick",
  "stone-veneer",
  "pavers",
  "front-walk",
  "driveway-pavers",
  "driveway-gravel",
  "lawn",
  "planting-beds",
  "shrub",
  "tree",
  "exterior-lights",
] as const;
export type RateId = (typeof RATE_IDS)[number];

export const PERCENT_IDS = ["overhead-profit", "contingency", "plan-review"] as const;
export type PercentId = (typeof PERCENT_IDS)[number];

/** Check a rates file: the shape, and that every rate the estimate needs is there. */
export function parseRates(data: unknown): RatesFile {
  const file = RatesFile.parse(data);
  const missing = [...RATE_IDS.filter((id) => !file.rates[id]), ...PERCENT_IDS.filter((id) => !file.percents[id])];
  if (missing.length) throw new Error(`The cost rates file is missing: ${missing.join(", ")}`);
  return file;
}

let cached: RatesFile | null = null;

/** The rates in lib/cost/data/cost-rates.json. */
export function rates(): RatesFile {
  if (!cached) cached = parseRates(raw);
  return cached;
}
