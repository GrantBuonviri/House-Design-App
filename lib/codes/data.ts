import base from "./data/irc-2021.json";
import zones from "./data/iecc-2021-zones.json";
import editions from "./data/editions.json";
import { CITY_OVERLAYS, STATE_OVERLAYS } from "./data/local";
import type { AdoptedCode, AdoptedCodes, CodeOverlay, EditionTables, OverlayValue } from "./data/local/types";
import type { Location } from "@/lib/model/schema";
import { DEFAULT_PLACE } from "@/lib/location/current";
import { CITIES } from "@/lib/location/cities";

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
 * Where a state or city adopted another model edition (the 2018 IECC, the UPC
 * for plumbing, the 2020 NEC), the numbers that edition prints differently come
 * from data/editions.json and count as that state's or city's changes.
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
  /** Who reviews the plans there, for the PDF. */
  local: LocalFacts;
};

/** The building department's names, from the city file. */
export type LocalFacts = {
  /** "City and County of Denver, Colorado", or "Elsewhere in Colorado" for a place off the list. */
  jurisdiction: string;
  permitOffice?: string;
  zoningCode?: string;
  /** statewide, or local-only where each city or county adopts its own codes. */
  adoption?: CodeOverlay["adoption"];
  /** For "Elsewhere in <state>": what applies there. */
  elsewhere?: string;
  /** "Colorado". */
  stateName: string;
  /** For the title block and cover: "Denver, Colorado", or just "Colorado" for a place off the list. */
  place: string;
  /** Who reviews the plans, for "Verify ... with ...": "the City and County of Denver", or "the building department". */
  reviewer: string;
  /** The city's short name ("Denver"), for a local rule; unset for a place off the list. */
  cityName?: string;
  /** Who issues electrical and plumbing permits, where it isn't the building department (a state licensing office). */
  electricalPermit?: string;
  plumbingPermit?: string;
  /** A local rule for building on a steep lot. */
  hillsideRule?: string;
  /** The building department's own list of required sheets. */
  checklist?: string;
  /** Fire sprinklers in a new house here, for the cover sheet. */
  sprinklers?: string;
};

type BaseData = { meta: CodeSet["meta"]; editionLines: EditionLine[]; values: Record<string, CodeEntry> };
type ZoneRow = Record<string, CodeValue>;
type ZoneData = { meta: { source: string; secondSource: string; checked: string; section: string; note?: string }; units: Record<string, string>; sections: Record<string, string>; zones: Record<string, ZoneRow> };

const BASE = base as unknown as BaseData;
const ZONES = zones as unknown as ZoneData;
const EDITIONS = editions as unknown as EditionTables;

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

