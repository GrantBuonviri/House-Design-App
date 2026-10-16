import type { Device, DeviceEdits, DeviceKind, FloorPlan, HouseSystems, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { openingType } from "./catalog";
import { openingRooms, roleOf } from "./connect";
import { newPlanId } from "./edit";
import { INTERIOR_WALL_IN } from "./basics";
import { add, angleOf, boundsOf, dist, dot, edgesOf, leftNormal, pointInPolygon, polygonArea, polygonCenter, project, rotate, round1, scale, sub, subtractIntervals, unit } from "./geometry";
import { inSpans, openSpans, openingGeometries, type OpeningGeometry } from "./walls";
import type { CabinetLayout, CabinetRun } from "./cabinets";
import { flatPlan } from "./flatten";

/**
 * Outlets, switches, lights, smoke and CO alarms, fans, the panel, heating
 * registers and hose bibs, placed by the code rules (NEC 210.52 and 210.70,
 * IRC R314 and R315) from the rooms, doors and fixtures. Like the cabinets,
 * the owner can move, add or take away any of them; the changes are kept
 * as "hidden" app-placed ones plus "added" ones.
 */

export type DeviceSystem = "electrical" | "mechanical" | "plumbing";

export const DEVICE_INFO: Record<DeviceKind, { label: string; system: DeviceSystem; wall: boolean; mountIn?: number }> = {
  outlet: { label: "Outlet", system: "electrical", wall: true, mountIn: 16 },
  "outlet-240": { label: "240V appliance outlet", system: "electrical", wall: true, mountIn: 6 },
  junction: { label: "Box for a future island outlet", system: "electrical", wall: false },
  switch: { label: "Light switch", system: "electrical", wall: true, mountIn: 48 },
  "switch-3way": { label: "3-way switch", system: "electrical", wall: true, mountIn: 48 },
  light: { label: "Ceiling light", system: "electrical", wall: false },
  "light-recessed": { label: "Recessed light", system: "electrical", wall: false },
  "light-wall": { label: "Wall light", system: "electrical", wall: true, mountIn: 78 },
  fan: { label: "Exhaust fan", system: "electrical", wall: false },
  smoke: { label: "Smoke alarm", system: "electrical", wall: false },
  co: { label: "CO alarm", system: "electrical", wall: false },
  "smoke-co": { label: "Smoke and CO alarm", system: "electrical", wall: false },
  heat: { label: "Heat alarm", system: "electrical", wall: false },
  panel: { label: "Electrical panel", system: "electrical", wall: true, mountIn: 54 },
  supply: { label: "Heating and cooling supply", system: "mechanical", wall: false },
  return: { label: "Return air grille", system: "mechanical", wall: true, mountIn: 12 },
  thermostat: { label: "Thermostat", system: "mechanical", wall: true, mountIn: 54 },
  "hose-bib": { label: "Frost-free hose bib", system: "plumbing", wall: true, mountIn: 18 },
  water: { label: "Water supply (hot and cold)", system: "plumbing", wall: true, mountIn: 20 },
  drain: { label: "Drain", system: "plumbing", wall: true, mountIn: 16 },
  gas: { label: "Gas shutoff", system: "plumbing", wall: true, mountIn: 10 },
  "dryer-vent": { label: "Dryer vent", system: "mechanical", wall: true, mountIn: 30 },
};

/** Hookups: where water, drains, gas and the dryer vent come through the wall. Fixtures bring their own; more can be added by hand. */
export const HOOKUP_KINDS: DeviceKind[] = ["water", "drain", "gas", "dryer-vent"];
export const isHookup = (k: DeviceKind) => HOOKUP_KINDS.includes(k);

/** What each fixture needs behind it. Gas ones depend on the house's fuel choices. */
function hookupsFor(kind: string, systems: HouseSystems): DeviceKind[] {
  switch (kind) {
    case "toilet":
      return ["water", "drain"];
    case "sink":
    case "vanity":
    case "laundry-sink":
    case "tub":
    case "shower":
    case "dishwasher":
      return ["water", "drain"];
    case "washer":
      return ["water", "drain"];
    case "water-heater":
      return systems.waterHeater === "gas" || systems.waterHeater === "tankless-gas" ? ["water", "gas"] : ["water"];
    case "range":
      return systems.cooking === "gas" ? ["gas"] : [];
    case "dryer":
      return systems.dryer === "gas" ? ["gas", "dryer-vent"] : ["dryer-vent"];
    case "furnace":
      return systems.heating === "gas-furnace" ? ["gas"] : [];
    case "fireplace":
      return ["gas"];
    default:
      return [];
  }
}

/** The hookups behind each fixture, with ids `hk:<fixture id>:<kind>` so they follow the fixture and can be hidden or moved like any device. */
export function fixtureHookups(plan: FloorPlan, systems: HouseSystems): Device[] {
  const out: Device[] = [];
  for (const f of plan.fixtures) {
    const kinds = hookupsFor(f.kind, systems);
    if (!kinds.length) continue;
    const back = rotate({ x: 0, y: 1 }, f.rotation);
    const across = rotate({ x: 1, y: 0 }, f.rotation);
    // On the wall behind, spread a little apart across the fixture's width.
    const spread = Math.min(6, f.widthIn / 4);
    kinds.forEach((kind, i) => {
      const off = (i - (kinds.length - 1) / 2) * spread * 2;
      const p = add(add({ x: f.x, y: f.y }, scale(back, -f.depthIn / 2 + 1)), scale(across, off));
      out.push({ id: `hk:${f.id}:${kind}`, kind, x: round1(p.x), y: round1(p.y), rotation: f.rotation });
    });
  }
  return out;
}

/** The hookups that are on a floor now: the fixtures' own (less hidden ones) and hand-added ones. Used by the 3D view. */
export function placedHookups(plan: FloorPlan, systems: HouseSystems): Device[] {
  const hidden = new Set(plan.devices?.hidden ?? []);
  return [...fixtureHookups(plan, systems).filter((d) => !hidden.has(d.id)), ...(plan.devices?.added ?? []).filter((d) => isHookup(d.kind))];
}

export const isLight = (k: DeviceKind) => k === "light" || k === "light-recessed" || k === "light-wall";
export const isSwitch = (k: DeviceKind) => k === "switch" || k === "switch-3way";
export const isSmoke = (k: DeviceKind) => k === "smoke" || k === "smoke-co";
export const isCo = (k: DeviceKind) => k === "co" || k === "smoke-co";

export type PlacedDevice = Device & { auto: boolean };

/** What the placement needs to know beyond this floor's plan. */
export type DeviceContext = {
  plan: FloorPlan;
  cabinets: CabinetLayout;
  exteriorIn: number;
  systems: HouseSystems;
  /** CO alarms are needed: gas appliances, a fireplace, or an attached garage. */
  coNeeded: boolean;
  /** Island receptacles required (NEC 210.52(C)(2)); when not, a box for one later. */
  islandOutlet: boolean;
  /** The floor at ground level: outside outlets, lights and hose bibs. */
  grade: boolean;
  /** Boise wants a heat alarm, wired to the smoke alarms, in an attached garage (R314.7.5). */
  garageHeat: boolean;
  /** The floor that gets the panel and the thermostat. */
  panel: boolean;
  thermostat: boolean;
  /** Where stairs start (own stairs) and end (stairs from below) on this floor, for 3-way switches and a stair light. */
  stairEnds: Point[];
  stairs: Point[][];
};

// ---------- Room kinds ----------

const BATHS = new Set(["bathroom", "half-bath", "primary-bath"]);
const SLEEPING = new Set(["bedroom", "primary-bedroom", "guest-suite"]);
/** Rooms that need wall outlets every 12 ft (NEC 210.52(A)); bathrooms, halls, garages, closets and outdoor rooms have their own rules. */
const NO_WALL_OUTLETS = new Set(["bathroom", "half-bath", "primary-bath", "hall", "closet", "primary-closet", "pantry", "garage", "patio", "deck", "porch", "outdoor-kitchen", "storage", "mechanical"]);
export const needsWallOutlets = (r: Pick<PlanRoom, "type">) => !NO_WALL_OUTLETS.has(r.type ?? "other");
export const isBath = (r: Pick<PlanRoom, "type">) => BATHS.has(r.type ?? "");
const isSleeping = (r: Pick<PlanRoom, "type">) => SLEEPING.has(r.type ?? "");
const isClosetLike = (r: Pick<PlanRoom, "type">) => ["closet", "primary-closet", "pantry"].includes(r.type ?? "");
const isOutdoor = (r: Pick<PlanRoom, "type">) => roleOf(r) === "outdoor";
const isGarage = (r: Pick<PlanRoom, "type">) => roleOf(r) === "garage";
/** Heated and cooled rooms get supply registers. */
const conditioned = (r: PlanRoom) => !isOutdoor(r) && !isGarage(r) && !(isClosetLike(r) && polygonArea(r.polygon) / 144 < 40);

/** Fixtures and built-ins that break up a wall for the outlet spacing ("fixed cabinets" in 210.52(A)(2)). */
const BUILT_IN = new Set(["counter", "island", "sink", "range", "fridge", "dishwasher", "vanity", "tub", "shower", "fireplace", "washer", "dryer", "laundry-sink", "water-heater", "furnace", "closet"]);

// ---------- Walls of a room ----------

type Box = { x: number; y: number; rotation: number; widthIn: number; depthIn: number };

export type RoomEdge = { i: number; a: Point; b: Point; u: Point; inward: Point; length: number };

export function roomEdges(room: PlanRoom): RoomEdge[] {
  return edgesOf(room.polygon)
    .map(({ a, b, i }) => {
      const length = dist(a, b);
      const u = unit(sub(b, a));
      let inward = leftNormal(u);
      const mid = add(a, scale(u, length / 2));
      if (!pointInPolygon(add(mid, scale(inward, 2)), room.polygon)) inward = scale(inward, -1);
      return { i, a, b, u, inward, length };
    })
    .filter((e) => e.length > 1);
}

/** The inside face of a wall at a point on a room edge: past half the wall, plus an inch. */
function onWall(plan: FloorPlan, room: PlanRoom, e: RoomEdge, t: number, exteriorIn: number, outside = false): { p: Point; rotation: number } {
  const at = add(e.a, scale(e.u, t));
  const outward = scale(e.inward, -1);
  const other = plan.rooms.some((r) => r.id !== room.id && pointInPolygon(add(at, scale(outward, 6)), r.polygon));
  const half = other ? INTERIOR_WALL_IN / 2 : exteriorIn / 2;
  const dir = outside ? outward : e.inward;
  return { p: add(at, scale(dir, half + 1)), rotation: Math.round(angleOf(dir) - 90) };
}

/** Where a door, opening, built-in or removed wall sits along a room edge. */
function blockedOn(plan: FloorPlan, e: RoomEdge, geos: OpeningGeometry[], boxes: Box[]): [number, number][] {
  const cuts: [number, number][] = openSpans(plan, e.a, e.b);
  for (const g of geos) {
    if (g.opening.kind === "window") continue;
    const pr = project(g.center, e.a, e.b);
    if (pr.d > 2 || Math.abs(dot(g.u, e.u)) < 0.98) continue;
    cuts.push([pr.t - g.opening.widthIn / 2, pr.t + g.opening.widthIn / 2]);
  }
  for (const f of boxes) {
    const u = rotate({ x: 1, y: 0 }, f.rotation);
    if (Math.abs(dot(u, e.u)) < 0.98) continue;
    const back = add({ x: f.x, y: f.y }, scale(rotate({ x: 0, y: 1 }, f.rotation), -f.depthIn / 2));
    const pr = project(back, e.a, e.b);
    if (pr.d > 9) continue;
    const t = dot(sub(back, e.a), e.u);
    cuts.push([t - f.widthIn / 2, t + f.widthIn / 2]);
  }
  return cuts;
}

/** One stretch of wall with no doorway or built-in across it, which may turn corners. */
export type WallSpace = { pieces: { edge: RoomEdge; t0: number; t1: number }[]; length: number; closed: boolean };

/** The wall spaces of a room, measured along the floor line around corners (NEC 210.52(A)). */
export function wallSpaces(plan: FloorPlan, room: PlanRoom, boxes: Box[]): WallSpace[] {
  plan = flatPlan(plan);
  room = plan.rooms.find((r) => r.id === room.id) ?? room;
  const geos = openingGeometries(plan);
  const edges = roomEdges(room);
  const free = edges.map((e) => subtractIntervals(e.length, blockedOn(plan, e, geos, boxes)).filter(([a, b]) => b - a > 0.5));
  const anyCut = edges.some((e, k) => free[k].length !== 1 || free[k][0][0] > 0.5 || free[k][0][1] < e.length - 0.5);
  if (!anyCut) {
    const pieces = edges.map((edge) => ({ edge, t0: 0, t1: edge.length }));
    return [{ pieces, length: pieces.reduce((s, p) => s + p.t1 - p.t0, 0), closed: true }];
  }
  // Walk around the room; a stretch continues across a corner when it reaches the end of one edge and the next edge starts free.
  const flat: { edge: RoomEdge; t0: number; t1: number; k: number }[] = [];
  edges.forEach((edge, k) => free[k].forEach(([t0, t1]) => flat.push({ edge, t0, t1, k })));
  const spaces: WallSpace[] = [];
  let cur: WallSpace | null = null;
  for (const piece of flat) {
    const prev = cur?.pieces[cur.pieces.length - 1];
    const joins = prev && prev.t1 > prev.edge.length - 0.5 && piece.t0 < 0.5 && (piece.k === (edges.indexOf(prev.edge) + 1) % edges.length);
    if (cur && joins) cur.pieces.push(piece);
    else {
      cur = { pieces: [piece], length: 0, closed: false };
      spaces.push(cur);
    }
  }
  // The last stretch may run on into the first one.
  if (spaces.length > 1) {
    const last = spaces[spaces.length - 1].pieces.at(-1)!;
    const first = spaces[0].pieces[0];
    if (last.t1 > last.edge.length - 0.5 && first.t0 < 0.5 && edges.indexOf(first.edge) === (edges.indexOf(last.edge) + 1) % edges.length) {
      spaces[0].pieces = [...spaces.pop()!.pieces, ...spaces[0].pieces];
    }
  }
  for (const s of spaces) s.length = s.pieces.reduce((sum, p) => sum + p.t1 - p.t0, 0);
  return spaces;
}

/** The point `s` inches along a wall space. */
function alongSpace(space: WallSpace, s: number): { edge: RoomEdge; t: number } {
  let left = s;
  for (const p of space.pieces) {
    const L = p.t1 - p.t0;
    if (left <= L + 1e-6) return { edge: p.edge, t: p.t0 + left };
    left -= L;
  }
  const p = space.pieces[space.pieces.length - 1];
  return { edge: p.edge, t: p.t1 };
}

/** Where a point on the wall falls along a wall space, or null when it's not on it. */
export function spaceOffset(space: WallSpace, p: Point, tolerance = 10): number | null {
  let before = 0;
  let best: { s: number; d: number } | null = null;
  for (const piece of space.pieces) {
    const t = dot(sub(p, piece.edge.a), piece.edge.u);
    const off = Math.abs(dot(sub(p, piece.edge.a), leftNormal(piece.edge.u)));
    if (t >= piece.t0 - 3 && t <= piece.t1 + 3 && off <= tolerance && (!best || off < best.d)) best = { s: before + Math.max(0, Math.min(piece.t1 - piece.t0, t - piece.t0)), d: off };
    before += piece.t1 - piece.t0;
  }
  return best ? best.s : null;
}

/** The longest stretch along a wall space (or around a closed room) with no outlet: every point must be within half of it. */
export function largestGap(space: WallSpace, at: number[]): number {
  const s = [...at].sort((a, b) => a - b);
  if (!s.length) return space.closed ? Infinity : space.length * 2;
  if (space.closed) {
    let gap = s[0] + space.length - s[s.length - 1];
    for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i] - s[i - 1]);
    return gap;
  }
  let gap = Math.max(s[0] * 2, (space.length - s[s.length - 1]) * 2);
  for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i] - s[i - 1]);
  return gap;
}

