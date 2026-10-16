import { exteriorWallIn, FLOOR_STRUCTURE_IN } from "@/lib/plan/basics";
import { openingType } from "@/lib/plan/catalog";
import { planOf } from "@/lib/plan/edit";
import { boundsOf, dist, edgesOf, pointInPolygon, polygonArea } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { openSpans, openingGeometries, WALL_CAP_OVERHANG_IN, wallPieces, wallTopIn, type WallPiece } from "@/lib/plan/walls";
import { hostPiece } from "@/lib/house3d/build";
import { floorFootprint, joinRooms, offsetRing, regionArea, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { levelHeights } from "@/lib/house3d/levels";
import { lotOffsetFor, siteFor, type Site } from "@/lib/house3d/site";
import { rockCuyd, rocksUnder } from "@/lib/land/onLot";
import { yardAmounts, yardLayout } from "@/lib/exterior/yard";
import { type Quantities, sqft, ft, FROST_DEPTH_IN, JOIST_DEPTH_IN, OVERDIG_IN, SHALLOW_DIG_IN, ringLength, samplesAround, type Ctx, empty, siteFacts, toRoad, type MeasuredRoom, roomFixtures, centerOf, applyRoof } from "./quantityBasics";
import { measureRoof } from "./measureRoof";
import { railingLengths, railingsOn } from "@/lib/plan/railings";
import { riseFromHeights } from "@/lib/house3d/railings";
import { cabinetsByRoom, furnishExtras } from "./furnishQuantities";
import { overhangsOf, postsUnder, supportOf } from "@/lib/plan/support";
import { flatProject, savedPlans, savedRoom } from "@/lib/plan/flatten";
import { roomArea, roomEdgeArc, wallArc } from "@/lib/plan/arcs";
import type { FloorPlan } from "@/lib/model/schema";

/** Inches of curved wall along the curve, over every floor. A wall two rooms share counts once. */
export function curvedWallLength(plans: Record<string, FloorPlan>): number {
  let total = 0;
  for (const plan of Object.values(plans)) {
    const seen = new Set<string>();
    const count = (arc: { a: { x: number; y: number }; b: { x: number; y: number }; bulge: number; length: number } | null) => {
      if (!arc) return;
      const [p, q] = [arc.a, arc.b].map((pt) => `${Math.round(pt.x)},${Math.round(pt.y)}`).sort();
      const key = `${p}|${q}|${Math.round(Math.abs(arc.bulge))}`;
      if (seen.has(key)) return;
      seen.add(key);
      total += arc.length;
    };
    for (const r of plan.rooms) r.polygon.forEach((_, i) => count(roomEdgeArc(r, i)));
    for (const w of plan.walls) count(wallArc(w));
  }
  return total;
}

/** Measures the house from its floor plan. Null when there is no floor plan with rooms. */
export function measurePlan(p: Ctx): Quantities | null {
  const curvedLf = ft(curvedWallLength(savedPlans(p.floorPlans)));
  p = flatProject(p);
  const plans = p.floorPlans;
  if (!Object.values(plans).some((pl) => pl.rooms.length > 0)) return null;
  const q = empty("plan");
  q.curvedWallLf = curvedLf;
  siteFacts(p, q);
  const basics = p.plan.basics;
  const exteriorIn = exteriorWallIn(basics);
  const heights = levelHeights(p.levels, basics);
  const offset = lotOffsetFor(p);
  const site: Site = siteFor(p.plot, offset, plans);
  const used = p.levels.filter((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
  const below = (id: string) => heights[id].floorIn < -12;
  q.floorsAbove = Math.max(1, used.filter((l) => !below(l.id)).length);
  q.floorsBelow = used.filter((l) => below(l.id)).length;

  const allRooms: MeasuredRoom[] = [];
  let lowestUsed = Infinity;
  for (const l of used) lowestUsed = Math.min(lowestUsed, heights[l.id].floorIn);

  // Basements: concrete walls, slab, digging and waterproofing.
  const basementRegions: Region[] = [];
  for (const l of used.filter((l) => below(l.id))) {
    const plan = planOf(plans, l.id);
    const { floorIn, ceilingIn } = heights[l.id];
    const wallH = ceilingIn + FLOOR_STRUCTURE_IN;
    for (const r of floorFootprint(plan)) {
      basementRegions.push(r);
      const outer = offsetRing(r.outline, exteriorIn / 2);
      const per = ringLength(outer);
      const area = sqft(regionArea(r));
      q.basementSlabSqft += area;
      q.basementWallSqft += sqft(per * (wallH + 8));
      q.footingLf += ft(per);
      const pts = samplesAround(outer);
      const depths = pts.map((pt) => Math.max(0, Math.min(wallH, site.groundAt(pt) - floorIn)));
      const avgDepth = depths.reduce((s, d) => s + d, 0) / Math.max(1, depths.length);
      q.waterproofSqft += sqft(per * avgDepth);
      const dug = offsetRing(outer, OVERDIG_IN);
      q.excavationCuyd += (polygonArea(dug) * (avgDepth + 12)) / 46656;
      // Above-ground parts of a walkout wall get siding.
      q.extWallSqft += sqft(per * Math.max(0, wallH - avgDepth));
    }
  }

  // Floors on the ground (not over a basement): slab or crawlspace, with stem walls down to the footings.
  const groundLevels = used.filter((l) => !below(l.id) && heights[l.id].floorIn <= 12);
  const groundRegions = subtractRegions(
    joinRooms(groundLevels.flatMap((l) => planOf(plans, l.id).rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon))),
    basementRegions,
  );
  const basementOuter = basementRegions.map((r) => offsetRing(r.outline, exteriorIn / 2 + 6));
  const garagePolys = groundLevels.flatMap((l) => planOf(plans, l.id).rooms.filter((r) => areaKind(r) === "garage").map((r) => r.polygon));
  const garageSqft = sqft(garagePolys.reduce((s, poly) => s + polygonArea(poly), 0));
  const onSlab = q.foundation === "slab";
  for (const r of groundRegions) {
    const area = sqft(regionArea(r));
    q.groundSqft += area;
    const outer = offsetRing(r.outline, exteriorIn / 2);
    const pts = samplesAround(outer).filter((pt) => !basementOuter.some((b) => pointInPolygon(pt, b)));
    const step = ringLength(outer) / Math.max(1, samplesAround(outer).length);
    q.footingLf += ft(pts.length * step);
    for (const pt of pts) {
      const drop = -site.groundAt(pt); // floor is at 0, the ground below it
      const h = drop + FROST_DEPTH_IN - (onSlab ? 4 : JOIST_DEPTH_IN);
      q.stemWallSqft += sqft(step * Math.max(12, h));
    }
    q.excavationCuyd += (polygonArea(r.outline) * SHALLOW_DIG_IN) / 46656;
  }
  // Big rocks under the house (ground floors and basements) are broken up and hauled away.
  if (p.plot?.features.length) {
    const footprints = [...groundRegions, ...basementRegions].map((r) => r.outline.map((pt) => ({ x: pt.x + offset.x, y: pt.y + offset.y })));
    q.rockCuyd = rocksUnder(p.plot, footprints).reduce((t, r) => t + rockCuyd(r.sizeFt), 0);
  }
  // Ground floors where they sit over a basement are framed too.
  const groundAll = joinRooms(groundLevels.flatMap((l) => planOf(plans, l.id).rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon)));
  q.floorFramingSqft += Math.max(0, sqft(groundAll.reduce((s, r) => s + regionArea(r), 0)) - q.groundSqft);
  q.garageSlabSqft = Math.min(garageSqft, q.groundSqft);
  const livingGround = Math.max(0, q.groundSqft - q.garageSlabSqft);
  if (onSlab) q.slabSqft = livingGround;
  else q.floorFramingSqft += livingGround;
  if (q.foundation === "stepped") {
    // Retaining walls along about half the house, half as tall as the drop across it.
    const bb = boundsOf(groundRegions.flatMap((r) => r.outline));
    if (bb) {
      const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
      q.retainingWallSqft = sqft(span * 0.5 * Math.min(96, Math.max(36, (q.slopePercent / 100) * span * 0.5)));
    }
  }

  // Every floor: areas, walls, doors and windows, fixtures.
  for (const l of used) {
    const plan = planOf(plans, l.id);
    const { floorIn, ceilingIn } = heights[l.id];
    const story = ceilingIn + FLOOR_STRUCTURE_IN;
    const isBelow = below(l.id);
    const cabinets = cabinetsByRoom(plan, ceilingIn);
    const extras = furnishExtras(plan);
    for (const k of Object.keys(extras) as (keyof typeof extras)[]) q.furnish[k] += extras[k];
    for (const r of plan.rooms) {
      const a = sqft(roomArea(savedRoom(r)));
      const kind = areaKind(r);
      if (kind === "living") q.livingSqft += a;
      else if (kind === "garage") q.garageSqft += a;
      else if (r.type === "deck") q.deckSqft += a;
      else q.porchSqft += a;
      if (r.type === "patio") q.patioSqft += a;
      // Wall length on each side of the room, less any stretch where the wall was taken out.
      const edgesIn = edgesOf(r.polygon).map((e) => dist(e.a, e.b) - openSpans(plan, e.a, e.b).reduce((t, [t0, t1]) => t + t1 - t0, 0));
      allRooms.push({ id: r.id, name: r.name, type: r.type ?? "other", sqft: a, fixtures: plan.fixtures.filter((f) => f.roomId === r.id), edgesIn, cabinets: cabinets.get(r.id) });
    }
    // Rooms held up "On posts" past the floor below: posts with footings, and a beam.
    const sup = supportOf(plans, p.levels, l);
    if (sup) {
      for (const o of overhangsOf(plan.rooms, sup.regions)) {
        if (o.kind !== "posts") continue;
        const { posts, beams } = postsUnder(o, sup.regions);
        q.overhangPosts += posts.length;
        q.overhangBeamLf += ft(beams.reduce((t, [a, b]) => t + dist(a, b), 0));
      }
    }
    // Floors framed over something: upper floors, and lower basements' upper floors.
    if (!groundLevels.includes(l) && floorIn > lowestUsed + 12) q.floorFramingSqft += sqft(floorFootprint(plan).reduce((s, r) => s + regionArea(r), 0));
    const pieces: WallPiece[] = wallPieces(plan, exteriorIn);
    let extLen = 0;
    for (const w of pieces) {
      const L = dist(w.a, w.b);
      if (w.open) continue;
      if (w.exterior) extLen += L;
      // A half wall takes framing and drywall for its 42" only, plus a counter cap when it has one.
      const share = w.height ? wallTopIn(w, ceilingIn) / ceilingIn : 1;
      if (w.exterior && groundLevels.includes(l)) q.baseWallLf += ft(L);
      else q.intWallLf += ft(L) * share;
      if (!w.exterior) q.intWallSqft += sqft(L * ceilingIn * share);
      if (w.height === "half-cap") {
        const top = sqft(L * (w.thicknessIn + WALL_CAP_OVERHANG_IN * 2));
        q.counterSqft += top;
      }
    }
    let extOpenings = 0;
    for (const g of openingGeometries(plan)) {
      const o = g.opening;
      const host = hostPiece(pieces, g);
      const exterior = !!host?.exterior && !host.open;
      const type = openingType(o.style);
      const area = o.widthIn * o.heightIn;
      if (exterior) extOpenings += area;
      if (o.kind === "window") {
        q.windowSqft += sqft(area);
        q.windows += 1;
      } else if (o.style === "door-slider") q.patioDoors += o.widthIn / 72;
      else if (o.style === "door-garage") q.garageDoorLf += ft(o.widthIn);
      else if (o.style === "door-pocket") q.pocketDoors += 1;
      else if (o.style === "door-barn") q.barnDoors += 1;
      else if (o.kind === "door") {
        const leaves = type.double ? 2 : 1;
        if (exterior || o.style === "door-entry") q.entryDoors += leaves;
        else q.interiorDoors += leaves;
      }
    }
    if (!isBelow) q.extWallSqft += Math.max(0, sqft(extLen * story - extOpenings));
    q.stairs += plan.stairs.length;
  }

  // Stair railings with Grant's changes from Furnish (wall-mounted handrails are inside the stairs rate).
  const rise = riseFromHeights(levelHeights(p.levels, basics));
  for (const l of p.levels) {
    const len = railingLengths(railingsOn(plans, l.id, rise));
    q.stairGuardWoodLf += len.guard.wood;
    q.stairGuardMetalLf += len.guard.metal;
    q.stairGuardGlassLf += len.guard.glass;
    q.stairHalfWallLf += len.halfWall + len.wall * 2;
  }

  const roof = measureRoof(plans, p.levels, basics, p.house3d.roof);
  applyRoof(q, roof);
  roomFixtures(q, allRooms);

  // Drywall: inside face of outside walls, both sides of inside walls, and ceilings.
  q.drywallSqft = q.extWallSqft + q.intWallSqft * 2 + q.livingSqft + q.garageSqft;

  // Driveway from the garage (or the house) to the road, and service lines to the road.
  const garageCenter = garagePolys.length ? centerOf(garagePolys.flat()) : centerOf(groundRegions.flatMap((r) => r.outline));
  const toStreet = ft(toRoad(p, garageCenter, offset));
  const garageWidth = garagePolys.length ? Math.min(30, Math.max(12, q.garageDoorLf + 4 || 20)) : 12;
  q.driveSqft = toStreet * garageWidth;
  q.trenchLf = toStreet;

  // The yard as laid out for the 3D view: driveway, walk, beds, lawn, plants and outdoor lights.
  const yard = yardLayout(plans, p.levels, basics, p.plot, offset);
  if (yard) {
    const y = yardAmounts(yard);
    if (y.driveSqft > 0) q.driveSqft = y.driveSqft;
    q.walkSqft = y.walkSqft;
    q.lawnSqft = y.lawnSqft;
    q.bedSqft = y.bedSqft;
    q.shrubs = y.shrubs;
    q.trees = y.trees;
    q.extLights = y.lights;
  }
  return q;
}
