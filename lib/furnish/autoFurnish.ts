import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { add, angleOf, dist, edgesOf, leftNormal, pointInPolygon, rectangle, rotate, round1, scale, sub, unit } from "@/lib/plan/geometry";
import { openingGeometries } from "@/lib/plan/walls";
import { overlaps } from "@/lib/plan/furniture";
import { isCurved } from "@/lib/plan/arcs";
import { areaKind } from "@/lib/plan/measure";
import { catalogEntry } from "./catalog";
import { layerItems, placeCheck, placeItem, type LayerItem } from "./layer";
import { BEDROOMS_FOR_CLOSETS, closetOnEdge, hasCloset, placeCloset, type ClosetSpot } from "./closets";

/**
 * "Furnish for me": fills a room (or every room on a floor) with what its
 * type needs, skipping anything already there. Kitchens get a counter run
 * with the sink, dishwasher and range set into it and a fridge beside it;
 * bathrooms a tub or shower, vanity and toilet; laundries a washer, dryer
 * and laundry sink; bedrooms a reach-in closet; mechanical rooms a water
 * heater and furnace; entries and mudrooms coat hooks or lockers. Each item
 * backs onto a wall clear of doors (and tall ones clear of windows), using
 * the same fit check as placing by hand. Cabinets, outlets and hookups
 * follow on their own from the fixtures. Sensible defaults, not a designer's
 * layout.
 */

export type FurnishResult = {
  plan: FloorPlan;
  /** How many things were put in. */
  placed: number;
  /** Rooms that got something. */
  rooms: string[];
  /** What didn't fit and what it got instead. */
  notes: string[];
};

/** Room types Furnish for me knows what to put in. */
const KNOWN = new Set(["kitchen", "bathroom", "primary-bath", "half-bath", "laundry", "mechanical", "entry", "mudroom", ...BEDROOMS_FOR_CLOSETS]);

export const canAutoFurnish = (room: Pick<PlanRoom, "type">) => KNOWN.has(room.type ?? "");

/** From the wall's line to an item's back, as the snap does. */
const OFF_WALL_IN = 2.5;
/** Things too tall to stand in front of a window. */
const TALL = new Set(["fixture:fridge", "fixture:water-heater", "fixture:furnace", "fixture:shower", "fixture:washer", "fixture:dryer", "addon:lockers"]);

type Fit = { x: number; y: number; rotation: number; widthIn: number; depthIn: number };

class Filler {
  plan: FloorPlan;
  placed = 0;
  notes: string[] = [];
  private items: LayerItem[];

  constructor(
    plan: FloorPlan,
    readonly room: PlanRoom,
    readonly ceilingIn: number,
  ) {
    this.plan = plan;
    this.items = layerItems(plan);
  }

  has(...kinds: string[]): boolean {
    return this.plan.fixtures.some((f) => f.roomId === this.room.id && kinds.includes(f.kind)) || (this.plan.addOns ?? []).some((a) => a.roomId === this.room.id && kinds.includes(a.kind));
  }

  fixtures(kind: string) {
    return this.plan.fixtures.filter((f) => f.roomId === this.room.id && f.kind === kind);
  }

  /** Whether an item stands clear of doors, inside the room and (for tall ones) not across a window. */
  private fits(entryId: string, c: Fit): boolean {
    const check = placeCheck(this.plan, { entryId, ...c }, this.items);
    if (!check.ok || check.roomId !== this.room.id || check.blocksDoors.length) return false;
    if (TALL.has(entryId)) {
      const outline = rectangle(c.x, c.y, c.widthIn, c.depthIn, c.rotation);
      for (const og of openingGeometries(this.plan)) {
        if (og.opening.kind !== "window") continue;
        if (overlaps(outline, rectangle(og.center.x, og.center.y, og.opening.widthIn, 16, angleOf(og.u)))) return false;
      }
    }
    return true;
  }

