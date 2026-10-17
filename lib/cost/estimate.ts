import { WHOLE_HOUSE, type CostSettings, type DesignChoices, type Project, type Selection } from "@/lib/model/schema";
import { interiorCategory } from "@/lib/catalog/categories";
import { exteriorCategory, paintable, rateFor } from "@/lib/catalog/exterior";
import { ACCENT_BAND_FT, accentPlaceFor } from "@/lib/exterior/picks";
import { productTitle } from "@/lib/interior/picks";
import { measureHouse, type Quantities } from "./quantities";
import { rates as loadRates, type Range, type RateId, type RatesFile } from "./rates";
import { flatProject } from "@/lib/plan/flatten";

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
  { id: "builtins", label: "Built-ins and extras" },
  { id: "hookups", label: "Extra hookups" },
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
  /** The rate it's priced at, for lines from the rates file. */
  rate?: RateId;
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

/**
 * Sq ft of wall the accent siding covers: a band along the base of the
 * ground floor's walls (less doors), or the gable ends. At most half the siding.
 */
export function accentArea(ext: Pick<DesignChoices, "selections" | "accentPlace">, q: Quantities): number {
  const pick = ext.selections.find((s) => s.targetId === WHOLE_HOUSE && s.category === "accent");
  if (!pick) return 0;
  const place = accentPlaceFor(ext, q.gableSqft > 0);
  const area = place === "gables" ? q.gableSqft : q.baseWallLf * ACCENT_BAND_FT * 0.9;
  return Math.min(area, (q.extWallSqft + q.gableSqft) * 0.5);
}

/** Boise's building permit fee for a building value. */
export function permitFee(value: number, permit: RatesFile["permit"]): number {
  const b = permit.brackets.find((x) => x.upTo === null || value <= x.upTo) ?? permit.brackets[permit.brackets.length - 1];
  return b.base + (Math.max(0, value - b.over) / 1000) * b.per1000;
}

