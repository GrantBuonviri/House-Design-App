import type { AddOn, Cabinet, Device, FloorPlan } from "@/lib/model/schema";

/**
 * Furnish items that ride along with their room: add-ons, and cabinets and
 * devices placed by hand (each with a `roomId`). Fixtures and furniture are
 * handled by the room edit helpers themselves; this covers the rest, so
 * moving, turning, copying, flipping, joining or splitting a room carries
 * them too. Kept free of other plan imports so every edit helper can use it.
 */

export type Rider = AddOn | Cabinet | Device;

/** Map every rider (add-ons, hand-added cabinets and devices) through `fn`; returns only the lists that exist, to spread into a plan. */
export function mapRiders(plan: FloorPlan, fn: <T extends Rider>(x: T) => T): Partial<Pick<FloorPlan, "addOns" | "cabinets" | "devices">> {
  const out: Partial<Pick<FloorPlan, "addOns" | "cabinets" | "devices">> = {};
  if (plan.addOns) out.addOns = plan.addOns.map((x) => fn(x));
  if (plan.cabinets) out.cabinets = { ...plan.cabinets, added: plan.cabinets.added.map((x) => fn(x)) };
  if (plan.devices) out.devices = { ...plan.devices, added: plan.devices.added.map((x) => fn(x)) };
  return out;
}

/** Riders in any of these rooms. */
export function ridersIn(plan: FloorPlan, roomIds: Set<string>): { addOns: AddOn[]; cabinets: Cabinet[]; devices: Device[] } {
  const inRoom = (x: Rider) => x.roomId !== undefined && roomIds.has(x.roomId);
  return {
    addOns: (plan.addOns ?? []).filter(inRoom),
    cabinets: (plan.cabinets?.added ?? []).filter(inRoom),
    devices: (plan.devices?.added ?? []).filter(inRoom),
  };
}

/** Add copies of riders to a plan. */
export function addRiders(plan: FloorPlan, more: { addOns: AddOn[]; cabinets: Cabinet[]; devices: Device[] }): FloorPlan {
  const next = { ...plan };
  if (more.addOns.length) next.addOns = [...(plan.addOns ?? []), ...more.addOns];
  if (more.cabinets.length) next.cabinets = { hidden: plan.cabinets?.hidden ?? [], added: [...(plan.cabinets?.added ?? []), ...more.cabinets] };
  if (more.devices.length) next.devices = { hidden: plan.devices?.hidden ?? [], added: [...(plan.devices?.added ?? []), ...more.devices] };
  return next;
}
