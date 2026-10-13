import type { Stage } from "@/lib/model/schema";

export const STAGE_INFO: { id: Stage; label: string; milestone: number }[] = [
  { id: "setup", label: "Project setup", milestone: 1 },
  { id: "land", label: "Land", milestone: 2 },
  { id: "brief", label: "Rooms & vibe", milestone: 3 },
  { id: "bubbles", label: "Flow sketch", milestone: 4 },
  { id: "plan", label: "Floor plan", milestone: 5 },
  { id: "interior", label: "Interior", milestone: 9 },
  { id: "exterior", label: "Exterior", milestone: 10 },
];

/** Milestones finished so far; stages from later milestones show "coming soon". */
export const BUILT_MILESTONE = 3;

export function stageAvailable(stage: Stage): boolean {
  return STAGE_INFO.find((s) => s.id === stage)!.milestone <= BUILT_MILESTONE;
}
