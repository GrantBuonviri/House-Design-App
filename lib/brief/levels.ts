import type { DesignBrief, Level } from "@/lib/model/schema";

/** The floors a brief can place rooms on, lowest first. */
export const BRIEF_LEVELS = [
  { id: "basement", name: "Basement", kind: "basement", elevationIn: -114 },
  { id: "main", name: "Main floor", kind: "main", elevationIn: 0 },
  { id: "upper", name: "Upper floor", kind: "upper", elevationIn: 126 },
  { id: "upper-2", name: "Third floor", kind: "upper", elevationIn: 252 },
] as const satisfies readonly Level[];

export type BriefLevelId = (typeof BRIEF_LEVELS)[number]["id"];
export const BRIEF_LEVEL_IDS = BRIEF_LEVELS.map((l) => l.id) as [BriefLevelId, ...BriefLevelId[]];

/** Which levels exist for a number of floors above ground and a basement. */
export function levelIdsFor(floors: number, basement: boolean): BriefLevelId[] {
  const ids: BriefLevelId[] = [];
  if (basement) ids.push("basement");
  ids.push("main");
  if (floors >= 2) ids.push("upper");
  if (floors >= 3) ids.push("upper-2");
  return ids;
}

export function levelName(id: string | undefined): string {
  return BRIEF_LEVELS.find((l) => l.id === id)?.name ?? "Main floor";
}

/** Move a level that no longer exists to the nearest one that does. */
export function nearestLevel(id: string | undefined, allowed: BriefLevelId[]): BriefLevelId {
  if (id && (allowed as string[]).includes(id)) return id as BriefLevelId;
  if (id === "upper-2" && allowed.includes("upper")) return "upper";
  return "main";
}

/**
 * The project's levels to match a brief: one per floor plus the basement.
 * Levels the user added that the brief doesn't know about are kept.
 */
export function syncLevels(current: Level[], brief: DesignBrief): Level[] {
  const wanted = levelIdsFor(brief.floors, brief.basement);
  const known = new Set<string>(BRIEF_LEVELS.map((l) => l.id));
  const extra = current.filter((l) => !known.has(l.id));
  const levels: Level[] = BRIEF_LEVELS.filter((l) => wanted.includes(l.id)).map((l) => {
    const existing = current.find((c) => c.id === l.id);
    return existing ?? { ...l };
  });
  return [...levels, ...extra].sort((a, b) => a.elevationIn - b.elevationIn);
}
