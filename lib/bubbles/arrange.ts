import type { BubbleDiagram, DesignBrief, Level, Plot, Point } from "@/lib/model/schema";
import { MAIN_LEVEL_ID, nearestLevel } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { freeSpot, layout, type LayoutLink, type LayoutNode } from "./layout";
import { bubbleForRoom, bubbleIdFor, emptyDiagram, isDrawn, stairsBubble, type Bubble } from "./shapes";
import { ruleSpot, siteOf, spotFromVector, spotVector, type Spot } from "./site";

/**
 * Turning the brief and the land into bubble diagrams, one per level.
 * Rooms are placed by spot (which side of the house), then the force layout
 * makes the drawing: connected rooms touch, nothing overlaps, and the stairs
 * line up on every floor.
 */

export type SketchContext = { brief: DesignBrief; plot: Plot | null; levels: Level[] };
export type Diagrams = Record<string, BubbleDiagram>;

const OUTSIDE = new Set(["garage", "outdoor"]);

/** Rooms that the stairs usually open onto, best first. */
const STAIR_HUBS = ["entry", "family", "living", "bonus", "media", "mudroom", "kitchen", "dining", "bedroom"];

/** How far from the middle of a floor a room on an outside spot sits, as a share of the floor's radius. */
const SPOT_REACH = 0.85;
/** Rooms closer to the middle than this share of the floor's radius are "in the middle". */
const CENTER_SHARE = 0.3;

function mainLevelId(levels: Level[]): string {
  return levels.find((l) => l.id === MAIN_LEVEL_ID)?.id ?? levels.find((l) => l.kind === "main")?.id ?? levels[0].id;
}

/** Main floor first, then outward: the floors nearest the main floor next. */
function layoutOrder(levels: Level[]): Level[] {
  const main = mainLevelId(levels);
  return [...levels].sort((a, b) => (a.id === main ? -1 : b.id === main ? 1 : Math.abs(a.elevationIn) - Math.abs(b.elevationIn)));
}

/** The level a brief room's bubble goes on. */
export function levelForRoom(room: { levelId?: string }, levels: Level[]): string {
  const ids = levels.map((l) => l.id);
  if (room.levelId && ids.includes(room.levelId)) return room.levelId;
  const near = nearestLevel(room.levelId, ids);
  return ids.includes(near) ? near : mainLevelId(levels);
}

function area(b: Pick<Bubble, "rx" | "ry">): number {
  return Math.PI * b.rx * b.ry;
}

/** The radius of a circle with the same area as all these bubbles. */
function floorRadius(bubbles: Pick<Bubble, "rx" | "ry">[]): number {
  return Math.sqrt(bubbles.reduce((s, b) => s + area(b), 0) / Math.PI) || 120;
}

/** The middle of a floor, weighted by bubble size. */
export function centerOf(bubbles: Bubble[]): Point {
  const total = bubbles.reduce((s, b) => s + area(b), 0);
  if (!total) return { x: 0, y: 0 };
  return {
    x: bubbles.reduce((s, b) => s + b.x * area(b), 0) / total,
    y: bubbles.reduce((s, b) => s + b.y * area(b), 0) / total,
  };
}

/** Links for the layout: the brief's connections plus the stairs next to a hub room. */
function linksFor(brief: DesignBrief, bubbles: Bubble[]): LayoutLink[] {
  const ids = new Set(bubbles.map((b) => b.id));
  const links: LayoutLink[] = [];
  for (const e of brief.adjacencies) {
    const a = bubbleIdFor(e.a);
    const b = bubbleIdFor(e.b);
    if (ids.has(a) && ids.has(b)) links.push({ a, b, strength: e.strength });
  }
  const stairs = bubbles.find((b) => b.stairs);
  const hub = stairsHub(brief, bubbles);
  if (stairs && hub) links.push({ a: stairs.id, b: hub.id, strength: "must" });
  return links;
}

function stairsHub(brief: DesignBrief, bubbles: Bubble[]): Bubble | undefined {
  const typeOf = new Map(brief.rooms.map((r) => [bubbleIdFor(r.id), r.type]));
  for (const t of STAIR_HUBS) {
    const hit = bubbles.find((b) => typeOf.get(b.id) === t);
    if (hit) return hit;
  }
  return bubbles.find((b) => !b.stairs);
}

