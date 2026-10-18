import type { FloorPlan, Point } from "@/lib/model/schema";
import { add, dist, pointInPolygon, polygonArea, scale, sub, unit } from "@/lib/plan/geometry";
import { openingGeometries } from "@/lib/plan/walls";
import { flatPlan } from "@/lib/plan/flatten";
import { isLight } from "@/lib/plan/devices";
import type { DeviceKind } from "@/lib/model/schema";
import type { LayerItem } from "@/lib/furnish/layer";

/**
 * Lights at night in the walkthrough: which lamps and ceiling lights there
 * are on a floor, how dark it is for the sun's height, and which few of the
 * lights really light the scene (the room you're in and its neighbors, up to
 * MAX_LIVE_LIGHTS, since every real light costs drawing time on every pixel).
 * Every other lamp and fixture still glows; it just doesn't light the room.
 */

/** The most real lights on at once. */
export const MAX_LIVE_LIGHTS = 6;
/** Of those, the most from the room you're in (the rest go to its neighbors). */
const MAX_HERE = 4;

export type LightSource = {
  id: string;
  levelId: string;
  roomId?: string;
  /** On the plan, inches. */
  p: Point;
  /** Height above the floor it's on, inches. */
  z: number;
  kind: "ceiling" | "wall" | "lamp";
};

/** Where an item's light comes from, if it gives light. */
function sourceOf(it: LayerItem, ceilingIn: number): { z: number; kind: LightSource["kind"] } | null {
  const type = it.entryId.slice(it.entryId.indexOf(":") + 1);
  if (it.kind === "device") {
    if (!isLight(type as DeviceKind)) return null;
    return type === "light-wall" ? { z: it.bottomIn + 2, kind: "wall" } : { z: ceilingIn - 6, kind: "ceiling" };
  }
  if (it.entryId === "addon:table-lamp") return { z: it.bottomIn + it.heightIn * 0.72, kind: "lamp" };
  if (it.entryId === "addon:pendant") return { z: it.bottomIn + 2, kind: "lamp" };
  if (it.entryId === "furniture:floor-lamp") return { z: 54, kind: "lamp" };
  return null;
}

/** The smallest room a spot is in (so a closet inside a bedroom reads as the closet). */
function roomIdAt(plan: FloorPlan, p: Point): string | undefined {
  return [...plan.rooms].sort((a, b) => Math.abs(polygonArea(a.polygon)) - Math.abs(polygonArea(b.polygon))).find((r) => pointInPolygon(p, r.polygon))?.id;
}

/** Every lamp and light on a floor (pass the floor's items with the app's own lights, `stageItems`). */
export function lightSources(plan: FloorPlan, items: LayerItem[], levelId: string, ceilingIn: number): LightSource[] {
  const flat = flatPlan(plan);
  const out: LightSource[] = [];
  for (const it of items) {
    const s = sourceOf(it, ceilingIn);
    if (!s) continue;
    const p = { x: it.x, y: it.y };
    out.push({ id: it.id, levelId, roomId: roomIdAt(flat, p) ?? it.roomId, p, ...s });
  }
  return out;
}

/** Rooms you can see into from each room: through a door or cased opening, or across a removed wall. */
export function linkedRooms(plan: FloorPlan): Map<string, Set<string>> {
  const flat = flatPlan(plan);
  const links = new Map<string, Set<string>>();
  const link = (a?: string, b?: string) => {
    if (!a || !b || a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      const set = links.get(x) ?? new Set<string>();
      set.add(y);
      links.set(x, set);
    }
  };
  const across = (c: Point, n: Point) => link(roomIdAt(flat, add(c, scale(n, 10))), roomIdAt(flat, add(c, scale(n, -10))));
  for (const og of openingGeometries(flat)) if (og.opening.kind !== "window") across(og.center, og.n);
  for (const w of flat.openWalls ?? []) {
    const u = unit(sub(w.b, w.a));
    across(scale(add(w.a, w.b), 0.5), { x: -u.y, y: u.x });
  }
  return links;
}

/**
 * The lights that really light the scene: the room you're in first (the
 * nearest few), then one in each neighboring room, nearest first, up to `cap`.
 */
export function liveLights(sources: LightSource[], here: { levelId: string; roomId?: string; p: Point }, links: Map<string, Set<string>>, cap = MAX_LIVE_LIGHTS): LightSource[] {
  const near = (a: LightSource, b: LightSource) => dist(a.p, here.p) - dist(b.p, here.p);
  const onFloor = sources.filter((s) => s.levelId === here.levelId);
  if (!here.roomId) return onFloor.sort(near).slice(0, Math.min(cap, 2));
  const mine = onFloor.filter((s) => s.roomId === here.roomId).sort(near);
  // Lamps first: they make the room feel lit at night.
  const own = [...mine.filter((s) => s.kind === "lamp"), ...mine.filter((s) => s.kind !== "lamp")].slice(0, MAX_HERE);
  const out = [...own];
  const next = links.get(here.roomId) ?? new Set<string>();
  const others = [...next]
    .map((id) => onFloor.filter((s) => s.roomId === id).sort(near)[0])
    .filter((s): s is LightSource => Boolean(s))
    .sort(near);
  for (const s of others) if (out.length < cap) out.push(s);
  // Room left over: more from this room.
  for (const s of mine) if (out.length < cap && !out.includes(s)) out.push(s);
  return out.slice(0, cap);
}

/** How far the lights are on for the sun's height in degrees: off in daylight, coming on as the sun sets, fully on once it's down. */
export function lightsAmount(altitudeDeg: number): number {
  return Math.max(0, Math.min(1, (8 - altitudeDeg) / 12));
}

/** How dark the sky and the daylight inside are: 0 by day, 1 at night (from just after sunset). */
export function nightAmount(altitudeDeg: number): number {
  return Math.max(0, Math.min(1, (3 - altitudeDeg) / 11));
}

/** The latest hour the walkthrough's time slider reaches with Pretty on: about four hours past sunset. */
export function latestHour(sunset: number): number {
  return Math.min(23.75, Math.round((sunset + 4) * 4) / 4);
}
