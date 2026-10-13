import type { Plot, Point } from "@/lib/model/schema";
import { plotImplications } from "@/lib/land/implications";
import { compassShort } from "@/lib/land/sun";

/**
 * Where on a floor a room should sit, as one of nine spots: the eight
 * compass directions from the middle of the house, or the middle itself.
 * Claude and the built-in rules both answer in spots; code turns spots into
 * positions, so the geometry is always checked.
 */

export const SPOTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "center"] as const;
export type Spot = (typeof SPOTS)[number];

const D = Math.SQRT1_2;
const VECTORS: Record<Spot, Point> = {
  N: { x: 0, y: -1 },
  NE: { x: D, y: -D },
  E: { x: 1, y: 0 },
  SE: { x: D, y: D },
  S: { x: 0, y: 1 },
  SW: { x: -D, y: D },
  W: { x: -1, y: 0 },
  NW: { x: -D, y: -D },
  center: { x: 0, y: 0 },
};

/** Unit vector for a spot in drawing coordinates (x east, y south). */
export function spotVector(spot: Spot): Point {
  return VECTORS[spot];
}

const OPPOSITE: Record<Spot, Spot> = {
  N: "S",
  NE: "SW",
  E: "W",
  SE: "NW",
  S: "N",
  SW: "NE",
  W: "E",
  NW: "SE",
  center: "center",
};

export function oppositeSpot(spot: Spot): Spot {
  return OPPOSITE[spot];
}

/** Mirror a spot east to west (or north to south when the road is east or west). */
export function mirroredSpot(spot: Spot, axis: "x" | "y"): Spot {
  const v = VECTORS[spot];
  return spotFromVector(axis === "x" ? { x: -v.x, y: v.y } : { x: v.x, y: -v.y }, 0);
}

/**
 * The spot for an offset from the middle of a floor. Offsets shorter than
 * `centerRadius` count as the middle.
 */
export function spotFromVector(v: Point, centerRadius: number): Spot {
  const len = Math.hypot(v.x, v.y);
  if (len <= centerRadius || len === 0) return "center";
  const bearing = (Math.atan2(v.x, -v.y) * 180) / Math.PI;
  return compassShort(bearing) as Spot;
}

/** The parts of a house that tend to sit together. */
export type Zone = "entry" | "garage" | "porch" | "living" | "kitchen" | "outdoor" | "private" | "service" | "center";

const ZONE_OF: Record<string, Zone> = {
  entry: "entry",
  "half-bath": "entry",
  office: "entry",
  garage: "garage",
  mudroom: "garage",
  workshop: "garage",
  porch: "porch",
  living: "living",
  family: "living",
  dining: "living",
  sunroom: "living",
  playroom: "living",
  media: "living",
  kitchen: "kitchen",
  pantry: "kitchen",
  patio: "outdoor",
  deck: "outdoor",
  "outdoor-kitchen": "outdoor",
  "primary-bedroom": "private",
  "primary-bath": "private",
  "primary-closet": "private",
  bedroom: "private",
  bathroom: "private",
  "guest-suite": "private",
  bonus: "private",
  laundry: "service",
  storage: "service",
  mechanical: "service",
  craft: "service",
  gym: "service",
};

export function zoneOf(type: string): Zone {
  return ZONE_OF[type] ?? "center";
}

/**
 * Which way each part of the house faces, by the side the road is on. The
 * entry and garage face the road, living spaces and patios get the sunny
 * south side, bedrooms go on the quieter side away from the road, and the
 * garage sits on the less sunny flank (on the west it also shades the house
 * from hot afternoon sun).
 */
const BY_ROAD: Record<Plot["roadSide"], Record<Zone, Spot>> = {
  N: { entry: "N", garage: "NW", porch: "N", living: "S", kitchen: "center", outdoor: "S", private: "E", service: "W", center: "center" },
  S: { entry: "S", garage: "SW", porch: "S", living: "SE", kitchen: "center", outdoor: "E", private: "N", service: "W", center: "center" },
  E: { entry: "E", garage: "NE", porch: "E", living: "S", kitchen: "center", outdoor: "SW", private: "W", service: "N", center: "center" },
  W: { entry: "W", garage: "NW", porch: "W", living: "S", kitchen: "center", outdoor: "SE", private: "E", service: "N", center: "center" },
};

/** Rooms that are nicer with daylight, for the open side of a walkout basement. */
const DAYLIGHT = new Set(["family", "media", "bedroom", "guest-suite", "gym", "bonus", "playroom", "living", "office", "craft", "patio"]);
const BURIED = new Set(["storage", "mechanical", "workshop", "laundry"]);

export type Site = {
  roadSide: Plot["roadSide"];
  /** Spot on the downhill side, when the land slopes enough for a walkout. */
  walkout: Spot | null;
  /** Which axis a mirror image flips so the entry stays on the road. */
  mirrorAxis: "x" | "y";
};

export function siteOf(plot: Plot | null): Site {
  // Without land, assume the road is on the north and the back yard faces south.
  if (!plot) return { roadSide: "N", walkout: null, mirrorAxis: "x" };
  const f = plotImplications(plot).foundation.type;
  const walkout = f === "walkout" || f === "stepped" ? (compassShort(plot.slope.downhillDeg) as Spot) : null;
  return { roadSide: plot.roadSide, walkout, mirrorAxis: plot.roadSide === "N" || plot.roadSide === "S" ? "x" : "y" };
}

/** The built-in choice of spot for a room. */
export function ruleSpot(type: string, levelKind: "basement" | "main" | "upper" | "loft" | "split", site: Site): Spot {
  if (levelKind === "basement" && site.walkout) {
    if (DAYLIGHT.has(type)) return site.walkout;
    if (BURIED.has(type)) return oppositeSpot(site.walkout);
    return "center";
  }
  return BY_ROAD[site.roadSide][zoneOf(type)];
}
