import type { Level, Point, Project } from "@/lib/model/schema";
import { floorFootprint, joinRooms, type Region } from "@/lib/house3d/footprint";
import { houseSpot } from "@/lib/house3d/site";
import { roofTop } from "@/lib/house3d/roof";
import { FLOOR_STRUCTURE_IN, ceilingFor } from "@/lib/plan/basics";
import { stairsDrawing } from "@/lib/plan/stairs";
import { wallPieces } from "@/lib/plan/walls";
import { plotImplications } from "@/lib/land/implications";
import { houseFacts } from "@/lib/plans/house";
import { houseScene } from "@/lib/plans/scene";
import { insideRegions } from "./geometry";
import { frameFloor, framedRegions, type Bearing, type Engineer, type FloorFraming } from "./framing";
import { foundationOf, zonesOf, type Foundation } from "./foundation";
import { roofFraming, type RoofFraming } from "./roof";
import { headersFor, type HeaderResult, type LevelWalls } from "./headers";
import { bracingFor, type BracedLine } from "./bracing";
import { flatProject } from "@/lib/plan/flatten";

/**
 * The house's structure, worked out once from the plans: floor framing,
 * foundation, roof trusses, headers and wall bracing, all from the IRC's
 * prescriptive tables, plus the list of what needs an engineer.
 */

export type Structure = {
  /** The main floor: the lowest floor that isn't a basement. */
  main: Level | null;
  basement: Level | null;
  /** Floors above the main floor, lowest first. */
  upper: Level[];
  floors: FloorFraming[];
  foundation: Foundation | null;
  roof: RoofFraming;
  headers: HeaderResult[];
  bracing: BracedLine[];
  engineer: Engineer[];
};

const cache = new WeakMap<Project, Structure>();

export function structureOf(project: Project): Structure {
  project = flatProject(project);
  const hit = cache.get(project);
  if (hit) return hit;
  const h = houseFacts(project);
  const sc = houseScene(project);
  const settings = project.plans.structure;
  const drawn = [...h.drawn].sort((a, b) => sc.heights[a.id].floorIn - sc.heights[b.id].floorIn);
  const basement = drawn.find((l) => l.kind === "basement") ?? null;
  const above = drawn.filter((l) => l.kind !== "basement");
  const main = above[0] ?? null;
  const upper = above.slice(1);
  const roof = roofFraming(project);
  const out: Structure = { main, basement, upper, floors: [], foundation: null, roof, headers: [], bracing: [], engineer: [] };
  if (!main) {
    cache.set(project, out);
    return out;
  }

  /** Floor openings where stairs come up from the floor below. */
  const openingsOn = (level: Level): Point[][] =>
    h.levels.filter((l) => l.id !== level.id).flatMap((l) => h.plan(l.id).stairs.filter((s) => s.toLevelId === level.id).map((s) => stairsDrawing(s, h.riseFor(s, l)).footprint));

  // Floors over floors, from the top down, so we know which walls below carry them.
  const framing = new Map<string, FloorFraming>();
  for (let i = above.length - 1; i >= 1; i--) {
    const level = above[i];
    const plan = h.plan(level.id);
    const regions = framedRegions(plan);
    if (!regions.length) continue;
    framing.set(level.id, frameFloor({ level, plan, over: "floor", regions, openings: openingsOn(level), below: h.plan(above[i - 1].id), exteriorIn: h.exteriorIn, structure: settings, floorAbove: i < above.length - 1 && framedRegions(h.plan(above[i + 1].id)).length > 0 }));
  }
  // The main floor over a crawlspace or basement.
  const mainPlan = h.plan(main.id);
  const zonesInput = { mainPlan, basement: basement ? { level: basement, plan: h.plan(basement.id), floorIn: sc.heights[basement.id].floorIn, wallIn: ceilingFor(h.basics, basement) + FLOOR_STRUCTURE_IN } : undefined, systems: project.plans.systems };
  const carry: Bearing[] = (upper[0] ? framing.get(upper[0].id)?.bearingWalls ?? [] : []).filter((b) => !b.piece?.exterior);
  const underMain = framedUnderMain(zonesInput);
  if (underMain.regions.length)
    framing.set(main.id, frameFloor({ level: main, plan: mainPlan, over: underMain.over, regions: underMain.regions, openings: openingsOn(main), exteriorIn: h.exteriorIn, structure: settings, carry }));
  out.floors = above.map((l) => framing.get(l.id)).filter((f): f is FloorFraming => !!f);

  const upperRegions = upper.map((level) => ({ level, regions: floorFootprint(h.plan(level.id)) }));
  const hillside = project.plot ? ["walkout", "stepped"].includes(plotImplications(project.plot, houseSpot(project)).foundation.type) : false;
  out.foundation = foundationOf({
    main,
    ...zonesInput,
    upper: upperRegions,
    soilPsf: settings.soilPsf,
    hillside,
    groundAt: (p) => sc.site.groundAt(p),
    mainFraming: framing.get(main.id),
    bearingWalls: carry,
  });

  const walls: LevelWalls[] = above.map((level) => ({ level, plan: h.plan(level.id), pieces: wallPieces(h.plan(level.id), h.exteriorIn), framing: framing.get(level.id) }));
  const hd = headersFor(walls, roof);
  out.headers = hd.headers;

  // Eave to ridge: the tallest roof above the top of its walls.
  const eaveToRidgeIn = Math.max(
    0,
    ...sc.roofs.map((r) => {
      const level = h.levels.find((l) => l.id === r.levelId);
      return level ? roofTop(r.shape) - (sc.heights[level.id].floorIn + sc.heights[level.id].ceilingIn) : 0;
    }),
  );
  const aboveAt = (level: Level) => (p: Point) => upperRegions.filter((u) => sc.heights[u.level.id].floorIn > sc.heights[level.id].floorIn && insideRegions(u.regions, p)).length;
  out.bracing = above.flatMap((level) => bracingFor({ level, plan: h.plan(level.id), exteriorIn: h.exteriorIn, ceilingIn: sc.heights[level.id].ceilingIn, above: aboveAt(level), exposure: settings.windExposure, eaveToRidgeIn }));

  out.engineer = [...out.foundation.engineer, ...out.floors.flatMap((f) => f.engineer), ...hd.engineer];
  cache.set(project, out);
  return out;
}

/** The part of the main floor that's framed: over a basement or crawlspace, never the garage or a slab. */
function framedUnderMain(z: Parameters<typeof zonesOf>[0]): { regions: Region[]; over: "crawlspace" | "basement" } {
  const zones = zonesOf(z);
  const parts = [...zones.basement, ...zones.crawlspace];
  // Basement and crawlspace parts join into one floor; holes inside them stay.
  const regions = parts.length < 2 ? parts : joinRooms(parts.map((r) => r.outline)).map((r) => ({ ...r, holes: [...r.holes, ...parts.flatMap((q) => q.holes)] }));
  return { regions, over: zones.basement.length ? "basement" : "crawlspace" };
}
