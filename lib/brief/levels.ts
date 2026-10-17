import type { DesignBrief, Level, Project } from "@/lib/model/schema";

/**
 * Floors of the house, made from two counts: floors above ground (1 to 5)
 * and below ground (0 to 3). Ids are stable so rooms, bubble diagrams and
 * floor plans can refer to them: "floor-1" is the main floor, "floor-2" the
 * one above it, "basement-1" the first floor down.
 */
export const MAX_ABOVE = 5;
export const MAX_BELOW = 3;

/** Floor-to-floor heights, inches: 9 ft ceilings plus the floor structure. */
const STORY_IN = 126;
const BASEMENT_STORY_IN = 114;

const ABOVE_NAMES = ["Main floor", "Second floor", "Third floor", "Fourth floor", "Fifth floor"];
const BELOW_NAMES = ["Basement", "Lower basement", "Deep basement"];

export const ALL_LEVEL_IDS = [
  ...BELOW_NAMES.map((_, i) => `basement-${i + 1}`).reverse(),
  ...ABOVE_NAMES.map((_, i) => `floor-${i + 1}`),
] as [string, ...string[]];

export const MAIN_LEVEL_ID = "floor-1";

/** Level ids used before schema version 2. */
export const LEGACY_LEVEL_IDS: Record<string, string> = {
  basement: "basement-1",
  main: "floor-1",
  upper: "floor-2",
  "upper-2": "floor-3",
};

function parse(id: string | undefined): { below: boolean; n: number } | null {
  const m = /^(floor|basement)-(\d)$/.exec(id ?? "");
  return m ? { below: m[1] === "basement", n: Number(m[2]) } : null;
}

export function levelFor(id: string): Level {
  const p = parse(id) ?? { below: false, n: 1 };
  return p.below
    ? { id, name: BELOW_NAMES[p.n - 1], kind: "basement", elevationIn: -BASEMENT_STORY_IN * p.n }
    : { id, name: ABOVE_NAMES[p.n - 1], kind: p.n === 1 ? "main" : "upper", elevationIn: STORY_IN * (p.n - 1) };
}

/** The level ids for these counts, lowest first. */
export function levelIdsFor(above: number, below: number): string[] {
  const ids: string[] = [];
  for (let i = Math.min(below, MAX_BELOW); i >= 1; i--) ids.push(`basement-${i}`);
  for (let i = 1; i <= Math.max(1, Math.min(above, MAX_ABOVE)); i++) ids.push(`floor-${i}`);
  return ids;
}

export function levelsFor(above: number, below: number): Level[] {
  return levelIdsFor(above, below).map(levelFor);
}

export function levelName(id: string | undefined): string {
  return parse(id) ? levelFor(id!).name : "Main floor";
}

/** Move a level that no longer exists to the nearest one that does. */
export function nearestLevel(id: string | undefined, allowed: string[]): string {
  if (id && allowed.includes(id)) return id;
  const p = parse(id);
  if (p) {
    const prefix = p.below ? "basement" : "floor";
    for (let n = p.n - 1; n >= 1; n--) if (allowed.includes(`${prefix}-${n}`)) return `${prefix}-${n}`;
  }
  return MAIN_LEVEL_ID;
}

/**
 * The project's levels to match a brief: one per floor. Levels the user
 * added that the brief doesn't know about are kept.
 */
export function syncLevels(current: Level[], brief: Pick<DesignBrief, "floors" | "floorsBelow">): Level[] {
  const wanted = levelIdsFor(brief.floors, brief.floorsBelow);
  const levels = wanted.map((id) => current.find((c) => c.id === id) ?? levelFor(id));
  // A loft stays one story above the top floor when floors are added or taken away.
  const loftAt = Math.max(...levels.map((l) => l.elevationIn), 0) + STORY_IN;
  const extra = current.filter((l) => !parse(l.id)).map((l) => (l.kind === "loft" && l.elevationIn !== loftAt ? { ...l, elevationIn: loftAt } : l));
  return [...levels, ...extra].sort((a, b) => a.elevationIn - b.elevationIn);
}

/** Lofts and split levels the user adds in the flow sketch, on top of the brief's floors. */
export type ExtraLevelKind = "loft" | "split-up" | "split-down";

export const EXTRA_LEVEL_LABEL: Record<ExtraLevelKind, string> = {
  loft: "Loft, above the top floor",
  "split-up": "Split level, half a floor up",
  "split-down": "Split level, half a floor down",
};

export function isExtraLevel(id: string): boolean {
  return !parse(id);
}

/** Where a new loft or split level would sit, or null if there's already one there. */
export function newExtraLevel(kind: ExtraLevelKind, levels: Level[]): Level | null {
  const top = Math.max(...levels.filter((l) => !isExtraLevel(l.id)).map((l) => l.elevationIn), 0);
  const elevationIn = kind === "loft" ? top + STORY_IN : kind === "split-up" ? STORY_IN / 2 : -BASEMENT_STORY_IN / 2;
  if (levels.some((l) => l.elevationIn === elevationIn)) return null;
  const id = `${kind === "loft" ? "loft" : "split"}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, name: kind === "loft" ? "Loft" : kind === "split-up" ? "Split level (up)" : "Split level (down)", kind: kind === "loft" ? "loft" : "split", elevationIn };
}

/** Level ids the project has now that this brief's floors would leave out. */
export function removedLevelIds(project: Pick<Project, "levels">, brief: Pick<DesignBrief, "floors" | "floorsBelow">): string[] {
  const kept = new Set(syncLevels(project.levels, brief).map((l) => l.id));
  return project.levels.filter((l) => !kept.has(l.id)).map((l) => l.id);
}

/** Rooms drawn on these levels, in the flow sketch and in the floor plans (a level with both counts the larger). */
export function roomsOnLevels(project: Pick<Project, "bubbles" | "floorPlans">, ids: string[]): number {
  return ids.reduce((n, id) => n + Math.max(project.bubbles[id]?.bubbles.length ?? 0, project.floorPlans[id]?.rooms.length ?? 0), 0);
}

/** The project without the sketch and floor plan of these levels. */
export function dropLevelRooms<T extends Pick<Project, "bubbles" | "floorPlans">>(project: T, ids: string[]): T {
  const bubbles = { ...project.bubbles };
  const floorPlans = { ...project.floorPlans };
  for (const id of ids) {
    delete bubbles[id];
    delete floorPlans[id];
  }
  return { ...project, bubbles, floorPlans };
}

/** The question asked before floors with rooms go away. */
export function removeRoomsQuestion(n: number, names: string[]): string {
  const floor = names.length === 1 ? `The ${names[0].toLowerCase()} has` : `Those floors have`;
  return `${floor} ${n} room${n === 1 ? "" : "s"}. Remove ${n === 1 ? "it" : "them"}?`;
}
