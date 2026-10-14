import type { CostSettings, Project, Selection } from "@/lib/model/schema";
import { measureHouse, type Quantities } from "./quantities";
import { rates as loadRates, type Range, type RateId, type RatesFile } from "./rates";

/**
 * The cost estimate: the measured house times the Boise rates, in the 16
 * categories from the spec, each with a low, likely and high number. Worked
 * out from the project every time and never saved, so it can't go stale.
 * Land is always $0.
 */

export const CATEGORIES = [
  { id: "site", label: "Site work and excavation" },
  { id: "foundation", label: "Foundation" },
  { id: "framing", label: "Framing" },
  { id: "roofing", label: "Roofing" },
  { id: "windows-doors", label: "Windows and doors" },
  { id: "exterior", label: "Exterior finishes" },
  { id: "insulation-drywall", label: "Insulation and drywall" },
  { id: "plumbing", label: "Plumbing" },
  { id: "electrical", label: "Electrical" },
  { id: "hvac", label: "Heating and cooling" },
  { id: "interior", label: "Interior finishes" },
  { id: "cabinets", label: "Cabinets and counters" },
  { id: "fixtures", label: "Fixtures and appliances" },
  { id: "permits", label: "Permits and fees" },
  { id: "overhead", label: "Builder overhead and profit" },
  { id: "contingency", label: "Contingency" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

export type Money = { low: number; likely: number; high: number };

export type CostLine = {
  id: string;
  category: CategoryId;
  label: string;
  /** How much was measured, and in what. */
  qty: number;
  unit: "sqft" | "linft" | "each" | "cuyd" | "percent" | "value";
  /** Per unit, likely. Null for lines worked out another way (permit, percentages, products). */
  material: number | null;
  labor: number | null;
  cost: Money;
  source: string;
  url?: string | null;
  checked?: string;
  note?: string;
  /** A picked product that replaced the allowance on this line. */
  product?: string;
};

export type CostCategory = { id: CategoryId; label: string; cost: Money; lines: CostLine[] };

export type Estimate = {
  source: Quantities["source"];
  quantities: Quantities;
  categories: CostCategory[];
  total: Money;
  /** Likely cost per square foot of heated space. */
  perSqft: Money;
  land: 0;
  drivers: { text: string; amount: number }[];
  utilities: CostSettings["utilities"];
};

const ZERO: Money = { low: 0, likely: 0, high: 0 };
const addMoney = (a: Money, b: Money): Money => ({ low: a.low + b.low, likely: a.likely + b.likely, high: a.high + b.high });
const sumMoney = (ms: Money[]) => ms.reduce(addMoney, ZERO);
const times = (r: Range, k: number): Money => ({ low: r[0] * k, likely: r[1] * k, high: r[2] * k });

/** A product category (from milestones 9 and 10) and the line whose allowance it replaces. */
export const ALLOWANCE_FOR: Record<string, RateId> = {
  flooring: "flooring",
  tile: "tile",
  paint: "interior-paint",
  trim: "trim-millwork",
  cabinets: "kitchen-cabinets",
  counters: "countertops",
  vanities: "vanity",
  toilets: "toilet",
  "bath-faucets": "bath-sink-faucet",
  showers: "shower-tub",
  "kitchen-faucets": "kitchen-sink-faucet",
  appliances: "appliance-package",
  windows: "window",
  "entry-doors": "entry-door",
  "interior-doors": "interior-door",
  "garage-doors": "garage-door",
  siding: "siding",
  roofing: "roof-shingle",
  gutters: "gutters",
};

/** Boise's building permit fee for a building value. */
export function permitFee(value: number, permit: RatesFile["permit"]): number {
  const b = permit.brackets.find((x) => x.upTo === null || value <= x.upTo) ?? permit.brackets[permit.brackets.length - 1];
  return b.base + (Math.max(0, value - b.over) / 1000) * b.per1000;
}

export function estimate(
  p: Pick<Project, "levels" | "plot" | "sketch" | "bubbles" | "floorPlans" | "house3d" | "plan" | "discovery" | "brief" | "cost" | "interior" | "exterior">,
  file: RatesFile = loadRates(),
): Estimate | null {
  const q = measureHouse(p);
  if (!q) return null;
  const utilities = p.cost.utilities;
  const lines: CostLine[] = [];

  const line = (category: CategoryId, id: RateId, qty: number, label?: string, note?: string) => {
    if (!(qty > 0.01)) return;
    const r = file.rates[id];
    lines.push({
      id,
      category,
      label: label ?? r.label,
      qty,
      unit: r.unit,
      material: r.material[1],
      labor: r.labor[1],
      cost: addMoney(times(r.material, qty), times(r.labor, qty)),
      source: r.source,
      url: r.url,
      checked: r.checked,
      note: note ?? r.note,
    });
  };

  // Site work
  line("site", "site-prep", 1);
  line("site", "excavation", q.excavationCuyd);
  line("site", "backfill-grade", q.groundSqft);
  line("site", "driveway", q.driveSqft);
  if (q.drainage === "some") line("site", "drainage-some", 1);
  if (q.drainage === "major") line("site", "drainage-major", 1);
  line("site", "retaining-wall", q.retainingWallSqft);
  line("site", "utility-trench", q.trenchLf);

  // Foundation
  line("foundation", "slab", q.slabSqft);
  line("foundation", "slab", q.basementSlabSqft, "Basement floor slab");
  line("foundation", "garage-slab", q.garageSlabSqft);
  line("foundation", "garage-slab", q.porchSqft, "Porch and patio slabs");
  line("foundation", "footing", q.footingLf);
  line("foundation", "stem-wall", q.stemWallSqft);
  line("foundation", "basement-wall", q.basementWallSqft);
  line("foundation", "waterproofing", q.waterproofSqft);

  // Framing
  line("framing", "floor-framing", q.floorFramingSqft);
  line("framing", "ext-wall-framing", q.extWallSqft + q.gableSqft);
  line("framing", "int-wall-framing", q.intWallLf);
  line("framing", "roof-framing", q.roofSqft);
  line("framing", "stairs", q.stairs);
  line("framing", "deck", q.deckSqft);

  // Roofing
  line("roofing", "roof-shingle", q.roofSqft - q.flatRoofSqft);
  line("roofing", "roof-flat", q.flatRoofSqft);
  line("roofing", "roof-hip-valley", q.hipValleyLf);
  line("roofing", "gutters", q.gutterLf);

  // Windows and doors
  line("windows-doors", "window", q.windowSqft, `Windows (${q.windows || Math.round(q.windowSqft / 15)})`);
  line("windows-doors", "patio-door", q.patioDoors);
  line("windows-doors", "entry-door", q.entryDoors);
  line("windows-doors", "interior-door", q.interiorDoors);
  line("windows-doors", "pocket-door", q.pocketDoors);
  line("windows-doors", "barn-door", q.barnDoors);
  line("windows-doors", "garage-door", q.garageDoorLf);

  // Exterior
  line("exterior", "siding", q.extWallSqft + q.gableSqft);
  line("exterior", "ext-trim", q.eaveLf);

  // Insulation and drywall
  line("insulation-drywall", "wall-insulation", q.extWallSqft + q.basementWallSqft * 0.5);
  line("insulation-drywall", "attic-insulation", q.atticSqft);
  line("insulation-drywall", "drywall", q.drywallSqft);

  // Plumbing
  line("plumbing", "plumbing-fixture-rough", q.plumbingFixtures);
  line("plumbing", "water-heater", q.waterHeaters);
  if (q.plumbingFixtures > 0) line("plumbing", "water-service", 1);

  // Electrical and HVAC
  line("electrical", "electrical", q.livingSqft + q.garageSqft * 0.5);
  line("electrical", "electrical-service", 1);
  line("hvac", "hvac", q.livingSqft);

  // Interior finishes (mid-range allowances until products are picked)
  line("interior", "flooring", Math.max(0, q.livingSqft - q.tileSqft * 0.5));
  line("interior", "tile", q.tileSqft);
  line("interior", "interior-paint", q.livingSqft);
  line("interior", "trim-millwork", q.livingSqft);

  // Cabinets and counters
  line("cabinets", "kitchen-cabinets", q.cabinetLf);
  line("cabinets", "countertops", q.counterSqft);
  line("cabinets", "vanity", q.vanities);

  // Fixtures and appliances
  line("fixtures", "toilet", q.toilets);
  line("fixtures", "bath-sink-faucet", q.bathSinks);
  line("fixtures", "shower-tub", q.showers);
  line("fixtures", "kitchen-sink-faucet", q.kitchenSinks);
  line("fixtures", "appliance-package", q.kitchens);
  line("fixtures", "laundry-hookup", q.laundries);

  applySelections(lines, [...p.interior.selections, ...p.exterior.selections]);

  // Permits and fees
  const permit = file.permit;
  const value =
    q.livingSqft * permit.valuationPerSqft.living + q.garageSqft * permit.valuationPerSqft.garage + (q.porchSqft + q.deckSqft) * permit.valuationPerSqft.porch;
  const fee = permitFee(value, permit);
  lines.push({
    id: "building-permit",
    category: "permits",
    label: "Building permit",
    qty: value,
    unit: "value",
    material: null,
    labor: null,
    cost: { low: fee, likely: fee, high: fee },
    source: permit.source,
    url: permit.url,
    checked: permit.checked,
    note: permit.note ?? `Based on a building value of $${Math.round(value).toLocaleString("en-US")}.`,
  });
  const review = file.percents["plan-review"];
  lines.push({
    id: "plan-review",
    category: "permits",
    label: review.label,
    qty: review.value[1],
    unit: "percent",
    material: null,
    labor: null,
    cost: times(review.value, fee / 100),
    source: review.source,
    url: review.url,
    checked: review.checked,
    note: review.note,
  });
  line("permits", "impact-fees", 1);
  line("permits", "trade-permits", 1);
  if (utilities === "city") {
    line("permits", "water-connection", 1);
    line("permits", "sewer-connection", 1);
  } else {
    line("site", "well", 1);
    line("site", "septic", 1);
  }

  // Builder overhead and profit on the construction, then contingency on everything.
  const hard = sumMoney(lines.filter((l) => l.category !== "permits").map((l) => l.cost));
  const op = file.percents["overhead-profit"];
  const opCost: Money = { low: (hard.low * op.value[0]) / 100, likely: (hard.likely * op.value[1]) / 100, high: (hard.high * op.value[2]) / 100 };
  lines.push({ id: "overhead-profit", category: "overhead", label: op.label, qty: op.value[1], unit: "percent", material: null, labor: null, cost: opCost, source: op.source, url: op.url, checked: op.checked, note: op.note });
  const before = sumMoney(lines.map((l) => l.cost));
  const ct = file.percents["contingency"];
  const ctCost: Money = { low: (before.low * ct.value[0]) / 100, likely: (before.likely * ct.value[1]) / 100, high: (before.high * ct.value[2]) / 100 };
  lines.push({ id: "contingency", category: "contingency", label: ct.label, qty: ct.value[1], unit: "percent", material: null, labor: null, cost: ctCost, source: ct.source, url: ct.url, checked: ct.checked, note: ct.note });

  const categories: CostCategory[] = CATEGORIES.map((c) => {
    const ls = lines.filter((l) => l.category === c.id);
    return { id: c.id, label: c.label, lines: ls, cost: sumMoney(ls.map((l) => l.cost)) };
  });
  const total = spread(lines.map((l) => l.cost));
  const area = Math.max(1, q.livingSqft);
  const perSqft = { low: total.low / area, likely: total.likely / area, high: total.high / area };
  return { source: q.source, quantities: q, categories, total, perSqft, land: 0, drivers: drivers(q, lines, file, utilities), utilities };
}

/**
 * The total's low and high. Adding up every line's low (or high) would
 * assume every price lands at its extreme at once, which doesn't happen; a
 * fully independent mix would understate it, since prices tend to move
 * together. This is halfway between the two.
 */
export function spread(costs: Money[]): Money {
  const likely = costs.reduce((s, c) => s + c.likely, 0);
  const sumDown = costs.reduce((s, c) => s + (c.likely - c.low), 0);
  const sumUp = costs.reduce((s, c) => s + (c.high - c.likely), 0);
  const rssDown = Math.sqrt(costs.reduce((s, c) => s + (c.likely - c.low) ** 2, 0));
  const rssUp = Math.sqrt(costs.reduce((s, c) => s + (c.high - c.likely) ** 2, 0));
  return { low: likely - (sumDown + rssDown) / 2, likely, high: likely + (sumUp + rssUp) / 2 };
}

/** Picked products replace the allowance on their line: the product's price times the line's amount (or the picked quantity). */
export function applySelections(lines: CostLine[], selections: Selection[]) {
  for (const s of selections) {
    const id = ALLOWANCE_FOR[s.category];
    const l = id && lines.find((x) => x.id === id);
    if (!l || s.product.price === undefined) continue;
    const qty = s.quantity ?? l.qty;
    const material = s.product.price * qty;
    const labor = (l.labor ?? 0) * qty;
    const c = material + labor;
    l.cost = { low: c * 0.95, likely: c, high: c * 1.1 };
    l.material = s.product.price;
    l.product = `${s.product.brand} ${s.product.name}`;
    l.qty = qty;
  }
}

const money = (n: number) => `$${Math.round(n / 1000).toLocaleString("en-US")}k`;

/** The few things adding the most cost beyond a plain house, in plain words. */
function drivers(q: Quantities, lines: CostLine[], file: RatesFile, utilities: CostSettings["utilities"]): { text: string; amount: number }[] {
  const likely = (ids: string[]) => lines.filter((l) => ids.includes(l.id)).reduce((s, l) => s + l.cost.likely, 0);
  const out: { text: string; amount: number }[] = [];
  if (q.basementWallSqft > 0) {
    const a = likely(["basement-wall", "waterproofing", "excavation"]);
    out.push({ text: `Basement walls, digging and waterproofing: about ${money(a)}`, amount: a });
  }
  if (q.slopePercent >= 3 && q.stemWallSqft > 0) {
    const r = file.rates["stem-wall"];
    const footLf = q.footingLf;
    // Compared to the short stem walls on flat ground (about 2.5 ft).
    const extra = Math.max(0, q.stemWallSqft - footLf * 2.5) * (r.material[1] + r.labor[1]);
    if (extra > 2000) out.push({ text: `Taller foundation walls for the ${Math.round(q.slopePercent)}% slope: about ${money(extra)}`, amount: extra });
  }
  const ret = likely(["retaining-wall"]);
  if (ret) out.push({ text: `Retaining walls for steep ground: about ${money(ret)}`, amount: ret });
  const drain = likely(["drainage-some", "drainage-major"]);
  if (drain) out.push({ text: `${q.drainage === "major" ? "Poor" : "Fair"} drainage: drains and grading add about ${money(drain)}`, amount: drain });
  const hv = likely(["roof-hip-valley"]);
  if (hv > 1500) out.push({ text: `Roof hips and valleys: about ${money(hv)}`, amount: hv });
  if (utilities === "well-septic") {
    const a = likely(["well", "septic"]);
    out.push({ text: `Well and septic system: about ${money(a)}`, amount: a });
  }
  const glass = likely(["window", "patio-door"]);
  if (q.livingSqft > 0 && q.windowSqft / q.livingSqft > 0.18) out.push({ text: `Lots of glass (${Math.round(q.windowSqft)} sq ft of windows): about ${money(glass)}`, amount: glass });
  return out.sort((a, b) => b.amount - a.amount).slice(0, 4);
}

/** "$585k", "$1.2M". */
export function shortMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2).replace(/0$/, "")}M`;
  if (n >= 1000) return `$${Math.round(n / 1000).toLocaleString("en-US")}k`;
  return `$${Math.round(n)}`;
}

/** "$12,340". */
export function fullMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