/** Built-ins that break up wall space: fixtures plus base cabinets. */
export function builtIns(plan: FloorPlan, cabinets: CabinetLayout): Box[] {
  plan = flatPlan(plan);
  return [...plan.fixtures.filter((f) => BUILT_IN.has(f.kind) && f.kind !== "island"), ...cabinets.cabinets.filter((c) => c.bottomIn < 24)];
}

/** Counter spaces of a kitchen run: the run less the range, sink and refrigerator (NEC 210.52(C)). */
export function counterSpaces(run: CabinetRun): [number, number][] {
  const cuts = run.appliances.filter((a) => ["range", "sink", "fridge"].includes(a.fixture.kind)).map((a) => [a.t0 - run.t0, a.t1 - run.t0] as [number, number]);
  return subtractIntervals(run.t1 - run.t0, cuts)
    .filter(([a, b]) => b - a >= 11.5)
    .map(([a, b]) => [a + run.t0, b + run.t0] as [number, number]);
}

export const kitchenRuns = (plan: FloorPlan, cabinets: CabinetLayout) =>
  cabinets.runs.filter((r) => r.kind === "wall" && r.appliances.every((a) => !["washer", "dryer", "laundry-sink"].includes(a.fixture.kind)) && kitchenRoom(plan, add(r.origin, scale(r.u, (r.t0 + r.t1) / 2))));

