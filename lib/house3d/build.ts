import type { FloorPlan, House3D, Level, PlanBasics, PlanRoom, Point, Selection } from "@/lib/model/schema";
import { exteriorWallIn, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { add, collinearOverlap, dist, lerp, pointInPolygon, polygonArea, polygonCenter, project, scale, sub, subtractIntervals, unit } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { stairsDrawing } from "@/lib/plan/stairs";
import { openingGeometries, wallPieces, type OpeningGeometry, type WallPiece } from "@/lib/plan/walls";
import { COLORS, floorColor } from "./colors";
import { drawFixture } from "./fixtures";
import { roomLook, type RoomLook } from "./finishes";
import { COVERED, cutHoles, floorFootprint, offsetRing, roofFootprint, subtractRegions, type Region } from "./footprint";
import { levelHeights, type LevelHeights } from "./levels";
import { MeshBuilder, toScene, type Frame, type MeshData, type Vec3 } from "./mesh";
import { drawOpening, openingSpan } from "./openings";
import { drawRoof, roofShape, roofTop, ROOF_THICK_IN } from "./roof";
import type { Site } from "./site";
import { entrySteps } from "./entry";
import { drawStairs, prism } from "./stairs";

/**
 * The whole 3D house from the project: walls with doors and windows cut in,
 * floors, stairs, fixtures, roofs and the foundation down to the ground.
 * Pure data (see mesh.ts), so the 3D views stay in step with the plan and it
 * can all be tested.
 */

export type PickKind = "room" | "opening" | "stairs" | "fixture";
export type Pick = { kind: PickKind; id: string; levelId: string };

export type Layer = "walls" | "footprints" | "floors" | "ceilings" | "openings" | "stairs" | "fixtures" | "roof" | "foundation";

/** Which walls a part belongs to: outside (exterior) walls or inside ones. */
export type WallGroup = "outside" | "inside";

export type Part = {
  key: string;
  /** The floor it belongs to (roofs: the floor they cover). */
  levelId: string;
  layer: Layer;
  pick?: Pick;
  mesh: MeshData;
  glass?: boolean;
  /**
   * Walls, their footprint strips, and the doors and windows in them say
   * which walls they belong to, so the 3D view can hide a group of walls
   * along with everything in them.
   */
  wall?: WallGroup;
};

export type HouseContext = {
  levels: Level[];
  basics: PlanBasics | null;
  house3d: House3D;
  site: Site;
  frame: Frame;
  /** Interior picks, for floor, wall, cabinet and appliance colors. */
  interior?: Selection[];
};

const solidColor = (c: [number, number, number]) => ({ left: c, right: c, ends: c, top: c });
const FOOTPRINT_COLOR = { outside: solidColor(COLORS.footprintOutside), inside: solidColor(COLORS.footprintInside) };

/** Floor structure under the lowest floor (a slab or the floor over a crawlspace). */
const GROUND_SLAB_IN = 8;
const OUTDOOR_SLAB_IN = 5;

const covers = (polys: Point[][], p: Point, near = 6) =>
  polys.some((poly) => pointInPolygon(p, poly) || poly.some((a, i) => project(p, a, poly[(i + 1) % poly.length]).d < near));

const indoorPolys = (pl: FloorPlan | undefined) => (pl?.rooms ?? []).filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon);

/** The levels in order from the bottom, with their plans. */
function stack(levels: Level[], heights: LevelHeights) {
  return [...levels].sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn);
}

/** The wall piece a door or window sits in. */
export function hostPiece(pieces: WallPiece[], og: OpeningGeometry): WallPiece | undefined {
  return pieces.find((p) => {
    const pr = project(og.center, p.a, p.b);
    return pr.d < 1 && pr.t > 0.01 && pr.t < pr.length - 0.01;
  });
}

/** The thickness of the wall a door or window sits in. */
function hostThickness(host: WallPiece | undefined): number {
  return host && !host.open ? host.thicknessIn : INTERIOR_WALL_IN;
}

/** How thick the wall footprint strips are (a little over the floor, so they show). */
export const FOOTPRINT_IN = 0.75;

