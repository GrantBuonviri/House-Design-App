import type { Project, Stage } from "@/lib/model/schema";

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

/** Which stages have something done in them, for the ticks in the stage bar. The page you're on counts only once it has something. */
export function stagesDone(p: Project): Record<"setup" | "land" | "brief" | "bubbles" | "plan" | "furnish", boolean> {
  const plans = Object.values(p.floorPlans);
  return {
    setup: p.location !== null,
    land: p.plot !== null,
    brief: p.brief !== null,
    bubbles: Object.values(p.bubbles).some((b) => b.bubbles.length > 0),
    plan: plans.some((f) => f.rooms.length > 0 || f.walls.length > 0),
    furnish: plans.some((f) => f.furniture.length > 0 || (f.addOns?.length ?? 0) > 0 || f.cabinets !== undefined || f.devices !== undefined),
  };
}

const NEXT_LINE: Record<keyof ReturnType<typeof stagesDone>, string> = {
  setup: "Next: pick where you’ll build",
  land: "Next: pick your land",
  brief: "Next: choose your rooms",
  bubbles: "Next: sketch how the rooms connect",
  plan: "Next: draw the floor plan",
  furnish: "Next: furnish your rooms",
};

/** The first stage not done yet, and the one line saying what to do there. Null once everything has been started. */
export function nextStep(p: Project): { stage: Stage; line: string } | null {
  const done = stagesDone(p);
  const first = STAGE_INFO.find((s) => !done[s.id as keyof typeof done]);
  return first ? { stage: first.id, line: NEXT_LINE[first.id as keyof typeof NEXT_LINE] } : null;
}