function kitchenRoom(plan: FloorPlan, p: Point): boolean {
  const r = plan.rooms.find((x) => pointInPolygon(p, x.polygon) || pointInPolygon(add(p, { x: 0, y: 0 }), x.polygon));
  return !r || ["kitchen", "pantry", "outdoor-kitchen", "dining", "family", "living"].includes(r.type ?? "");
}

// ---------- Placement ----------

export function autoDevices(ctx: DeviceContext): Device[] {
  const { plan, exteriorIn } = ctx;
  const out: Device[] = [];
  const put = (id: string, kind: DeviceKind, p: Point, rotation = 0) => out.push({ id, kind, x: round1(p.x), y: round1(p.y), rotation });
  const boxes = builtIns(plan, ctx.cabinets);
  const geos = openingGeometries(plan);
  const roomOf = (p: Point) => plan.rooms.find((r) => pointInPolygon(p, r.polygon));

  for (const room of plan.rooms) {
    const edges = roomEdges(room);
    const c = interiorPoint(room);
    const area = polygonArea(room.polygon) / 144;
    const b = boundsOf(room.polygon)!;

    // Wall outlets: no point along the wall more than 6 ft from one (210.52(A)).
    if (needsWallOutlets(room)) {
      wallSpaces(plan, room, boxes)
        .filter((s) => s.length >= 24)
        .forEach((s, k) => {
          const n = Math.max(1, Math.ceil((s.length - 1) / 144));
          for (let i = 0; i < n; i++) {
            const at = alongSpace(s, nudgeFromCorners(s, ((i + 0.5) * s.length) / n));
            const w = onWall(plan, room, at.edge, at.t, exteriorIn);
            put(`out:${room.id}:${k}:${i}`, "outlet", w.p, w.rotation);
          }
        });
    }
    // Hallways 10 ft or longer get one (210.52(H)).
    if (room.type === "hall" && Math.max(b.x1 - b.x0, b.y1 - b.y0) >= 120) {
      const s = wallSpaces(plan, room, boxes).sort((x, y) => y.length - x.length)[0];
      if (s && s.length >= 24) {
        const at = alongSpace(s, s.length / 2);
        const w = onWall(plan, room, at.edge, at.t, exteriorIn);
        put(`out:${room.id}:hall`, "outlet", w.p, w.rotation);
      }
    }
    // Garages: one in each car bay (210.52(G)), on the back wall.
    if (isGarage(room)) {
      const doors = geos.filter((g) => g.opening.style === "door-garage" && openingRooms(plan, g.opening).includes(room.id));
      const bays = Math.max(1, doors.reduce((s, g) => s + Math.max(1, Math.round(g.opening.widthIn / 108)), 0));
      const front = doors[0] ? scale(scale(doors[0].n, -1), dot(sub(c, doors[0].center), doors[0].n) < 0 ? -1 : 1) : null;
      const back = front ? edges.slice().sort((x, y) => dot(x.inward, front) - dot(y.inward, front) || y.length - x.length)[0] : edges.slice().sort((x, y) => y.length - x.length)[0];
      const spaces = wallSpaces(plan, room, boxes);
      for (let i = 0; i < bays; i++) {
        const t = ((i + 0.5) * back.length) / bays;
        const w = onWall(plan, room, back, freeT(spaces, back, t), exteriorIn);
        put(`out:${room.id}:bay${i}`, "outlet", w.p, w.rotation);
        put(`lt:${room.id}:bay${i}`, "light", add(lerpIn(b, (i + 0.5) / bays, 0.5), { x: 0, y: 0 }));
      }
      if (ctx.garageHeat) put(`heat:${room.id}`, "heat", add(c, { x: 0, y: -36 }));
    }

    // Lights: a switched light in every room (210.70(A)(1)); recessed lights in kitchens.
    if (isGarage(room)) {
      // Placed with the bays.
    } else if (room.type === "kitchen" && area >= 80) {
      const nx = Math.max(2, Math.min(4, Math.round((b.x1 - b.x0) / 78)));
      const ny = Math.max(2, Math.min(4, Math.round((b.y1 - b.y0) / 78)));
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          const p = lerpIn(b, (i + 0.5) / nx, (j + 0.5) / ny);
          if (pointInPolygon(p, room.polygon)) put(`lt:${room.id}:${i}${j}`, "light-recessed", p);
        }
    } else if (room.type === "hall") {
      const long = b.x1 - b.x0 >= b.y1 - b.y0;
      const n = Math.max(1, Math.round((long ? b.x1 - b.x0 : b.y1 - b.y0) / 144));
      for (let i = 0; i < n; i++) {
        const p = long ? lerpIn(b, (i + 0.5) / n, 0.5) : lerpIn(b, 0.5, (i + 0.5) / n);
        put(`lt:${room.id}:${i}`, "light", pointInPolygon(p, room.polygon) ? p : c);
      }
    } else if (isOutdoor(room)) {
      if (room.type === "porch") put(`lt:${room.id}`, "light", besideLabel(room, ABOVE));
    } else if (isBath(room)) {
      const vanities = plan.fixtures.filter((f) => f.kind === "vanity" && roomOf({ x: f.x, y: f.y })?.id === room.id);
      for (const v of vanities) {
        const back = add({ x: v.x, y: v.y }, scale(rotate({ x: 0, y: 1 }, v.rotation), -v.depthIn / 2 - 0.5));
        put(`lt:${room.id}:${v.id}`, "light-wall", back, v.rotation);
      }
      if (!vanities.length || area >= 60) put(`lt:${room.id}`, "light", besideLabel(room, ABOVE));
    } else if (!(isClosetLike(room) && area < 20)) put(`lt:${room.id}`, "light", besideLabel(room, ABOVE));

    // Bathroom outlets: within 3 ft of each basin (210.52(D)); fans in every bathroom.
    if (isBath(room)) {
      for (const v of plan.fixtures.filter((f) => f.kind === "vanity" && roomOf({ x: f.x, y: f.y })?.id === room.id)) {
        const u = rotate({ x: 1, y: 0 }, v.rotation);
        const back = add({ x: v.x, y: v.y }, scale(rotate({ x: 0, y: 1 }, v.rotation), -v.depthIn / 2 - 0.5));
        const ends = v.widthIn >= 60 ? [-1, 1] : [1];
        for (const e of ends) put(`out:${room.id}:${v.id}:${e}`, "outlet", add(back, scale(u, e * (v.widthIn / 2 - 6))), v.rotation);
      }
      const wc = plan.fixtures.find((f) => (f.kind === "toilet" || f.kind === "shower" || f.kind === "tub") && roomOf({ x: f.x, y: f.y })?.id === room.id);
      const fanAt = wc ? { x: wc.x, y: wc.y } : add(c, { x: 18, y: 0 });
      put(`fan:${room.id}`, "fan", pointInPolygon(fanAt, room.polygon) ? fanAt : c);
    }

    // Switches at the doors, on the latch side, inside the room.
    if (!isOutdoor(room)) {
      const doors = geos.filter((g) => g.opening.kind !== "window" && g.opening.style !== "door-garage" && openingRooms(plan, g.opening).includes(room.id));
      const people = doors.filter((g) => {
        const other = openingRooms(plan, g.opening).find((id) => id !== room.id);
        const o = plan.rooms.find((r) => r.id === other);
        return !o || !isClosetLike(o);
      });
      const threeWay = people.length >= 2 && (roleOf(room) === "hall" || roleOf(room) === "public" || isGarage(room)) && area >= 100;
      const chosen = threeWay ? farthestPair(people) : people.slice(0, 1).concat(people.length ? [] : doors.slice(0, 1));
      chosen.forEach((g) => {
        const s = switchSpot(plan, room, g, exteriorIn);
        if (s) put(`sw:${room.id}:${g.opening.id}`, threeWay ? "switch-3way" : "switch", s.p, s.rotation);
      });
    }
  }

  // Counter outlets: no point along the counter more than 24" from one (210.52(C)(1)).
  for (const run of kitchenRuns(plan, ctx.cabinets)) {
    counterSpaces(run).forEach(([t0, t1], k) => {
      const n = Math.max(1, Math.ceil((t1 - t0 - 1) / 48));
      for (let i = 0; i < n; i++) {
        const t = t0 + ((i + 0.5) * (t1 - t0)) / n;
        put(`out:${run.id}:${k}:${i}`, "outlet", add(add(run.origin, scale(run.u, t)), scale(run.n, 1)), run.rotation);
      }
    });
  }
  // Islands: an outlet, or a box for one later (210.52(C)(2)).
  for (const run of ctx.cabinets.runs.filter((r) => r.kind === "island")) {
    const p = add(add(run.origin, scale(run.u, (run.t0 + run.t1) / 2)), scale(run.n, run.depthIn / 2));
    put(`out:${run.id}:island`, ctx.islandOutlet ? "outlet" : "junction", p, run.rotation);
  }
  // Appliance outlets: behind the refrigerator and washer, 240V for an electric range and dryer.
  for (const f of plan.fixtures) {
    const back = add({ x: f.x, y: f.y }, scale(rotate({ x: 0, y: 1 }, f.rotation), -f.depthIn / 2 + 1));
    if (f.kind === "fridge" || f.kind === "washer") put(`out:${f.id}`, "outlet", back, f.rotation);
    if ((f.kind === "range" && ctx.systems.cooking === "electric") || (f.kind === "dryer" && ctx.systems.dryer === "electric")) put(`out:${f.id}`, "outlet-240", back, f.rotation);
    if (f.kind === "furnace" || f.kind === "water-heater") {
      // A service outlet within 25 ft of heating equipment (210.63); one beside it.
      const side = add({ x: f.x, y: f.y }, scale(rotate({ x: 1, y: 0 }, f.rotation), f.widthIn / 2 + 8));
      if (f.kind === "furnace") put(`out:${f.id}`, "outlet", add(side, scale(rotate({ x: 0, y: 1 }, f.rotation), -f.depthIn / 2 + 1)), f.rotation);
    }
  }

  out.push(...fixtureHookups(plan, ctx.systems));

  // Stairs: 3-way switches at the bottom and the top, and a light.
  ctx.stairEnds.forEach((p, i) => {
    const room = roomOf(p);
    if (!room) return;
    const e = nearestEdge(room, p);
    if (!e) return;
    const w = onWall(plan, room, e.edge, e.t, exteriorIn);
    put(`sw:stairs:${i}`, "switch-3way", w.p, w.rotation);
  });
  ctx.stairs.forEach((fp, i) => put(`lt:stairs:${i}`, "light", polygonCenter(fp)));

  // Smoke alarms in each bedroom, outside each sleeping area, and on each floor (R314.3); CO alarms outside sleeping areas (R315.3).
  const bathDoors = geos.filter((g) => g.opening.kind !== "window" && openingRooms(plan, g.opening).some((id) => isBath(plan.rooms.find((r) => r.id === id) ?? {}))).map((g) => g.center);
  const ranges = plan.fixtures.filter((f) => f.kind === "range").map((f) => ({ x: f.x, y: f.y }));
  const alarms: Point[] = [];
  // Off bathroom doors (36") and at least 6 ft from the range, where photoelectric alarms may go (R314.3).
  const keepOff = [...bathDoors.map((at) => ({ at, min: 40 })), ...ranges.map((at) => ({ at, min: 78 }))];
  for (const room of plan.rooms.filter(isSleeping)) {
    const p = awayFrom(besideLabel(room, BELOW), keepOff, room);
    put(`sm:${room.id}`, "smoke", p);
    alarms.push(p);
  }
  for (const room of plan.rooms.filter(isSleeping)) {
    for (const g of geos.filter((x) => x.opening.kind !== "window" && openingRooms(plan, x.opening).includes(room.id))) {
      const otherId = openingRooms(plan, g.opening).find((id) => id !== room.id);
      const other = plan.rooms.find((r) => r.id === otherId);
      if (!other || isSleeping(other) || isBath(other) || isClosetLike(other) || isOutdoor(other) || isGarage(other)) continue;
      const into = dot(sub(interiorPoint(other), g.center), g.n) >= 0 ? g.n : scale(g.n, -1);
      let p = add(g.center, scale(into, 36));
      if (!pointInPolygon(p, other.polygon)) p = add(g.center, scale(into, 12));
      p = awayFrom(p, keepOff, other);
      const near = alarms.some((a) => dist(a, p) < 120 && roomOf(a)?.id === other.id);
      if (near) continue;
      put(`sm:out:${other.id}:${g.opening.id}`, ctx.coNeeded ? "smoke-co" : "smoke", p);
      alarms.push(p);
    }
  }
  if (!alarms.length) {
    const candidates = plan.rooms.filter((r) => !isOutdoor(r) && !isGarage(r) && !isBath(r) && !isClosetLike(r) && r.type !== "kitchen" && r.type !== "mechanical");
    const best = candidates
      .map((r) => ({ r, p: interiorPoint(r), score: (r.type === "hall" ? 1e6 : 0) + polygonArea(r.polygon) }))
      .filter((x) => ranges.every((g) => dist(g, x.p) >= 72))
      .sort((a, b) => b.score - a.score)[0];
    if (best) put(`sm:story`, "smoke", awayFrom(best.p, keepOff, best.r));
  }

  // Outside: lights at the doors (210.70(A)(2)), outlets front and back (210.52(E)), and hose bibs.
  if (ctx.grade) outsideDevices(ctx, put);
  // Decks, porches and balconies off the house get an outlet (210.52(E)(3)).
  for (const room of plan.rooms.filter(isOutdoor)) {
    const shared = roomEdges(room)
      .map((e) => ({ e, other: plan.rooms.find((r) => r.id !== room.id && !isOutdoor(r) && pointInPolygon(add(add(e.a, scale(e.u, e.length / 2)), scale(e.inward, -8)), r.polygon)) }))
      .filter((x) => x.other)
      .sort((a, b) => b.e.length - a.e.length)[0];
    if (!shared) continue;
    const w = onWall(plan, room, shared.e, shared.e.length / 2 + 18, exteriorIn);
    put(`out:${room.id}:outdoor`, "outlet", w.p, w.rotation);
  }

  // The panel: in the garage on a house wall, else a mechanical, laundry or storage room. Not in a bathroom or closet (240.24).
  if (ctx.panel) {
    const spot = panelSpot(plan, boxes, exteriorIn);
    if (spot) put("panel", "panel", spot.p, spot.rotation);
  }

  // Heating and cooling: a supply in each room, under a window where there is one; a return per floor; the thermostat.
  for (const room of plan.rooms.filter(conditioned)) {
    const wins = geos.filter((g) => g.opening.kind === "window" && openingRooms(plan, g.opening).includes(room.id)).sort((a, b) => b.opening.widthIn - a.opening.widthIn);
    const n = polygonArea(room.polygon) / 144 > 250 ? 2 : 1;
    const spots: Point[] = wins.slice(0, n).map((g) => {
      const into = pointInPolygon(add(g.center, scale(g.n, 8)), room.polygon) ? g.n : scale(g.n, -1);
      return add(g.center, scale(into, exteriorIn / 2 + 8));
    });
    if (!spots.length) spots.push(add(interiorPoint(room), { x: 0, y: -12 }));
    spots.forEach((p, i) => put(`sup:${room.id}:${i}`, "supply", p));
  }
  const returnRoom = plan.rooms.filter((r) => r.type === "hall").sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0] ?? plan.rooms.filter((r) => ["living", "family", "entry"].includes(r.type ?? "")).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
  if (returnRoom) {
    const s = wallSpaces(plan, returnRoom, boxes).sort((a, b) => b.length - a.length)[0];
    if (s) {
      const at = alongSpace(s, s.length / 2 + Math.min(30, s.length / 4));
      const w = onWall(plan, returnRoom, at.edge, at.t, exteriorIn);
      put(`ret:${returnRoom.id}`, "return", w.p, w.rotation);
    }
  }
  if (ctx.thermostat) {
    const room = plan.rooms.filter((r) => r.type === "hall").sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0] ?? plan.rooms.filter((r) => ["living", "family", "dining"].includes(r.type ?? "")).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
    if (room) {
      // On an inside wall, away from outside doors, windows and the supply.
      const inner = wallSpaces(plan, room, boxes).flatMap((s) => s.pieces).filter((p) => plan.rooms.some((r) => r.id !== room.id && pointInPolygon(add(add(p.edge.a, scale(p.edge.u, (p.t0 + p.t1) / 2)), scale(p.edge.inward, -6)), r.polygon)));
      const piece = inner.sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))[0];
      if (piece) {
        const w = onWall(plan, room, piece.edge, (piece.t0 + piece.t1) / 2 - Math.min(24, (piece.t1 - piece.t0) / 4), exteriorIn);
        put("tstat", "thermostat", w.p, w.rotation);
      }
    }
  }
  return out;
}

