import { roomType } from "@/lib/brief/rooms";
import { priorityWeights } from "@/lib/plan/score";
import { centerOf, compacted, currentSpots, howDifferent, moveToSpots, type Diagrams, type SketchContext } from "./arrange";
import { bubbleIdFor } from "./shapes";
import { mirroredSpot, oppositeSpot, ruleSpot, siteOf, zoneOf, type Spot } from "./site";

/** One of the "Show me alternatives" designs. `numbers` says what it changes compared with the user's sketch. */
export type Alternative = { title: string; why: string; diagrams: Diagrams; numbers?: string };

const SIDE: Record<string, string> = { N: "north", S: "south", E: "east", W: "west" };

/** Alternatives that move rooms less than this look the same as the user's sketch. */
export const MIN_DIFFERENCE = 0.12;

/**
 * Three alternatives, each a variation on the user's current sketch: rooms
 * that don't change stay where the user put them, and the brief's
 * connections still hold. Variations that would barely look different are
 * skipped, and ideas whose titles are in `skip` (already shown) come last.
 */
export function ruleAlternatives(ctx: SketchContext, current: Diagrams, skip: string[] = []): Alternative[] {
  const site = siteOf(ctx.plot, ctx.spot);
  const now = currentSpots(ctx, current);
  const typeOf = new Map(ctx.brief.rooms.map((r) => [bubbleIdFor(r.id), r.type]));
  const zone = (id: string) => zoneOf(typeOf.get(id) ?? "");
  const candidates: Alternative[] = [];
  const changes = (spots: Map<string, Spot>) => [...spots].some(([id, s]) => now.get(id)?.spot !== s);
  const add = (title: string, why: string, spots: Map<string, Spot>, seed: number) => {
    if (changes(spots)) candidates.push({ title, why, diagrams: moveToSpots(ctx, current, spots, seed) });
  };
  const road = SIDE[site.roadSide];
  const back = oppositeSpot(site.roadSide);

  // Mirror image. The entry stays on the road, and living spaces keep the sunny side.
  const flipped = new Map<string, Spot>();
  for (const [id, { spot }] of now) {
    if (site.mirrorAxis === "y" && (zone(id) === "living" || zone(id) === "kitchen" || zone(id) === "outdoor")) continue;
    flipped.set(id, mirroredSpot(spot, site.mirrorAxis));
  }
  add(
    "Flipped side to side",
    site.mirrorAxis === "x"
      ? "A mirror image: the garage and bedrooms swap sides, and the entry still faces the road."
      : "The garage and bedrooms swap ends, while living spaces keep the sunny south side.",
    flipped,
    21,
  );

  // Split bedrooms: the primary suite on one side, the other bedrooms on the other.
  const split = new Map<string, Spot>();
  for (const level of ctx.levels) {
    const ids = [...now].filter(([, v]) => v.levelId === level.id).map(([id]) => id);
    const primary = ids.find((id) => typeOf.get(id) === "primary-bedroom");
    const others = ids.filter((id) => typeOf.get(id) === "bedroom" || typeOf.get(id) === "bathroom");
    if (!primary || !others.some((id) => typeOf.get(id) === "bedroom")) continue;
    let primarySpot = now.get(primary)!.spot;
    if (primarySpot === "center") primarySpot = ruleSpot("primary-bedroom", level.kind, site);
    split.set(primary, primarySpot);
    for (const id of others) split.set(id, oppositeSpot(primarySpot));
  }
  add("Split bedrooms", "The primary suite and the other bedrooms on opposite sides of the house, for more privacy.", split, 23);

  // Living spaces spread along the south side for more winter sun.
  const sunny = new Map<string, Spot>();
  const xOf = new Map(Object.values(current).flatMap((d) => d.bubbles.map((b) => [b.id, b.x] as const)));
  const living = [...now.keys()]
    .filter((id) => zone(id) === "living" && roomType(typeOf.get(id)!).category === "living")
    .sort((a, b) => xOf.get(a)! - xOf.get(b)!);
  const along: Spot[] = ["SW", "S", "SE"];
  if (living.length >= 2) living.forEach((id, i) => sunny.set(id, along[Math.round((i * (along.length - 1)) / (living.length - 1))]));
  add("Stretched along the sun", "Living spaces spread across the south side, so more of them get low winter sun.", sunny, 25);

  // Living spaces toward the back yard, away from the street.
  if (back !== "S") {
    const yard = new Map<string, Spot>();
    for (const [id] of now) if (zone(id) === "living" || zone(id) === "outdoor") yard.set(id, back);
    add("Living toward the back yard", `Living spaces and the patio face the yard, away from the street on the ${road}.`, yard, 29);
  }

  // Bedrooms on the quiet side, away from the road.
  const quiet = new Map<string, Spot>();
  for (const [id] of now) if (zone(id) === "private") quiet.set(id, back);
  add("Bedrooms on the quiet side", `Bedrooms move to the side away from the street on the ${road}, where it's quieter.`, quiet, 31);

  // The kitchen in the middle, with everything else around it.
  const kitchen = new Map<string, Spot>();
  for (const [id] of now) if (typeOf.get(id) === "kitchen") kitchen.set(id, "center");
  add("Kitchen at the heart", `The kitchen moves to the middle, with everything else around it and the entry still on the ${road}.`, kitchen, 27);

  // A smaller footprint, when there's room to pull things in.
  const small = compacted(ctx, current);
  if (spread(small) < spread(current) * 0.95) {
    candidates.push({
      title: "More compact",
      why: "Rooms pulled closer together, for shorter walks and a smaller footprint that costs less to build.",
      diagrams: small,
    });
  }

  // Best first by the sketch's own score, with numbers for each reason.
  const { weights } = priorityWeights(ctx.brief.priorities);
  const before = scoreSketch(ctx, current);
  const ranked = candidates
    .map((alt) => {
      const after = scoreSketch(ctx, alt.diagrams);
      return { alt: { ...alt, numbers: compareSketches(before, after).slice(0, 3).join(" · ") || undefined }, gain: sketchTotal(after, weights) - sketchTotal(before, weights) };
    })
    .sort((a, b) => b.gain - a.gain)
    .map((x) => x.alt);
  candidates.splice(0, candidates.length, ...ranked);

  if (!skip.length) return pickDistinct(current, candidates, 3);
  // Show me different ones: ideas not shown yet first, even smaller changes, then the ones shown before.
  const seen = new Set(skip.map((t) => t.toLowerCase()));
  const unseen = candidates.filter((a) => !seen.has(a.title.toLowerCase()) && howDifferent(current, a.diagrams) >= MIN_DIFFERENCE / 2);
  const picked = pickDistinct(current, unseen, 3);
  for (const a of pickDistinct(current, candidates.filter((c) => !unseen.includes(c)), 3)) if (picked.length < 3) picked.push(a);
  return picked;
}

