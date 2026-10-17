/**
 * The priorities the user can tick. Each label is the brief's priority text
 * and moves exactly one of `priorityWeights`' weights, so ticking one really
 * changes how sketches and plans are ranked ("Ranked for: Lower cost").
 */
export const PRIORITIES = [
  { id: "sun", label: "Sunny living areas" },
  { id: "cost", label: "Lower cost" },
  { id: "fit", label: "Roomy rooms" },
  { id: "quiet", label: "Quiet bedrooms" },
] as const;

export type PriorityId = (typeof PRIORITIES)[number]["id"];

/** The brief's accessibility tag when "easy to get around" is ticked. `doors.ts` reads it as the whole main floor (36" doors). */
export const ACCESSIBLE_TAG = "Easy to get around with a wheelchair or walker";
