import type { AddOn, Cabinet, Device, FloorPlan, Fixture, FurnitureItem, PlanRoom, Point } from "@/lib/model/schema";
import { add, angleOf, dist, leftNormal, pointInPolygon, polygonCenter, project, rectangle, rotate, round1, scale, sub } from "@/lib/plan/geometry";
import { clampOffset, nearestHost, openingGeometries } from "@/lib/plan/walls";
import { pointOnEdge } from "@/lib/plan/arcs";
import { newPlanId } from "@/lib/plan/edit";
import { INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { areaKind } from "@/lib/plan/measure";
import { flatPlan } from "@/lib/plan/flatten";
import { addCabinet, cabinetSize, removeCabinet, updateCabinet, type PlacedCabinet } from "@/lib/plan/cabinets";
import { DEVICE_INFO, removeDevice, updateDevice, type PlacedDevice } from "@/lib/plan/devices";
import { furnitureType, overlaps } from "@/lib/plan/furniture";
import { fixtureType } from "@/lib/plan/catalog";
import { catalogEntry, entryFor, type CatalogEntry, type Mount } from "./catalog";
import { coveringFit, coveringOf, fittedAddOns, restHeight } from "./decor";

/**
 * The furnish layer: everything Furnish places on a floor, kept in the
 * floor plan's own lists (fixtures, furniture, add-ons, and the cabinet and
 * device edits) so the 3D view, walking, cost, the PDF sheets and the code
 * checks keep reading them where they always have. This file is the one
 * place that edits them for Furnish: place, move, turn, resize, remove and
 * swap work the same way for any kind. Cabinets and devices the app lays
 * out on its own stay automatic until touched; touching one hides the
 * automatic copy and adds a hand-placed one (the "hide and add" pattern),
 * and the hidden ids are stable, so that holds when the layout rebuilds.
 */

export type LayerKind = "fixture" | "furniture" | "addon" | "cabinet" | "device";

export type FurnishLayer = {
  fixtures: Fixture[];
  furniture: FurnitureItem[];
  addOns: AddOn[];
  cabinets: NonNullable<FloorPlan["cabinets"]>;
  devices: NonNullable<FloorPlan["devices"]>;
};

/** One placed item, whatever list it lives in, with what the editors need to show and move it. */
export type LayerItem = {
  kind: LayerKind;
  id: string;
  /** Its catalog entry (see catalog.ts). */
  entryId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  bottomIn: number;
  mount: Mount;
  roomId?: string;
  color?: string;
  /** Placed by the app (auto cabinets and devices) and not touched yet. */
  auto: boolean;
};

/** The layer on a floor. */
export function furnishOf(plan: FloorPlan): FurnishLayer {
  return {
    fixtures: plan.fixtures,
    furniture: plan.furniture,
    addOns: plan.addOns ?? [],
    cabinets: plan.cabinets ?? { hidden: [], added: [] },
    devices: plan.devices ?? { hidden: [], added: [] },
  };
}

/** A floor with its layer replaced. Empty cabinet and device edits are left out, as before Furnish. */
export function withFurnish(plan: FloorPlan, layer: FurnishLayer): FloorPlan {
  const { cabinets: _c, devices: _d, addOns: _a, ...rest } = plan;
  void _c;
  void _d;
  void _a;
  const edited = (e: { hidden: string[]; added: unknown[] }) => e.hidden.length > 0 || e.added.length > 0;
  return {
    ...rest,
    fixtures: layer.fixtures,
    furniture: layer.furniture,
    ...(layer.addOns.length || plan.addOns ? { addOns: layer.addOns } : {}),
    ...(edited(layer.cabinets) || plan.cabinets ? { cabinets: layer.cabinets } : {}),
    ...(edited(layer.devices) || plan.devices ? { devices: layer.devices } : {}),
  };
}

const CEILING_IN = 96;

const fromFixture = (f: Fixture): LayerItem => {
  const e = entryFor("fixture", f.kind);
  return { kind: "fixture", id: f.id, entryId: e?.id ?? `fixture:${f.kind}`, label: e?.label ?? fixtureType(f.kind).label, x: f.x, y: f.y, rotation: f.rotation, widthIn: f.widthIn, depthIn: f.depthIn, heightIn: e?.heightIn ?? 30, bottomIn: 0, mount: "floor", roomId: f.roomId, auto: false };
};
const fromFurniture = (f: FurnitureItem): LayerItem => {
  const e = entryFor("furniture", f.kind);
  return { kind: "furniture", id: f.id, entryId: e?.id ?? `furniture:${f.kind}`, label: e?.label ?? f.kind, x: f.x, y: f.y, rotation: f.rotation, widthIn: f.widthIn, depthIn: f.depthIn, heightIn: e?.heightIn ?? 30, bottomIn: 0, mount: "floor", roomId: f.roomId, color: f.color, auto: false };
};
const fromAddOn = (a: AddOn): LayerItem => {
  const e = entryFor("addon", a.kind);
  return { kind: "addon", id: a.id, entryId: e?.id ?? `addon:${a.kind}`, label: e?.label ?? a.kind, x: a.x, y: a.y, rotation: a.rotation, widthIn: a.widthIn, depthIn: a.depthIn, heightIn: a.heightIn, bottomIn: a.bottomIn, mount: e?.mount ?? "floor", roomId: a.roomId, color: a.color, auto: false };
};
const fromCabinet = (c: Cabinet, auto: boolean): LayerItem => {
  const e = entryFor("cabinet", c.kind);
  return { kind: "cabinet", id: c.id, entryId: e?.id ?? `cabinet:${c.kind}`, label: e?.label ?? c.kind, x: c.x, y: c.y, rotation: c.rotation, widthIn: c.widthIn, depthIn: c.depthIn, heightIn: c.heightIn, bottomIn: c.bottomIn, mount: c.bottomIn > 24 ? "wall" : "floor", roomId: c.roomId, auto };
};
const fromDevice = (d: Device, auto: boolean, ceilingIn = CEILING_IN): LayerItem => {
  const e = entryFor("device", d.kind);
  const info = DEVICE_INFO[d.kind];
  return { kind: "device", id: d.id, entryId: e?.id ?? `device:${d.kind}`, label: info.label, x: d.x, y: d.y, rotation: d.rotation, widthIn: 4, depthIn: 2, heightIn: 4, bottomIn: info.wall ? (info.mountIn ?? 16) : ceilingIn, mount: info.wall ? "wall" : "ceiling", roomId: d.roomId, auto };
};

/**
 * Everything on the layer as one list. Pass the floor's cabinet and device
 * layouts to include the app's own (auto) ones; without them only
 * hand-placed cabinets and devices are listed. Ceiling lights and alarms sit
 * at `ceilingIn` (the floor's ceiling height).
 */
export function layerItems(plan: FloorPlan, layouts: { cabinets?: PlacedCabinet[]; devices?: PlacedDevice[] } = {}, ceilingIn = CEILING_IN): LayerItem[] {
  const l = furnishOf(plan);
  return [
    ...l.fixtures.map(fromFixture),
    ...fittedAddOns(plan, ceilingIn).map(fromAddOn),
    ...(layouts.cabinets ? layouts.cabinets.map((c) => fromCabinet(c, c.auto)) : l.cabinets.added.map((c) => fromCabinet(c, false))),
    ...(layouts.devices ? layouts.devices.map((d) => fromDevice(d, d.auto, ceilingIn)) : l.devices.added.map((d) => fromDevice(d, false, ceilingIn))),
    ...l.furniture.map(fromFurniture),
  ];
}

/** The room a spot is in (indoor rooms first). */
export function roomAt(plan: FloorPlan, p: Point): PlanRoom | undefined {
  const flat = flatPlan(plan);
  const hit = flat.rooms.find((r) => areaKind(r) !== "outdoor" && pointInPolygon(p, r.polygon)) ?? flat.rooms.find((r) => pointInPolygon(p, r.polygon));
  return hit && plan.rooms.find((r) => r.id === hit.id);
}

const norm = (deg: number) => ((Math.round(deg * 10) / 10) % 360 + 360) % 360;

// ---------- Edits ----------

export type PlaceOptions = {
  rotation?: number;
  widthIn?: number;
  depthIn?: number;
  heightIn?: number;
  bottomIn?: number;
  color?: string;
  /** The floor's ceiling height, for cabinets and ceiling items. */
  ceilingIn?: number;
};

/**
 * Place a catalog item with its middle at `at`. Doors, windows, walls and
 * closet pieces have their own placers and aren't handled here (the plan
 * comes back unchanged with no id).
 */
export function placeItem(plan: FloorPlan, entryId: string, at: Point, opts: PlaceOptions = {}): { plan: FloorPlan; id: string | null } {
  const e = catalogEntry(entryId);
  if (!e) return { plan, id: null };
  const rotation = norm(opts.rotation ?? 0);
  const x = round1(at.x);
  const y = round1(at.y);
  const roomId = roomAt(plan, at)?.id;
  const ceilingIn = opts.ceilingIn ?? CEILING_IN;
  const room = roomId ? { roomId } : {};
  switch (e.kind) {
    case "fixture": {
      const f: Fixture = { id: newPlanId("f"), kind: e.type, x, y, rotation, widthIn: opts.widthIn ?? e.widthIn, depthIn: opts.depthIn ?? e.depthIn, ...room };
      return { plan: { ...plan, fixtures: [...plan.fixtures, f] }, id: f.id };
    }
    case "furniture": {
      const f: FurnitureItem = { id: newPlanId("m"), kind: e.type, x, y, rotation, widthIn: opts.widthIn ?? e.widthIn, depthIn: opts.depthIn ?? e.depthIn, ...(opts.color ? { color: opts.color } : {}), ...room };
      return { plan: { ...plan, furniture: [...plan.furniture, f] }, id: f.id };
    }
    case "addon": {
      const bottom = e.mount === "ceiling" ? Math.max(0, ceilingIn - e.heightIn) : e.onTop ? restHeight(plan, at) : e.bottomIn;
      let a: AddOn = { id: newPlanId("ao"), kind: e.type, x, y, rotation, widthIn: opts.widthIn ?? e.widthIn, depthIn: opts.depthIn ?? e.depthIn, heightIn: opts.heightIn ?? e.heightIn, bottomIn: opts.bottomIn ?? bottom, ...(opts.color ? { color: opts.color } : {}), ...room };
      if (e.covering) {
        // Curtains and blinds go on the nearest window and follow it from then on.
        const fit = coveringFit(plan, e.type, at, ceilingIn);
        if (!fit) return { plan, id: null };
        a = { ...a, ...fit };
      }
      return { plan: { ...plan, addOns: [...(plan.addOns ?? []), a] }, id: a.id };
    }
    case "cabinet": {
      const s = cabinetSize(e.type as Cabinet["kind"], ceilingIn);
      const next = addCabinet(plan, { kind: e.type as Cabinet["kind"], x, y, rotation, widthIn: opts.widthIn ?? e.widthIn, depthIn: opts.depthIn ?? s.d, heightIn: opts.heightIn ?? s.h, bottomIn: opts.bottomIn ?? s.z, ...room });
      return { plan: next, id: next.cabinets!.added[next.cabinets!.added.length - 1].id };
    }
    case "device":
    case "hookup": {
      const d: Device = { id: newPlanId("dev"), kind: e.type as Device["kind"], x, y, rotation, ...room };
      const edits = plan.devices ?? { hidden: [], added: [] };
      return { plan: { ...plan, devices: { ...edits, added: [...edits.added, d] } }, id: d.id };
    }
    default:
      return { plan, id: null };
  }
}

export type ItemPatch = Partial<Pick<LayerItem, "x" | "y" | "rotation" | "widthIn" | "depthIn" | "heightIn" | "bottomIn" | "color">>;

/** Change an item. Moving it re-files it under the room it lands in. An app-placed cabinet or device becomes a hand-placed copy. */
export function updateItem(plan: FloorPlan, item: LayerItem, patch: ItemPatch): FloorPlan {
  const moved = patch.x !== undefined || patch.y !== undefined;
  const p = { x: round1(patch.x ?? item.x), y: round1(patch.y ?? item.y) };
  const roomId = moved ? roomAt(plan, p)?.id : item.roomId;
  const base = { ...(patch.rotation !== undefined ? { rotation: norm(patch.rotation) } : {}), ...(moved ? p : {}) };
  const withRoom = <T extends { roomId?: string }>(x: T): T => {
    const { roomId: _r, ...rest } = x;
    void _r;
    return (roomId ? { ...rest, roomId } : rest) as T;
  };
  const size = <T>(x: T, keys: (keyof ItemPatch)[]): Partial<T> => Object.fromEntries(keys.filter((k) => patch[k] !== undefined).map((k) => [k, k === "color" ? patch[k] : round1(patch[k] as number)])) as Partial<T>;
  switch (item.kind) {
    case "fixture":
      return { ...plan, fixtures: plan.fixtures.map((f) => (f.id === item.id ? withRoom({ ...f, ...base, ...size<Fixture>(f, ["widthIn", "depthIn"]) }) : f)) };
    case "furniture":
      return { ...plan, furniture: plan.furniture.map((f) => (f.id === item.id ? withRoom({ ...f, ...base, ...size<FurnitureItem>(f, ["widthIn", "depthIn", "color"]) }) : f)) };
    case "addon":
      return {
        ...plan,
        addOns: (plan.addOns ?? []).map((a) => {
          if (a.id !== item.id) return a;
          const next = withRoom({ ...a, ...base, ...size<AddOn>(a, ["widthIn", "depthIn", "heightIn", "bottomIn", "color"]) });
          if (!moved) return next;
          // Moved curtains go on the window nearest where they're dropped (they stay put with none near); a lamp or pillows rest on what's under them.
          if (coveringOf(a.kind)) {
            const fit = coveringFit(plan, a.kind, p);
            return fit ? withRoom({ ...next, ...fit }) : a;
          }
          return catalogEntry(item.entryId)?.onTop ? { ...next, bottomIn: restHeight(plan, p, a.id) } : next;
        }),
      };
    case "cabinet": {
      const cab = cabinetOf(plan, item);
      return updateCabinet(plan, cab, { ...base, ...size<Cabinet>(cab, ["widthIn", "depthIn", "heightIn", "bottomIn"]), roomId });
    }
    case "device":
      return updateDevice(plan, deviceOf(plan, item), { ...base, roomId });
  }
}

const cabinetOf = (plan: FloorPlan, item: LayerItem): Cabinet =>
  plan.cabinets?.added.find((c) => c.id === item.id) ?? { id: item.id, kind: entryKind(item) as Cabinet["kind"], x: item.x, y: item.y, rotation: item.rotation, widthIn: item.widthIn, depthIn: item.depthIn, heightIn: item.heightIn, bottomIn: item.bottomIn };
const deviceOf = (plan: FloorPlan, item: LayerItem): Device =>
  plan.devices?.added.find((d) => d.id === item.id) ?? { id: item.id, kind: entryKind(item) as Device["kind"], x: item.x, y: item.y, rotation: item.rotation };
const entryKind = (item: LayerItem) => item.entryId.slice(item.entryId.indexOf(":") + 1);

export const moveItem = (plan: FloorPlan, item: LayerItem, to: Point, rotation?: number) => updateItem(plan, item, { x: to.x, y: to.y, ...(rotation !== undefined ? { rotation } : {}) });
export const turnItem = (plan: FloorPlan, item: LayerItem, deg: number) => updateItem(plan, item, { rotation: item.rotation + deg });
export const resizeItem = (plan: FloorPlan, item: LayerItem, size: Pick<ItemPatch, "widthIn" | "depthIn" | "heightIn" | "bottomIn">) => updateItem(plan, item, size);

/** Take an item away. An app-placed cabinet or device is hidden, and stays hidden when the layout rebuilds. */
export function removeItem(plan: FloorPlan, item: Pick<LayerItem, "kind" | "id">): FloorPlan {
  switch (item.kind) {
    case "fixture":
      return { ...plan, fixtures: plan.fixtures.filter((f) => f.id !== item.id) };
    case "furniture":
      return { ...plan, furniture: plan.furniture.filter((f) => f.id !== item.id) };
    case "addon":
      return { ...plan, addOns: (plan.addOns ?? []).filter((a) => a.id !== item.id) };
    case "cabinet":
      return removeCabinet(plan, item.id);
    case "device":
      return removeDevice(plan, item.id);
  }
}

const layerKindOf = (e: CatalogEntry): LayerKind | null =>
  e.kind === "hookup" ? "device" : e.kind === "fixture" || e.kind === "furniture" || e.kind === "addon" || e.kind === "cabinet" || e.kind === "device" ? e.kind : null;

/** Swap an item for another catalog entry in the same spot, facing the same way. */
export function swapItem(plan: FloorPlan, item: LayerItem, entryId: string, ceilingIn = CEILING_IN): { plan: FloorPlan; id: string | null } {
  const e = catalogEntry(entryId);
  const kind = e && layerKindOf(e);
  if (!e || !kind) return { plan, id: null };
  if (kind === "device" && item.kind === "device") {
    const next = updateDevice(plan, deviceOf(plan, item), { kind: e.type as Device["kind"] });
    const id = item.auto ? next.devices!.added[next.devices!.added.length - 1].id : item.id;
    return { plan: next, id };
  }
  // Floor items keep their back where it was; the new one is sized from the catalog.
  const back = add({ x: item.x, y: item.y }, scale(rotate({ x: 0, y: 1 }, item.rotation), -item.depthIn / 2));
  const depth = kind === "cabinet" ? cabinetSize(e.type as Cabinet["kind"], ceilingIn).d : e.depthIn;
  const at = item.mount === "ceiling" || e.mount === "ceiling" ? { x: item.x, y: item.y } : add(back, scale(rotate({ x: 0, y: 1 }, item.rotation), depth / 2));
  return placeItem(removeItem(plan, item), entryId, at, { rotation: item.rotation, ceilingIn, ...(item.color ? { color: item.color } : {}) });
}

// ---------- Snapping and checking ----------

/** Roughly half a wall, plus a little air, from the wall's line to an item's back (as the floor plan's fixture tool did). */
const OFF_WALL_IN = 2.5;

/**
 * Back an item onto the nearest wall within reach: floor items stand with
 * their back against it, wall-hung ones lie flat on it. Its middle slides
 * along the wall so it fits between the ends. Null when no wall is close
 * (and always for ceiling items).
 */
export function snapToWall(plan: FloorPlan, p: Point, size: { widthIn: number; depthIn: number; mount: Mount }, reachIn = 18): { x: number; y: number; rotation: number } | null {
  if (size.mount === "ceiling") return null;
  const near = nearestHost(plan, p, size.depthIn / 2 + reachIn);
  if (!near) return null;
  const inward = scale(leftNormal(near.u), near.side);
  const along = pointOnEdge(near.seg.a, near.seg.b, near.seg.bulge ?? 0, clampOffset(near.t, size.widthIn, near.seg.length));
  const at = add(along, scale(inward, size.depthIn / 2 + OFF_WALL_IN));
  return { x: round1(at.x), y: round1(at.y), rotation: norm(Math.round(angleOf(inward) - 90)) };
}

export type FurnishCheck = {
  ok: boolean;
  roomId?: string;
  /** Why it can't go there. */
  problem?: string;
  /** Doors it's in the way of (it can still go there, but it shows in Things to check). */
  blocksDoors: string[];
};

export type Candidate = Pick<LayerItem, "entryId" | "x" | "y" | "rotation" | "widthIn" | "depthIn"> & Partial<Pick<LayerItem, "id" | "heightIn" | "bottomIn">>;

/** Counters, islands and vanities hold sinks, ranges, dishwashers and cabinets: those may overlap them. */
const HOLDERS = new Set(["fixture:counter", "fixture:island", "fixture:vanity"]);
const NESTS = new Set(["fixture:sink", "fixture:prep-sink", "fixture:range", "fixture:dishwasher", "fixture:fridge"]);
const nestsWith = (a: string, b: string) => (HOLDERS.has(a) && (NESTS.has(b) || b.startsWith("cabinet:"))) || (HOLDERS.has(b) && (NESTS.has(a) || a.startsWith("cabinet:")));

const outlineOf = (c: Pick<LayerItem, "x" | "y" | "widthIn" | "depthIn" | "rotation">) => rectangle(c.x, c.y, c.widthIn, c.depthIn, c.rotation ?? 0);
/** Rugs (walked over) and things resting on furniture (a table lamp, pillows): they never stand in anything's way. */
const isFlat = (entryId: string) => (entryId.startsWith("furniture:") && Boolean(furnitureType(entryId.slice(10))?.flat)) || Boolean(catalogEntry(entryId)?.onTop);

/** The space in front of and behind each door, about as deep as it's wide: where it swings and where you walk through. */
export function doorZones(plan: FloorPlan): { id: string; zone: Point[] }[] {
  const out: { id: string; zone: Point[] }[] = [];
  for (const og of openingGeometries(plan)) {
    if (og.opening.kind === "window") continue;
    const depth = Math.min(36, og.opening.widthIn);
    for (const s of [-1, 1]) {
      const c = add(og.center, scale(og.n, s * (depth / 2 + 2)));
      out.push({ id: og.opening.id, zone: rectangle(c.x, c.y, og.opening.widthIn, depth, angleOf(og.u)) });
    }
  }
  return out;
}

/**
 * Whether an item fits where it is, for any kind: floor items inside one
 * room (not through a wall) and not on top of another item; wall-hung ones
 * on a wall and not across a door or window; ceiling ones in a room. Doors
 * it stands in front of are listed but don't stop it.
 */
export function placeCheck(plan: FloorPlan, c: Candidate, others: LayerItem[] = layerItems(plan)): FurnishCheck {
  const e = catalogEntry(c.entryId);
  const flat = flatPlan(plan);
  const center = { x: c.x, y: c.y };
  const room = flat.rooms.find((r) => areaKind(r) !== "outdoor" && pointInPolygon(center, r.polygon)) ?? flat.rooms.find((r) => pointInPolygon(center, r.polygon));
  const mount = e?.mount ?? "floor";
  const outline = outlineOf(c);
  if (e?.covering) {
    if (!room) return { ok: false, problem: "It needs to go inside a room.", blocksDoors: [] };
    return coveringFit(plan, e.type, center) ? { ok: true, roomId: room.id, blocksDoors: [] } : { ok: false, roomId: room.id, problem: `${e.label} go on a window.`, blocksDoors: [] };
  }
  if (mount === "wall") {
    const back = add(center, scale(rotate({ x: 0, y: 1 }, c.rotation), -c.depthIn / 2));
    if (!nearestHost(plan, back, OFF_WALL_IN + 4)) return { ok: false, roomId: room?.id, problem: "It needs to go flat on a wall.", blocksDoors: [] };
    const devices = e?.kind === "device" || e?.kind === "hookup";
    if (!room && !devices) return { ok: false, problem: "It needs to go inside a room.", blocksDoors: [] };
    const z0 = c.bottomIn ?? e?.bottomIn ?? 0;
    const z1 = z0 + (c.heightIn ?? e?.heightIn ?? 4);
    for (const og of openingGeometries(plan)) {
      const o = og.opening;
      const oz0 = o.kind === "window" ? (o.sillIn ?? 30) : 0;
      if (z1 <= oz0 || z0 >= oz0 + o.heightIn) continue;
      const box = rectangle(og.center.x, og.center.y, o.widthIn, 16, angleOf(og.u));
      if (overlaps(outline, box)) return { ok: false, roomId: room?.id, problem: o.kind === "window" ? "It's across a window." : "It's across a doorway.", blocksDoors: [] };
    }
    return { ok: true, roomId: room?.id, blocksDoors: [] };
  }
  if (!room) return { ok: false, problem: "It needs to go inside a room.", blocksDoors: [] };
  if (mount === "ceiling") return { ok: true, roomId: room.id, blocksDoors: [] };
  // Floor items: every corner inside the room, at least half a wall from its walls.
  const half = INTERIOR_WALL_IN / 2;
  const inside = outline.every((p) => pointInPolygon(p, room.polygon) && room.polygon.every((a, i) => project(p, a, room.polygon[(i + 1) % room.polygon.length]).d >= half - 0.01));
  const edgesIn = outline.every((a, i) => {
    const b = outline[(i + 1) % 4];
    for (let k = 1; k < 4; k++) if (!pointInPolygon(add(a, scale(sub(b, a), k / 4)), room.polygon)) return false;
    return true;
  });
  if (!inside || !edgesIn) return { ok: false, roomId: room.id, problem: `It goes through a wall of the ${room.name.toLowerCase()}.`, blocksDoors: [] };
  if (isFlat(c.entryId)) return { ok: true, roomId: room.id, blocksDoors: [] };
  for (const o of others) {
    if (o.id === c.id || o.mount !== "floor" || isFlat(o.entryId) || nestsWith(c.entryId, o.entryId)) continue;
    // Cabinets sit in runs side by side; only boxes clearly on top of each other count.
    if (o.kind === "cabinet" && c.entryId.startsWith("cabinet:") && dist(center, o) > Math.min(c.widthIn, o.widthIn) / 2) continue;
    if (overlaps(outline, outlineOf(o))) return { ok: false, roomId: room.id, problem: `It's on top of the ${o.label.toLowerCase()}.`, blocksDoors: [] };
  }
  const blocksDoors = [...new Set(doorZones(plan).filter((z) => overlaps(outline, z.zone)).map((z) => z.id))];
  return { ok: true, roomId: room.id, blocksDoors };
}

// ---------- Things to check ----------

export type FurnishProblem = {
  key: string;
  item: LayerItem;
  text: string;
  at: Point;
  /** "Move inside" can put it back in its room. */
  canMoveInside: boolean;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Hand-placed items that lost their spot: outside their room (or outside
 * every room), wall-hung ones whose wall is gone, and floor items standing
 * in a doorway. App-placed cabinets and devices follow their fixtures and
 * rooms, so they aren't listed.
 */
export function furnishProblems(plan: FloorPlan): FurnishProblem[] {
  const flat = flatPlan(plan);
  const out: FurnishProblem[] = [];
  const items = layerItems(plan);
  const zones = doorZones(plan);
  for (const it of items) {
    const at = { x: it.x, y: it.y };
    const room = it.roomId ? flat.rooms.find((r) => r.id === it.roomId) : undefined;
    const name = it.label;
    if (it.roomId && room && !pointInPolygon(at, room.polygon)) {
      out.push({ key: `furnish-out:${it.id}`, item: it, text: `${cap(name)} is outside its room (${room.name}).`, at, canMoveInside: true });
      continue;
    }
    // Loose items not in any room (devices may go on outside walls).
    if (!room && it.kind !== "device" && it.kind !== "cabinet" && !flat.rooms.some((r) => pointInPolygon(at, r.polygon))) {
      out.push({ key: `furnish-out:${it.id}`, item: it, text: `${cap(name)} isn't in any room.`, at, canMoveInside: false });
      continue;
    }
    if (it.mount === "wall") {
      const back = add(at, scale(rotate({ x: 0, y: 1 }, it.rotation), -it.depthIn / 2));
      if (!nearestHost(plan, back, OFF_WALL_IN + 6)) {
        out.push({ key: `furnish-wall:${it.id}`, item: it, text: it.kind === "device" ? `${cap(name)}'s wall was removed.` : `${cap(name)} is no longer on a wall.`, at, canMoveInside: false });
        continue;
      }
    }
    if (it.mount === "floor" && !isFlat(it.entryId) && it.kind !== "cabinet" && !HOLDERS.has(it.entryId) && it.entryId !== "fixture:closet") {
      const outline = outlineOf(it);
      if (zones.some((z) => overlaps(outline, z.zone))) out.push({ key: `furnish-door:${it.id}`, item: it, text: `${cap(name)} is in the way of a door.`, at, canMoveInside: false });
    }
  }
  return out;
}

/** "Move inside": slide an item toward the middle of its room until it fits. */
export function moveInside(plan: FloorPlan, item: LayerItem): FloorPlan {
  const room = item.roomId ? flatPlan(plan).rooms.find((r) => r.id === item.roomId) : undefined;
  if (!room) return plan;
  const target = polygonCenter(room.polygon);
  const others = layerItems(plan);
  for (let k = 1; k <= 20; k++) {
    const p = add(item, scale(sub(target, item), k / 20));
    const cand = { ...item, x: round1(p.x), y: round1(p.y) };
    if (pointInPolygon(p, room.polygon) && (k === 20 || placeCheck(plan, cand, others).ok)) {
      const next = updateItem(plan, item, { x: cand.x, y: cand.y });
      return next;
    }
  }
  return plan;
}

// ---------- Keeping the layer through Suggest a plan ----------

/**
 * Bring a floor's furnish items onto a new plan for it (Suggest a plan, or
 * starting from the sketch). Items go to the new room made for the same
 * brief room (or with the same name), shifted as the room's middle moved.
 * Ones whose room isn't there stay where they were. A fixture the new plan
 * already has in that room (like a closet rod) isn't doubled up.
 */
export function carryFurnish(old: FloorPlan, next: FloorPlan): FloorPlan {
  const match = new Map<string, { id: string; d: Point }>();
  for (const r of old.rooms) {
    const n = next.rooms.find((x) => (r.briefRoomId && x.briefRoomId === r.briefRoomId) || (!r.briefRoomId && x.name === r.name));
    if (n) match.set(r.id, { id: n.id, d: sub(polygonCenter(n.polygon), polygonCenter(r.polygon)) });
  }
  const ride = <T extends { x: number; y: number; roomId?: string }>(x: T): T => {
    const m = x.roomId ? match.get(x.roomId) : undefined;
    if (!m) {
      const { roomId: _r, ...rest } = x;
      void _r;
      return rest as T;
    }
    return { ...x, x: round1(x.x + m.d.x), y: round1(x.y + m.d.y), roomId: m.id };
  };
  const fixtures = old.fixtures.map(ride).filter((f) => !next.fixtures.some((n) => n.kind === f.kind && n.roomId !== undefined && n.roomId === f.roomId));
  const l = furnishOf(old);
  return withFurnish(next, {
    fixtures: [...next.fixtures, ...fixtures],
    furniture: [...next.furniture, ...old.furniture.map(ride)],
    addOns: [...(next.addOns ?? []), ...l.addOns.map(ride)],
    cabinets: { hidden: l.cabinets.hidden, added: l.cabinets.added.map(ride) },
    devices: { hidden: l.devices.hidden, added: l.devices.added.map(ride) },
  });
}

/** `carryFurnish` for every floor: new plans keep the furnish items of the plans they replace. */
export function keepFurnish(old: Record<string, FloorPlan>, next: Record<string, FloorPlan>): Record<string, FloorPlan> {
  return Object.fromEntries(Object.entries(next).map(([id, plan]) => [id, old[id] ? carryFurnish(old[id], plan) : plan]));
}