/** The energy numbers for a climate zone (layer 2), from the 2021 IECC or the edition the place adopted. */
function zoneLayer(climateZone: string, adopted?: { edition: string; who: string; layer: CodeLayer }): Record<string, CodeEntry> {
  const key = zoneRow(climateZone);
  const other = adopted ? EDITIONS.iecc[adopted.edition] : undefined;
  const zonesOf = other?.zones ?? ZONES.zones;
  const row = zonesOf[key] ?? zonesOf["5"] ?? ZONES.zones[key] ?? ZONES.zones["5"];
  const out: Record<string, CodeEntry> = {};
  for (const [field, value] of Object.entries(row)) {
    const k = `energy.${field}`;
    const prev = BASE.values[k];
    out[k] = {
      ...(prev ?? {}),
      value,
      unit: ZONES.units[field] || prev?.unit || "",
      code: other ? `IECC ${adopted!.edition}` : "IECC 2021",
      section: ZONES.sections[field] ?? ZONES.meta.section,
      amendment: other ? `${adopted!.who} uses the ${adopted!.edition} IECC` : null,
      source: other?.source ?? ZONES.meta.source,
      checked: other ? EDITIONS.checked : ZONES.meta.checked,
      secondCheck: { verdict: "agree", source: other?.secondSource ?? ZONES.meta.secondSource },
      note: `Climate zone ${climateZone}${key === "4C" ? " (marine 4 uses the zone 5 column)" : ""}.`,
      layer: other ? adopted!.layer : "zone",
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

/** Apply an overlay's changes on top, marking each with its layer. Numbers the person typed on the place card (`keep`) stay, and numbers nobody could confirm are left out. */
function applyValues(values: Record<string, CodeEntry>, changes: Record<string, OverlayValue> | undefined, layer: CodeLayer, keep: Set<string>, extra: Partial<CodeEntry> = {}, climateZone?: string) {
  if (!changes) return;
  const inZone = (z: string) => !!climateZone && (z.toUpperCase() === climateZone.toUpperCase() || (!/[A-C]$/i.test(z) && /^\d/.exec(z)?.[0] === /^\d/.exec(climateZone)?.[0]));
  // "energy.ceilingR@6" holds a state's own number for climate zone 6 only (a state energy table, zone by zone).
  for (const [key, { zones, ...change }] of Object.entries(changes)) {
    const [k, zone] = key.split("@");
    if (keep.has(k) || change.unverified) continue;
    if (zone && !inZone(zone)) continue;
    if (zones && !zones.some(inZone)) continue;
    values[k] = { ...(values[k] ?? { unit: "", code: "", section: "", amendment: null, source: "", checked: "" }), ...extra, ...change, layer } as CodeEntry;
  }
}

/** An adopted code the app can use: confirmed, and not the base edition. */
const otherEdition = (c: AdoptedCode | undefined, baseEdition: string): string | null => (c && !c.unverified && c.edition !== baseEdition ? c.edition : null);

/** The closest edition the tables hold for a model ("UPC"), at or before `edition` if there is one. */
function nearestEdition(tables: Record<string, unknown>, model: string, edition: string): string | null {
  const have = Object.keys(tables)
    .filter((k) => k.startsWith(`${model} `))
    .map((k) => k.slice(model.length + 1))
    .sort();
  if (!have.length) return null;
  const before = have.filter((e) => e <= edition);
  return before.length ? before[before.length - 1] : have[0];
}

/** Which overlay set a code: the city's own adoption wins over its state's. */
type Adopted = { codes: AdoptedCodes; by: { irc?: Owner; iecc?: Owner; nec?: Owner; plumbing?: Owner } };
type Owner = { who: string; layer: CodeLayer };

function adoptedOf(location: Location, state?: CodeOverlay, city?: CodeOverlay): Adopted {
  const codes: AdoptedCodes = {};
  const by: Adopted["by"] = {};
  const stateWho = state?.jurisdiction ?? location.state;
  const cityWho = city?.jurisdiction?.split(",")[0] ?? location.name;
  for (const k of ["irc", "iecc", "nec", "plumbing"] as const) {
    const c = city?.codes?.[k];
    const s = state?.codes?.[k];
    if (c) {
      (codes as Record<string, unknown>)[k] = c;
      by[k] = { who: cityWho, layer: "city" };
    } else if (s) {
      (codes as Record<string, unknown>)[k] = s;
      by[k] = { who: stateWho, layer: "state" };
    }
  }
  return { codes, by };
}

/** The numbers that the adopted editions print differently from the 2021 IRC, 2021 IECC and 2023 NEC. */
function editionValues(values: Record<string, CodeEntry>, { codes, by }: Adopted) {
  const put = (changes: Record<string, OverlayValue> | undefined, owner: Owner, code: string, why: string) =>
    applyValues(values, changes, owner.layer, new Set(), { code, amendment: why, checked: EDITIONS.checked });
  const irc = otherEdition(codes.irc, "2021");
  if (irc && by.irc) put(EDITIONS.irc[irc], by.irc, `IRC ${irc}`, `${by.irc.who} uses the ${irc} IRC`);
  const iecc = otherEdition(codes.iecc, "2021");
  if (iecc && by.iecc && !codes.iecc?.name) put(EDITIONS.iecc[iecc]?.values, by.iecc, `IECC ${iecc}`, `${by.iecc.who} uses the ${iecc} IECC`);
  const nec = otherEdition(codes.nec, "2023");
  if (nec && by.nec) put(EDITIONS.nec[nec], by.nec, `NEC ${nec}`, `${by.nec.who} uses the ${nec} NEC`);
  const pl = codes.plumbing;
  if (pl && !pl.unverified && by.plumbing && (pl.model === "UPC" || pl.model === "IPC")) {
    const ed = nearestEdition(EDITIONS.plumbing, pl.model, pl.edition);
    if (ed) put(EDITIONS.plumbing[`${pl.model} ${ed}`], by.plumbing, `${pl.model} ${ed}`, `${by.plumbing.who} uses ${pl.name ?? `the ${pl.edition} ${pl.model}`}`);
  }
}

/** The cover sheet's code list for what the place adopted. */
function editionLinesFor({ codes }: Adopted, elsewhere?: string): EditionLine[] {
  if (!Object.keys(codes).length) return elsewhere ? BASE.editionLines.map((l, i) => (i === 0 ? { ...l, detail: elsewhere } : l)) : BASE.editionLines;
  const ed = (c: AdoptedCode | undefined, base: string) => (c && !c.unverified ? c.edition : base);
  const detail = (c: AdoptedCode | undefined, model: string) =>
    c?.unverified ? `${model}; the adoption here couldn't be confirmed, check with the building department` : (c?.amendments ?? model);
  const irc = ed(codes.irc, "2021");
  const pl = codes.plumbing;
  const plumbing = !pl || pl.unverified || pl.model === "IRC" ? `${irc} IRC chapters 25 to 33` : (pl.name ?? `${pl.edition} ${pl.model === "UPC" ? "Uniform Plumbing Code (UPC)" : pl.model === "IPC" ? "International Plumbing Code (IPC)" : "state plumbing code"}`);
  const iecc = ed(codes.iecc, "2021");
  // An edition the app has no table for keeps the 2021 numbers; say so.
  const noTable = iecc !== "2021" && !codes.iecc?.name && !EDITIONS.iecc[iecc] ? "; the energy numbers shown are the 2021 IECC's for this climate zone" : "";
  return [
    { label: `Residential: ${irc} International Residential Code (IRC)`, detail: detail(codes.irc, "Model code") },
    { label: `Energy: ${codes.iecc?.name && !codes.iecc.unverified ? codes.iecc.name : `${iecc} International Energy Conservation Code (IECC)`}`, detail: detail(codes.iecc, "Prescriptive values for the climate zone") + noTable },
    { label: `Electrical: ${ed(codes.nec, "2023")} National Electrical Code (NEC)`, detail: detail(codes.nec, "Model code") },
    { label: `Plumbing: ${plumbing}`, detail: detail(pl, pl?.model === "IRC" || !pl ? "The IRC plumbing chapters" : "Model code") },
    { label: `Mechanical and fuel gas: ${irc} IRC chapters 12 to 24`, detail: detail(codes.irc, "Model code") },
  ];
}

/** Build the whole code set for a place. `overlays` stands in for the built-in state and city files (tests). */
export function buildCodeSet(location: Location, overlays?: { state?: CodeOverlay; city?: CodeOverlay }): CodeSet {
  const state = overlays ? overlays.state : STATE_OVERLAYS[location.state.toLowerCase()];
  const city = overlays ? overlays.city : CITY_OVERLAYS[location.cityId];
  const adopted = adoptedOf(location, state, city);
  const values: Record<string, CodeEntry> = {};
  for (const [k, e] of Object.entries(BASE.values)) values[k] = { ...e, layer: "base" };
  editionValues(values, adopted);
  const iecc = otherEdition(adopted.codes.iecc, "2021");
  const ieccBy = adopted.by.iecc;
  Object.assign(values, zoneLayer(location.climateZone, iecc && ieccBy && !adopted.codes.iecc?.name ? { edition: iecc, ...ieccBy } : undefined), locationLayer(location));
  // Water heaters are strapped against earthquakes in seismic categories D0 to D2 (IRC P2801.8); the UPC straps them everywhere.
  const strap = values["plumbing.whStrapRequired"];
  if (strap && strap.layer === "base") values["plumbing.whStrapRequired"] = { ...strap, value: /^D[012]$/.test(location.seismicCategory.toUpperCase()), layer: "location", note: `Seismic design category ${location.seismicCategory}: strapping is required in D0 to D2.` };
  const keep = new Set(Object.entries(values).filter(([, e]) => e.layer === "location" && e.note === EDITED_NOTE).map(([k]) => k));
  applyValues(values, state?.values, "state", keep, {}, location.climateZone);
  applyValues(values, city?.values, "city", keep, {}, location.climateZone);
  // A local roof snow load is a minimum: a snowier place keeps its own.
  const roof = values["design.roofSnowLoadMin"];
  if (roof.layer !== "location" && typeof roof.value === "number" && roof.value < roofSnowFor(location.groundSnowPsf)) values["design.roofSnowLoadMin"] = locationLayer(location)["design.roofSnowLoadMin"];
  const elsewhere = location.cityId.startsWith("elsewhere-") ? state?.elsewhere : undefined;
  const editions = city?.editionLines ?? state?.editionLines ?? editionLinesFor(adopted, elsewhere);
  const stateName = CITIES.find((c) => c.state === location.state)?.stateName ?? location.state;
  const offList = location.cityId.startsWith("elsewhere-");
  const jurisdiction = city?.jurisdiction ?? (offList ? location.name : `${location.name}, ${stateName}`);
  const local: LocalFacts = {
    jurisdiction,
    permitOffice: city?.permitOffice,
    zoningCode: city?.zoningCode,
    adoption: city?.adoption ?? state?.adoption,
    elsewhere,
    stateName,
    place: offList ? stateName : `${location.name}, ${stateName}`,
    reviewer: city?.jurisdiction ? `the ${city.jurisdiction.split(",")[0]}` : "the building department",
    cityName: offList ? undefined : location.name,
    electricalPermit: city?.electricalPermit ?? state?.electricalPermit,
    plumbingPermit: city?.plumbingPermit ?? state?.plumbingPermit,
    hillsideRule: city?.hillsideRule,
    checklist: city?.checklist,
    sprinklers: city?.sprinklers ?? state?.sprinklers,
  };
  const metaEditions: CodeEdition[] = editions.map((l) => ({ code: l.label.replace(/:.*/, ""), edition: l.label.replace(/^[^:]+: /, ""), amendments: l.detail }));
  return { meta: { ...BASE.meta, jurisdiction, editions: metaEditions }, editions, values, location, local };
}

// ---------- The active set ----------

const placeKey = (loc: Location) => JSON.stringify(loc);
const built = new Map<string, CodeSet>();
let active: CodeSet = buildCodeSet(DEFAULT_PLACE);
let activeKey = placeKey(DEFAULT_PLACE);
built.set(activeKey, active);

/** Use the code numbers for this place from now on (null = the default place's numbers, as before a place is picked). */
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
  if (book === "Design criteria") return `IRC ${e.section}`;
  return e.section.startsWith(`${book} `) ? e.section : `${book} ${e.section}`;
}

/** Whose change a number is: the city ("Denver") for a city's, the state ("Colorado") for a state's, null for the model code or the place card. */
export function changedBy(key: string): string | null {
  const layer = codeEntry(key).layer;
  if (layer === "city") return active.local.cityName ?? active.local.stateName;
  if (layer === "state") return active.local.stateName;
  return null;
}

/** A steep lot's foundation note: the city's own rule where it has one. */
export function hillsideNote(): string {
  return active.local.hillsideRule ?? "Steep lots usually need an engineer-designed foundation.";
}

/** The code in use for one part of the work, from the cover sheet's list: "Energy" gives "2018 International Energy Conservation Code (IECC)". */
export function codeName(part: "Residential" | "Energy" | "Electrical" | "Plumbing"): string {
  const line = active.editions.find((l) => l.label.startsWith(`${part}:`));
  return line ? line.label.slice(part.length + 2) : part;
}
