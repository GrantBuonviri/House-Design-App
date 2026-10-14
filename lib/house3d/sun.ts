import { SUMMER_SOLSTICE, WINTER_SOLSTICE, dayArc, sunPosition } from "@/lib/land/sun";
import type { Vec3 } from "./mesh";

/** Spring equinox, for an in-between sun. */
export const EQUINOX = 80;
export { SUMMER_SOLSTICE as SUMMER, WINTER_SOLSTICE as WINTER } from "@/lib/land/sun";

/** Unit direction toward the sun in the scene (x east, y up, z south). */
export function sunDirection(dayOfYear: number, solarHour: number): Vec3 {
  const s = sunPosition(dayOfYear, solarHour);
  const az = (s.azimuthDeg * Math.PI) / 180;
  const alt = (Math.max(s.altitudeDeg, 2) * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
}

/** The three days the walkthrough and window preview can show. */
export const SEASONS = [
  { id: "summer", label: "Summer", name: "summer", day: SUMMER_SOLSTICE, daylightSaving: true },
  { id: "springfall", label: "Spring / fall", name: "spring and fall", day: EQUINOX, daylightSaving: true },
  { id: "winter", label: "Winter", name: "winter", day: WINTER_SOLSTICE, daylightSaving: false },
] as const;
export type SeasonId = (typeof SEASONS)[number]["id"];
export type Season = (typeof SEASONS)[number];

/** Sunrise and sunset for a day, on the quarter hour (local solar time), so sliders land on round times. */
export function daylight(day: number): { sunrise: number; sunset: number } {
  const arc = dayArc(day);
  return { sunrise: Math.ceil((12 - arc.daylightHours / 2) * 4) / 4, sunset: Math.floor((12 + arc.daylightHours / 2) * 4) / 4 };
}

/** Boise is about 45 minutes behind Mountain Standard Time by the sun, plus an hour in daylight saving time. */
export function clockTime(solarHour: number, daylightSaving: boolean): string {
  const h = solarHour + 0.75 + (daylightSaving ? 1 : 0);
  const mins = Math.round((h * 60) / 15) * 15;
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
}