function outsideDevices(ctx: DeviceContext, put: (id: string, kind: DeviceKind, p: Point, rotation?: number) => void) {
  const { plan, exteriorIn } = ctx;
  const geos = openingGeometries(plan);
  const house = plan.rooms.filter((r) => !isOutdoor(r));
  if (!house.length) return;
  const center = polygonCenter(house.flatMap((r) => r.polygon));
  const outsideOf = (g: OpeningGeometry) => {
    const [a, b] = openingRooms(plan, g.opening);
    const left = a ? plan.rooms.find((r) => r.id === a) : undefined;
    const right = b ? plan.rooms.find((r) => r.id === b) : undefined;
    // n points to the left side (a).
    if (!left || isOutdoor(left)) return right && !isOutdoor(right) ? g.n : null;
    if (!right || isOutdoor(right)) return scale(g.n, -1);
    return null;
  };
  const doors = geos
    .filter((g) => g.opening.kind === "door" && g.opening.style !== "door-garage")
    .map((g) => ({ g, out: outsideOf(g) }))
    .filter((x): x is { g: OpeningGeometry; out: Point } => x.out !== null);
  // A light outside each outside door, on the latch side.
  for (const { g, out } of doors) {
    const latch = latchDir(g);
    put(`lt:out:${g.opening.id}`, "light-wall", add(add(g.center, scale(g.u, latch * (g.opening.widthIn / 2 + 8))), scale(out, exteriorIn / 2 + 1)), Math.round(angleOf(out) - 90));
  }
  // Lights beside garage doors.
  for (const g of geos.filter((x) => x.opening.style === "door-garage")) {
    const out = outsideOf(g);
    if (out) put(`lt:out:${g.opening.id}`, "light-wall", add(add(g.center, scale(g.u, -(g.opening.widthIn / 2 + 12))), scale(out, exteriorIn / 2 + 1)), Math.round(angleOf(out) - 90));
  }
  const entry = doors.find((d) => d.g.opening.style === "door-entry") ?? doors[0];
  const front = entry ? entry.out : { x: 0, y: 1 };
  // Front: by the entry door. Back: the middle of the outside wall facing the other way.
  const outdoorOutlet = (p: Point) => plan.rooms.some((r) => isOutdoor(r) && pointInPolygon(p, r.polygon));
  const outsideEdges = house.flatMap((r) =>
    roomEdges(r)
      .filter((e) => !plan.rooms.some((o) => o.id !== r.id && pointInPolygon(add(add(e.a, scale(e.u, e.length / 2)), scale(e.inward, -8)), o.polygon)))
      .map((e) => ({ r, e })),
  );
  if (entry) {
    const g = entry.g;
    // On the outside face of a house wall: outside every room, with a heated or garage room just behind it.
    const onOutsideWall = (q: Point) => !house.some((r) => pointInPolygon(q, r.polygon)) && house.some((r) => pointInPolygon(add(q, scale(front, -(exteriorIn + 2))), r.polygon));
    const spot = (gap: number) => {
      for (const side of [-latchDir(g), latchDir(g)]) {
        const q = add(add(g.center, scale(g.u, side * (g.opening.widthIn / 2 + gap))), scale(front, exteriorIn / 2 + 1));
        if (onOutsideWall(q)) return q;
      }
      return null;
    };
    const p = spot(18);
    if (p && !outdoorOutlet(p)) put("out:front", "outlet", p, Math.round(angleOf(front) - 90));
    const bib = spot(60) ?? spot(36);
    if (bib) put("hb:front", "hose-bib", bib, Math.round(angleOf(front) - 90));
  }
  const back = outsideEdges.filter((x) => dot(scale(x.e.inward, -1), front) < -0.7).sort((a, b) => b.e.length - a.e.length)[0];
  if (back) {
    const backOut = scale(back.e.inward, -1);
    const backRoomOutdoor = plan.rooms.some((r) => isOutdoor(r) && pointInPolygon(add(add(back.e.a, scale(back.e.u, back.e.length / 2)), scale(backOut, 24)), r.polygon));
    const w = onWall(plan, back.r, back.e, back.e.length / 2 - 18, exteriorIn, true);
    if (!backRoomOutdoor) put("out:back", "outlet", w.p, w.rotation);
    const h = onWall(plan, back.r, back.e, Math.max(18, back.e.length / 2 - 60), exteriorIn, true);
    put("hb:back", "hose-bib", h.p, h.rotation);
  }
  void center;
}