/** How spread out a sketch is: each room's distance from the middle of its floor, added up. */
function spread(ds: Diagrams): number {
  return Object.values(ds).reduce((sum, d) => {
    const c = centerOf(d.bubbles);
    return sum + d.bubbles.reduce((t, b) => t + Math.hypot(b.x - c.x, b.y - c.y), 0);
  }, 0);
}

/**
 * Up to `count` alternatives that each look different from the user's sketch
 * and from each other, in the order given. When too few are different
 * enough, the most different of the rest fill the gaps.
 */
export function pickDistinct(current: Diagrams, candidates: Alternative[], count: number): Alternative[] {
  const scored = candidates.map((alt) => ({ alt, score: howDifferent(current, alt.diagrams) }));
  const picked: Alternative[] = [];
  const distinct = (alt: Alternative) => picked.every((p) => howDifferent(p.diagrams, alt.diagrams) >= MIN_DIFFERENCE / 2);
  for (const { alt, score } of scored) {
    if (picked.length < count && score >= MIN_DIFFERENCE && distinct(alt)) picked.push(alt);
  }
  const rest = scored.filter(({ alt }) => !picked.includes(alt)).sort((a, b) => b.score - a.score);
  for (const { alt, score } of rest) {
    if (picked.length < count && score > 0 && distinct(alt)) picked.push(alt);
  }
  for (const { alt } of rest) {
    if (picked.length < count && !picked.includes(alt)) picked.push(alt);
  }
  return picked;
}

// ---------- A light score from the sketch alone ----------

export type SketchScore = {
  /** Living rooms on a south-facing spot (S, SE or SW). */
  sunnyLiving: number;
  /** Garages and storage on the north or west. */
  garageNorthWest: number;
  garages: number;
  /** Average distance from each bedroom to the nearest garage or kitchen, in room widths; null without both. */
  bedroomsAway: number | null;
  /** The brief's connections whose bubbles touch, out of all of them. */
  kept: number;
  connections: number;
};