/** Flow lines for a level: the brief's "must" and "nice" connections, and the stairs. */
function flowsFor(brief: DesignBrief, bubbles: Bubble[]): BubbleDiagram["flows"] {
  return linksFor(brief, bubbles)
    .filter((l) => l.strength !== "avoid")
    .map((l) => ({ id: `f-${l.a}-${l.b}`, from: l.a, to: l.b }));
}

/** The built-in choice of spot for every room in the brief. */
export function ruleSpots(ctx: SketchContext): Map<string, Spot> {
  const site = siteOf(ctx.plot);
  const kind = new Map(ctx.levels.map((l) => [l.id, l.kind]));
  return new Map(ctx.brief.rooms.map((r) => [r.id, ruleSpot(r.type, kind.get(levelForRoom(r, ctx.levels)) ?? "main", site)]));
}

/**
 * A complete starting sketch: every brief room as a bubble on its floor, at
 * its spot (by room id; rooms without one use the built-in choice).
 */
export function suggestDiagrams(ctx: SketchContext, spots: Map<string, Spot> = new Map(), seed = 7, current: Diagrams = {}): Diagrams {
  const rules = ruleSpots(ctx);
  const byLevel = new Map<string, Bubble[]>(ctx.levels.map((l) => [l.id, []]));
  const spotOf = new Map<string, Spot>();
  // Rooms the user drew in their own shape keep it.
  const drawn = new Map(Object.values(current).flatMap((d) => d.bubbles.filter(isDrawn).map((b) => [b.id, b] as const)));
  for (const room of ctx.brief.rooms) {
    const fresh = bubbleForRoom(room, ctx.brief.garageBays);
    const own = drawn.get(fresh.id);
    const b: Bubble = own ? { ...fresh, shape: "free", outline: own.outline, rx: own.rx, ry: own.ry, rotation: own.rotation } : fresh;
    byLevel.get(levelForRoom(room, ctx.levels))!.push(b);
    spotOf.set(b.id, spots.get(room.id) ?? rules.get(room.id)!);
  }
  if (ctx.levels.length > 1) {
    for (const l of ctx.levels) {
      const s = stairsBubble(l.id);
      byLevel.get(l.id)!.push(s);
      spotOf.set(s.id, "center");
    }
  }

  const out: Diagrams = {};
  let stairsAt: Point | null = null;
  let middle: Point = { x: 0, y: 0 };
  const main = mainLevelId(ctx.levels);
  const categoryOf = new Map(ctx.brief.rooms.map((r) => [r.id, roomType(r.type).category as string]));
  for (const level of layoutOrder(ctx.levels)) {
    const bubbles = byLevel.get(level.id)!;
    if (bubbles.length === 0) {
      out[level.id] = emptyDiagram();
      continue;
    }
    // Upper floors and basements are mostly one kind of room. Fan them out
    // around the stairs so the floor sits over the main floor.
    if (level.id !== main) spreadSpots(bubbles.filter((b) => !b.stairs), spotOf);
    const reach = floorRadius(bubbles) * SPOT_REACH;
    const nodes: LayoutNode[] = bubbles.map((b) => {
      const v = spotVector(spotOf.get(b.id) ?? "center");
      const anchor = { x: middle.x + v.x * reach, y: middle.y + v.y * reach };
      if (b.stairs && stairsAt) return { ...b, anchor: stairsAt, anchorWeight: 1, start: stairsAt, pinned: true };
      return { ...b, anchor, anchorWeight: spotOf.get(b.id) === "center" ? 0.5 : 1 };
    });
    const at = layout(nodes, linksFor(ctx.brief, bubbles), { seed });
    const placed = bubbles.map((b) => ({ ...b, ...at.get(b.id)! }));
    if (level.id === main) {
      stairsAt = placed.find((b) => b.stairs) ?? null;
      // Other floors center on the main floor's indoor rooms, not on the garage or patio.
      middle = centerOf(placed.filter((b) => !b.roomId || !OUTSIDE.has(categoryOf.get(b.roomId) ?? "")));
    }
    out[level.id] = { bubbles: placed, flows: flowsFor(ctx.brief, placed), strokes: [], notes: [] };
  }
  return out;
}

const FAN = [0, 45, -45, 90, -90, 135, -135, 180];