function panelSpot(plan: FloorPlan, boxes: Box[], exteriorIn: number): { p: Point; rotation: number } | null {
  const order = (r: PlanRoom) => (isGarage(r) ? 0 : r.type === "mechanical" ? 1 : r.type === "laundry" ? 2 : r.type === "storage" ? 3 : r.type === "mudroom" ? 4 : 9);
  const rooms = plan.rooms.filter((r) => order(r) < 9).sort((a, b) => order(a) - order(b));
  for (const room of rooms) {
    const spaces = wallSpaces(plan, room, boxes).flatMap((s) => s.pieces).filter((p) => p.t1 - p.t0 >= 36);
    // In a garage, on a wall shared with the house.
    const houseSide = spaces.filter((p) => plan.rooms.some((r) => r.id !== room.id && !isGarage(r) && !isOutdoor(r) && pointInPolygon(add(add(p.edge.a, scale(p.edge.u, (p.t0 + p.t1) / 2)), scale(p.edge.inward, -6)), r.polygon)));
    const pick = (isGarage(room) && houseSide.length ? houseSide : spaces).sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))[0];
    if (pick) return onWall(plan, room, pick.edge, pick.t0 + 24, exteriorIn);
  }
  const any = plan.rooms.filter((r) => !isBath(r) && !isClosetLike(r) && !isOutdoor(r) && !isSleeping(r)).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
  if (!any) return null;
  const s = wallSpaces(plan, any, boxes).sort((a, b) => b.length - a.length)[0];
  if (!s) return null;
  const at = alongSpace(s, Math.min(24, s.length / 2));
  return onWall(plan, any, at.edge, at.t, exteriorIn);
}

