import { HouseSystems, type DesignChoices, type FloorPlan, type House3D, type Level, type PlanBasics, type PlanRoom, type Point, type Selection } from "@/lib/model/schema";
import { exteriorWallIn, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { add, collinearOverlap, dist, lerp, pointInPolygon, polygonArea, polygonCenter, project, rectangle, scale, sub, subtractIntervals, unit } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { isClosedIn, stairsDrawing } from "@/lib/plan/stairs";
import { HALF_WALL_IN, openingGeometries, roomEdgeAt, WALL_CAP_IN, WALL_CAP_OVERHANG_IN, wallPieces, type OpeningGeometry, type WallPiece } from "@/lib/plan/walls";
import { wallKey } from "@/lib/interior/picks";
import { COLORS, floorColor } from "./colors";
import { drawAddOn, drawFixture, drawFurniture, drawHookup } from "./fixtures";
import { DEVICE_INFO, placedHookups } from "@/lib/plan/devices";
import { roomLook, type RoomLook } from "./finishes";
import { exteriorLook, type ExteriorLook } from "./exterior";
import { COVERED, cutHoles, floorFootprint, offsetRing, roofFootprint, subtractRegions, type Region } from "./footprint";
import { levelHeights, type LevelHeights } from "./levels";
import { against, faceOf, stretchOf, wallFootprints } from "./joints";
import { MeshBuilder, toScene, type Frame, type MeshData, type Vec3 } from "./mesh";
import { drawOpening, openingSpan, type DoorMotion } from "./openings";
import { drawRoof, roofShape, roofTop, ROOF_THICK_IN } from "./roof";
import type { Site } from "./site";
import { entrySteps } from "./entry";
import { drawStairs, prism } from "./stairs";
import { drawRailing, riseFromHeights, type RailingMeshes } from "./railings";
import { railingsOn } from "@/lib/plan/railings";
import type { Quality } from "@/lib/graphics";
import { buildYard } from "./yard";
import { BASE_KINDS, cabinetLayout } from "@/lib/plan/cabinets";
import { codeNum } from "@/lib/codes/data";
import { overhangsOf, postsUnder, supportOf } from "@/lib/plan/support";
import { ROOF_STEP_DEG, flatPlans, sourceEdge } from "@/lib/plan/flatten";

/**
 * The whole 3D house from the project: walls with doors and windows cut in,
 * floors, stairs, fixtures, roofs and the foundation down to the ground.
 * Pure data (see mesh.ts), so the 3D views stay in step with the plan and it
 * can all be tested.
 */

export type PickKind = "room" | "opening" | "stairs" | "fixture" | "yard";
export type Pick = { kind: PickKind; id: string; levelId: string };

export type Layer = "walls" | "footprints" | "floors" | "ceilings" | "openings" | "stairs" | "fixtures" | "furniture" | "roof" | "foundation" | "yard";

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
  /**
   * A door's moving part (leaf, sliding pane, garage door), drawn closed. The 3D view and the
   * walkthrough draw these on their own so they can swing, slide or roll up; everything else
   * (and the PDF sheets) just see them closed.
   */
  door?: { id: string; motion: DoorMotion };
  /** Furniture is picked in the walkthrough only, so it carries its id here rather than a `pick`. */
  furnitureId?: string;
  /** Drawn only with this graphics setting (railing balusters with Pretty, a see-through panel in their place with Fast). Left out: always. */
  quality?: Quality;
};

/** The parts drawn with a graphics setting. */
export const forQuality = (parts: Part[], quality: Quality) => parts.filter((p) => !p.quality || p.quality === quality);

export type HouseContext = {
  levels: Level[];
  basics: PlanBasics | null;
  house3d: House3D;
  site: Site;
  frame: Frame;
  /** Interior picks, for floor, wall, cabinet and appliance colors. */
  interior?: Selection[];
  /** Exterior picks: siding, roof, trim, windows, doors, the deck and patio, the yard. */
  exterior?: DesignChoices;
  /** Fuel choices, for the gas hookups behind fixtures. Left out: the usual defaults. */
  systems?: HouseSystems;
};

/** How the outside looks: gable ends only count for gable and shed roofs. */
export function lookOutside(ctx: { exterior?: DesignChoices; house3d: House3D }): ExteriorLook {
  return exteriorLook(ctx.exterior, ctx.house3d.roof.style === "gable" || ctx.house3d.roof.style === "shed");
}

const solidColor = (c: [number, number, number]) => ({ left: c, right: c, ends: c, top: c });
const FOOTPRINT_COLOR = { outside: solidColor(COLORS.footprintOutside), inside: solidColor(COLORS.footprintInside) };