/** When several rooms share a spot, move the extra ones to the neighboring spots. */
function spreadSpots(bubbles: Bubble[], spotOf: Map<string, Spot>) {
  const groups = new Map<Spot, Bubble[]>();
  for (const b of bubbles) {
    const s = spotOf.get(b.id) ?? "center";
    if (s !== "center") groups.set(s, [...(groups.get(s) ?? []), b]);
  }
  for (const [spot, group] of groups) {
    if (group.length < 3) continue;
    const v = spotVector(spot);
    const base = (Math.atan2(v.x, -v.y) * 180) / Math.PI;
    group.forEach((b, i) => {
      const turn = ((base + FAN[i % FAN.length]) * Math.PI) / 180;
      spotOf.set(b.id, spotFromVector({ x: Math.sin(turn), y: -Math.cos(turn) }, 0));
    });
  }
}

/** Where each bubble sits now: its level and its spot from the middle of the main floor. */
export function currentSpots(ctx: SketchContext, current: Diagrams): Map<string, { levelId: string; spot: Spot }> {
  const main = mainLevelId(ctx.levels);
  const center = centerOf(current[main]?.bubbles ?? Object.values(current).flatMap((d) => d.bubbles));
  const out = new Map<string, { levelId: string; spot: Spot }>();
  for (const level of ctx.levels) {
    const bubbles = current[level.id]?.bubbles ?? [];
    const r = floorRadius(bubbles);
    for (const b of bubbles) {
      out.set(b.id, { levelId: level.id, spot: spotFromVector({ x: b.x - center.x, y: b.y - center.y }, r * CENTER_SHARE) });
    }
  }
  return out;
}

/**
 * The current sketch with some bubbles moved to new spots (by bubble id).
 * Bubbles whose spot doesn't change stay close to where they are; the
 * stairs don't move. Pen strokes and notes are left out: they stay with the
 * user's own sketch.
 */
export function moveToSpots(ctx: SketchContext, current: Diagrams, spots: Map<string, Spot>, seed = 11): Diagrams {
  const now = currentSpots(ctx, current);
  const main = mainLevelId(ctx.levels);
  const center = centerOf(current[main]?.bubbles ?? []);
  return relayout(ctx, current, (b, reach) => {
    const want = spots.get(b.id);
    if (!want || want === now.get(b.id)?.spot) return null;
    const v = spotVector(want);
    return { x: center.x + v.x * reach, y: center.y + v.y * reach };
  }, seed);
}

/** The current sketch pulled together around the middle, for a smaller footprint. */
export function compacted(ctx: SketchContext, current: Diagrams, factor = 0.8): Diagrams {
  const center = centerOf(current[mainLevelId(ctx.levels)]?.bubbles ?? []);
  return relayout(ctx, current, (b) => ({ x: center.x + (b.x - center.x) * factor, y: center.y + (b.y - center.y) * factor }), 13, true);
}

/**
 * Lay out the current sketch again. `target` gives a new anchor for a bubble,
 * or null to keep it where it is.
 */
function relayout(
  ctx: SketchContext,
  current: Diagrams,
  target: (b: Bubble, reach: number) => Point | null,
  seed: number,
  moveStairs = false,
): Diagrams {
  const out: Diagrams = {};
  let stairsAt: Point | null = null;
  for (const level of layoutOrder(ctx.levels)) {
    const d = current[level.id];
    if (!d || d.bubbles.length === 0) {
      if (d) out[level.id] = { ...d, strokes: [], notes: [] };
      continue;
    }
    const reach = floorRadius(d.bubbles) * SPOT_REACH;
    const targets = new Map(d.bubbles.map((b) => [b.id, target(b, reach)]));
    const links = [...linksFor(ctx.brief, d.bubbles), ...d.flows.map((f) => ({ a: f.from, b: f.to, strength: "nice" as const }))];
    // Rooms that must connect to a room that moves go with it.
    const follows = new Set(
      links.filter((l) => l.strength === "must").flatMap((l) => (targets.get(l.a) && !targets.get(l.b) ? [l.b] : targets.get(l.b) && !targets.get(l.a) ? [l.a] : [])),
    );
    const nodes: LayoutNode[] = d.bubbles.map((b) => {
      if (b.stairs && (stairsAt || !moveStairs)) {
        const at = stairsAt ?? { x: b.x, y: b.y };
        return { ...b, anchor: at, anchorWeight: 1, start: at, pinned: true };
      }
      const to = targets.get(b.id);
      if (to) return { ...b, anchor: to, anchorWeight: 1.5, start: to };
      return { ...b, anchor: { x: b.x, y: b.y }, anchorWeight: follows.has(b.id) ? 0.3 : 2.5, start: { x: b.x, y: b.y } };
    });
    const at = layout(nodes, links, { seed, iterations: 220 });
    const bubbles = d.bubbles.map((b) => ({ ...b, ...at.get(b.id)! }));
    if (moveStairs) stairsAt ??= bubbles.find((b) => b.stairs) ?? null;
    out[level.id] = { bubbles, flows: d.flows, strokes: [], notes: [] };
  }
  return out;
}

