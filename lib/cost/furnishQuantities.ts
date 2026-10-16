import type { FloorPlan } from "@/lib/model/schema";
import { pointInPolygon } from "@/lib/plan/geometry";
import { cabinetLayout } from "@/lib/plan/cabinets";
import { codeNum } from "@/lib/codes/data";
import { isHookup } from "@/lib/plan/devices";

/** What the Furnish stage adds to the estimate that the older measuring doesn't see. */
export type FurnishExtras = {
  builtInLf: number;
  wallShelfLf: number;
  ceilingFans: number;
  /** Mirrors, towel bars, grab bars, medicine cabinets and coat hooks. */
  accessories: number;
  fireplaces: number;
  extraWaterRuns: number;
  extraDrainRuns: number;
  gasRuns: number;
  circuits240: number;
  dryerVents: number;
  extraDevices: number;
};

export const noFurnishExtras = (): FurnishExtras => ({
  builtInLf: 0,
  wallShelfLf: 0,
  ceilingFans: 0,
  accessories: 0,
  fireplaces: 0,
  extraWaterRuns: 0,
  extraDrainRuns: 0,
  gasRuns: 0,
  circuits240: 0,
  dryerVents: 0,
  extraDevices: 0,
});

const BUILT_INS = new Set(["bookcase", "window-seat", "bench", "desk", "lockers"]);
const ACCESSORIES = new Set(["mirror", "towel-bar", "grab-bar", "medicine-cabinet", "coat-hooks"]);

/**
 * Only what was placed by hand beyond what fixtures and the code rules bring.
 * A moved or swapped app-placed device is one hidden plus one added, so it
 * nets out to nothing; hookups are matched to their fixture by id (`hk:<fixture>:<kind>`).
 */
export function furnishExtras(plan: FloorPlan): FurnishExtras {
  const x = noFurnishExtras();
  for (const a of plan.addOns ?? []) {
    if (BUILT_INS.has(a.kind)) x.builtInLf += a.widthIn / 12;
    else if (a.kind === "shelving") x.wallShelfLf += a.widthIn / 12;
    else if (a.kind === "ceiling-fan") x.ceilingFans += 1;
    else if (ACCESSORIES.has(a.kind)) x.accessories += 1;
  }
  x.fireplaces = plan.fixtures.filter((f) => f.kind === "fireplace").length;

  const added = plan.devices?.added ?? [];
  const hidden = plan.devices?.hidden ?? [];
  const hiddenHook = (kind: string) => hidden.filter((id) => id.startsWith("hk:") && id.endsWith(`:${kind}`)).length;
  const extra = (kind: string) => Math.max(0, added.filter((d) => d.kind === kind).length - hiddenHook(kind));
  x.extraWaterRuns = extra("water");
  x.extraDrainRuns = extra("drain");
  x.gasRuns = extra("gas");
  x.dryerVents = extra("dryer-vent");
  // Appliance outlets the app places have ids `out:<fixture id>`.
  const hidden240 = hidden.filter((id) => /^out:[^:]+$/.test(id)).length;
  x.circuits240 = Math.max(0, added.filter((d) => d.kind === "outlet-240").length - hidden240);
  const hiddenHooks = hidden.filter((id) => id.startsWith("hk:")).length;
  const others = added.filter((d) => !isHookup(d.kind) && d.kind !== "outlet-240").length;
  x.extraDevices = Math.max(0, others - Math.max(0, hidden.length - hiddenHooks - hidden240));
  return x;
}

export type RoomCabinets = {
  /** Linear feet counted at the kitchen cabinet rate, where a base and upper run together is 1 foot per foot. */
  lf: number;
  tall: number;
  specialty: number;
};

const UPPER_KINDS = new Set(["upper", "open-shelf", "appliance-garage"]);
const SPECIALTY = new Set(["corner", "wine", "appliance-garage", "open-shelf"]);
const BASE_SHARE = 0.6;

/**
 * The real cabinets on a floor (the app's own layout plus hand edits) by room.
 * The kitchen rate is per foot of run with base and uppers, so base cabinets
 * count 60% and uppers 40%. Vanities are priced as vanities.
 */
export function cabinetsByRoom(plan: FloorPlan, ceilingIn: number): Map<string, RoomCabinets> {
  const out = new Map<string, RoomCabinets>();
  const layout = cabinetLayout(plan, ceilingIn, codeNum("kitchen.rangeClearanceAbove"));
  const runRoom = new Map(layout.runs.map((r) => [r.id, r.roomId]));
  for (const c of layout.cabinets) {
    if (c.kind === "vanity") continue;
    const room = plan.rooms.find((r) => pointInPolygon({ x: c.x, y: c.y }, r.polygon))?.id ?? c.roomId ?? (c.runId ? runRoom.get(c.runId) : undefined);
    if (!room) continue;
    const cur = out.get(room) ?? { lf: 0, tall: 0, specialty: 0 };
    const w = c.widthIn / 12;
    if (c.kind === "tall" || c.kind === "pantry") cur.tall += 1;
    else cur.lf += w * (UPPER_KINDS.has(c.kind) ? 1 - BASE_SHARE : BASE_SHARE);
    if (SPECIALTY.has(c.kind)) cur.specialty += 1;
    out.set(room, cur);
  }
  return out;
}
