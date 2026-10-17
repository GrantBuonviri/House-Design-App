import { PlanBasics, type Level } from "@/lib/model/schema";

/**
 * The plan basics: ceiling heights, wall thickness, garage, stairs and doors.
 * Every answer has a sensible default for a new house.
 */

/**
 * The basics every answer starts at. Outside walls are 2x6 in climate zone 5
 * and colder (room for the insulation the energy code wants there) and 2x4
 * in warmer zones. Without a zone, 2x6.
 */
export function defaultBasics(climateZone?: string): PlanBasics {
  const zone = climateZone ? parseInt(climateZone, 10) : NaN;
  return PlanBasics.parse(zone < 5 ? { exteriorWall: "2x4" } : {});
}

/** Ceiling height for a level when the basics don't name one: 9 ft on the main floor, 8 ft elsewhere. */
export function defaultCeiling(level: Pick<Level, "kind">): number {
  return level.kind === "main" ? 108 : 96;
}

export function ceilingFor(basics: PlanBasics | null, level: Pick<Level, "id" | "kind">): number {
  return basics?.ceilings[level.id] ?? defaultCeiling(level);
}

/** Wall thickness with drywall (and sheathing outside), inches. */
export const INTERIOR_WALL_IN = 4.5;
export function exteriorWallIn(basics: PlanBasics | null): number {
  return (basics ?? defaultBasics()).exteriorWall === "2x4" ? 4.5 : 6.5;
}

/** Floor joists, subfloor and the ceiling below, between one floor's ceiling and the next floor. */
export const FLOOR_STRUCTURE_IN = 13;

/**
 * How far the stairs climb from one level to another: the lower level's
 * ceiling plus the floor structure, or the difference in elevation for
 * split levels and lofts.
 */
export function riseBetween(basics: PlanBasics | null, from: Level, to: Level): number {
  const regular = /^(floor|basement)-\d$/;
  const next = Math.abs(to.elevationIn - from.elevationIn);
  if (regular.test(from.id) && regular.test(to.id) && to.elevationIn > from.elevationIn) {
    const steps = Math.round(next / 120) || 1;
    if (steps === 1) return ceilingFor(basics, from) + FLOOR_STRUCTURE_IN;
  }
  return next;
}

/** The level right above this one, if any. */
export function levelAbove(levels: Level[], level: Level): Level | undefined {
  return [...levels].sort((a, b) => a.elevationIn - b.elevationIn).find((l) => l.elevationIn > level.elevationIn);
}

export function levelBelow(levels: Level[], level: Level): Level | undefined {
  return [...levels].sort((a, b) => b.elevationIn - a.elevationIn).find((l) => l.elevationIn < level.elevationIn);
}

export const GARAGE_LABEL: Record<PlanBasics["garage"], string> = {
  front: "Attached, doors facing the road",
  side: "Attached, doors on the side (side-load)",
  detached: "Detached, separate from the house",
  none: "No garage",
};

export const STAIRS_LABEL: Record<PlanBasics["stairs"], string> = {
  straight: "Straight",
  l: "L-shaped, with a landing",
  u: "U-shaped (switchback)",
};
