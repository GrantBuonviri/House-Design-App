import type { FloorPlan, PlanPin, Point } from "@/lib/model/schema";
import { project } from "./geometry";

/** How close (screen pixels) a click has to be to a pinned line. */
export const PIN_HIT_PX = 8;

export function addPin(plan: FloorPlan, pin: PlanPin): FloorPlan {
  return { ...plan, pins: [...(plan.pins ?? []), pin] };
}

export function removePin(plan: FloorPlan, id: string): FloorPlan {
  const pins = (plan.pins ?? []).filter((p) => p.id !== id);
  const next: FloorPlan = { ...plan, pins };
  if (!pins.length) delete next.pins;
  return next;
}

/** The pin nearest to `p` within `tol` inches of its line, or null. */
export function pinAt(plan: FloorPlan, p: Point, tol: number): PlanPin | null {
  let best: PlanPin | null = null;
  let bestD = tol;
  for (const pin of plan.pins ?? []) {
    const d = project(p, pin.a, pin.b).d;
    if (d <= bestD) {
      best = pin;
      bestD = d;
    }
  }
  return best;
}