  /**
   * The best spot with its back on a wall: closest to `near` when given,
   * otherwise tucked toward a corner. Tries each width in turn.
   */
  spot(entryId: string, widths: number[], depthIn: number, near?: Point): Fit | null {
    for (const W of widths) {
      const spots: (Fit & { score: number })[] = [];
      for (const e of edgesOf(this.room.polygon)) {
        if (isCurved(this.room.bulges?.[e.i])) continue;
        const L = dist(e.a, e.b);
        if (L < W + 4) continue;
        const u = unit(sub(e.b, e.a));
        const nl = leftNormal(u);
        const mid = scale(add(e.a, e.b), 0.5);
        const n = pointInPolygon(add(mid, scale(nl, 2)), this.room.polygon) ? nl : scale(nl, -1);
        const rotation = (((Math.round(angleOf(n) - 90) % 360) + 360) % 360);
        for (let t = W / 2 + 3; t <= L - W / 2 - 3 + 0.01; t += 6) {
          const c = add(add(e.a, scale(u, t)), scale(n, depthIn / 2 + OFF_WALL_IN));
          const score = near ? -dist(c, near) : -Math.min(t - W / 2, L - t - W / 2);
          spots.push({ x: round1(c.x), y: round1(c.y), rotation, widthIn: W, depthIn, score });
        }
        // The far corner exactly.
        const t = L - W / 2 - 3;
        const c = add(add(e.a, scale(u, t)), scale(n, depthIn / 2 + OFF_WALL_IN));
        spots.push({ x: round1(c.x), y: round1(c.y), rotation, widthIn: W, depthIn, score: near ? -dist(c, near) : 0 });
      }
      spots.sort((a, b) => b.score - a.score);
      const hit = spots.find((s) => this.fits(entryId, s));
      if (hit) return { x: hit.x, y: hit.y, rotation: hit.rotation, widthIn: hit.widthIn, depthIn: hit.depthIn };
    }
    return null;
  }

  put(entryId: string, f: Fit): string | null {
    const out = placeItem(this.plan, entryId, f, { rotation: f.rotation, widthIn: f.widthIn, depthIn: f.depthIn, ceilingIn: this.ceilingIn });
    if (!out.id) return null;
    this.plan = out.plan;
    this.items = layerItems(this.plan);
    this.placed++;
    return out.id;
  }

  /** Put an item against a wall, at the first width that fits. */
  place(entryId: string, widths?: number[], near?: Point): boolean {
    const e = catalogEntry(entryId)!;
    const f = this.spot(entryId, widths ?? [e.widthIn], e.depthIn, near);
    return f ? Boolean(this.put(entryId, f)) : false;
  }

  /** Set an item into a counter, `x` inches from the counter's middle along it, its back against the counter's back. */
  onCounter(entryId: string, counter: FloorPlan["fixtures"][number], xs: number[]): Fit | null {
    const e = catalogEntry(entryId)!;
    const u = rotate({ x: 1, y: 0 }, counter.rotation);
    const v = rotate({ x: 0, y: 1 }, counter.rotation);
    const back = add({ x: counter.x, y: counter.y }, scale(v, -counter.depthIn / 2));
    for (const x of xs) {
      if (Math.abs(x) + e.widthIn / 2 > counter.widthIn / 2 + 0.01) continue;
      const c = add(add(back, scale(u, x)), scale(v, e.depthIn / 2));
      const f = { x: round1(c.x), y: round1(c.y), rotation: counter.rotation, widthIn: e.widthIn, depthIn: e.depthIn };
      if (this.fits(entryId, f)) return f;
    }
    return null;
  }

  missing(what: string, instead?: string) {
    this.notes.push(`No room for ${what} in ${this.room.name}${instead ? `: it got ${instead}` : ""}.`);
  }
}

const steps = (from: number, to: number, by: number) => {
  const out: number[] = [];
  for (let x = from; by > 0 ? x <= to + 0.01 : x >= to - 0.01; x += by) out.push(x);
  return out;
};

