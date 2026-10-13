import { z } from "zod";
import { describePlot } from "@/lib/brief/describe";
import { currentSpots, levelForRoom, type Diagrams, type SketchContext } from "./arrange";
import { bubbleIdFor, bubbleSqft } from "./shapes";
import { SPOTS, type Spot } from "./site";

/**
 * What Claude is asked for. Claude never draws: it says which spot each room
 * goes in (one of the eight compass sides of the floor, or the middle), and
 * code turns spots into a drawing. Floors stay as the brief has them.
 */

const RoomSpot = z.object({
  id: z.string().describe("The room's id, exactly as given."),
  spot: z.enum(SPOTS).describe("Where on its floor the room goes: a compass side of the house, or the middle."),
});

export const AiSketch = z.object({
  idea: z.string().describe("One or two plain sentences on the main idea of the layout."),
  rooms: z.array(RoomSpot),
});
export type AiSketch = z.infer<typeof AiSketch>;

export const AiAlternatives = z.object({
  alternatives: z.array(
    z.object({
      title: z.string().describe("A short name for the idea, at most five words."),
      why: z.string().describe("One plain sentence on what changes and why it could suit them."),
      moves: z.array(RoomSpot).describe("Only the rooms that move to a different spot."),
    }),
  ),
});
export type AiAlternatives = z.infer<typeof AiAlternatives>;

const SPOT_HELP = `Spots: N, NE, E, SE, S, SW, W, NW are the sides of the house (north is up), and "center" is the middle. Rooms with the same spot are placed next to each other.`;

export const SKETCH_SYSTEM = `You are an experienced residential architect in Boise, Idaho, making the first bubble diagram for a new house. Bubbles show rooms and how they connect, not walls.

${SPOT_HELP}

Give every room a spot on its floor. Think about how the house works:
- the entry and garage face the road; a mudroom links the garage to the kitchen
- living spaces and outdoor living get the sunny south side when they can (Boise is in the northern hemisphere)
- bedrooms go on the quieter side, away from the road and the busy rooms
- on a walkout basement, rooms that want daylight go on the downhill side
- rooms the client must have together share a spot or neighboring spots
- on upper floors and basements, spread rooms around the middle so the floor sits over the main floor

idea: one or two sentences a first-time home builder would enjoy reading.`;

export const ALTERNATIVES_SYSTEM = `You are an experienced residential architect in Boise, Idaho. The client has a bubble diagram for their house. Suggest three alternatives that are similar to it but each try one clear idea, such as a split-bedroom plan, a mirror image, living spaces stretched along the sunny side, a more compact plan, or the kitchen at the heart of the house.

${SPOT_HELP}

Rules:
- Keep every room on its current floor.
- Keep what the client said: rooms that must connect stay together, rooms to keep apart stay apart.
- Each alternative moves a few rooms, not everything, and the three must differ from each other.
- In moves, list only the rooms that change spot, by id. The stairs never move.
- title: at most five words. why: one plain sentence.`;

function roomsJson(ctx: SketchContext) {
  return JSON.stringify(
    ctx.brief.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, sqft: r.targetSqFt, floor: levelForRoom(r, ctx.levels) })),
  );
}

function connections(ctx: SketchContext) {
  const name = new Map(ctx.brief.rooms.map((r) => [r.id, r.name]));
  const lines = ctx.brief.adjacencies.map((e) => `${name.get(e.a)} (${e.a}) ${e.strength} ${name.get(e.b)} (${e.b})`);
  return lines.length ? lines.join("\n") : "None given.";
}

function briefLines(ctx: SketchContext) {
  const b = ctx.brief;
  return [
    b.summary ? `In a nutshell: ${b.summary}` : "",
    b.vibe.length ? `Feel: ${b.vibe.join(", ")}` : "",
    b.priorities.length ? `Priorities: ${b.priorities.join("; ")}` : "",
    b.freeText ? `In their words: ${b.freeText}` : "",
  ].filter(Boolean);
}

export function sketchPrompt(ctx: SketchContext): string {
  return [
    `Floors: ${ctx.levels.map((l) => `${l.id} (${l.name})`).join(", ")}`,
    `Rooms (JSON):\n${roomsJson(ctx)}`,
    `Connections (must = share a wall or opening, nice = close by, avoid = keep apart):\n${connections(ctx)}`,
    ...briefLines(ctx),
    `The land:\n${describePlot(ctx.plot)}`,
  ].join("\n\n");
}

export function alternativesPrompt(ctx: SketchContext, current: Diagrams): string {
  const spots = currentSpots(ctx, current);
  const sketch = ctx.levels
    .filter((l) => current[l.id]?.bubbles.length)
    .map((l) => {
      const bubbles = current[l.id].bubbles.map((b) => ({
        id: b.id,
        name: b.label,
        sqft: bubbleSqft(b),
        spot: spots.get(b.id)?.spot,
        ...(b.stairs ? { stairs: true } : {}),
      }));
      return `${l.name} (${l.id}):\n${JSON.stringify(bubbles)}`;
    });
  const idOf = new Map(ctx.brief.rooms.map((r) => [r.id, bubbleIdFor(r.id)]));
  const name = new Map(ctx.brief.rooms.map((r) => [r.id, r.name]));
  const conn = ctx.brief.adjacencies.map((e) => `${name.get(e.a)} (${idOf.get(e.a)}) ${e.strength} ${name.get(e.b)} (${idOf.get(e.b)})`);
  return [
    `Their bubble diagram, floor by floor (ids are bubble ids):\n${sketch.join("\n\n")}`,
    `Connections from their brief:\n${conn.length ? conn.join("\n") : "None given."}`,
    ...briefLines(ctx),
    `The land:\n${describePlot(ctx.plot)}`,
  ].join("\n\n");
}

/** Claude's spots, keeping only rooms that exist. */
export function spotsFrom(list: { id: string; spot: Spot }[], valid: Set<string>): Map<string, Spot> {
  return new Map(list.filter((r) => valid.has(r.id)).map((r) => [r.id, r.spot]));
}
