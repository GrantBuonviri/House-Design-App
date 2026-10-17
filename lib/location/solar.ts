import type { Location } from "@/lib/model/schema";

/** What the sun and clock need to know about a place. */
export type SunPlace = Pick<Location, "latitudeDeg" | "longitudeDeg" | "utcOffsetHours" | "daylightSaving">;

/**
 * Minutes the clock reads ahead of the sun in standard time: 4 minutes for
 * each degree the place sits west of its time zone's middle line (11.2° west of the line is
 * 45 minutes). Rounded to the minute.
 */
export function clockAheadMinutes(place: Pick<SunPlace, "longitudeDeg" | "utcOffsetHours">): number {
  return Math.round((15 * place.utcOffsetHours - place.longitudeDeg) * 4);
}