/**
 * Add bubbles for brief rooms that aren't in the sketch yet, each at its
 * usual spot. Everything already drawn stays exactly where it is.
 */
export function addMissingRooms(ctx: SketchContext, current: Diagrams, roomIds: string[]): Diagrams {
  const site = siteOf(ctx.plot);
  const main = mainLevelId(ctx.levels);
  const center = centerOf(current[main]?.bubbles ?? []);
  const out: Diagrams = { ...current };
  const rooms = ctx.brief.rooms.filter((r) => roomIds.includes(r.id));
  for (const level of ctx.levels) {
    const adding = rooms.filter((r) => levelForRoom(r, ctx.levels) === level.id);
    if (adding.length === 0) continue;
    const d = current[level.id] ?? emptyDiagram();
    const fresh = adding.map((r) => ({ room: r, bubble: bubbleForRoom(r, ctx.brief.garageBays) }));
    const all = [...d.bubbles, ...fresh.map((f) => f.bubble)];
    const reach = floorRadius(all) * SPOT_REACH;
    const nodes: LayoutNode[] = [
      ...d.bubbles.map((b) => ({ ...b, anchor: { x: b.x, y: b.y }, anchorWeight: 1, pinned: true })),
      ...fresh.map(({ room, bubble }) => {
        const v = spotVector(ruleSpot(room.type, level.kind, site));
        const anchor = { x: center.x + v.x * reach, y: center.y + v.y * reach };
        return { ...bubble, anchor, anchorWeight: 1 };
      }),
    ];
    const at = layout(nodes, linksFor(ctx.brief, all), { iterations: 200 });
    // Rooms already drawn don't move, so a new one may have nowhere to go but out to the edge.
    const added: Bubble[] = [];
    for (const [i, f] of fresh.entries()) {
      const b = { ...f.bubble, ...at.get(f.bubble.id)! };
      added.push({ ...b, ...freeSpot(b, [...d.bubbles, ...added], { x: b.x, y: b.y }, nodes[d.bubbles.length + i].anchor) });
    }
    const flows = flowsFor(ctx.brief, [...d.bubbles, ...added]).filter(
      (f) => added.some((b) => b.id === f.from || b.id === f.to) && !d.flows.some((x) => samePair(x, f)),
    );
    out[level.id] = { ...d, bubbles: [...d.bubbles, ...added], flows: [...d.flows, ...flows] };
  }
  return out;
}

function samePair(x: { from: string; to: string }, y: { from: string; to: string }) {
  return (x.from === y.from && x.to === y.to) || (x.from === y.to && x.to === y.from);
}

/** Brief rooms that don't have a bubble on any level. */
export function missingRooms(brief: DesignBrief, diagrams: Diagrams): DesignBrief["rooms"] {
  const placed = new Set(Object.values(diagrams).flatMap((d) => d.bubbles.map((b) => b.roomId)));
  return brief.rooms.filter((r) => !placed.has(r.id));
}

/**
 * How different two sketches look: how far rooms moved on average, weighted
 * by their size, as a share of the floor's size. A room that changed floors
 * or is missing counts as a full floor away. 0 means identical.
 */
export function howDifferent(a: Diagrams, b: Diagrams): number {
  let moved = 0;
  let total = 0;
  for (const [levelId, d] of Object.entries(a)) {
    const radius = floorRadius(d.bubbles);
    const other = new Map((b[levelId]?.bubbles ?? []).map((x) => [x.id, x]));
    for (const bubble of d.bubbles) {
      const w = area(bubble);
      const there = other.get(bubble.id);
      moved += w * (there ? Math.min(1, Math.hypot(there.x - bubble.x, there.y - bubble.y) / radius) : 1);
      total += w;
    }
  }
  return total ? moved / total : 0;
}
