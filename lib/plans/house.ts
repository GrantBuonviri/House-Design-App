import type { FloorPlan, Level, PlanBasics, PlanStairs, Point, Project } from "@/lib/model/schema";
import { exteriorWallIn, riseBetween } from "@/lib/plan/basics";
import { planOf } from "@/lib/plan/edit";
import { stairsDrawing } from "@/lib/plan/stairs";
import { openingGeometries } from "@/lib/plan/walls";
import { safetyGlazing } from "@/lib/codes/openings";

/**
 * Everything the plan sheets and code checks share about the house, worked
 * out once: floors in order, their plans, stairs outlines, door and window
 * tags, and which glass needs to be safety glass.
 */

export type HouseFacts = {
  project: Project;
  /** Lowest floor first. */
  levels: Level[];
  /** Floors with at least one room, lowest first. */
  drawn: Level[];
  plan: (levelId: string) => FloorPlan;
  basics: PlanBasics | null;
  exteriorIn: number;
  /** How far a flight of stairs climbs. */
  riseFor: (s: Pick<PlanStairs, "toLevelId">, from: Level) => number;
  /** Stairs outlines on a floor: its own stairs and the ones coming up from below. */
  stairsOn: (levelId: string) => Point[][];
  /** "D3" or "W7", by opening id, numbered through the house lowest floor first. */
  tags: Map<string, string>;
  /** Openings that need safety glass, with the reasons. */
  safety: Map<string, string[]>;
};

const cache = new WeakMap<Project, HouseFacts>();

export function houseFacts(project: Project): HouseFacts {
  const hit = cache.get(project);
  if (hit) return hit;
  const levels = [...project.levels].sort((a, b) => a.elevationIn - b.elevationIn);
  const plan = (id: string) => planOf(project.floorPlans, id);
  const basics = project.plan.basics;
  const riseFor = (s: Pick<PlanStairs, "toLevelId">, from: Level) => {
    const to = levels.find((l) => l.id === s.toLevelId);
    return to ? riseBetween(basics, from, to) : 108 + 13;
  };
  const stairsOn = (levelId: string) => {
    const level = levels.find((l) => l.id === levelId);
    if (!level) return [];
    const own = plan(levelId).stairs.map((s) => stairsDrawing(s, riseFor(s, level)).footprint);
    const below = levels.filter((l) => l.elevationIn < level.elevationIn);
    const up = below.flatMap((l) => plan(l.id).stairs.filter((s) => s.toLevelId === levelId).map((s) => stairsDrawing(s, riseFor(s, l)).footprint));
    return [...own, ...up];
  };

  const tags = new Map<string, string>();
  let d = 0;
  let w = 0;
  for (const l of levels) {
    const geos = openingGeometries(plan(l.id)).sort((a, b) => Math.round(a.center.y / 12) - Math.round(b.center.y / 12) || a.center.x - b.center.x);
    for (const g of geos) {
      if (g.opening.kind === "door") tags.set(g.opening.id, `D${++d}`);
      else if (g.opening.kind === "window") tags.set(g.opening.id, `W${++w}`);
    }
  }
  const safety = new Map<string, string[]>();
  for (const l of levels) for (const [id, why] of safetyGlazing(plan(l.id), stairsOn(l.id))) safety.set(id, why);

  const facts: HouseFacts = {
    project,
    levels,
    drawn: levels.filter((l) => plan(l.id).rooms.length > 0),
    plan,
    basics,
    exteriorIn: exteriorWallIn(basics),
    riseFor,
    stairsOn,
    tags,
    safety,
  };
  cache.set(project, facts);
  return facts;
}
