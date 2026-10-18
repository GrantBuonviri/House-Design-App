import type { FloorPlan, PlanRoom, Point } from "@/lib/model/schema";
import { add, angleOf, dist, edgesOf, leftNormal, pointInPolygon, polygonCenter, rectangle, rotate, round1, scale, sub, unit } from "@/lib/plan/geometry";
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
 *
 * Two choices: Minimal is just that; Full adds furniture too (beds with
 * nightstands and a dresser, a sofa with a coffee table and a TV stand, a
 * dining table, a desk and chair) and decor where it fits (table lamps,
 * rugs, pillows, a floor lamp, a pendant over the table, plants). Either can be previewed first: the result
 * lists what it would add (`added`) before anything is saved.
 */

export type FurnishPreset = "minimal" | "full";

export const FURNISH_PRESETS: { id: FurnishPreset; label: string; hint: string }[] = [
  { id: "minimal", label: "Minimal", hint: "What each room needs: kitchen counters and appliances, bath fixtures, laundry, bedroom closets, the water heater and furnace, coat hooks." },
  { id: "full", label: "Full", hint: "All of that, plus furniture and decor: beds with nightstands, lamps and a dresser, a sofa with pillows, a coffee table, rug, floor lamp and TV stand, a dining table with a pendant, a desk and chair, and plants." },
];

/** One thing Furnish for me put in (or would, in a preview). */
export type FurnishAdded = { id: string; label: string; room: string; roomId: string };

export type FurnishResult = {
  plan: FloorPlan;
  /** How many things were put in. */
  placed: number;
  /** Rooms that got something. */
  rooms: string[];
  /** What didn't fit and what it got instead. */
  notes: string[];
  /** Each thing put in, in order. */
  added: FurnishAdded[];
};

/** Room types Furnish for me knows what to put in. */
const KNOWN = new Set(["kitchen", "bathroom", "primary-bath", "half-bath", "laundry", "mechanical", "entry", "mudroom", ...BEDROOMS_FOR_CLOSETS]);

/** Rooms that only get something with Full: their furniture. */
const FURNITURE_ONLY = new Set(["living", "family", "bonus", "dining", "office"]);

export const canAutoFurnish = (room: Pick<PlanRoom, "type">, preset: FurnishPreset = "minimal") => KNOWN.has(room.type ?? "") || (preset === "full" && FURNITURE_ONLY.has(room.type ?? ""));

/** From the wall's line to an item's back, as the snap does. */
const OFF_WALL_IN = 2.5;
/** Things too tall to stand in front of a window. */
const TALL = new Set(["fixture:fridge", "fixture:water-heater", "fixture:furnace", "fixture:shower", "fixture:washer", "fixture:dryer", "addon:lockers"]);

type Fit = { x: number; y: number; rotation: number; widthIn: number; depthIn: number };

