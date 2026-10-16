import type { Point, Project } from "@/lib/model/schema";
import { isHeated } from "@/lib/brief/rooms";
import { plotImplications, type FoundationType } from "@/lib/land/implications";
import { nearestAccess } from "@/lib/land/onLot";
import { boundsOf, dist, lerp, SQ_IN_PER_SQ_FT } from "@/lib/plan/geometry";
import { lightsFor } from "@/lib/catalog/categories";
import { wallKey } from "@/lib/interior/picks";
import type { RateId } from "./rates";
import type { measureRoof } from "./measureRoof";
import { noFurnishExtras, type FurnishExtras, type RoomCabinets } from "./furnishQuantities";

/** What the cost measures produce (Quantities), plus the constants and helpers shared by measurePlan.ts and measureRough.ts. */

export type Quantities = {
  /** "plan": measured from the floor plan. "rough": guessed from the Rooms page. */
  source: "plan" | "rough";
  livingSqft: number;
  garageSqft: number;
  /** Porch and covered patio floors (a slab), and decks. */
  porchSqft: number;
  deckSqft: number;
  /** Open patios (part of porchSqft): concrete, or pavers when picked. */
  patioSqft: number;
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
  /** Posts (with footings) and beam under upper-floor rooms held up "On posts". */
  overhangPosts: number;
  overhangBeamLf: number;
  /** Length along the curve of all curved walls, in feet (shared walls counted once). */
  curvedWallLf: number;
  stemWallSqft: number;
  basementWallSqft: number;
  waterproofSqft: number;
  retainingWallSqft: number;
  /** Big rocks under the house, broken up and hauled away. */
  rockCuyd: number;
  excavationCuyd: number;
  driveSqft: number;
  trenchLf: number;

  // The yard (see lib/exterior/yard.ts)
  walkSqft: number;
  lawnSqft: number;
  bedSqft: number;
  shrubs: number;
  trees: number;
  /** Outdoor wall lights by the doors. */
  extLights: number;

  // Structure and shell
  floorFramingSqft: number;
  /** Framed outside walls above ground, less doors and windows. */
  extWallSqft: number;
  /** Gable ends and the tall side of a shed roof. */
  gableSqft: number;
  /** Outside walls of the floors on the ground, for a stone or brick band along the base. */
  baseWallLf: number;
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
  /** Feet of stair railing by kind: guards by look, and half walls (a full wall counts double). */
  stairGuardWoodLf: number;
  stairGuardMetalLf: number;
  stairGuardGlassLf: number;
  stairHalfWallLf: number;

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
  /** Tall cabinets and specialty boxes from the real cabinet layout. */
  tallCabinets: number;
  specialtyCabinets: number;
  /** Built-ins, extras and hand-added hookups placed in Furnish. */
  furnish: FurnishExtras;
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

export const sqft = (sqIn: number) => sqIn / SQ_IN_PER_SQ_FT;
export const ft = (inches: number) => inches / 12;

/** Footings go below the frost line: 24 in in Boise. */
export const FROST_DEPTH_IN = 24;
/** Floor joists sit this far below the floor over a crawlspace. */
export const JOIST_DEPTH_IN = 12;
/** Space dug around a basement so the walls can be built and waterproofed. */
export const OVERDIG_IN = 24;
/** A crawlspace or slab is dug about this deep under the whole house (topsoil and gravel). */
export const SHALLOW_DIG_IN = 12;

export const BATH_TYPES = new Set(["bathroom", "primary-bath", "half-bath"]);
export const TILE_ROOMS = new Set(["bathroom", "primary-bath", "half-bath", "laundry", "mudroom"]);
export const SHOWER_TILE_SQFT = 90;
export const OPEN_ROOMS = new Set(["living", "family", "kitchen", "dining", "entry", "hall", "bonus", "other"]);

export function ringLength(ring: Point[]): number {
  return ring.reduce((s, p, i) => s + dist(p, ring[(i + 1) % ring.length]), 0);
}

/** Points every `step` inches around a ring. */
export function samplesAround(ring: Point[], step = 24): Point[] {
  const out: Point[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.round(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(lerp(a, b, (k + 0.5) / n));
  });
  return out;
}

export type Ctx = Pick<Project, "levels" | "plot" | "sketch" | "bubbles" | "floorPlans" | "house3d" | "plan" | "discovery" | "brief">;

export function empty(source: Quantities["source"]): Quantities {
  return {
    source,
    livingSqft: 0,
    garageSqft: 0,
    porchSqft: 0,
    deckSqft: 0,
    patioSqft: 0,
    walkSqft: 0,
    lawnSqft: 0,
    bedSqft: 0,
    shrubs: 0,
    trees: 0,
    extLights: 0,
    baseWallLf: 0,
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
    overhangPosts: 0,
    overhangBeamLf: 0,
    curvedWallLf: 0,
    stemWallSqft: 0,
    basementWallSqft: 0,
    waterproofSqft: 0,
    retainingWallSqft: 0,
    rockCuyd: 0,
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
    stairGuardWoodLf: 0,
    stairGuardMetalLf: 0,
    stairGuardGlassLf: 0,
    stairHalfWallLf: 0,
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
    tallCabinets: 0,
    specialtyCabinets: 0,
    furnish: noFurnishExtras(),
    rooms: [],
  };
}

/** Site facts that don't depend on the plan. */
export function siteFacts(p: Ctx, q: Quantities) {
  if (!p.plot) return;
  const imp = plotImplications(p.plot);
  q.foundation = imp.foundation.type;
  q.slopePercent = p.plot.slope.percent;
  q.drainage = imp.drainageWork;
}

/** How far a point (plan inches) is from where its driveway meets the main road or a lane, in inches. */
export function toRoad(p: Ctx, pt: Point, offset: Point): number {
  if (!p.plot) return 40 * 12;
  const at = { x: pt.x + offset.x, y: pt.y + offset.y };
  return Math.max(20 * 12, dist(at, nearestAccess(p.plot, at).at));
}

export type MeasuredRoom = { id: string; name: string; type: string; sqft: number; fixtures: { kind: string; widthIn: number; depthIn: number }[]; edgesIn?: number[]; cabinets?: RoomCabinets };

/**
 * Plumbing, cabinets, tile, lights and finishes for rooms, using what's
 * placed in each room or typical amounts when nothing is. Each room's share
 * is kept in `q.rooms` too.
 */
export function roomFixtures(q: Quantities, rooms: MeasuredRoom[]) {
  for (const r of rooms) {
    const f = (k: string) => r.fixtures.filter((x) => x.kind === k);
    const placed = r.fixtures.length > 0;
    let cabinetsDone = false;
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
      let top = counters.reduce((s, c) => s + sqft(c.widthIn * Math.max(c.depthIn, 25)), 0);
      // The real cabinets when there are any; a typical kitchen (about 20 ft of base cabinets and the matching uppers) only when there are none.
      let lf = r.cabinets?.lf ?? 0;
      if (!lf && kitchen) {
        lf = Math.min(36, Math.max(14, r.sqft / 11));
        if (!counters.length) top = lf * 2.1;
      }
      q.cabinetLf += lf;
      q.counterSqft += top;
      add("kitchen-cabinets", lf);
      add("countertops", top);
      add("cabinet-hardware", lf * 1.5);
      cabinetsDone = true;
    }
    if (r.cabinets) {
      // Cabinets in other rooms (laundry, mudroom, anything placed by hand) at the same rate.
      if (!cabinetsDone && r.cabinets.lf > 0) {
        q.cabinetLf += r.cabinets.lf;
        add("kitchen-cabinets", r.cabinets.lf);
        add("cabinet-hardware", r.cabinets.lf * 1.5);
      }
      q.tallCabinets += r.cabinets.tall;
      q.specialtyCabinets += r.cabinets.specialty;
      add("tall-cabinet", r.cabinets.tall);
      add("cabinet-specialty", r.cabinets.specialty);
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

export function centerOf(pts: Point[]): Point {
  const bb = boundsOf(pts);
  return bb ? { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 } : { x: 0, y: 0 };
}

export function applyRoof(q: Quantities, roof: ReturnType<typeof measureRoof>) {
  q.flatRoofSqft = roof.flatSqft;
  q.roofSqft = roof.roofSqft + roof.flatSqft;
  q.gableSqft = roof.gableSqft;
  q.hipValleyLf = roof.hipValleyLf;
  q.gutterLf = roof.gutterLf;
  q.eaveLf = roof.eaveLf;
  q.atticSqft = roof.atticSqft;
}
