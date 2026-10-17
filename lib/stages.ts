import type { Stage } from "@/lib/model/schema";

/** The stages in the stage bar, in order. */
export const STAGE_INFO: { id: Stage; label: string }[] = [
  { id: "setup", label: "Project setup" },
  { id: "land", label: "Land" },
  { id: "brief", label: "Rooms" },
  { id: "bubbles", label: "Flow sketch" },
  { id: "plan", label: "Floor plan" },
  { id: "furnish", label: "Furnish" },
];

/** The stage whose page shows: Interior and Exterior are windows in the walkthrough now, so old saves on them open on Furnish. */
export function shownStage(stage: Stage): Stage {
  return stage === "interior" || stage === "exterior" ? "furnish" : stage;
}