export function estimate(
  p: Pick<Project, "levels" | "plot" | "sketch" | "bubbles" | "floorPlans" | "house3d" | "plan" | "discovery" | "brief" | "cost" | "interior" | "exterior">,
  file: RatesFile = loadRates(),
): Estimate | null {
  p = flatProject(p);
  const q = measureHouse(p);
  if (!q) return null;
  const utilities = p.cost.utilities;
  const lines: CostLine[] = [];

  const line = (category: CategoryId, id: RateId, qty: number, label?: string, note?: string, lineId?: string) => {
    if (!(qty > 0.01)) return;
    const r = file.rates[id];
    lines.push({
      id: lineId ?? id,
      rate: id,
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
  line("site", "rock-removal", q.rockCuyd);
  line("site", "utility-trench", q.trenchLf);
  line("site", "front-walk", q.walkSqft);
  line("site", "lawn", q.lawnSqft);
  line("site", "planting-beds", q.bedSqft);
  line("site", "shrub", q.shrubs, undefined, undefined, "shrubs");
  line("site", "tree", q.trees, undefined, undefined, "trees");

  // Foundation
  line("foundation", "slab", q.slabSqft);
  line("foundation", "slab", q.basementSlabSqft, "Basement floor slab");
  line("foundation", "garage-slab", q.garageSlabSqft);
  line("foundation", "garage-slab", q.porchSqft - q.patioSqft, "Porch slabs");
  line("foundation", "garage-slab", q.patioSqft, "Patio (concrete)", undefined, "patio");
  line("foundation", "footing", q.footingLf);
  line("foundation", "stem-wall", q.stemWallSqft);
  line("foundation", "basement-wall", q.basementWallSqft);
  line("foundation", "waterproofing", q.waterproofSqft);
  line("foundation", "window-well", q.windowWells, "Window wells with ladders, outside basement escape windows");

  // Framing
  line("framing", "floor-framing", q.floorFramingSqft);
  line("framing", "ext-wall-framing", q.extWallSqft + q.gableSqft);
  line("framing", "int-wall-framing", q.intWallLf);
  line("framing", "curved-wall-framing", q.curvedWallLf, "Curved walls: extra framing");
  line("framing", "roof-framing", q.roofSqft);
  line("framing", "stairs", q.stairs);
  line("framing", "stair-guard-wood", q.stairGuardWoodLf, "Stair railings: wood with white balusters");
  line("framing", "stair-guard-metal", q.stairGuardMetalLf, "Stair railings: black metal");
  line("framing", "stair-guard-glass", q.stairGuardGlassLf, "Stair railings: glass");
  line("framing", "stair-half-wall", q.stairHalfWallLf, "Stair half and full walls");
  line("framing", "deck", q.deckSqft);
  line("framing", "overhang-post", q.overhangPosts);
  line("framing", "overhang-beam", q.overhangBeamLf);

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

  // Exterior: siding, with an accent (stone, brick or wood) taking its part of the walls when one is picked.
  const accent = accentArea(p.exterior, q);
  line("exterior", "siding", q.extWallSqft + q.gableSqft - accent);
  line("exterior", "siding", accent, "Accent siding", undefined, "accent");
  line("exterior", "ext-trim", q.eaveLf);

  // Insulation and drywall
  line("insulation-drywall", "wall-insulation", q.extWallSqft + q.basementWallSqft * 0.5);
  line("insulation-drywall", "attic-insulation", q.atticSqft);
  line("insulation-drywall", "drywall", q.drywallSqft);
  line("insulation-drywall", "curved-wall-drywall", q.curvedWallLf, "Curved walls: extra drywall");

  // Plumbing
  line("plumbing", "plumbing-fixture-rough", q.plumbingFixtures);
  line("plumbing", "water-heater", q.waterHeaters);
  if (q.plumbingFixtures > 0) line("plumbing", "water-service", 1);

  // Electrical and HVAC
  line("electrical", "electrical", q.livingSqft + q.garageSqft * 0.5);
  line("electrical", "electrical-service", 1);
  line("electrical", "lighting-fixtures", q.lightFixtures);
  line("electrical", "exterior-lights", q.extLights);
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
  line("cabinets", "cabinet-hardware", q.cabinetHardware);
  line("cabinets", "tall-cabinet", q.tallCabinets);
  line("cabinets", "cabinet-specialty", q.specialtyCabinets);

  // Fixtures and appliances
  line("fixtures", "toilet", q.toilets);
  line("fixtures", "bath-sink-faucet", q.bathSinks);
  line("fixtures", "shower-tub", q.showers);
  line("fixtures", "kitchen-sink-faucet", q.kitchenSinks);
  line("fixtures", "appliance-package", q.kitchens);
  line("fixtures", "laundry-hookup", q.laundries);

  // Built-ins and extras placed in Furnish, and hookups placed by hand beyond what fixtures and the code rules bring. Furniture stays unpriced.
  const fx = q.furnish;
  line("builtins", "built-in-cabinetry", fx.builtInLf);
  line("builtins", "wall-shelving", fx.wallShelfLf);
  line("builtins", "ceiling-fan", fx.ceilingFans);
  line("builtins", "bath-accessory", fx.accessories);
  line("builtins", "fireplace", fx.fireplaces);
  line("hookups", "extra-water-run", fx.extraWaterRuns);
  line("hookups", "extra-drain-run", fx.extraDrainRuns);
  line("hookups", "gas-line-run", fx.gasRuns);
  line("hookups", "circuit-240", fx.circuits240);
  line("hookups", "dryer-vent-run", fx.dryerVents);
  line("hookups", "extra-device", fx.extraDevices);

  applySelections(lines, p.interior.selections, q, file);
  applyExterior(lines, p.exterior.selections, file);

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

  // The Furnish categories only show up once something is placed for them.
  const categories: CostCategory[] = CATEGORIES.filter((c) => (c.id !== "builtins" && c.id !== "hookups") || lines.some((l) => l.category === c.id)).map((c) => {
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

/**
 * Picked products replace the mid-range allowance on their line. Interior
 * picks work room by room: each room uses its own pick, or the whole-house
 * pick, or the allowance, for its share of the line. A pick that is only
 * part of a line (a faucet in "kitchen sink + faucet") replaces that part of
 * the allowance. Labor stays at the line's rate.
 */
export function applySelections(lines: CostLine[], selections: Selection[], q?: Quantities, file: RatesFile = loadRates()) {
  const byLine = new Map<string, Selection[]>();
  for (const s of selections) {
    if (s.product.price === undefined) continue;
    const lineId = interiorCategory(s.category)?.line;
    if (!lineId) continue;
    byLine.set(lineId, [...(byLine.get(lineId) ?? []), s]);
  }
  for (const [lineId, picks] of byLine) {
    const l = lines.find((x) => x.id === lineId);
    if (!l) continue;
    const r = file.rates[lineId as RateId];
    // Each room's part of the line, scaled so the parts add up to the line's amount.
    const parts = (q?.rooms ?? []).map((room) => ({ id: room.id, amount: room.amounts[lineId as RateId] ?? 0 })).filter((x) => x.amount > 0);
    const roomWalls = new Map((q?.rooms ?? []).map((room) => [room.id, room.walls]));
    const sum = parts.reduce((s, x) => s + x.amount, 0);
    const shares = sum > 0 ? parts.map((x) => ({ id: x.id, amount: (x.amount * l.qty) / sum })) : [{ id: WHOLE_HOUSE, amount: l.qty }];

    let cost: Money = ZERO;
    let pickedAmount = 0;
    const used = new Set<string>();
    for (const part of shares) {
      // The picks that apply here, one per category: the room's own, or the whole house's.
      const cats = new Map<string, Selection>();
      for (const s of picks) if (s.targetId === WHOLE_HOUSE && !s.wall && !cats.has(s.category)) cats.set(s.category, s);
      for (const s of picks) if (s.targetId === part.id && !s.wall) cats.set(s.category, s);
      // Accent walls take their wall's share of the room's paint; the room's own paint covers the rest.
      const walls = roomWalls.get(part.id);
      const accents = picks.filter((s) => s.targetId === part.id && s.wall && walls?.[s.wall]);
      const accentShare = Math.min(1, accents.reduce((t, s) => t + walls![s.wall!], 0));
      let replaced = 0;
      let productCost = 0;
      const price = (s: Selection, cover: number) => {
        const c = interiorCategory(s.category);
        replaced += (c?.share ?? 1) * cover;
        productCost += s.product.price! * (c?.perUnit ?? 1) * part.amount * cover;
        used.add(productTitle(s.product));
      };
      for (const s of cats.values()) price(s, s.category === "paint" ? 1 - accentShare : 1);
      for (const s of accents) price(s, walls![s.wall!]);
      replaced = Math.min(1, replaced);
      if (cats.size || accents.length) pickedAmount += part.amount;
      const allowance = r ? addMoney(times(r.material, part.amount * (1 - replaced)), times(r.labor, part.amount)) : ZERO;
      const product: Money = { low: productCost * 0.95, likely: productCost, high: productCost * 1.1 };
      cost = addMoney(cost, addMoney(allowance, product));
    }
    if (!used.size) continue;
    l.cost = cost;
    l.qty = shares.reduce((s, x) => s + x.amount, 0);
    const names = [...used];
    const everywhere = pickedAmount >= l.qty - 0.01;
    // A pick that's only part of the line (a fridge in the appliance package) names the line too.
    const partial = picks.every((x) => (interiorCategory(x.category)?.share ?? 1) < 1);
    const what = names.length === 1 ? names[0] : `${names.length} picks`;
    l.product = partial ? `${l.label} with ${what}` : what;
    if (!everywhere) l.product += ", mid-range elsewhere";
    // The per-unit material shown is what it averages out to.
    l.material = l.qty > 0 ? Math.max(0, cost.likely / l.qty - (l.labor ?? 0)) : l.material;
    l.note = `Picked: ${names.join(", ")}.${everywhere ? "" : " Rooms without a pick use the mid-range allowance."} ${l.note ?? ""}`.trim();
  }
}

/**
 * Exterior picks replace the mid-range allowance on their line for the whole
 * house. Some change what it costs to put up too (a metal roof, brick,
 * pavers): the line then uses that kind's rate for labor and for the parts
 * the product doesn't cover. Siding paint only counts on paintable siding.
 */
export function applyExterior(lines: CostLine[], selections: Selection[], file: RatesFile = loadRates()) {
  const picks = selections.filter((s) => s.targetId === WHOLE_HOUSE && exteriorCategory(s.category));
  const siding = picks.find((s) => s.category === "siding");
  const byLine = new Map<string, Selection[]>();
  for (const s of picks) {
    if (s.category === "siding-paint" && !paintable(siding?.product.kind)) continue;
    const c = exteriorCategory(s.category)!;
    byLine.set(c.line, [...(byLine.get(c.line) ?? []), s]);
  }
  for (const [lineId, ps] of byLine) {
    const l = lines.find((x) => x.id === lineId);
    if (!l) continue;
    // The rate: the first pick whose kind has its own, else the line's.
    let rateId = l.rate;
    for (const s of ps) {
      const c = exteriorCategory(s.category)!;
      const k = rateFor(c, s.product.kind);
      if (k !== c.rate) {
        rateId = k;
        break;
      }
    }
    const r = rateId ? file.rates[rateId] : undefined;
    if (!r) continue;
    let replaced = 0;
    let productCost = 0;
    const names: string[] = [];
    for (const s of ps) {
      if (s.product.price === undefined) continue;
      const c = exteriorCategory(s.category)!;
      replaced += c.share;
      productCost += s.product.price * c.perUnit * l.qty;
      names.push(productTitle(s.product));
    }
    replaced = Math.min(1, replaced);
    const allowance = addMoney(times(r.material, l.qty * (1 - replaced)), times(r.labor, l.qty));
    l.cost = addMoney(allowance, { low: productCost * 0.95, likely: productCost, high: productCost * 1.1 });
    l.labor = r.labor[1];
    l.material = l.qty > 0 ? Math.max(0, l.cost.likely / l.qty - r.labor[1]) : l.material;
    if (rateId !== l.rate) {
      l.label = lineId === "accent" ? `Accent: ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}` : r.label;
      l.rate = rateId;
      l.source = r.source;
      l.url = r.url;
      l.checked = r.checked;
    }
    if (names.length) {
      l.product = names.length === 1 ? names[0] : `${names.length} picks`;
      l.note = `Picked: ${names.join(", ")}. ${r.note ?? ""}`.trim();
    } else l.note = r.note;
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
