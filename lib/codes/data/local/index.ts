import type { CodeEdition, CodeEntry, EditionLine } from "../../data";
import boise from "./boise-id.json";

/**
 * State and city code changes, layered over the 2021 base (see `lib/codes/data.ts`).
 * A state file is `state-<st>.json`, a city file `<cityId>.json`; each is
 * imported here and listed under its state or city id. Boise's wind
 * basis is already here, so Boise houses keep the bracing they had.
 */
export type CodeOverlay = {
  /** "City of Boise, Ada County, Idaho", for the PDF. */
  jurisdiction?: string;
  /** Replaces the cover sheet's code list when the place adopted other editions. */
  editionLines?: EditionLine[];
  editions?: CodeEdition[];
  /** Changes to tracked numbers. Each carries the amendment that made it. */
  values: Record<string, Partial<CodeEntry> & Pick<CodeEntry, "value">>;
};

/** By two-letter state, lower case ("id"). */
export const STATE_OVERLAYS: Record<string, CodeOverlay> = {};

/** By city id ("boise-id"). */
export const CITY_OVERLAYS: Record<string, CodeOverlay> = {
  "boise-id": boise as CodeOverlay,
};