/** Which way along the wall the latch side of a door is: +1 toward the host's end. */
function latchDir(g: OpeningGeometry): number {
  return g.opening.hinge === "start" ? 1 : -1;
}

function switchSpot(plan: FloorPlan, room: PlanRoom, g: OpeningGeometry, exteriorIn: number): { p: Point; rotation: number } | null {
  const into = pointInPolygon(add(g.center, scale(g.n, 8)), room.polygon) ? g.n : scale(g.n, -1);
  const type = openingType(g.opening.style);
  // Hinged doors: beside the latch. Others: beside whichever end has more wall.
  const dirs = type.swings && !type.double ? [latchDir(g), -latchDir(g)] : [1, -1];
  for (const d of dirs) {
    const along = add(g.center, scale(g.u, d * (g.opening.widthIn / 2 + 5)));
    const p = add(along, scale(into, INTERIOR_WALL_IN / 2 + 1));
    if (pointInPolygon(p, room.polygon) && !plan.openings.some((o) => o.id !== g.opening.id && nearOpening(plan, o, along))) {
      const outerHalf = plan.rooms.some((r) => r.id !== room.id && pointInPolygon(add(along, scale(into, -6)), r.polygon)) ? INTERIOR_WALL_IN / 2 : exteriorIn / 2;
      return { p: add(along, scale(into, outerHalf + 1)), rotation: Math.round(angleOf(into) - 90) };
    }
  }
  return null;
}

