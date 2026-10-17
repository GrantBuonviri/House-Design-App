import { useProjectStore } from "@/lib/store/projectStore";
import type { Location } from "@/lib/model/schema";
import { DEFAULT_PLACE, locationOf } from "./current";

/** The open project's place (Boise's numbers until one is picked), for components that show the sun or clock. */
export function usePlace(): Location {
  return useProjectStore((s) => (s.project ? locationOf(s.project) : DEFAULT_PLACE));
}
