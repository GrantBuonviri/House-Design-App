import base from "./data/irc-2021.json";
import zones from "./data/iecc-2021-zones.json";
import { CITY_OVERLAYS, STATE_OVERLAYS, type CodeOverlay } from "./data/local";
import type { Location } from "@/lib/model/schema";
import { DEFAULT_PLACE } from "@/lib/location/current";

/**
 * The building-code numbers the plan checks use, for a new house at the
 * project's place. The active set is built from layers, later ones winning:
 *
 * 1. base: data/irc-2021.json, the 2021 IRC (with its plumbing chapters),
 *    2021 IECC and 2023 NEC, with no state changes;
 * 2. zone: data/iecc-2021-zones.json, the energy numbers for the place's climate zone;
 * 3. location: the design criteria (snow, wind, quakes, frost, temperatures) from `project.location`;
 * 4. state: data/local/state-<st>.json, the editions and changes the state adopted;
 * 5. city: data/local/<cityId>.json, city-only changes and the jurisdiction's names.
 *
 * Every entry keeps its code section, where it came from and when it was
 * checked. Only numbers and section references are kept, never the code's
 * own text. `setCodeLocation` picks the place; the project store calls it
 * whenever the open project's place changes, and tests use `withCodeLocation`.
 */

/** A number, a yes/no, short text, or a table as the code prints it (keyed by its rows and columns). */
export type CodeValue = number | string | boolean | string[] | { [key: string]: unknown };

export type CodeLayer = "base" | "zone" | "location" | "state" | "city";

export type CodeEntry = {
  value: CodeValue;
  unit: string;
  /** "IRC 2021", "IECC 2021", "NEC 2023", or "Design criteria" for the place's own numbers. */
  code: string;
  section: string;
  /** The state or city amendment that changed the number, if any. */
  amendment: string | null;
  source: string;
  checked: string;
  note?: string;
  /** The gathered number couldn't be confirmed from a source; not used by any check. */
  unverified?: boolean;
  /** The second, separate check of the number against its source. */
  secondCheck?: { verdict: "agree" | "disagree" | "could-not-confirm"; source?: string | null };
  /** How a disagreement between the two checks was settled. */
  resolved?: string;
  /** Which layer the number came from. */
  layer?: CodeLayer;
};

export type CodeEdition = { code: string; edition: string; amendments?: string; source?: string };

/** One line of the cover sheet's code list. */
export type EditionLine = { label: string; detail: string };

export type CodeSet = {
  meta: { jurisdiction: string; checked: string; editions: CodeEdition[] };
  /** The code editions for the cover sheet and code summary. */
  editions: EditionLine[];
  values: Record<string, CodeEntry>;
  /** The place the set was built for. */
  location: Location;
};

type BaseData = { meta: CodeSet["meta"]; editionLines: EditionLine[]; values: Record<string, CodeEntry> };
type ZoneRow = Record<string, CodeValue>;
type ZoneData = { meta: { source: string; secondSource: string; checked: string; section: string; note?: string }; units: Record<string, string>; sections: Record<string, string>; zones: Record<string, ZoneRow> };

const BASE = base as unknown as BaseData;
const ZONES = zones as unknown as ZoneData;

/**
 * The zone table row for a climate zone: the number, except marine 4 ("4C"),
 * which the IECC tables group with zone 5.
 */
export function zoneRow(climateZone: string): string {
  const z = climateZone.trim().toUpperCase();
  if (z === "4C") return "4C";
  const n = /^\d/.exec(z)?.[0] ?? "5";
  return n;
}

/** The energy numbers for a climate zone (layer 2). */
function zoneLayer(climateZone: string): Record<string, CodeEntry> {
  const key = zoneRow(climateZone);
  const row = ZONES.zones[key] ?? ZONES.zones["5"];
  const out: Record<string, CodeEntry> = {};
  for (const [field, value] of Object.entries(row)) {
    const k = `energy.${field}`;
    const prev = BASE.values[k];
    out[k] = {
      ...(prev ?? {}),
      value,
      unit: ZONES.units[field] || prev?.unit || "",
      code: "IECC 2021",
      section: ZONES.sections[field] ?? ZONES.meta.section,
      amendment: null,
      source: ZONES.meta.source,
      checked: ZONES.meta.checked,
      secondCheck: { verdict: "agree", source: ZONES.meta.secondSource },
      note: `Climate zone ${climateZone}${key === "4C" ? " (marine 4 uses the zone 5 column)" : ""}.`,
      layer: "zone",
    };
  }
  return out;
}