function nearOpening(plan: FloorPlan, o: Opening, p: Point): boolean {
  const g = openingGeometries({ ...plan, openings: [o] })[0];
  return !!g && project(p, g.a, g.b).d < 3;
}

function farthestPair(gs: OpeningGeometry[]): OpeningGeometry[] {
  let best: [OpeningGeometry, OpeningGeometry] = [gs[0], gs[1]];
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) if (dist(gs[i].center, gs[j].center) > dist(best[0].center, best[1].center)) best = [gs[i], gs[j]];
  return best;
}

function nearestEdge(room: PlanRoom, p: Point): { edge: RoomEdge; t: number } | null {
  let best: { edge: RoomEdge; t: number; d: number } | null = null;
  for (const e of roomEdges(room)) {
    const pr = project(p, e.a, e.b);
    if (!best || pr.d < best.d) best = { edge: e, t: Math.max(6, Math.min(e.length - 6, pr.t)), d: pr.d };
  }
  return best;
}

/** Keep a spot along a wall off doors and built-ins on that edge. */
function freeT(spaces: WallSpace[], edge: RoomEdge, t: number): number {
  let best = t;
  let bestD = Infinity;
  for (const s of spaces)
    for (const p of s.pieces) {
      if (p.edge.i !== edge.i || p.t1 - p.t0 < 8) continue;
      const c = Math.max(p.t0 + 4, Math.min(p.t1 - 4, t));
      if (Math.abs(c - t) < bestD) {
        bestD = Math.abs(c - t);
        best = c;
      }
    }
  return best;
}

/** Keep outlets 6" or more from corners where the stretch allows. */
function nudgeFromCorners(space: WallSpace, s: number): number {
  let before = 0;
  for (const p of space.pieces) {
    const L = p.t1 - p.t0;
    if (s <= before + L) {
      const local = s - before;
      if (local < 6 && L > 12) return before + 6;
      if (L - local < 6 && L > 12) return before + L - 6;
      return s;
    }
    before += L;
  }
  return s;
}

