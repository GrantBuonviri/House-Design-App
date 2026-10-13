import { z } from "zod";
import type { DesignBrief } from "@/lib/model/schema";
import { ALL_LEVEL_IDS, levelIdsFor } from "./levels";
import { roomType } from "./rooms";
import { missingEssentials } from "./rules";

/**
 * What Claude is asked to return. Claude never adds or removes rooms: it
 * fills in sizes, floors and notes for the user's rooms (by id), suggests
 * extra connections, and writes the feel, priorities and summary. Code then
 * checks and repairs it before the app uses it.
 */
export const AiBrief = z.object({
  summary: z
    .string()
    .describe("Two or three plain sentences describing the house and how it should feel. Mention anything essential that looks missing."),
  rooms: z.array(
    z.object({
      id: z.string().describe("The room's id, exactly as given."),
      sqft: z.number().describe("Target floor area in square feet."),
      level: z.enum(ALL_LEVEL_IDS).describe("The floor the room goes on."),
      notes: z.string().describe("A short, specific note on what matters for this room, or an empty string."),
    }),
  ),
  connections: z.array(
    z.object({
      a: z.string().describe("A room id."),
      b: z.string().describe("Another room id."),
      strength: z.enum(["must", "nice", "avoid"]),
    }),
  ),
  openKitchen: z.boolean(),
  vibe: z.array(z.string()).describe("Short words or phrases for the feel and style."),
  priorities: z.array(z.string()).describe("The most important goals, most important first."),
  accessibility: z.array(z.string()).describe("Accessibility needs the client mentioned, or none."),
});
export type AiBrief = z.infer<typeof AiBrief>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/**
 * Merge Claude's answer into the rule-based draft. The draft already holds
 * exactly the user's rooms with their own names, chosen floors, dimensions
 * and descriptions; those always win. Claude fills in the rest:
 * - a size for rooms without dimensions (clamped to sensible limits), except
 *   a garage, which is sized for its number of cars
 * - a floor for rooms left to Claude (only floors that exist)
 * - a note for rooms without a description
 * - extra connections between real rooms, on top of the existing ones
 */
export function briefFromAi(ai: AiBrief, draft: DesignBrief, chosen: { id: string; levelId?: string }[]): DesignBrief {
  const allowed = levelIdsFor(draft.floors, draft.floorsBelow);
  const byId = new Map(ai.rooms.map((r) => [r.id, r]));
  const userFloor = new Map(chosen.map((r) => [r.id, r.levelId]));

  const rooms = draft.rooms.map((room) => {
    const answer = byId.get(room.id);
    if (!answer) return room;
    const next = { ...room };
    // The user's dimensions, or a garage sized by its number of cars, set the size.
    const sized = Boolean(room.lengthIn && room.widthIn) || (room.type === "garage" && draft.garageBays > 0);
    if (!sized && Number.isFinite(answer.sqft)) {
      const t = roomType(room.type);
      next.targetSqFt = Math.round(clamp(answer.sqft, t.min, t.max) / 5) * 5;
    }
    const picked = userFloor.get(room.id);
    if (!(picked && allowed.includes(picked)) && allowed.includes(answer.level)) next.levelId = answer.level;
    if (!room.notes && answer.notes.trim()) next.notes = answer.notes.trim();
    return next;
  });

  const ids = new Set(rooms.map((r) => r.id));
  const adjacencies = [...draft.adjacencies];
  for (const e of ai.connections) {
    if (!ids.has(e.a) || !ids.has(e.b) || e.a === e.b) continue;
    if (adjacencies.some((x) => (x.a === e.a && x.b === e.b) || (x.a === e.b && x.b === e.a))) continue;
    adjacencies.push({ a: e.a, b: e.b, strength: e.strength });
  }

  let summary = ai.summary.trim() || draft.summary || "";
  // Claude is asked to flag missing essentials; make sure the user sees them either way.
  const missing = missingEssentials(rooms);
  if (missing.length && !/heads up|missing|no (?:full )?bath|no kitchen/i.test(summary)) {
    summary += ` Heads up: ${missing.join(", and ")}.`;
  }

  return {
    ...draft,
    rooms,
    adjacencies,
    openKitchen: ai.openKitchen,
    primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId,
    vibe: dedupe(ai.vibe).slice(0, 12),
    priorities: dedupe(ai.priorities).slice(0, 12),
    accessibility: dedupe(ai.accessibility).slice(0, 12),
    summary,
    source: "ai",
  };
}
