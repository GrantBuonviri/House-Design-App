import type { Level, PlanBasics, Point, Project, Roof } from "@/lib/model/schema";
import { isHeated, roomType } from "@/lib/brief/rooms";
import { plotImplications, type FoundationType } from "@/lib/land/implications";
import { exteriorWallIn, FLOOR_STRUCTURE_IN } from "@/lib/plan/basics";
import { openingType } from "@/lib/plan/catalog";
import { planOf, type Plans } from "@/lib/plan/edit";
import { boundsOf, dist, lerp, pointInPolygon, polygonArea, SQ_IN_PER_SQ_FT } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { openingGeometries, wallPieces, type WallPiece } from "@/lib/plan/walls";
import { hostPiece } from "@/lib/house3d/build";
import { floorFootprint, joinRooms, offsetRing, regionArea, roofFootprint, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { levelHeights } from "@/lib/house3d/levels";
import { roofShape, type RoofShape } from "@/lib/house3d/roof";
import { lotOffsetFor, siteFor, type Site } from "@/lib/house3d/site";
import { lightsFor } from "@/lib/catalog/categories";
import { wallKey } from "@/lib/interior/picks";
import type { RateId } from "./rates";

/**
 * Measures the house for the cost estimate: areas, wall lengths, the roof,
 * doors and windows, fixtures and the foundation. Measured from the floor
 * plan when there is one, or roughly from the Rooms page when there isn't.
 * Areas are in square feet and lengths in feet.
 */

export type Quantities = {
  /** "plan": measured from the floor plan. "rough": guessed from the Rooms page. */
  source: "plan" | "rough";
  livingSqft: number;
  garageSqft: number;
  /** Porch and covered patio floors (a slab), and decks. */
  porchSqft: number;
  deckSqft: number;
  floorsAbove: number;
  floorsBelow: number;

  // Site and foundation
  foundation: FoundationType;
  slopePercent: number;
  drainage: "none" | "some" | "major";
  /** Footprint of everything touching the ground (not basements), for grading. */
  groundSqft: number;
  slabSqft: number;
  garageSlabSqft: number;
  basementSlabSqft: number;
  footingLf: number;
  stemWallSqft: number;
  basementWallSqft: number;
  waterproofSqft: number;
  retainingWallSqft: number;
  excavationCuyd: number;
  driveSqft: number;
  trenchLf: number;

  // Structure and shell
  floorFramingSqft: number;
  /** Framed outside walls above ground, less doors and windows. */
  extWallSqft: number;
  /** Gable ends and the tall side of a shed roof. */
  gableSqft: number;
  intWallLf: number;
  intWallSqft: number;
  /** All roof surface, sloped and flat. */
  roofSqft: number;
  /** The flat part of the roof (a membrane instead of shingles). */
  flatRoofSqft: number;
  hipValleyLf: number;
  gutterLf: number;
  eaveLf: number;
  /** Ceilings under the roof, for attic insulation. */
  atticSqft: number;
  stairs: number;

  // Doors and windows
  windowSqft: number;
  windows: number;
  patioDoors: number;
  entryDoors: number;
  interiorDoors: number;
  pocketDoors: number;
  barnDoors: number;
  garageDoorLf: number;

  // Inside
  drywallSqft: number;
  tileSqft: number;
  cabinetLf: number;
  counterSqft: number;
  vanities: number;
  toilets: number;
  bathSinks: number;
  showers: number;
  kitchenSinks: number;
  kitchens: number;
  laundries: number;
  /** Every fixture that needs water or a drain. */
  plumbingFixtures: number;
  waterHeaters: number;
  /** Decorative ceiling and wall lights. */
  lightFixtures: number;
  /** Cabinet pulls and knobs. */
  cabinetHardware: number;
  /**
   * Each room's share of the finish lines (flooring, tile, cabinets, fixtures
   * and so on), so a product picked for one room prices only that room.
   */
  rooms: RoomFinish[];
};

export type RoomFinish = {
  /** The floor plan room id (or "rough-N" for a room from the Rooms page). */
  id: string;
  name: string;
  type: string;
  sqft: number;
  amounts: Partial<Record<RateId, number>>;
  /** Each wall's share of the room's walls, by wall key ("e3"), for accent wall paint. */
  walls?: Record<string, number>;
};

const sqft = (sqIn: number) => sqIn / SQ_IN_PER_SQ_FT;
const ft = (inches: number) => inches / 12;

/** Footings go below the frost line: 24 in in Boise. */
export const FROST_DEPTH_IN = 24;
/** Floor joists sit this far below the floor over a crawlspace. */
const JOIST_DEPTH_IN = 12;
/** Space dug around a basement so the walls can be built and waterproofed. */
const OVERDIG_IN = 24;
/** A crawlspace or slab is dug about this deep under the whole house (topsoil and gravel). */
const SHALLOW_DIG_IN = 12;

const BATH_TYPES = new Set(["bathroom", "primary-bath", "half-bath"]);
const TILE_ROOMS = new Set(["bathroom", "primary-bath", "half-bath", "laundry", "mudroom"]);
const SHOWER_TILE_SQFT = 90;
const OPEN_ROOMS = new Set(["living", "family", "kitchen", "dining", "entry", "hall", "bonus", "other"]);

function ringLength(ring: Point[]): number {
  return ring.reduce((s, p, i) => s + dist(p, ring[(i + 1) % ring.length]), 0);
}

/** Points every `step` inches around a ring. */
function samplesAround(ring: Point[], step = 24): Point[] {
  const out: Point[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.round(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(lerp(a, b, (k + 0.5) / n));
  });
  return out;
}

const triArea3D = (t: RoofShape["tris"][number]) => {
  const [a, b, c] = t.p.map((p, i) => [p.x, p.y, t.h[i]]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};

const wallArea = (w: RoofShape["walls"][number]) => {
  // Upright pieces: a triangle (gable) or a four-sided piece (shed side). Area of the shape in its own plane.
  let s = 0;
  for (let i = 1; i < w.p.length - 1; i++) {
    const pts = [0, i, i + 1].map((k) => [w.p[k].x, w.p[k].y, w.h[k]]);
    const u = pts[1].map((x, j) => x - pts[0][j]);
    const v = pts[2].map((x, j) => x - pts[0][j]);
    s += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return s;
};

/**
 * Hips and valleys: the sloped creases where two roof planes meet. Found as
 * triangle edges shared by two triangles that face different ways (edges
 * inside one flat plane, and level ridges, don't count).
 */
export function foldLength(tris: RoofShape["tris"]): number {
  const normal = (t: RoofShape["tris"][number]) => {
    const [a, b, c] = t.p.map((p, i) => [p.x, p.y, t.h[i]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const k = n[2] < 0 ? -l : l;
    return n.map((x) => x / k);
  };
  const key = (p: { x: number; y: number }, h: number) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(h)}`;
  const edges = new Map<string, { n: number[]; len: number; rise: number }[]>();
  for (const t of tris) {
    const n = normal(t);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const ka = key(t.p[i], t.h[i]);
      const kb = key(t.p[j], t.h[j]);
      if (ka === kb) continue;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const len = Math.hypot(t.p[i].x - t.p[j].x, t.p[i].y - t.p[j].y, t.h[i] - t.h[j]);
      const list = edges.get(k) ?? [];
      list.push({ n, len, rise: Math.abs(t.h[i] - t.h[j]) });
      edges.set(k, list);
    }
  }
  let total = 0;
  for (const list of edges.values()) {
    if (list.length !== 2 || list[0].rise < 6) continue;
    const [a, b] = list;
    const cos = a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2];
    if (cos < 0.995) total += a.len;
  }
  return total;
}

/** Roof surfaces, gable walls, hips and valleys, gutters and attic ceilings over the whole house. */
export function measureRoof(plans: Plans, levels: Level[], basics: PlanBasics | null, roof: Roof) {
  const heights = levelHeights(levels, basics);
  const ordered = [...levels].sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn);
  const exteriorIn = exteriorWallIn(basics);
  const out = { roofSqft: 0, flatSqft: 0, gableSqft: 0, hipValleyLf: 0, gutterLf: 0, eaveLf: 0, atticSqft: 0 };
  ordered.forEach((level, i) => {
    const plan = planOf(plans, level.id);
    const regions = roofFootprint(plan);
    if (!regions.length) return;
    const next = ordered.slice(i + 1).find((l) => (plans[l.id]?.rooms.length ?? 0) > 0);
    const above = next ? floorFootprint(planOf(plans, next.id)) : [];
    const exposed = subtractRegions(regions, above);
    out.atticSqft += sqft(subtractRegions(floorFootprint(plan), above).reduce((s, r) => s + regionArea(r), 0));
    const { floorIn, ceilingIn } = heights[level.id];
    const flat = level.kind === "basement" || floorIn < 0;
    for (const found of exposed) {
      const r: Region = { ...found, holes: found.holes.filter((h) => polygonArea(h) > 150 * 144) };
      const shape = roofShape(r, floorIn + ceilingIn, exteriorIn, roof, flat);
      const area = sqft(shape.tris.reduce((s, t) => s + triArea3D(t), 0));
      const isFlat = flat || shape.fellBack || roof.style === "flat";
      if (isFlat) out.flatSqft += area;
      else out.roofSqft += area;
      out.gableSqft += sqft(shape.walls.reduce((s, w) => s + wallArea(w), 0));
      const eave = ft(ringLength(offsetRing(r.outline, exteriorIn / 2 + roof.overhangIn)));
      out.eaveLf += eave;
      if (isFlat) {
        out.gutterLf += eave * 0.25;
        continue;
      }
      out.hipValleyLf += ft(foldLength(shape.tris));
      out.gutterLf += eave * (roof.style === "hip" ? 1 : roof.style === "gable" ? 0.6 : 0.3);
    }
  });
  return out;
}

type Ctx = Pick<Project, "levels" | "plot" | "sketch" | "bubbles" | "floorPlans" | "house3d" | "plan" | "discovery" | "brief">;

function empty(source: Quantities["source"]): Quantities {
  return {
    source,
    livingSqft: 0,
    garageSqft: 0,
    porchSqft: 0,
    deckSqft: 0,
    floorsAbove: 1,
    floorsBelow: 0,
    foundation: "slab",
    slopePercent: 0,
    drainage: "none",
    groundSqft: 0,
    slabSqft: 0,
    garageSlabSqft: 0,
    basementSlabSqft: 0,
    footingLf: 0,
    stemWallSqft: 0,
    basementWallSqft: 0,
    waterproofSqft: 0,
    retainingWallSqft: 0,
    excavationCuyd: 0,
    driveSqft: 0,
    trenchLf: 0,
    floorFramingSqft: 0,
    extWallSqft: 0,
    gableSqft: 0,
    intWallLf: 0,
    intWallSqft: 0,
    roofSqft: 0,
    flatRoofSqft: 0,
    hipValleyLf: 0,
    gutterLf: 0,
    eaveLf: 0,
    atticSqft: 0,
    stairs: 0,
    windowSqft: 0,
    windows: 0,
    patioDoors: 0,
    entryDoors: 0,
    interiorDoors: 0,
    pocketDoors: 0,
    barnDoors: 0,
    garageDoorLf: 0,
    drywallSqft: 0,
    tileSqft: 0,
    cabinetLf: 0,
    counterSqft: 0,
    vanities: 0,
    toilets: 0,
    bathSinks: 0,
    showers: 0,
    kitchenSinks: 0,
    kitchens: 0,
    laundries: 0,
    plumbingFixtures: 0,
    waterHeaters: 0,
    lightFixtures: 0,
    cabinetHardware: 0,
    rooms: [],
  };
}

/** Site facts that don't depend on the plan. */
function siteFacts(p: Ctx, q: Quantities) {
  if (!p.plot) return;
  const imp = plotImplications(p.plot);
  q.foundation = imp.foundation.type;
  q.slopePercent = p.plot.slope.percent;
  q.drainage = imp.drainageWork;
}

/** How far a point (plan inches) is from the road edge of the lot, in inches. */
function toRoad(p: Ctx, pt: Point, offset: Point): number {
  if (!p.plot) return 40 * 12;
  const bb = boundsOf(p.plot.outline.length ? p.plot.outline : [{ x: 0, y: 0 }, { x: p.plot.widthIn, y: p.plot.depthIn }])!;
  const x = pt.x + offset.x;
  const y = pt.y + offset.y;
  const d = { N: y - bb.y0, S: bb.y1 - y, W: x - bb.x0, E: bb.x1 - x }[p.plot.roadSide];
  return Math.max(20 * 12, d);
}

type MeasuredRoom = { id: string; name: string; type: string; sqft: number; fixtures: { kind: string; widthIn: number; depthIn: number }[]; edgesIn?: number[] };

/**
 * Plumbing, cabinets, tile, lights and finishes for rooms, using what's
 * placed in each room or typical amounts when nothing is. Each room's share
 * is kept in `q.rooms` too.
 */
function roomFixtures(q: Quantities, rooms: MeasuredRoom[]) {
  for (const r of rooms) {
    const f = (k: string) => r.fixtures.filter((x) => x.kind === k);
    const placed = r.fixtures.length > 0;
    const heated = isHeated(r.type);
    const a: RoomFinish["amounts"] = {};
    const add = (id: RateId, n: number) => {
      if (n > 0) a[id] = (a[id] ?? 0) + n;
    };
    if (BATH_TYPES.has(r.type) || f("toilet").length || f("vanity").length) {
      const half = r.type === "half-bath";
      const toilets = placed ? f("toilet").length : 1;
      const vanities = placed ? f("vanity").length : 1;
      const sinks = placed ? f("vanity").reduce((s, v) => s + (v.widthIn >= 60 ? 2 : 1), 0) : r.type === "primary-bath" ? 2 : 1;
      const showers = placed ? f("tub").length + f("shower").length : half ? 0 : r.type === "primary-bath" ? 2 : 1;
      q.toilets += toilets;
      q.vanities += vanities;
      q.bathSinks += sinks;
      q.showers += showers;
      q.plumbingFixtures += toilets + sinks + showers;
      q.tileSqft += showers * SHOWER_TILE_SQFT;
      add("toilet", toilets);
      add("vanity", vanities);
      add("bath-sink-faucet", sinks);
      add("shower-tub", showers);
      add("tile", showers * SHOWER_TILE_SQFT);
      add("countertops", vanities * 4);
      add("cabinet-hardware", vanities * 4);
    }
    if (r.type === "kitchen" || f("sink").length || f("range").length) {
      const kitchen = r.type === "kitchen";
      if (kitchen) q.kitchens += 1;
      const sinks = placed ? f("sink").length : kitchen ? 1 : 0;
      q.kitchenSinks += sinks;
      q.plumbingFixtures += sinks + (placed ? f("dishwasher").length : kitchen ? 1 : 0);
      add("kitchen-sink-faucet", sinks);
      if (kitchen) add("appliance-package", 1);
      const counters = [...f("counter"), ...f("island")];
      let lf = 0;
      let top = 0;
      if (counters.length) {
        lf = counters.reduce((s, c) => s + ft(c.widthIn), 0);
        top = counters.reduce((s, c) => s + sqft(c.widthIn * Math.max(c.depthIn, 25)), 0);
      } else if (kitchen) {
        // A typical kitchen: about 20 ft of base cabinets and the matching uppers.
        lf = Math.min(36, Math.max(14, r.sqft / 11));
        top = lf * 2.1;
      }
      q.cabinetLf += lf;
      q.counterSqft += top;
      add("kitchen-cabinets", lf);
      add("countertops", top);
      add("cabinet-hardware", lf * 1.5);
    }
    if (r.type === "laundry" || f("washer").length) {
      q.laundries += 1;
      q.plumbingFixtures += placed ? f("washer").length + f("laundry-sink").length : 1;
    }
    if (r.type === "outdoor-kitchen") q.plumbingFixtures += 1;
    if (TILE_ROOMS.has(r.type)) {
      q.tileSqft += r.sqft;
      add("tile", r.sqft);
    }
    q.waterHeaters += f("water-heater").length;
    if (heated) {
      if (!TILE_ROOMS.has(r.type) && r.type !== "mechanical") add("flooring", r.sqft);
      if (r.type !== "mechanical") add("interior-paint", r.sqft);
      add("trim-millwork", r.sqft);
    }
    const lights = lightsFor(r.type, r.sqft);
    q.lightFixtures += lights;
    add("lighting-fixtures", lights);
    const around = (r.edgesIn ?? []).reduce((t, x) => t + x, 0);
    const walls = around > 0 ? Object.fromEntries(r.edgesIn!.map((len, i) => [wallKey(i), len / around])) : undefined;
    q.rooms.push({ id: r.id, name: r.name, type: r.type, sqft: r.sqft, amounts: a, ...(walls ? { walls } : {}) });
  }
  q.counterSqft += q.vanities * 4;
  q.cabinetHardware = Math.round(q.cabinetLf * 1.5 + q.vanities * 4);
  if (q.plumbingFixtures > 0) q.waterHeaters = Math.max(1, q.waterHeaters);
}

/** Measures the house from its floor plan. Null when there is no floor plan with rooms. */
export function measurePlan(p: Ctx): Quantities | null {
  const plans = p.floorPlans;
  if (!Object.values(plans).some((pl) => pl.rooms.length > 0)) return null;
  const q = empty("plan");
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
    for (const r of plan.rooms) {
      const a = sqft(polygonArea(r.polygon));
      const kind = areaKind(r);
      if (kind === "living") q.livingSqft += a;
      else if (kind === "garage") q.garageSqft += a;
      else if (r.type === "deck") q.deckSqft += a;
      else q.porchSqft += a;
      const edgesIn = r.polygon.map((p, i) => dist(p, r.polygon[(i + 1) % r.polygon.length]));
      allRooms.push({ id: r.id, name: r.name, type: r.type ?? "other", sqft: a, fixtures: plan.fixtures.filter((f) => f.roomId === r.id), edgesIn });
    }
    // Floors framed over something: upper floors, and lower basements' upper floors.
    if (!groundLevels.includes(l) && floorIn > lowestUsed + 12) q.floorFramingSqft += sqft(floorFootprint(plan).reduce((s, r) => s + regionArea(r), 0));
    const pieces: WallPiece[] = wallPieces(plan, exteriorIn);
    let extLen = 0;
    for (const w of pieces) {
      const L = dist(w.a, w.b);
      if (w.open) continue;
      if (w.exterior) extLen += L;
      else q.intWallLf += ft(L);
      if (!w.exterior) q.intWallSqft += sqft(L * ceilingIn);
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
  return q;
}

function centerOf(pts: Point[]): Point {
  const bb = boundsOf(pts);
  return bb ? { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 } : { x: 0, y: 0 };
}

function applyRoof(q: Quantities, roof: ReturnType<typeof measureRoof>) {
  q.flatRoofSqft = roof.flatSqft;
  q.roofSqft = roof.roofSqft + roof.flatSqft;
  q.gableSqft = roof.gableSqft;
  q.hipValleyLf = roof.hipValleyLf;
  q.gutterLf = roof.gutterLf;
  q.eaveLf = roof.eaveLf;
  q.atticSqft = roof.atticSqft;
}

/**
 * A rough measure from the Rooms page (or the Design Brief), before any
 * floor plan is drawn: the rooms' sizes plus space for halls and walls,
 * stacked as simple boxes, with typical windows and doors.
 */
export function measureRough(p: Ctx): Quantities | null {
  const answers = p.discovery.answers;
  const rooms = p.brief
    ? p.brief.rooms.map((r) => ({ name: r.name, type: r.type, sqft: r.targetSqFt, levelId: r.levelId }))
    : answers.rooms.map((r) => ({ name: r.name, type: r.type, sqft: (r.lengthIn && r.widthIn ? (r.lengthIn * r.widthIn) / 144 : 0) || roomType(r.type).sqft, levelId: r.levelId }));
  if (!rooms.length) return null;
  const q = empty("rough");
  siteFacts(p, q);
  const above = p.brief?.floors ?? answers.floorsAbove;
  const belowN = p.brief?.floorsBelow ?? answers.floorsBelow;
  q.floorsAbove = above;
  q.floorsBelow = belowN;

  // Halls, closets and walls add about 15% to the room sizes.
  const heated = rooms.filter((r) => isHeated(r.type)).reduce((s, r) => s + r.sqft, 0) * 1.15;
  const garage = rooms.filter((r) => roomType(r.type).category === "garage").reduce((s, r) => s + r.sqft, 0);
  const outdoor = rooms.filter((r) => roomType(r.type).category === "outdoor");
  q.livingSqft = heated;
  q.garageSqft = garage;
  q.deckSqft = outdoor.filter((r) => r.type === "deck").reduce((s, r) => s + r.sqft, 0);
  q.porchSqft = outdoor.filter((r) => r.type !== "deck").reduce((s, r) => s + r.sqft, 0);

  const floors = above + belowN;
  const perFloor = heated / floors;
  const ceiling = 9;
  const story = ceiling + FLOOR_STRUCTURE_IN / 12;
  const perimeter = (area: number) => 4 * Math.sqrt(area) * 1.15;
  const mainArea = perFloor + garage;
  const basementArea = belowN ? perFloor : 0;

  q.groundSqft = mainArea;
  q.garageSlabSqft = garage;
  if (q.foundation === "slab") q.slabSqft = perFloor;
  else q.floorFramingSqft += perFloor;
  q.footingLf = perimeter(mainArea) + (belowN ? perimeter(basementArea) : 0);
  const stemH = (q.foundation === "slab" ? 2.5 : 3) + Math.min(4, q.slopePercent / 4);
  q.stemWallSqft = perimeter(mainArea) * stemH;
  q.excavationCuyd = (mainArea * 1) / 27;
  if (belowN) {
    q.basementSlabSqft = basementArea * belowN;
    q.basementWallSqft = perimeter(basementArea) * 9.5 * belowN;
    q.waterproofSqft = q.basementWallSqft * 0.8;
    q.excavationCuyd += ((basementArea + perimeter(basementArea) * 2) * 9 * belowN) / 27;
    q.floorFramingSqft += perFloor; // the main floor over the basement
  }
  if (q.foundation === "stepped") q.retainingWallSqft = Math.sqrt(mainArea) * 0.5 * 5;
  q.floorFramingSqft += perFloor * Math.max(0, above - 1);

  const extWallGross = perimeter(perFloor) * story * above + perimeter(garage || 1) * 0.5 * story;
  q.windowSqft = heated * 0.12;
  q.windows = Math.round(q.windowSqft / 15);
  q.patioDoors = 1;
  q.entryDoors = garage ? 2 : 1;
  q.garageDoorLf = garage ? Math.max(9, (answers.garageCars || 2) * 8) : 0;
  q.extWallSqft = Math.max(0, extWallGross - q.windowSqft - 60);
  const heatedRooms = rooms.filter((r) => isHeated(r.type));
  q.interiorDoors = heatedRooms.filter((r) => !OPEN_ROOMS.has(r.type)).length + rooms.filter((r) => /bedroom|guest/.test(r.type)).length;
  q.intWallLf = (heated / 10) * 1.0;
  q.intWallSqft = q.intWallLf * ceiling;
  q.stairs = Math.max(0, floors - 1);

  const top = perFloor + (above === 1 ? garage : 0);
  const roof = p.house3d.roof;
  const slope = roof.style === "flat" ? 0 : roof.pitch / 12;
  const roofPlan = (top + (above > 1 ? garage : 0) + q.porchSqft * 0.6) * 1.12;
  q.roofSqft = roofPlan * Math.sqrt(1 + slope * slope);
  q.flatRoofSqft = roof.style === "flat" ? q.roofSqft : 0;
  q.eaveLf = perimeter(roofPlan);
  q.gutterLf = q.eaveLf * (roof.style === "hip" ? 1 : roof.style === "gable" ? 0.6 : 0.3);
  q.hipValleyLf = roof.style === "hip" ? 4 * Math.sqrt(roofPlan) * 0.6 : roof.style === "gable" ? Math.sqrt(roofPlan) * 0.4 : 0;
  q.gableSqft = roof.style === "gable" ? 2 * 0.5 * Math.sqrt(top) * (Math.sqrt(top) / 2) * slope : 0;
  q.atticSqft = perFloor;

  roomFixtures(
    q,
    rooms.map((r, i) => ({ id: `rough-${i}`, name: r.name, type: r.type, sqft: r.sqft, fixtures: [] })),
  );
  q.drywallSqft = q.extWallSqft + q.intWallSqft * 2 + heated + garage;
  q.driveSqft = 40 * (garage ? 20 : 12);
  q.trenchLf = 60;
  return q;
}

/** The best measure available: the floor plan, or the rough one from the Rooms page. */
export function measureHouse(p: Ctx): Quantities | null {
  return measurePlan(p) ?? measureRough(p);
}