/** A point inside the room near its middle, even for L-shaped rooms. */
export function interiorPoint(room: PlanRoom): Point {
  const c = polygonCenter(room.polygon);
  if (pointInPolygon(c, room.polygon)) return c;
  const b = boundsOf(room.polygon)!;
  let best = room.polygon[0];
  let bestD = -1;
  for (let i = 1; i < 10; i++)
    for (let j = 1; j < 10; j++) {
      const p = lerpIn(b, i / 10, j / 10);
      if (!pointInPolygon(p, room.polygon)) continue;
      const d = Math.min(...roomEdges(room).map((e) => project(p, e.a, e.b).d));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  return best;
}

const lerpIn = (b: { x0: number; y0: number; x1: number; y1: number }, fx: number, fy: number): Point => ({ x: b.x0 + (b.x1 - b.x0) * fx, y: b.y0 + (b.y1 - b.y0) * fy });

/** Move an alarm off bathroom doors (R314.3 item 4): the nearest spot in the room far enough from all of them. */
function awayFrom(p: Point, keepOff: { at: Point; min: number }[], room: PlanRoom): Point {
  const clear = (q: Point) => keepOff.every((k) => dist(k.at, q) >= k.min);
  if (clear(p)) return p;
  const b = boundsOf(room.polygon)!;
  let best: Point | null = null;
  for (let x = b.x0 + 6; x <= b.x1 - 6; x += 3)
    for (let y = b.y0 + 6; y <= b.y1 - 6; y += 3) {
      const q = { x, y };
      if (!clear(q) || !pointInPolygon(q, room.polygon) || roomEdges(room).some((e) => project(q, e.a, e.b).d < 8)) continue;
      if (!best || dist(q, p) < dist(best, p)) best = q;
    }
  return best ?? p;
}

/** A spot near the middle of a room that leaves the room's name readable: above it, below it, or beside it. */
function besideLabel(room: PlanRoom, order: Point[]): Point {
  const c = interiorPoint(room);
  for (const o of order) {
    const q = add(c, o);
    if (pointInPolygon(q, room.polygon) && roomEdges(room).every((e) => project(q, e.a, e.b).d >= 10)) return q;
  }
  return c;
}
const ABOVE = [{ x: 0, y: -30 }, { x: 0, y: 30 }, { x: -40, y: 0 }, { x: 40, y: 0 }];
const BELOW = [{ x: 0, y: 30 }, { x: 0, y: -30 }, { x: 40, y: 0 }, { x: -40, y: 0 }];

// ---------- Edits ----------

export function deviceLayout(ctx: DeviceContext): PlacedDevice[] {
  const auto = autoDevices(ctx).map((d) => ({ ...d, auto: true }));
  const edits = ctx.plan.devices;
  if (!edits) return auto;
  const hidden = new Set(edits.hidden);
  return [...auto.filter((d) => !hidden.has(d.id)), ...edits.added.map((d) => ({ ...d, auto: false }))];
}

const editsOf = (plan: FloorPlan): DeviceEdits => plan.devices ?? { hidden: [], added: [] };
const strip = ({ id, kind, x, y, rotation, roomId }: Device): Device => ({ id, kind, x, y, rotation, ...(roomId ? { roomId } : {}) });

export function removeDevice(plan: FloorPlan, id: string): FloorPlan {
  const e = editsOf(plan);
  if (e.added.some((d) => d.id === id)) return { ...plan, devices: { ...e, added: e.added.filter((d) => d.id !== id) } };
  return { ...plan, devices: { ...e, hidden: [...new Set([...e.hidden, id])] } };
}

/** Move or change a device. An app-placed one is swapped for a hand-placed copy. */
export function updateDevice(plan: FloorPlan, dev: Device, patch: Partial<Omit<Device, "id">>): FloorPlan {
  const e = editsOf(plan);
  const next: Device = { ...strip(dev), ...patch, x: round1(patch.x ?? dev.x), y: round1(patch.y ?? dev.y) };
  if (e.added.some((d) => d.id === dev.id)) return { ...plan, devices: { ...e, added: e.added.map((d) => (d.id === dev.id ? next : d)) } };
  return { ...plan, devices: { hidden: [...new Set([...e.hidden, dev.id])], added: [...e.added, { ...next, id: newPlanId("dev") }] } };
}

export function addDevice(plan: FloorPlan, dev: Omit<Device, "id">): FloorPlan {
  const e = editsOf(plan);
  return { ...plan, devices: { ...e, added: [...e.added, { ...dev, id: newPlanId("dev"), x: round1(dev.x), y: round1(dev.y) }] } };
}

export function resetDevices(plan: FloorPlan): FloorPlan {
  const { devices: _drop, ...rest } = plan;
  void _drop;
  return rest;
}

export const devicesEdited = (plan: FloorPlan) => Boolean(plan.devices && (plan.devices.hidden.length || plan.devices.added.length));

/** Snap a wall device to the nearest wall face, facing into the room it was dropped in. */
export function snapToWall(plan: FloorPlan, p: Point, exteriorIn: number, maxD = 36): { p: Point; rotation: number } | null {
  plan = flatPlan(plan);
  let best: { room: PlanRoom; edge: RoomEdge; t: number; d: number } | null = null;
  for (const room of plan.rooms) {
    if (!pointInPolygon(p, room.polygon)) continue;
    for (const e of roomEdges(room)) {
      const pr = project(p, e.a, e.b);
      // No wall to hang it on where a wall was taken out.
      if (inSpans(openSpans(plan, e.a, e.b), pr.t)) continue;
      if (!best || pr.d < best.d) best = { room, edge: e, t: pr.t, d: pr.d };
    }
  }
  if (!best || best.d > maxD) {
    // Outside the house: snap onto the nearest outside wall face.
    let out: { room: PlanRoom; edge: RoomEdge; t: number; d: number } | null = null;
    for (const room of plan.rooms)
      for (const e of roomEdges(room)) {
        const pr = project(p, e.a, e.b);
        if (dot(sub(p, pr.point), e.inward) < 0 && (!out || pr.d < out.d)) out = { room, edge: e, t: pr.t, d: pr.d };
      }
    if (!best && out && out.d <= maxD) return onWall(plan, out.room, out.edge, out.t, exteriorIn, true);
    if (!best) return null;
  }
  return onWall(plan, best.room, best.edge, best.t, exteriorIn);
}