const BEDROOM_TYPES = new Set(["bedroom", "primary-bedroom", "guest-suite"]);

export function scoreSketch(ctx: SketchContext, diagrams: Diagrams): SketchScore {
  const spots = currentSpots(ctx, diagrams);
  const typeOf = new Map(ctx.brief.rooms.map((r) => [bubbleIdFor(r.id), r.type]));
  const bubbles = Object.entries(diagrams).flatMap(([levelId, d]) => d.bubbles.map((b) => ({ ...b, levelId, type: b.roomId ? ctx.brief.rooms.find((r) => r.id === b.roomId)?.type : typeOf.get(b.id) })));
  const spotOf = (id: string) => spots.get(id)?.spot ?? "center";
  const living = bubbles.filter((b) => b.type && zoneOf(b.type) === "living" && roomType(b.type).category === "living");
  const garages = bubbles.filter((b) => b.type === "garage" || b.type === "storage");
  const r = (b: (typeof bubbles)[number]) => Math.max(b.rx, b.ry);
  const across = bubbles.length ? (bubbles.reduce((n, b) => n + 2 * r(b), 0) / bubbles.length) : 1;
  const away: number[] = [];
  for (const bed of bubbles.filter((b) => BEDROOM_TYPES.has(b.type ?? ""))) {
    const noisy = bubbles.filter((b) => b.levelId === bed.levelId && (b.type === "garage" || b.type === "kitchen"));
    if (noisy.length) away.push(Math.min(...noisy.map((n) => Math.hypot(n.x - bed.x, n.y - bed.y))) / across);
  }
  let kept = 0;
  let connections = 0;
  for (const e of ctx.brief.adjacencies) {
    const a = bubbles.find((b) => b.roomId === e.a || b.id === bubbleIdFor(e.a));
    const b = bubbles.find((x) => x.roomId === e.b || x.id === bubbleIdFor(e.b));
    if (!a || !b) continue;
    connections++;
    if (a.levelId === b.levelId && Math.hypot(a.x - b.x, a.y - b.y) <= (r(a) + r(b)) * 1.15) kept++;
  }
  return {
    sunnyLiving: living.filter((b) => spotOf(b.id).includes("S")).length,
    garageNorthWest: garages.filter((b) => /N|W/.test(spotOf(b.id))).length,
    garages: garages.length,
    bedroomsAway: away.length ? Math.round((away.reduce((n, x) => n + x, 0) / away.length) * 10) / 10 : null,
    kept,
    connections,
  };
}

/** One number for a sketch: the plan's weights (fit, sun, quiet) applied to the sketch's parts. */
export function sketchTotal(s: SketchScore, w: { fit: number; sun: number; quiet: number }): number {
  return w.sun * s.sunnyLiving + w.sun * s.garageNorthWest + Math.max(1, w.quiet) * (s.bedroomsAway ?? 0) + w.fit * s.kept;
}

/** What changed, in numbers: "1 more living room on the sunny side · bedrooms 2 rooms farther from the garage". */
export function compareSketches(now: SketchScore, alt: SketchScore): string[] {
  const out: string[] = [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const sun = alt.sunnyLiving - now.sunnyLiving;
  if (sun) out.push(sun > 0 ? `${n(sun, "more living room", "more living rooms")} on the sunny side` : `${n(-sun, "living room", "living rooms")} off the sunny side`);
  const garage = alt.garageNorthWest - now.garageNorthWest;
  if (garage) out.push(garage > 0 ? "garage moves to the north or west" : "garage leaves the north and west");
  if (alt.bedroomsAway !== null && now.bedroomsAway !== null) {
    const d = Math.round((alt.bedroomsAway - now.bedroomsAway) * 2) / 2;
    const k = Math.abs(d);
    const rooms = k === 0.5 ? "half a room" : `${Math.floor(k)}${k % 1 ? "½" : ""} ${k === 1 ? "room" : "rooms"}`;
    if (k >= 0.5) out.push(`bedrooms ${rooms} ${d > 0 ? "farther from" : "closer to"} the garage and kitchen`);
  }
  const kept = alt.kept - now.kept;
  if (kept) out.push(kept > 0 ? `${n(kept, "more connection", "more connections")} from your brief side by side` : `${n(-kept, "connection", "connections")} from your brief pulled apart`);
  return out;
}
