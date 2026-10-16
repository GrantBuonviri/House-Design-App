import type { Stage } from "@/lib/model/schema";

/** The stages in the stage bar, in order. */
export const STAGE_INFO: { id: Stage; label: string }[] = [
  { id: "setup", label: "Project setup" },
  { id: "land", label: "Land" },
  { id: "brief", label: "Rooms" },
  { id: "bubbles", label: "Flow sketch" },
  { id: "plan", label: "Floor plan" },
  { id: "furnish", label: "Furnish" },
  { id: "interior", label: "Interior" },
  { id: "exterior", label: "Exterior" },
];