/** Floor structure under the lowest floor (a slab or the floor over a crawlspace). */
const GROUND_SLAB_IN = 8;
/** The beam under a room held up on posts (a built-up 2x12). */
const BEAM_DEPTH_IN = 11.25;
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
  plans = flatPlans(plans);
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
  const ext = lookOutside(ctx);
  // A stone or brick band along the base of the outside walls, on floors on the ground.
  const band = ext.accent?.place === "base" && level.kind !== "basement" && Math.abs(floorIn) <= 12 ? ext.accent : null;
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
  const standing = pieces.filter((p) => !p.open && dist(p.a, p.b) > 0.01);
  // Outside walls run up to the next floor where there's one above, so there's no gap at the floor structure.
  // A half wall stops at 42" (its counter cap, if any, goes on top below).
  const upTos = standing.map((p) =>
    p.height ? floorIn + Math.min(HALF_WALL_IN, ceilingIn) : p.exterior && above && covers(abovePolys, lerp(p.a, p.b, 0.5)) ? heights[above.id].floorIn : topIn,
  );
  // Where walls meet, their ends are mitered or cut to each other's faces (see joints.ts), so no two overlap.
  const jp = standing.map((p) => ({ a: p.a, b: p.b, thicknessIn: p.thicknessIn, exterior: p.exterior }));
  const feet = wallFootprints(jp);
  // The counter caps on half walls, a little wider than the wall (and past a free end), meet the same way.
  const capFeet = standing.some((p) => p.height === "half-cap")
    ? wallFootprints(
        standing.map((p, i) => ({ ...jp[i], thicknessIn: p.thicknessIn + (p.height === "half-cap" ? WALL_CAP_OVERHANG_IN * 2 : 0) })),
        () => WALL_CAP_OVERHANG_IN,
      )
    : [];
  // The foundation under outside walls, an inch wider than the wall, where nothing is underneath.
  const founded = standing.map((p, i) => ({ p, i })).filter(({ p }) => p.exterior && floorIn <= 1 && !covers(belowPolys, lerp(p.a, p.b, 0.5), 2));
  const foundJp = founded.map(({ p }) => ({ a: p.a, b: p.b, thicknessIn: p.thicknessIn + 1, exterior: true }));
  const foundFeet = wallFootprints(foundJp, (i) => foundJp[i].thicknessIn / 2);
  standing.forEach((p, pi) => {
    const len = dist(p.a, p.b);
    const mid = lerp(p.a, p.b, 0.5);
    const upTo = upTos[pi];
    // Where the wall runs up into the floor above, its top is inside the floor structure (and would flicker with the floor).
    const buried = !p.height && above !== undefined && upTo === heights[above.id].floorIn;
    // Each side of a wall takes the paint of the room it faces, or that wall's own accent paint
    // (the left side of an outside wall is the siding).
    const side = (sign: 1 | -1) => {
      const u = unit(sub(p.b, p.a));
      const r = roomAt(add(mid, scale({ x: u.y, y: -u.x }, sign * (p.thicknessIn / 2 + 4))));
      const look = r && looks.get(r.id);
      if (!r || !look) return COLORS.drywall;
      const edge = look.accents.size ? roomEdgeAt(r.polygon, mid, p.thicknessIn / 2 + 2, { x: u.y, y: -u.x }) : null;
      return (edge !== null && look.accents.get(wallKey(sourceEdge(r, edge)))) || look.wall;
    };
    const color = p.exterior
      ? { left: ext.siding.color, leftPattern: ext.siding.pattern, right: side(-1), ends: ext.siding.color }
      : { left: side(1), right: side(-1), ends: COLORS.drywall };
    const bandColor = band && { ...color, left: band.color, leftPattern: band.pattern, ends: band.color };
    const paint = (c: typeof color) => (a: Point, b: Point) => {
      const which = faceOf(jp[pi], a, b);
      if (which === "left") return { color: c.left, pattern: c.leftPattern };
      if (which === "right") return { color: c.right };
      // An end against another wall shows only above that wall.
      const j = against(feet, pi, a, b);
      return { color: c.ends, pattern: p.exterior ? c.leftPattern : undefined, from: j >= 0 ? upTos[j] : -Infinity };
    };
    const tol = Math.max(2, p.thicknessIn / 2 + 0.5);
    const cuts: { t0: number; t1: number; og: OpeningGeometry }[] = [];
    for (const og of ogs) {
      const o = collinearOverlap(p.a, p.b, og.a, og.b, tol);
      if (o) cuts.push({ t0: o[0], t1: o[1], og });
    }
    const group: WallGroup = p.exterior ? "outside" : "inside";
    const piece = (t0: number, t1: number, z0: number, z1: number) => {
      const top = band && p.exterior ? floorIn + band.heightIn : -Infinity;
      for (const r of stretchOf(feet[pi], jp[pi], t0, t1)) {
        if (bandColor && z0 < top) {
          walls[group].prism(f, r, z0, Math.min(z1, top), paint(bandColor), z1 > top ? null : COLORS.wallTop);
          if (z1 > top) walls[group].prism(f, r, top, z1, paint(color), buried && z1 >= upTo ? null : COLORS.wallTop);
        } else walls[group].prism(f, r, z0, z1, paint(color), buried && z1 >= upTo ? null : COLORS.wallTop);
      }
    };
    for (const [t0, t1] of subtractIntervals(len, cuts.map((c) => [c.t0, c.t1]))) piece(t0, t1, floorIn, upTo);
    for (const c of cuts) {
      const { bottom, top } = openingSpan(c.og, ceilingIn);
      if (bottom > 0.5) piece(c.t0, c.t1, floorIn, Math.min(upTo, floorIn + bottom));
      if (floorIn + top < upTo - 0.5) piece(c.t0, c.t1, floorIn + top, upTo);
    }
    if (p.height === "half-cap") {
      const cc = lookAt(mid)?.counter ?? COLORS.counter;
      for (const r of capFeet[pi]) walls[group].prism(f, r, upTo, upTo + WALL_CAP_IN, (a, b) => (against(capFeet, pi, a, b) >= 0 ? null : { color: cc }), cc);
    }
    // The footprint: everywhere the wall meets the floor, so only doorways (openings down to the floor) leave gaps.
    const doorways = cuts.filter((c) => openingSpan(c.og, ceilingIn).bottom <= 0.5).map((c): [number, number] => [c.t0, c.t1]);
    const fc = FOOTPRINT_COLOR[group];
    for (const [t0, t1] of subtractIntervals(len, doorways))
      for (const r of stretchOf(feet[pi], jp[pi], t0, t1)) prints[group].prism(f, r, floorIn, floorIn + FOOTPRINT_IN, (a, b) => (against(feet, pi, a, b) >= 0 ? null : { color: fc.left }), fc.top);
    // Foundation: from below the ground up to this floor, where nothing is underneath.
    const fi = founded.findIndex((x) => x.i === pi);
    if (fi >= 0) {
      let low = Infinity;
      const steps = Math.max(2, Math.ceil(len / 24));
      for (let k = 0; k <= steps; k++) low = Math.min(low, site.groundAt(lerp(p.a, p.b, k / steps)));
      const bottom = Math.min(low - 12, floorIn - GROUND_SLAB_IN);
      const c = COLORS.foundation;
      if (floorIn - bottom > 2) for (const r of foundFeet[fi]) found.prism(f, r, bottom, floorIn, (a, b) => (against(foundFeet, fi, a, b) >= 0 ? null : { color: c }), c);
    }
  });
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
    const leaves = drawOpening(solid, glass, f, og, hostThickness(host), floorIn, ceilingIn, doorLook, host?.exterior ? ext : undefined);
    const pick: Pick = { kind: "opening", id: og.opening.id, levelId: L };
    // Doors and windows hide with the wall they're in (an opening in no wall counts as inside).
    const wall: WallGroup = host?.exterior ? "outside" : "inside";
    if (!solid.empty) parts.push({ key: `${L}:o:${og.opening.id}`, levelId: L, layer: "openings", pick, wall, mesh: solid.build() });
    if (!glass.empty) parts.push({ key: `${L}:og:${og.opening.id}`, levelId: L, layer: "openings", pick, wall, mesh: glass.build(), glass: true });
    leaves.forEach((leaf, i) => {
      const door = { id: og.opening.id, motion: leaf.motion };
      if (!leaf.solid.empty) parts.push({ key: `${L}:ol:${og.opening.id}:${i}`, levelId: L, layer: "openings", pick, wall, mesh: leaf.solid.build(), door });
      if (!leaf.glass.empty) parts.push({ key: `${L}:olg:${og.opening.id}:${i}`, levelId: L, layer: "openings", pick, wall, mesh: leaf.glass.build(), glass: true, door });
    });
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
    // Decks and patios take the picked decking and pavers.
    const out = room.type === "deck" ? ext.deck : room.type === "patio" ? ext.patio : { color: floorColor(room), pattern: 0 };
    for (const r of cutHoles(room.polygon, stairHoles)) drawSlab(mb, f, r, floorIn, thick, outdoor ? out.color : look.floor, outdoor ? out.pattern : look.floorPattern);
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

  // ---- Overhangs: the underside of any room past the floor below, and posts and a beam where it's "On posts" ----
  const sup = supportOf(plans, ctx.levels, level);
  if (sup) {
    const under = floorIn - 13;
    for (const o of overhangsOf(plan.rooms, sup.regions)) {
      const mb = new MeshBuilder();
      for (const piece of o.pieces) mb.flat(f, piece, [], under - 0.25, ext.trim, false);
      if (o.kind === "posts") {
        const { posts, beams } = postsUnder(o, sup.regions);
        const inward = (p: Point, d: number) => {
          const c = polygonCenter(o.pieces.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a)));
          return add(p, scale(unit(sub(c, p)), d));
        };
        const beamBottom = under - 0.25 - BEAM_DEPTH_IN;
        for (const [a, b] of beams) {
          const n = unit({ x: -(b.y - a.y), y: b.x - a.x });
          const mid = lerp(a, b, 0.5);
          // Set the beam just inside the outer edge.
          const toward = pointInPolygon(add(mid, scale(n, 3)), o.pieces.find((pc) => pc.some((q) => dist(q, a) < 1)) ?? o.pieces[0]) ? n : scale(n, -1);
          mb.box(f, add(a, scale(toward, 3)), add(b, scale(toward, 3)), 5.5, beamBottom, under - 0.25, { left: ext.trim, right: ext.trim, ends: ext.trim, top: ext.trim, bottom: ext.trim });
        }
        for (const p of posts) {
          const at = inward(p, 4);
          mb.block(f, at, 0, 5.5, 5.5, Math.min(site.groundAt(at), floorIn) - 2, beamBottom, ext.trim);
        }
      }
      if (!mb.empty) parts.push({ key: `${L}:oh:${o.roomId}`, levelId: L, layer: "floors", pick: { kind: "room", id: o.roomId, levelId: L }, mesh: mb.build() });
    }
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
    drawStairs(mb, f, s, rise, floorIn, isClosedIn(s, rise, stairHoles));
    parts.push({ key: `${L}:s:${s.id}`, levelId: L, layer: "stairs", pick: { kind: "stairs", id: s.id, levelId: L }, mesh: mb.build() });
  }

  // ---- Railings: this floor's stairs, and guards around stairwells coming up into it ----
  const rails = new Map<string, { pick: Pick; m: RailingMeshes }>();
  for (const r of railingsOn(plans, L, riseFromHeights(heights))) {
    let g = rails.get(r.stairsId);
    if (!g) {
      g = { pick: { kind: "stairs", id: r.stairsId, levelId: r.stairsLevelId }, m: { solid: new MeshBuilder(), glass: new MeshBuilder(), balusters: new MeshBuilder(), panel: new MeshBuilder() } };
      rails.set(r.stairsId, g);
    }
    drawRailing(g.m, f, r, floorIn, ceilingIn);
  }
  for (const [id, { pick, m }] of rails) {
    const base = { levelId: L, layer: "stairs" as const, pick };
    if (!m.solid.empty) parts.push({ ...base, key: `${L}:rail:${id}`, mesh: m.solid.build() });
    if (!m.glass.empty) parts.push({ ...base, key: `${L}:railg:${id}`, mesh: m.glass.build(), glass: true });
    if (!m.balusters.empty) parts.push({ ...base, key: `${L}:railb:${id}`, mesh: m.balusters.build(), quality: "pretty" });
    if (!m.panel.empty) parts.push({ ...base, key: `${L}:railp:${id}`, mesh: m.panel.build(), glass: true, quality: "fast" });
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

  // ---- Upper and tall cabinets (base cabinets are part of the counters) ----
  // Base boxes the app lays out are drawn as the counters; hand-placed ones of any kind are drawn as boxes.
  const counters = plan.fixtures.filter((x) => x.kind === "counter" || x.kind === "island" || x.kind === "vanity");
  const underCounter = (c: { x: number; y: number }) => counters.some((x) => pointInPolygon(c, rectangle(x.x, x.y, x.widthIn, x.depthIn, x.rotation)));
  const hung = cabinetLayout(plan, ceilingIn, codeNum("kitchen.rangeClearanceAbove")).cabinets.filter(
    (c) => !BASE_KINDS.has(c.kind) || c.bottomIn > 24 || (!c.auto && !underCounter(c)),
  );
  if (hung.length) {
    const mb = new MeshBuilder();
    for (const c of hung) {
      const look = lookAt({ x: c.x, y: c.y });
      mb.block(f, { x: c.x, y: c.y }, c.rotation, c.widthIn - 0.25, c.depthIn, floorIn + c.bottomIn, floorIn + c.bottomIn + c.heightIn, look?.cabinet ?? COLORS.cabinet);
    }
    parts.push({ key: `${L}:cab`, levelId: L, layer: "fixtures", mesh: mb.build() });
  }

  // ---- Built-ins and extras, and the hookups behind fixtures ----
  for (const a of plan.addOns ?? []) {
    const mb = new MeshBuilder();
    drawAddOn(mb, f, a, floorIn);
    if (!mb.empty) parts.push({ key: `${L}:ao:${a.id}`, levelId: L, layer: "fixtures", mesh: mb.build() });
  }
  const hookups = placedHookups(plan, ctx.systems ?? HouseSystems.parse({}));
  if (hookups.length) {
    const mb = new MeshBuilder();
    for (const d of hookups) drawHookup(mb, f, d, floorIn, DEVICE_INFO[d.kind].mountIn ?? 16);
    if (!mb.empty) parts.push({ key: `${L}:hk`, levelId: L, layer: "fixtures", mesh: mb.build() });
  }

  // ---- Furniture ----
  for (const item of plan.furniture) {
    const mb = new MeshBuilder();
    drawFurniture(mb, f, item, floorIn);
    if (!mb.empty) parts.push({ key: `${L}:fu:${item.id}`, levelId: L, layer: "furniture", furnitureId: item.id, mesh: mb.build() });
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
export function buildRoofs(plans: Plans, ctx: HouseContext & { heights: LevelHeights }): { parts: Part[]; fellBack: boolean; leansOnWall: boolean; topIn: number } {
  plans = flatPlans(plans, ROOF_STEP_DEG);
  const { heights, frame: f } = ctx;
  const ordered = stack(ctx.levels, heights);
  const exteriorIn = exteriorWallIn(ctx.basics);
  const parts: Part[] = [];
  let fellBack = false;
  let leansOnWall = false;
  let topIn = -Infinity;
  ordered.forEach((level, i) => {
    const regions = roofFootprint(planOf(plans, level.id));
    if (!regions.length) return;
    // Whatever the next floor up doesn't cover needs a roof (even where a floor further up hangs over it).
    const next = ordered.slice(i + 1).find((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
    const above = next ? floorFootprint(planOf(plans, next.id)) : [];
    const exposed = subtractRegions(regions, above);
    if (!exposed.length) return;
    const { floorIn, ceilingIn } = heights[level.id];
    // Where this roof meets the next floor's walls, it stops at their face.
    const upper = next && { regions: above, topIn: heights[next.id].floorIn + heights[next.id].ceilingIn };
    const mb = { roof: new MeshBuilder(), trim: new MeshBuilder(), siding: new MeshBuilder() };
    const ext = lookOutside(ctx);
    // Below ground floors that stick out get a flat top (usually a deck or patio over them).
    const flat = level.kind === "basement" || floorIn < 0;
    for (const found of exposed) {
      // Small pockets between rooms get roofed over rather than left as tiny open-air wells.
      const r = { ...found, holes: found.holes.filter((h) => polygonArea(h) > 150 * 144) };
      const shape = roofShape(r, floorIn + ceilingIn, exteriorIn, ctx.house3d.roof, flat, upper);
      leansOnWall ||= !!shape.leansOnWall;
      fellBack ||= shape.fellBack;
      topIn = Math.max(topIn, roofTop(shape));
      drawRoof(mb, f, shape, ROOF_THICK_IN, ext);
    }
    for (const [k, b] of Object.entries(mb)) if (!b.empty) parts.push({ key: `${level.id}:roof:${k}`, levelId: level.id, layer: "roof", mesh: b.build() });
  });
  return { parts, fellBack, leansOnWall, topIn };
}

/** Basements and other floors below the ground, grown to the outside of their walls: where the ground is dug out. */
export function dugOut(plans: Plans, ctx: HouseContext & { heights: LevelHeights }): Point[][] {
  plans = flatPlans(plans);
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
  const yard = ctx.exterior ? buildYard(plans, c) : [];
  return { heights, parts: [...parts, ...roofs.parts, ...yard], roofFellBack: roofs.fellBack, bounds: houseBounds(plans, c, roofs.topIn) };
}

export function houseBounds(plans: Plans, ctx: HouseContext & { heights: LevelHeights }, roofTopIn: number): HouseModel["bounds"] {
  plans = flatPlans(plans);
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

