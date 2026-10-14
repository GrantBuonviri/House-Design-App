import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { roomType } from "@/lib/brief/rooms";
import { SQ_IN_PER_SQ_FT, polygonArea } from "./geometry";

/**
 * Room areas and floor totals. Areas are measured to the middle of the walls,
 * so they read a little larger than the floor you'd carpet.
 */

export function roomSqft(room: Pick<PlanRoom, "polygon">): number {
  return Math.round(polygonArea(room.polygon) / SQ_IN_PER_SQ_FT);
}

export type AreaKind = "living" | "garage" | "outdoor";

/** Garages and outdoor rooms (porches, decks, patios) don't count as living space. */
export function areaKind(room: Pick<PlanRoom, "type">): AreaKind {
  if (!room.type) return "living";
  const c = roomType(room.type).category;
  return c === "garage" ? "garage" : c === "outdoor" ? "outdoor" : "living";
}

export type Totals = Record<AreaKind, number>;

export function planTotals(plan: FloorPlan): Totals {
  const t: Totals = { living: 0, garage: 0, outdoor: 0 };
  for (const r of plan.rooms) t[areaKind(r)] += polygonArea(r.polygon) / SQ_IN_PER_SQ_FT;
  return { living: Math.round(t.living), garage: Math.round(t.garage), outdoor: Math.round(t.outdoor) };
}

export function houseTotals(plans: FloorPlan[]): Totals {
  return plans.map(planTotals).reduce((s, t) => ({ living: s.living + t.living, garage: s.garage + t.garage, outdoor: s.outdoor + t.outdoor }), {
    living: 0,
    garage: 0,
    outdoor: 0,
  });
}

/** "1,820 sq ft living · 528 garage · 140 outdoor", leaving out what's zero. */
export function totalsText(t: Totals): string {
  const f = (n: number) => n.toLocaleString("en-US");
  const parts = [`${f(t.living)} sq ft living`];
  if (t.garage) parts.push(`${f(t.garage)} garage`);
  if (t.outdoor) parts.push(`${f(t.outdoor)} outdoor`);
  return parts.join(" · ");
}