class Filler {
  plan: FloorPlan;
  placed = 0;
  notes: string[] = [];
  added: FurnishAdded[] = [];
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
    const here = (x: { roomId?: string; kind: string }) => x.roomId === this.room.id && kinds.includes(x.kind);
    return this.plan.fixtures.some(here) || (this.plan.addOns ?? []).some(here) || this.plan.furniture.some(here);
  }

  fixtures(kind: string) {
    return this.plan.fixtures.filter((f) => f.roomId === this.room.id && f.kind === kind);
  }

  /** Whether an item stands clear of doors, inside the room and (for tall ones) not across a window. */
  fits(entryId: string, c: Fit): boolean {
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
  spot(entryId: string, widths: number[], depthIn: number, near?: Point | "middle"): Fit | null {
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
          // "middle": the middle of the longest wall it fits on (a bed or a sofa).
          const score = near === "middle" ? L - Math.abs(t - L / 2) * 2 : near ? -dist(c, near) : -Math.min(t - W / 2, L - t - W / 2);
          spots.push({ x: round1(c.x), y: round1(c.y), rotation, widthIn: W, depthIn, score });
        }
        // The far corner exactly.
        const t = L - W / 2 - 3;
        const c = add(add(e.a, scale(u, t)), scale(n, depthIn / 2 + OFF_WALL_IN));
        spots.push({ x: round1(c.x), y: round1(c.y), rotation, widthIn: W, depthIn, score: near === "middle" ? L - Math.abs(t - L / 2) * 2 : near ? -dist(c, near) : 0 });
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
    this.added.push({ id: out.id, label: catalogEntry(entryId)?.label ?? entryId, room: this.room.name, roomId: this.room.id });
    return out.id;
  }

  /** Put an item at an exact spot if it fits there. */
  putIfFits(entryId: string, f: Fit): string | null {
    return this.fits(entryId, f) ? this.put(entryId, f) : null;
  }

  /** Put an item against a wall, at the first width that fits. */
  place(entryId: string, widths?: number[], near?: Point | "middle"): boolean {
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
    f.added.push({ id: out.id, label: "Reach-in closet", room: f.room.name, roomId: f.room.id });
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

type Host = { x: number; y: number; rotation: number; widthIn: number; depthIn: number };

/**
 * A spot measured from another item: `along` its width from its middle, and
 * `out` from its back toward its front, to the new item's middle. `turn`
 * turns the new item (180 faces it back toward the host).
 */
function fromHost(entryId: string, host: Host, along: number, out: number, turn = 0): Fit {
  const e = catalogEntry(entryId)!;
  const u = rotate({ x: 1, y: 0 }, host.rotation);
  const v = rotate({ x: 0, y: 1 }, host.rotation);
  const back = add({ x: host.x, y: host.y }, scale(v, -host.depthIn / 2));
  const c = add(add(back, scale(u, along)), scale(v, out));
  return { x: round1(c.x), y: round1(c.y), rotation: (((host.rotation + turn) % 360) + 360) % 360, widthIn: e.widthIn, depthIn: e.depthIn };
}

/** Try each entry in turn against a wall; the first that fits goes in. */
function firstOf(f: Filler, entryIds: string[], near?: Point | "middle"): Host | null {
  for (const id of entryIds) {
    const e = catalogEntry(id)!;
    const fit = f.spot(id, [e.widthIn], e.depthIn, near);
    if (fit && f.put(id, fit)) return fit;
  }
  return null;
}

const furnitureIn = (f: Filler, kind: string) => f.plan.furniture.find((x) => x.roomId === f.room.id && x.kind === kind);
const anyFurniture = (f: Filler, kinds: string[]) => kinds.some((k) => furnitureIn(f, k));
const BEDS = ["bed-king", "bed-queen", "bed-full", "bed-twin"];
const SOFAS = ["sectional", "sofa", "loveseat"];

/** Full only: the furniture a room is used with. Nothing goes in a room that already has its main piece. */
function furnish(f: Filler) {
  const t = f.room.type ?? "";
  if (BEDROOMS_FOR_CLOSETS.includes(t)) {
    if (anyFurniture(f, BEDS)) return;
    const bed = firstOf(f, t === "primary-bedroom" ? ["furniture:bed-king", "furniture:bed-queen"] : ["furniture:bed-queen", "furniture:bed-full", "furniture:bed-twin"], "middle");
    if (!bed) return f.missing("a bed");
    for (const s of [-1, 1]) {
      const stand = fromHost("furniture:nightstand", bed, s * (bed.widthIn / 2 + 2 + 11), 9);
      // A table lamp on each nightstand.
      if (f.putIfFits("furniture:nightstand", stand)) f.putIfFits("addon:table-lamp", { ...stand, widthIn: 14, depthIn: 14 });
    }
    // A rug across the foot half of the bed.
    putRug(f, bed, ["furniture:rug-small"], bed.depthIn * 0.5);
    // The dresser across from the foot of the bed.
    const foot = add({ x: bed.x, y: bed.y }, scale(rotate({ x: 0, y: 1 }, bed.rotation), bed.depthIn / 2 + 120));
    f.place("furniture:dresser", [60, 48, 36], foot);
  } else if (t === "living" || t === "family" || t === "bonus") {
    if (anyFurniture(f, SOFAS)) return;
    const sofa = firstOf(f, ["furniture:sofa", "furniture:loveseat"], "middle");
    if (!sofa) return f.missing("a sofa");
    // 18" of floor between the sofa and the coffee table.
    f.putIfFits("furniture:coffee-table", fromHost("furniture:coffee-table", sofa, 0, sofa.depthIn + 18 + 12));
    // Decor: pillows on the sofa, a rug under the front legs and the coffee table, a floor lamp at one end, a plant in a corner.
    f.putIfFits("addon:throw-pillows", { ...fromHost("addon:throw-pillows", sofa, 0, 10), widthIn: Math.max(20, sofa.widthIn - 24) });
    putRug(f, sofa, ["furniture:rug-large", "furniture:rug-small"], sofa.depthIn * 0.6);
    for (const s of [1, -1]) if (f.putIfFits("furniture:floor-lamp", fromHost("furniture:floor-lamp", sofa, s * (sofa.widthIn / 2 + 12), 12))) break;
    const across = add({ x: sofa.x, y: sofa.y }, scale(rotate({ x: 0, y: 1 }, sofa.rotation), 240));
    f.place("furniture:tv-stand", undefined, across);
    f.place("furniture:plant");
  } else if (t === "dining") {
    if (furnitureIn(f, "dining-table")) return;
    // In the middle of the room, long side along the room's longest wall.
    const c = polygonCenter(f.room.polygon);
    const longest = edgesOf(f.room.polygon).reduce((a, b) => (dist(b.a, b.b) > dist(a.a, a.b) ? b : a));
    const rotation = (((Math.round(angleOf(sub(longest.b, longest.a))) % 180) + 180) % 180);
    const e = catalogEntry("furniture:dining-table")!;
    const fit = { x: round1(c.x), y: round1(c.y), widthIn: e.widthIn, depthIn: e.depthIn };
    if (!f.putIfFits("furniture:dining-table", { ...fit, rotation }) && !f.putIfFits("furniture:dining-table", { ...fit, rotation: (rotation + 90) % 180 })) return f.missing("a dining table");
    // A pendant over the table.
    f.putIfFits("addon:pendant", { ...fit, rotation, widthIn: 16, depthIn: 16 });
  } else if (t === "office") {
    if (furnitureIn(f, "desk")) return;
    const desk = firstOf(f, ["furniture:desk"], "middle");
    if (!desk) return f.missing("a desk");
    f.putIfFits("furniture:desk-chair", fromHost("furniture:desk-chair", desk, 0, desk.depthIn + 13, 180));
    f.place("furniture:plant-snake");
  }
}

/** A rug laid square to `host`, its back edge `out` inches in front of the host's back: the first size that fits the room. */
function putRug(f: Filler, host: Host, rugs: string[], out: number) {
  for (const id of rugs) {
    const e = catalogEntry(id)!;
    if (f.putIfFits(id, { ...fromHost(id, host, 0, out + e.depthIn / 2) })) return;
  }
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
export function furnishRoom(plan: FloorPlan, roomId: string, ceilingIn = 96, preset: FurnishPreset = "minimal"): FurnishResult {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || !canAutoFurnish(room, preset) || areaKind(room) === "outdoor") return { plan, placed: 0, rooms: [], notes: [], added: [] };
  const f = new Filler(plan, room, ceilingIn);
  fillRoom(f);
  // Furniture last, so it works around the fixtures and closet.
  if (preset === "full") furnish(f);
  return { plan: f.plan, placed: f.placed, rooms: f.placed ? [room.name] : [], notes: f.notes, added: f.added };
}

/** Furnish every room on a floor. */
export function furnishLevel(plan: FloorPlan, ceilingIn = 96, preset: FurnishPreset = "minimal"): FurnishResult {
  let p = plan;
  const out: FurnishResult = { plan, placed: 0, rooms: [], notes: [], added: [] };
  for (const r of plan.rooms.filter((x) => canAutoFurnish(x, preset))) {
    const res = furnishRoom(p, r.id, ceilingIn, preset);
    p = res.plan;
    out.placed += res.placed;
    out.rooms.push(...res.rooms);
    out.notes.push(...res.notes);
    out.added.push(...res.added);
  }
  return { ...out, plan: p };
}

/** The preview's list: what would go in each room, with counts ("Kitchen: Counter, Sink, 2 Nightstands"). */
export function previewLines(added: FurnishAdded[]): { room: string; items: string }[] {
  const rooms = new Map<string, { room: string; m: Map<string, number> }>();
  for (const a of added) {
    const r = rooms.get(a.roomId) ?? { room: a.room, m: new Map<string, number>() };
    r.m.set(a.label, (r.m.get(a.label) ?? 0) + 1);
    rooms.set(a.roomId, r);
  }
  return [...rooms.values()].map(({ room, m }) => ({ room, items: [...m].map(([label, n]) => (n > 1 ? `${n} ${label.toLowerCase()}s` : label)).join(", ") }));
}

/** One line saying what Furnish for me did. */
export function furnishSummary(res: Pick<FurnishResult, "placed" | "rooms">): string {
  if (!res.placed) return "Everything Furnish for me would add is already there.";
  const rooms = res.rooms.length === 1 ? res.rooms[0] : `${res.rooms.length} rooms`;
  return `Furnish for me put ${res.placed} ${res.placed === 1 ? "thing" : "things"} in ${rooms}. Cabinets, outlets and hookups follow on their own. Undo takes it all back.`;
}
