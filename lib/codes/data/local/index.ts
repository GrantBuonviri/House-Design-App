import type { CodeOverlay } from "./types";
import boise from "./boise-id.json";

export type { CodeOverlay } from "./types";

/** By two-letter state, lower case ("id"). */
export const STATE_OVERLAYS: Record<string, CodeOverlay> = {};

/** By city id ("boise-id"). */
export const CITY_OVERLAYS: Record<string, CodeOverlay> = {
  "boise-id": boise as CodeOverlay,
};
