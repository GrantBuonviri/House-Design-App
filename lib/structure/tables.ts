import type { HouseStructure } from "@/lib/model/schema";
import { codeEntry, codeNum } from "@/lib/codes/data";

/**
 * Lookups in the IRC's ready-made (prescriptive) structural tables, kept in
 * boise-2018.json as the tables print them. A size the tables don't cover
 * comes back as null, and the caller marks it "Engineer required".
 */

/** "15-7" (15 ft 7 in) to inches. */
export function ftIn(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const m = /^(\d+)-(\d+)$/.exec(String(text).trim());
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

type Table<T> = Record<string, T>;
const table = <T>(key: string) => codeEntry(key).value as unknown as Table<T>;

// ---------- Floor joists ----------

export type JoistSize = "2x8" | "2x10" | "2x12";
export type JoistSpacing = 12 | 16 | 19.2 | 24;
export type JoistPick = { size: JoistSize; spacing: JoistSpacing; allowIn: number };

/** Joist depth, inches. */
export const JOIST_DEPTH: Record<JoistSize, number> = { "2x8": 7.25, "2x10": 9.25, "2x12": 11.25 };

/** What the app tries, cheapest first. */
export const JOIST_OPTIONS: [JoistSize, JoistSpacing][] = [
  ["2x8", 16],
  ["2x10", 16],
  ["2x12", 16],
  ["2x10", 12],
  ["2x12", 12],
];

export const LUMBER_NAME: Record<HouseStructure["lumber"], string> = { "df-l": "Douglas fir-larch #2", "hem-fir": "Hem-fir #2" };

export function joistAllowIn(lumber: HouseStructure["lumber"], size: JoistSize, spacing: JoistSpacing): number | null {
  return ftIn(table<Table<Table<string>>>("struct.joistSpans40")[LUMBER_NAME[lumber]]?.[size]?.[String(spacing)]);
}

/** The cheapest joist that spans `spanIn`, or null. `only16` keeps to 16" spacing. */
export function pickJoist(lumber: HouseStructure["lumber"], spanIn: number, only16 = false): JoistPick | null {
  for (const [size, spacing] of JOIST_OPTIONS) {
    if (only16 && spacing !== 16) continue;
    const allowIn = joistAllowIn(lumber, size, spacing);
    if (allowIn !== null && allowIn >= spanIn) return { size, spacing, allowIn };
  }
  return null;
}

// ---------- Headers and girders ----------

export type HeaderTable = "exterior" | "interior";
export type HeaderPick = { size: string; spanIn: number; jacks: number; widthFt: number };

/** Building width columns in the header tables, feet. */
const WIDTHS = [12, 24, 36];

/** The rows of one header table column: every size with its span and jack studs, in the table's order. */
export function headerRows(kind: HeaderTable, condition: string, widthIn: number): HeaderPick[] | null {
  const widthFt = WIDTHS.find((w) => w * 12 >= widthIn - 0.5);
  if (!widthFt) return null;
  const t = table<Table<Table<{ span: string | null; jacks: number | null }>>>(kind === "exterior" ? "struct.headersExterior" : "struct.headersInterior")[condition];
  if (!t) return null;
  const out: HeaderPick[] = [];
  for (const [size, cols] of Object.entries(t)) {
    const c = cols[String(widthFt)];
    const spanIn = ftIn(c?.span);
    if (spanIn !== null && c?.jacks) out.push({ size, spanIn, jacks: c.jacks, widthFt });
  }
  return out;
}

/** Plies times depth, for picking the lightest header that works: "2-2x10" is 2 x 9.25. */
function headerBulk(size: string): number {
  const m = /^(\d)-2x(\d+)$/.exec(size);
  if (!m) return Infinity;
  const depth = { 4: 3.5, 6: 5.5, 8: 7.25, 10: 9.25, 12: 11.25 }[Number(m[2])] ?? 99;
  return Number(m[1]) * depth + depth / 100;
}

/** The lightest header for an opening, or null when the tables don't reach. */
export function pickHeader(kind: HeaderTable, condition: string, widthIn: number, openingIn: number): HeaderPick | null {
  const rows = headerRows(kind, condition, widthIn);
  if (!rows) return null;
  return rows.filter((r) => r.spanIn >= openingIn).sort((a, b) => headerBulk(a.size) - headerBulk(b.size))[0] ?? null;
}

/** King studs at each end of a header (Table R602.7.5). */
export function kingStuds(openingIn: number): number {
  const t = table<number>("struct.headerKingStuds");
  const rows = Object.entries(t)
    .map(([ft, n]) => [Number(ft), n] as const)
    .sort((a, b) => a[0] - b[0]);
  const hit = rows.find(([ft]) => ft * 12 >= openingIn - 0.5);
  return hit ? hit[1] : rows[rows.length - 1][1];
}

// ---------- Footings ----------

export type FoundationKind = "slab" | "crawl" | "basement";
export type FootingSize = { widthIn: number; thicknessIn: number };

export function footingSize(soilPsf: number, stories: number, kind: FoundationKind): FootingSize | null {
  const t = table<Table<Table<{ width: number; thickness: number }>>>("struct.footingsLightFrame");
  const c = t[String(soilPsf)]?.[String(Math.max(1, stories))]?.[kind];
  if (!c) return null;
  return { widthIn: Math.max(c.width, codeNum("struct.footingMinWidth")), thicknessIn: Math.max(c.thickness, codeNum("struct.footingMinThickness")) };
}

// ---------- Wall bracing ----------

export type StoryLocation = "one-story-or-top" | "first-of-two" | "first-of-three";
export type BracingMethod = "WSP" | "CS-WSP";

const bucketUp = (keys: string[], v: number): string | null => {
  const sorted = keys.map(Number).sort((a, b) => a - b);
  const hit = sorted.find((k) => k >= v - 1e-6);
  return hit === undefined ? null : String(hit);
};

/** Feet of bracing a braced wall line needs, before adjustments (Table R602.10.3(1)), or null past the table. */
export function bracingBase(location: StoryLocation, spacingFt: number, method: BracingMethod): number | null {
  const t = table<Table<Record<string, number | null>>>("struct.bracingWind")[location];
  if (!t) return null;
  const k = bucketUp(Object.keys(t), Math.max(spacingFt, 10));
  return k ? (t[k][method] ?? null) : null;
}

export type BracingFactors = { exposure: number; eaveToRidge: number; wallHeight: number; lines: number; total: number };

/** Adjustment factors from Table R602.10.3(2). `above` is the stories on top of this one (0 = roof only). */
export function bracingFactors(o: { exposure: "B" | "C"; stories: number; above: number; eaveToRidgeFt: number; wallHeightFt: number; lines: number }): BracingFactors | null {
  const t = codeEntry("struct.bracingAdjust").value as unknown as {
    exposure: Table<Table<number>>;
    eaveToRidge: Table<Record<string, number | null>>;
    wallHeight: Table<number>;
    bracedWallLines: Table<number>;
  };
  const exposure = t.exposure[o.exposure]?.[String(Math.min(3, Math.max(1, o.stories)))];
  const eKey = bucketUp(Object.keys(t.eaveToRidge), Math.max(5, o.eaveToRidgeFt));
  const eaveToRidge = eKey ? t.eaveToRidge[eKey][o.above === 0 ? "roofOnly" : o.above === 1 ? "roofPlusFloor" : "roofPlus2Floors"] : null;
  const hKey = bucketUp(Object.keys(t.wallHeight), Math.max(8, o.wallHeightFt));
  const wallHeight = hKey ? t.wallHeight[hKey] : null;
  const lKey = String(Math.min(5, Math.max(2, o.lines)));
  const lines = t.bracedWallLines[lKey];
  if (!exposure || !eaveToRidge || !wallHeight || !lines) return null;
  return { exposure, eaveToRidge, wallHeight, lines, total: exposure * eaveToRidge * wallHeight * lines };
}

/** Shortest continuously sheathed panel next to an opening of `openingIn` clear height, on a wall `wallFt` tall (Table R602.10.5), or null. */
export function csPanelMin(openingIn: number, wallFt: number): number | null {
  const t = (codeEntry("struct.panelMinLength").value as unknown as { "CS-WSP": Table<Record<string, number | null>> })["CS-WSP"];
  const keys = Object.keys(t);
  const k = bucketUp(keys, openingIn) ?? null;
  // Openings shorter than the first row use the first row; the table needs the wall height column.
  const row = t[k ?? (openingIn < Math.min(...keys.map(Number)) ? String(Math.min(...keys.map(Number))) : "")];
  if (!row) return null;
  const h = bucketUp(Object.keys(row), Math.max(8, wallFt));
  return h ? (row[h] ?? null) : null;
}

/** Shortest intermittent wood structural panel (Table R602.10.5). */
export function wspPanelMin(wallFt: number): number | null {
  const t = (codeEntry("struct.panelMinLength").value as unknown as { WSP: Table<number> }).WSP;
  const h = bucketUp(Object.keys(t), Math.max(8, wallFt));
  return h ? t[h] : null;
}

/** Portal frame panel width beside a garage door: one story, or one story plus a floor above. */
export function portalMin(storiesAbove: number): number {
  const t = (codeEntry("struct.panelMinLength").value as unknown as { PFH: { oneStory: number; twoStory: number } }).PFH;
  return storiesAbove > 0 ? t.twoStory : t.oneStory;
}