/** Everything for one floor. Rebuilt only when that floor's plan (or its neighbors') changes. */
export function buildLevel(
  plans: Plans,
  level: Level,
  ctx: HouseContext & { heights: LevelHeights },
): Part[] {
  const plan = planOf(plans, level.id);
  const { frame: f, heights, site } = ctx;
  const ordered = stack(ctx.levels, heights);
  const idx = ordered.findIndex((l) => l.id === level.id);
  const above = ordered.slice(idx + 1).find((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
  const below = ordered.slice(0, idx).reverse().find((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
  const { floorIn, ceilingIn } = heights[level.id];
  const topIn = floorIn + ceilingIn;
  const exteriorIn = exteriorWallIn(ctx.basics);
  const abovePolys = indoorPolys(above && plans[above.id]);
  const belowPolys = indoorPolys(below && plans[below.id]);
  const parts: Part[] = [];
  const L = level.id;
  const looks = new Map<string, RoomLook>(plan.rooms.map((r) => [r.id, roomLook(ctx.interior, r)]));
  /** The room a point is in, for picking its finishes. */
  const roomAt = (pt: Point) => plan.rooms.find((r) => areaKind(r) !== "outdoor" && pointInPolygon(pt, r.polygon));
  const lookAt = (pt: Point) => {
    const r = roomAt(pt);
    return r ? looks.get(r.id) : undefined;
  };

  // ---- Walls ----
  const pieces = wallPieces(plan, exteriorIn);
  const ogs = openingGeometries(plan);
  const walls = { outside: new MeshBuilder(), inside: new MeshBuilder() };
  // Where each wall stands on the floor: shown in its place when the wall is hidden.
  const prints = { outside: new MeshBuilder(), inside: new MeshBuilder() };
  const found = new MeshBuilder();
  for (const p of pieces) {
    if (p.open) continue;
    const len = dist(p.a, p.b);
    const mid = lerp(p.a, p.b, 0.5);
    // Outside walls run up to the next floor where there's one above, so there's no gap at the floor structure.
    const upTo = p.exterior && above && covers(abovePolys, mid) ? heights[above.id].floorIn : topIn;
    // Each side of a wall takes the paint of the room it faces (the left side of an outside wall is the siding).
    const side = (sign: 1 | -1) => {
      const u = unit(sub(p.b, p.a));
      return lookAt(add(mid, scale({ x: u.y, y: -u.x }, sign * (p.thicknessIn / 2 + 4))))?.wall ?? COLORS.drywall;
    };
    const color = p.exterior
      ? { left: COLORS.siding, right: side(-1), ends: COLORS.siding, top: COLORS.wallTop }
      : { left: side(1), right: side(-1), ends: COLORS.drywall, top: COLORS.wallTop };
    const tol = Math.max(2, p.thicknessIn / 2 + 0.5);
    const cuts: { t0: number; t1: number; og: OpeningGeometry }[] = [];
    for (const og of ogs) {
      const o = collinearOverlap(p.a, p.b, og.a, og.b, tol);
      if (o) cuts.push({ t0: o[0], t1: o[1], og });
    }
    const group: WallGroup = p.exterior ? "outside" : "inside";
    // Run on past a corner by half the wall's thickness, for a clean corner.
    const ends = (t0: number, t1: number, capA: boolean, capB: boolean) => [
      lerp(p.a, p.b, (t0 - (capA ? p.thicknessIn / 2 : 0)) / len),
      lerp(p.a, p.b, (t1 + (capB ? p.thicknessIn / 2 : 0)) / len),
    ];
    const piece = (t0: number, t1: number, z0: number, z1: number, capA: boolean, capB: boolean) => {
      const [a, b] = ends(t0, t1, capA, capB);
      walls[group].box(f, a, b, p.thicknessIn, z0, z1, color);
    };
    for (const [t0, t1] of subtractIntervals(len, cuts.map((c) => [c.t0, c.t1]))) piece(t0, t1, floorIn, upTo, t0 < 0.01, t1 > len - 0.01);
    for (const c of cuts) {
      const { bottom, top } = openingSpan(c.og, ceilingIn);
      if (bottom > 0.5) piece(c.t0, c.t1, floorIn, floorIn + bottom, false, false);
      if (floorIn + top < upTo - 0.5) piece(c.t0, c.t1, floorIn + top, upTo, false, false);
    }
    // The footprint: everywhere the wall meets the floor, so only doorways (openings down to the floor) leave gaps.
    const doorways = cuts.filter((c) => openingSpan(c.og, ceilingIn).bottom <= 0.5).map((c): [number, number] => [c.t0, c.t1]);
    for (const [t0, t1] of subtractIntervals(len, doorways)) {
      const [a, b] = ends(t0, t1, t0 < 0.01, t1 > len - 0.01);
      prints[group].box(f, a, b, p.thicknessIn, floorIn, floorIn + FOOTPRINT_IN, FOOTPRINT_COLOR[group]);
    }
    // Foundation: from below the ground up to this floor, where nothing is underneath.
    if (p.exterior && floorIn <= 1 && !covers(belowPolys, mid, 2)) {
      let low = Infinity;
      const n = Math.max(2, Math.ceil(len / 24));
      for (let k = 0; k <= n; k++) low = Math.min(low, site.groundAt(lerp(p.a, p.b, k / n)));
      const bottom = Math.min(low - 12, floorIn - GROUND_SLAB_IN);
      if (floorIn - bottom > 2) {
        const a = lerp(p.a, p.b, -p.thicknessIn / 2 / len);
        const b = lerp(p.a, p.b, 1 + p.thicknessIn / 2 / len);
        const c = COLORS.foundation;
        found.box(f, a, b, p.thicknessIn + 1, bottom, floorIn, { left: c, right: c, ends: c, top: c });
      }
    }
  }
  for (const g of ["outside", "inside"] as const) {
    if (!walls[g].empty) parts.push({ key: `${L}:walls:${g}`, levelId: L, layer: "walls", wall: g, mesh: walls[g].build() });
    if (!prints[g].empty) parts.push({ key: `${L}:footprints:${g}`, levelId: L, layer: "footprints", wall: g, mesh: prints[g].build() });
  }
  if (!found.empty) parts.push({ key: `${L}:foundation`, levelId: L, layer: "foundation", mesh: found.build() });

  // ---- Doors and windows ----
  for (const og of ogs) {
    const solid = new MeshBuilder();
    const glass = new MeshBuilder();
    const host = hostPiece(pieces, og);
    const doorLook = host && !host.exterior ? (lookAt(add(og.center, scale(og.n, 10))) ?? lookAt(add(og.center, scale(og.n, -10)))) : undefined;
    drawOpening(solid, glass, f, og, hostThickness(host), floorIn, ceilingIn, doorLook);
    const pick: Pick = { kind: "opening", id: og.opening.id, levelId: L };
    // Doors and windows hide with the wall they're in (an opening in no wall counts as inside).
    const wall: WallGroup = host?.exterior ? "outside" : "inside";
    if (!solid.empty) parts.push({ key: `${L}:o:${og.opening.id}`, levelId: L, layer: "openings", pick, wall, mesh: solid.build() });
    if (!glass.empty) parts.push({ key: `${L}:og:${og.opening.id}`, levelId: L, layer: "openings", pick, wall, mesh: glass.build(), glass: true });
  }

  // ---- Floors ----
  // Stairs coming up from below cut a hole in this floor.
  const stairHoles: Point[][] = [];
  for (const other of ctx.levels) {
    for (const s of plans[other.id]?.stairs ?? []) {
      if (s.toLevelId !== L || !heights[other.id]) continue;
      stairHoles.push(stairsDrawing(s, floorIn - heights[other.id].floorIn).footprint);
    }
  }
  for (const room of plan.rooms) {
    const outdoor = areaKind(room) === "outdoor";
    const mb = new MeshBuilder();
    const thick = outdoor ? OUTDOOR_SLAB_IN : below || floorIn > 1 ? 13 : GROUND_SLAB_IN;
    const look = looks.get(room.id)!;
    for (const r of cutHoles(room.polygon, stairHoles)) drawSlab(mb, f, r, floorIn, thick, outdoor ? floorColor(room) : look.floor, outdoor ? 0 : look.floorPattern);
    // Posts hold up the roof over a porch or covered patio, at its corners away from the house.
    if (outdoor && COVERED.has(room.type ?? "")) {
      const house = indoorPolys(plan);
      for (const c of room.polygon) {
        if (covers(house, c, 8)) continue;
        const toward = scale(sub(polygonCenter(room.polygon), c), 1);
        const inset = add(c, scale(unit(toward), 4));
        mb.block(f, inset, 0, 5.5, 5.5, floorIn, topIn, COLORS.trim);
      }
    }
    // Porches, decks and patios on the ground get a skirt down to the ground.
    if (outdoor && floorIn <= 1) {
      const low = Math.min(...room.polygon.map(site.groundAt));
      if (floorIn - thick - low > 1) skirt(mb, f, room, low - 6, floorIn - thick);
    }
    if (!mb.empty) parts.push({ key: `${L}:r:${room.id}`, levelId: L, layer: "floors", pick: { kind: "room", id: room.id, levelId: L }, mesh: mb.build() });
  }

  // ---- Ceilings, where nothing is built on top (seen from inside) ----
  const open = subtractRegions(floorFootprint(plan), above ? floorFootprint(plans[above.id]) : []);
  if (open.length) {
    const mb = new MeshBuilder();
    for (const r of open) mb.flat(f, r.outline, r.holes, topIn, COLORS.ceiling, false);
    parts.push({ key: `${L}:ceiling`, levelId: L, layer: "ceilings", mesh: mb.build() });
  }

  // ---- Stairs ----
  for (const s of plan.stairs) {
    const to = s.toLevelId && heights[s.toLevelId];
    const rise = to ? to.floorIn - floorIn : ceilingIn + 13;
    if (rise <= 12) continue;
    const mb = new MeshBuilder();
    drawStairs(mb, f, s, rise, floorIn);
    parts.push({ key: `${L}:s:${s.id}`, levelId: L, layer: "stairs", pick: { kind: "stairs", id: s.id, levelId: L }, mesh: mb.build() });
  }

  // ---- Steps down to the ground from outside doors and porches ----
  const entry = entrySteps(plan, floorIn, exteriorIn, site.groundAt);
  if (entry.length) {
    const mb = new MeshBuilder();
    for (const s of entry) prism(mb, f, s.outline, Math.min(...s.outline.map(site.groundAt)) - 6, s.top, COLORS.concrete, COLORS.concrete);
    parts.push({ key: `${L}:entry`, levelId: L, layer: "stairs", mesh: mb.build() });
  }

  // ---- Fixtures ----
  for (const fx of plan.fixtures) {
    const solid = new MeshBuilder();
    const glass = new MeshBuilder();
    const fxRoom = fx.roomId ? looks.get(fx.roomId) : lookAt({ x: fx.x, y: fx.y });
    drawFixture(solid, glass, f, fx, floorIn, fxRoom);
    const pick: Pick = { kind: "fixture", id: fx.id, levelId: L };
    if (!solid.empty) parts.push({ key: `${L}:f:${fx.id}`, levelId: L, layer: "fixtures", pick, mesh: solid.build() });
    if (!glass.empty) parts.push({ key: `${L}:fg:${fx.id}`, levelId: L, layer: "fixtures", pick, mesh: glass.build(), glass: true });
  }
  return parts;
}

/** A floor slab: the top in the room's flooring, the bottom as the ceiling below, and its edges. */
function drawSlab(mb: MeshBuilder, f: Frame, r: Region, floorIn: number, thick: number, color: [number, number, number], pattern = 0) {
  // Only the top gets the floor pattern.
  mb.pattern = pattern;
  mb.flat(f, r.outline, r.holes, floorIn, color, true);
  mb.pattern = 0;
  mb.flat(f, r.outline, r.holes, floorIn - thick, COLORS.ceiling, false);
  for (const ring of [r.outline, ...r.holes]) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      // Outlines go clockwise on screen and holes the other way, so the left side is always out.
      mb.upright(f, a, b, floorIn - thick, floorIn, floorIn - thick, floorIn, { x: b.y - a.y, y: a.x - b.x }, COLORS.slabEdge);
    });
  }
}

function skirt(mb: MeshBuilder, f: Frame, room: PlanRoom, z0: number, z1: number) {
  const ring = room.polygon;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    mb.upright(f, a, b, z0, z1, z0, z1, { x: b.y - a.y, y: a.x - b.x }, COLORS.foundation);
  });
}