function kitchen(f: Filler) {
  if (!f.has("counter", "island")) {
    if (!f.place("fixture:counter", [144, 120, 96, 84, 72, 60, 48])) f.missing("a counter");
  }
  const counters = [...f.fixtures("counter"), ...f.fixtures("island")];
  let sinkAt: { counter: (typeof counters)[number]; x: number } | null = null;
  if (!f.has("sink")) {
    for (const c of counters) {
      const half = c.widthIn / 2;
      // Toward the right end, leaving the left end for the range.
      const xs = steps(Math.min(half - 16.5 - 24, half / 3), -half + 16.5, -6);
      const fit = f.onCounter("fixture:sink", c, xs);
      if (fit && f.put("fixture:sink", fit)) {
        sinkAt = { counter: c, x: xsOf(c, fit) };
        break;
      }
    }
    if (!sinkAt) f.missing("a kitchen sink");
  } else {
    const s = f.fixtures("sink")[0];
    const c = counters.find((k) => dist(k, s) < k.widthIn / 2 + 1);
    if (c) sinkAt = { counter: c, x: xsOf(c, s) };
  }
  if (!f.has("dishwasher")) {
    const fit = sinkAt && f.onCounter("fixture:dishwasher", sinkAt.counter, [sinkAt.x + 16.5 + 12, sinkAt.x - 16.5 - 12]);
    if (!(fit && f.put("fixture:dishwasher", fit)) && !f.place("fixture:dishwasher", undefined, sinkAt ? sinkAt.counter : undefined)) f.missing("a dishwasher");
  }
  if (!f.has("range")) {
    let done = false;
    for (const c of counters) {
      const half = c.widthIn / 2;
      // Clear of the sink by a foot of counter on each side.
      const xs = steps(-half + 15 + 12, half - 15 - 12, 6).filter((x) => !sinkAt || sinkAt.counter.id !== c.id || Math.abs(x - sinkAt.x) >= 16.5 + 15 + 12);
      const fit = f.onCounter("fixture:range", c, xs);
      if (fit && f.put("fixture:range", fit)) {
        done = true;
        break;
      }
    }
    if (!done && !f.place("fixture:range")) f.missing("a range");
  }
  if (!f.has("fridge")) {
    const c = counters[0];
    const end = c && add({ x: c.x, y: c.y }, scale(rotate({ x: 1, y: 0 }, c.rotation), -c.widthIn / 2 - 20));
    if (!f.place("fixture:fridge", undefined, end)) f.missing("a refrigerator");
  }
}

/** How far along a counter (from its middle) something sits. */
function xsOf(counter: { x: number; y: number; rotation: number }, p: Point): number {
  const u = rotate({ x: 1, y: 0 }, counter.rotation);
  return round1((p.x - counter.x) * u.x + (p.y - counter.y) * u.y);
}

function bath(f: Filler, kind: "full" | "primary" | "half") {
  if (kind !== "half" && !f.has("tub", "shower")) {
    if (kind === "primary") {
      if (!f.place("fixture:shower", [60, 48, 36])) f.missing("a shower");
      f.place("fixture:tub");
    } else if (!f.place("fixture:tub")) {
      const shower = f.spot("fixture:shower", [48, 36], 36) ?? f.spot("fixture:shower", [36], 32);
      if (shower && f.put("fixture:shower", shower)) f.missing("a tub", `a ${shower.widthIn}" shower`);
      else f.missing("a tub or a shower");
    }
  }
  if (!f.has("toilet") && !f.place("fixture:toilet")) f.missing("a toilet");
  if (!f.has("vanity") && !f.place("fixture:vanity", kind === "primary" ? [60, 48, 36] : kind === "half" ? [30, 24] : [36, 30, 24])) f.missing("a vanity");
}

