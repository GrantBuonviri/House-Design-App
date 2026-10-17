import type { LocationField } from "@/lib/model/schema";

/** How each editable number of a place is shown on step one's "Edit numbers". */
export type FieldInfo = { label: string; unit: string; hint: string; step?: number; choices?: readonly string[] };

export const FIELD_INFO: Record<LocationField, FieldInfo> = {
  climateZone: { label: "Climate zone", unit: "", hint: "The energy code's zone (1 hot to 8 very cold; A moist, B dry, C marine). Sets insulation and window rules.", choices: ["1A", "2A", "2B", "3A", "3B", "3C", "4A", "4B", "4C", "5A", "5B", "5C", "6A", "6B", "7", "8"] },
  frostDepthIn: { label: "Frost depth", unit: "in", hint: "How deep the ground freezes. Footings go at least this deep.", step: 1 },
  groundSnowPsf: { label: "Ground snow", unit: "psf", hint: "The snow weight the roof and floors are built to carry.", step: 5 },
  windMph: { label: "Wind", unit: "mph", hint: "The design wind speed walls and roof are braced for.", step: 5 },
  seismicCategory: { label: "Earthquake level", unit: "", hint: "The code's seismic design category, from A (least) to E (most).", choices: ["A", "B", "C", "D0", "D1", "D2", "E"] },
  winterDesignF: { label: "Winter design temperature", unit: "°F", hint: "A cold winter night the heating is sized for.", step: 1 },
  summerDesignF: { label: "Summer design temperature", unit: "°F", hint: "A hot summer afternoon the cooling is sized for.", step: 1 },
  elevationFt: { label: "Elevation", unit: "ft", hint: "Height above sea level.", step: 10 },
  prevailingWind: { label: "Usual wind direction", unit: "", hint: "Where the wind mostly comes from.", choices: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] },
  costIndex: { label: "Cost level", unit: "×", hint: "Building costs here compared with the US average (1.00). Higher costs more.", step: 0.01 },
  latitudeDeg: { label: "Latitude", unit: "°", hint: "How far north. Sets how high the sun gets.", step: 0.01 },
  longitudeDeg: { label: "Longitude", unit: "°", hint: "How far east or west (west is negative). Sets clock times for sunrise and sunset.", step: 0.01 },
};

/** "Denver, CO · climate zone 5B · frost 36" · snow 30 psf · wind 115 mph · quake B · cost level 1.00" (without the name). */
export function placeSummary(p: { climateZone: string; frostDepthIn: number; groundSnowPsf: number; windMph: number; seismicCategory: string; costIndex: number }): string {
  return `climate zone ${p.climateZone} · frost ${p.frostDepthIn}" · snow ${p.groundSnowPsf} psf · wind ${p.windMph} mph · quake ${p.seismicCategory} · cost level ${p.costIndex.toFixed(2)}`;
}