/** Roof snow the app designs for: flat-roof snow (0.7 x ground snow, ASCE 7) but never under the 20 psf roof live load (IRC R301.6). */
export function roofSnowFor(groundSnowPsf: number): number {
  return Math.max(20, Math.ceil((0.7 * groundSnowPsf) / 5) * 5);
}

/** Seismic categories where detached houses use the wind bracing only (IRC R602.10.1 / R301.2.2 exception). */
export const WIND_ONLY_SDC = ["A", "B", "C"];

const EDITED_NOTE = "You changed this number on the place card.";

/** The design criteria from the place (layer 3). */
function locationLayer(loc: Location): Record<string, CodeEntry> {
  const edited = new Set(loc.edited);
  const source = `Place card: ${loc.name}, ${loc.state}`;
  const entry = (key: string, value: CodeValue, unit: string, section: string, field?: string, note?: string): [string, CodeEntry] => [
    key,
    {
      value,
      unit,
      code: "Design criteria",
      section,
      amendment: null,
      source,
      checked: BASE.meta.checked,
      ...(field && edited.has(field as Location["edited"][number]) ? { note: EDITED_NOTE } : note ? { note } : {}),
      secondCheck: { verdict: "agree", source },
      layer: "location",
    },
  ];
  return Object.fromEntries([
    entry("design.groundSnowLoad", loc.groundSnowPsf, "psf", "Table R301.2(1)", "groundSnowPsf"),
    entry("design.roofSnowLoadMin", roofSnowFor(loc.groundSnowPsf), "psf", "Table R301.2(1)", "groundSnowPsf", "0.7 x ground snow (ASCE 7 flat roof), at least the 20 psf roof live load (R301.6)."),
    entry("design.windSpeed", loc.windMph, "mph", "Table R301.2(1)", "windMph"),
    entry("design.seismicCategory", loc.seismicCategory, "", "Table R301.2(1)", "seismicCategory"),
    entry("design.frostDepth", loc.frostDepthIn, "in", "Table R301.2(1)", "frostDepthIn"),
    entry("design.weathering", loc.weathering, "", "Table R301.2(1)"),
    entry("design.termite", loc.termite, "", "Table R301.2(1)"),
    entry("design.winterDesignTemp", loc.winterDesignF, "°F", "Table R301.2(1)", "winterDesignF"),
    entry("design.iceBarrierRequired", loc.iceBarrier, "", "Table R301.2(1)"),
    entry("design.floodHazard", "Check the FEMA flood map (FIRM) for the lot", "", "Table R301.2(1)"),
    entry("design.climateZone", loc.climateZone, "", "IECC Table R301.1 (IRC Table N1101.7)", "climateZone"),
    entry("design.manualJWinter", loc.winterDesignF, "°F", "Manual J criteria", "winterDesignF"),
    entry("design.manualJSummer", loc.summerDesignF, "°F", "Manual J criteria", "summerDesignF"),
    entry("design.elevation", loc.elevationFt, "ft", "Manual J criteria", "elevationFt"),
    entry("footing.minDepthFrost", loc.frostDepthIn, "in", "R403.1.4.1", "frostDepthIn"),
    entry("struct.windSpeedBasis", loc.windMph, "mph (Vult)", "R301.2.1; Table R602.10.3(1)", "windMph"),
    entry("struct.seismicBracingExempt", WIND_ONLY_SDC.includes(loc.seismicCategory.toUpperCase()), "boolean", "R301.2.2; R602.10.1", "seismicCategory"),
  ]);
}

/** Apply an overlay's changes on top, marking each with its layer. Numbers the person typed on the place card (`keep`) stay. */
function applyOverlay(values: Record<string, CodeEntry>, overlay: CodeOverlay | undefined, layer: CodeLayer, keep: Set<string>) {
  if (!overlay) return;
  for (const [k, change] of Object.entries(overlay.values)) {
    if (keep.has(k)) continue;
    values[k] = { ...(values[k] ?? { unit: "", code: "", section: "", amendment: null, source: "", checked: "" }), ...change, layer } as CodeEntry;
  }
}