function laundry(f: Filler) {
  let washer = f.fixtures("washer")[0] as Point | undefined;
  if (!washer) {
    if (f.place("fixture:washer")) washer = f.fixtures("washer")[0];
    else f.missing("a washer");
  }
  if (!f.has("dryer") && !f.place("fixture:dryer", undefined, washer)) f.missing("a dryer");
  if (!f.has("laundry-sink")) f.place("fixture:laundry-sink", undefined, washer);
}

function bedroom(f: Filler) {
  if (hasCloset(f.plan, f.room.id)) return;
  const spot = closetFor(f);
  if (!spot) return f.missing("a closet");
  const out = placeCloset(f.plan, spot);
  if (out.id) {
    f.plan = out.plan;
    f.placed++;
  }
}

/** A reach-in closet in a corner of the room: the widest that fits, on a wall with nothing in the way. */
function closetFor(f: Filler): ClosetSpot | null {
  const items = layerItems(f.plan);
  for (const widthIn of [72, 60, 48]) {
    for (const e of edgesOf(f.room.polygon)) {
      const L = dist(e.a, e.b);
      for (const t of [0, L]) {
        const s = closetOnEdge(f.plan, f.room, e.i, t, "reach-in", { widthIn, depthIn: 26 }, items);
        if (s.ok && s.widthIn === widthIn) return s;
      }
    }
  }
  return null;
}

function fillRoom(f: Filler) {
  const t = f.room.type ?? "";
  if (t === "kitchen") kitchen(f);
  else if (t === "bathroom") bath(f, "full");
  else if (t === "primary-bath") bath(f, "primary");
  else if (t === "half-bath") bath(f, "half");
  else if (t === "laundry") laundry(f);
  else if (BEDROOMS_FOR_CLOSETS.includes(t)) bedroom(f);
  else if (t === "mechanical") {
    if (!f.has("water-heater") && !f.place("fixture:water-heater")) f.missing("a water heater");
    if (!f.has("furnace") && !f.place("fixture:furnace")) f.missing("a furnace");
  } else if (t === "entry") {
    if (!f.has("coat-hooks", "lockers")) f.place("addon:coat-hooks");
  } else if (t === "mudroom") {
    if (!f.has("lockers", "coat-hooks") && !f.place("addon:lockers", [60, 48, 36]) && !f.place("addon:coat-hooks")) f.missing("lockers or coat hooks");
  }
}

/** Furnish one room. */
export function furnishRoom(plan: FloorPlan, roomId: string, ceilingIn = 96): FurnishResult {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !canAutoFurnish(room) || areaKind(room) === "outdoor") return { plan, placed: 0, rooms: [], notes: [] };
  const f = new Filler(plan, room, ceilingIn);
  fillRoom(f);
  return { plan: f.plan, placed: f.placed, rooms: f.placed ? [room.name] : [], notes: f.notes };
}

/** Furnish every room on a floor. */
export function furnishLevel(plan: FloorPlan, ceilingIn = 96): FurnishResult {
  let p = plan;
  const out: FurnishResult = { plan, placed: 0, rooms: [], notes: [] };
  for (const r of plan.rooms.filter(canAutoFurnish)) {
    const res = furnishRoom(p, r.id, ceilingIn);
    p = res.plan;
    out.placed += res.placed;
    out.rooms.push(...res.rooms);
    out.notes.push(...res.notes);
  }
  return { ...out, plan: p };
}

/** One line saying what Furnish for me did. */
export function furnishSummary(res: Pick<FurnishResult, "placed" | "rooms">): string {
  if (!res.placed) return "Everything Furnish for me would add is already there.";
  const rooms = res.rooms.length === 1 ? res.rooms[0] : `${res.rooms.length} rooms`;
  return `Furnish for me put ${res.placed} ${res.placed === 1 ? "thing" : "things"} in ${rooms}. Cabinets, outlets and hookups follow on their own. Undo takes it all back.`;
}
