import data from "./data/cities.json";
import type { Location } from "@/lib/model/schema";

/**
 * The built-in list of places to build: about 100 US cities (every state and
 * DC), plus an "Elsewhere in <state>" choice per state that borrows the
 * numbers of that state's most typical listed city. Sources for each value
 * are in `data/cities.json`.
 */
export type City = {
  id: string;
  name: string;
  state: string;
  stateName: string;
  /** This state's most typical city, whose numbers "Elsewhere in <state>" uses. */
  typical?: boolean;
  /** True for the "Elsewhere in <state>" choices. */
  elsewhere?: boolean;
  latitudeDeg: number;
  longitudeDeg: number;
  utcOffsetHours: number;
  daylightSaving: boolean;
  climateZone: string;
  frostDepthIn: number;
  groundSnowPsf: number;
  windMph: number;
  seismicCategory: string;
  winterDesignF: number;
  summerDesignF: number;
  elevationFt: number;
  prevailingWind: Location["prevailingWind"];
  weathering: string;
  termite: string;
  iceBarrier: boolean;
  costIndex: number;
  sources?: Record<string, string>;
  /** Fields no source confirmed when the data was checked. */
  unverified?: string[];
};

const LISTED = data.cities as City[];

/** Where the cost levels come from, for the place card's hint. */
export const COST_INDEX_SOURCE: string = data.costIndexSource;

function elsewhereIn(city: City): City {
  const id = `elsewhere-${city.state.toLowerCase()}`;
  return { ...city, id, name: `Elsewhere in ${city.stateName}`, typical: false, elsewhere: true };
}

/** Every choice: the listed cities by name, then each state's "Elsewhere in <state>". */
export const CITIES: City[] = [
  ...[...LISTED].sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state)),
  ...LISTED.filter((c) => c.typical)
    .sort((a, b) => a.stateName.localeCompare(b.stateName))
    .map(elsewhereIn),
];

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function cityById(id: string): City | undefined {
  return BY_ID.get(id);
}

/** "Boise, ID". */
export function placeLabel(p: { name: string; state: string; cityId?: string; id?: string }): string {
  return (p.cityId ?? p.id ?? "").startsWith("elsewhere-") ? p.name : `${p.name}, ${p.state}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

/**
 * Places matching what was typed: a city name ("boise", "san an"), a state
 * name ("texas") or a two-letter state ("TX"). Best matches first.
 */
export function searchCities(query: string, limit = 12): City[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { c: City; score: number }[] = [];
  for (const c of CITIES) {
    const name = norm(c.name);
    const state = norm(c.stateName);
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 60;
    else if (state === q || c.state.toLowerCase() === q) score = 50;
    else if (state.startsWith(q)) score = 40;
    else if (`${name} ${c.state.toLowerCase()}`.startsWith(q) || `${name} ${state}`.startsWith(q)) score = 70;
    if (score && c.elsewhere) score -= 5;
    if (score) scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.c);
}

/** A project's saved place for a city: a full copy of its numbers, nothing edited yet. */
export function placeFromCity(city: City): Location {
  return {
    cityId: city.id,
    name: city.name,
    state: city.state,
    latitudeDeg: city.latitudeDeg,
    longitudeDeg: city.longitudeDeg,
    utcOffsetHours: city.utcOffsetHours,
    daylightSaving: city.daylightSaving,
    climateZone: city.climateZone,
    frostDepthIn: city.frostDepthIn,
    groundSnowPsf: city.groundSnowPsf,
    windMph: city.windMph,
    seismicCategory: city.seismicCategory,
    winterDesignF: city.winterDesignF,
    summerDesignF: city.summerDesignF,
    elevationFt: city.elevationFt,
    prevailingWind: city.prevailingWind,
    weathering: city.weathering,
    termite: city.termite,
    iceBarrier: city.iceBarrier,
    costIndex: city.costIndex,
    permitFee: null,
    edited: [],
  };
}