/** Build the whole code set for a place. `overlays` stands in for the built-in state and city files (tests). */
export function buildCodeSet(location: Location, overlays?: { state?: CodeOverlay; city?: CodeOverlay }): CodeSet {
  const values: Record<string, CodeEntry> = {};
  for (const [k, e] of Object.entries(BASE.values)) values[k] = { ...e, layer: "base" };
  Object.assign(values, zoneLayer(location.climateZone), locationLayer(location));
  // Water heaters are strapped against earthquakes in seismic categories D0 to D2 (IRC P2801.8).
  const strap = values["plumbing.whStrapRequired"];
  if (strap) values["plumbing.whStrapRequired"] = { ...strap, value: /^D[012]$/.test(location.seismicCategory.toUpperCase()), layer: "location", note: `Seismic design category ${location.seismicCategory}: strapping is required in D0 to D2.` };
  const state = overlays ? overlays.state : STATE_OVERLAYS[location.state.toLowerCase()];
  const city = overlays ? overlays.city : CITY_OVERLAYS[location.cityId];
  const keep = new Set(Object.entries(values).filter(([, e]) => e.layer === "location" && e.note === EDITED_NOTE).map(([k]) => k));
  applyOverlay(values, state, "state", keep);
  applyOverlay(values, city, "city", keep);
  const editions = city?.editionLines ?? state?.editionLines ?? BASE.editionLines;
  const jurisdiction = city?.jurisdiction ?? state?.jurisdiction ?? `${location.name}, ${location.state}`;
  return { meta: { ...BASE.meta, jurisdiction, editions: [...BASE.meta.editions, ...(state?.editions ?? []), ...(city?.editions ?? [])] }, editions, values, location };
}

// ---------- The active set ----------

const placeKey = (loc: Location) => JSON.stringify(loc);
const built = new Map<string, CodeSet>();
let active: CodeSet = buildCodeSet(DEFAULT_PLACE);
let activeKey = placeKey(DEFAULT_PLACE);
built.set(activeKey, active);

/** Use the code numbers for this place from now on (null = Boise's numbers, as before a place is picked). */
export function setCodeLocation(location: Location | null | undefined): void {
  const loc = location ?? DEFAULT_PLACE;
  const key = placeKey(loc);
  if (key === activeKey) return;
  let set = built.get(key);
  if (!set) {
    set = buildCodeSet(loc);
    built.set(key, set);
  }
  active = set;
  activeKey = key;
}

/** Run `fn` with the code numbers of `location`, then put the place back. */
export function withCodeLocation<T>(location: Location | null | undefined, fn: () => T): T {
  const before = active.location;
  setCodeLocation(location);
  try {
    return fn();
  } finally {
    setCodeLocation(before);
  }
}

/** The active code set. */
export function codeSet(): CodeSet {
  return active;
}

/** Changes whenever the active place changes, for caches of anything worked out from code numbers. */
export function codeSetKey(): string {
  return activeKey;
}

/** The code editions in use, for the cover sheet and code summary. */
export function codeEditions(): EditionLine[] {
  return active.editions;
}

export function codeEntry(key: string): CodeEntry {
  const e = active.values[key];
  if (!e) throw new Error(`No code value "${key}" in the code set`);
  return e;
}

export function codeNum(key: string): number {
  const v = codeEntry(key).value;
  if (typeof v !== "number") throw new Error(`Code value "${key}" isn't a number`);
  return v;
}

export function codeText(key: string): string {
  const v = codeEntry(key).value;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/** A table kept as the code prints it. */
export function codeTable<T>(key: string): Record<string, T> {
  const v = codeEntry(key).value;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`Code value "${key}" isn't a table`);
  return v as Record<string, T>;
}

/** "IRC R310.2.1", for printing next to a rule. */
export function codeRef(key: string): string {
  const e = codeEntry(key);
  const book = e.code.replace(/ \d{4}$/, "");
  return book === "Design criteria" ? `IRC ${e.section}` : `${book} ${e.section}`;
}