/** Roofs over every part of the house with nothing built on top. */
export function buildRoofs(plans: Plans, ctx: HouseContext & { heights: LevelHeights }): { parts: Part[]; fellBack: boolean; topIn: number } {
  const { heights, frame: f } = ctx;
  const ordered = stack(ctx.levels, heights);
  const exteriorIn = exteriorWallIn(ctx.basics);
  const parts: Part[] = [];
  let fellBack = false;
  let topIn = -Infinity;
  ordered.forEach((level, i) => {
    const regions = roofFootprint(planOf(plans, level.id));
    if (!regions.length) return;
    // Whatever the next floor up doesn't cover needs a roof (even where a floor further up hangs over it).
    const next = ordered.slice(i + 1).find((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
    const exposed = subtractRegions(regions, next ? floorFootprint(planOf(plans, next.id)) : []);
    if (!exposed.length) return;
    const { floorIn, ceilingIn } = heights[level.id];
    const mb = { roof: new MeshBuilder(), trim: new MeshBuilder(), siding: new MeshBuilder() };
    // Below ground floors that stick out get a flat top (usually a deck or patio over them).
    const flat = level.kind === "basement" || floorIn < 0;
    for (const found of exposed) {
      // Small pockets between rooms get roofed over rather than left as tiny open-air wells.
      const r = { ...found, holes: found.holes.filter((h) => polygonArea(h) > 150 * 144) };
      const shape = roofShape(r, floorIn + ceilingIn, exteriorIn, ctx.house3d.roof, flat);
      fellBack ||= shape.fellBack;
      topIn = Math.max(topIn, roofTop(shape));
      drawRoof(mb, f, shape, ROOF_THICK_IN);
    }
    for (const [k, b] of Object.entries(mb)) if (!b.empty) parts.push({ key: `${level.id}:roof:${k}`, levelId: level.id, layer: "roof", mesh: b.build() });
  });
  return { parts, fellBack, topIn };
}

/** Basements and other floors below the ground, grown to the outside of their walls: where the ground is dug out. */
export function dugOut(plans: Plans, ctx: HouseContext & { heights: LevelHeights }): Point[][] {
  const exteriorIn = exteriorWallIn(ctx.basics);
  return ctx.levels
    .filter((l) => ctx.heights[l.id].floorIn < -12)
    .flatMap((l) => floorFootprint(planOf(plans, l.id)).map((r) => offsetRing(r.outline, exteriorIn / 2)));
}

export type HouseModel = {
  heights: LevelHeights;
  parts: Part[];
  roofFellBack: boolean;
  /** The house's extent in scene units. */
  bounds: { min: Vec3; max: Vec3 } | null;
};

/** The whole house at once (the 3D view builds floors separately so it can skip unchanged ones). */
export function buildHouse(plans: Plans, ctx: HouseContext): HouseModel {
  const heights = levelHeights(ctx.levels, ctx.basics);
  const c = { ...ctx, heights };
  const parts = ctx.levels.flatMap((l) => buildLevel(plans, l, c));
  const roofs = buildRoofs(plans, c);
  return { heights, parts: [...parts, ...roofs.parts], roofFellBack: roofs.fellBack, bounds: houseBounds(plans, c, roofs.topIn) };
}

export function houseBounds(plans: Plans, ctx: HouseContext & { heights: LevelHeights }, roofTopIn: number): HouseModel["bounds"] {
  const pts = Object.values(plans).flatMap((p) => p.rooms.flatMap((r) => r.polygon));
  if (!pts.length) return null;
  const hs = Object.values(ctx.heights);
  const lowIn = Math.min(...ctx.levels.filter((l) => (plans[l.id]?.rooms.length ?? 0) > 0).map((l) => ctx.heights[l.id].floorIn), 0) - 12;
  const highIn = Math.max(roofTopIn, ...hs.map((h) => h.floorIn + h.ceilingIn));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    min: toScene(ctx.frame, { x: Math.min(...xs), y: Math.min(...ys) }, lowIn),
    max: toScene(ctx.frame, { x: Math.max(...xs), y: Math.max(...ys) }, highIn),
  };
}

