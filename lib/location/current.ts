import type { Location, LocationField, Project } from "@/lib/model/schema";
import { cityById, placeFromCity } from "./cities";

/** The default place: what every project used before places could be picked, and the stand-in until one is. */
export const DEFAULT_PLACE: Location = placeFromCity(cityById("boise-id")!);

/** The project's place, or the default place's numbers when none has been picked yet. */
export function locationOf(project: Pick<Project, "location">): Location {
  return project.location ?? DEFAULT_PLACE;
}

/** Change one number, remembering that it was edited. */
export function editPlace<K extends LocationField>(loc: Location, field: K, value: Location[K]): Location {
  const edited = loc.edited.includes(field) ? loc.edited : [...loc.edited, field];
  return { ...loc, [field]: value, edited };
}

/** Put one number back to the city's own. */
export function resetPlaceField(loc: Location, field: LocationField): Location {
  const city = cityById(loc.cityId);
  const original = city ? placeFromCity(city)[field] : loc[field];
  return { ...loc, [field]: original, edited: loc.edited.filter((f) => f !== field) };
}

/** The city's own value for a field, for "Back to <city>'s number". */
export function cityValue(loc: Location, field: LocationField): Location[LocationField] | undefined {
  const city = cityById(loc.cityId);
  return city ? placeFromCity(city)[field] : undefined;
}
