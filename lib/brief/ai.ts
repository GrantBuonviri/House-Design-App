import { z } from "zod";
import type { DesignBrief, FollowUp } from "@/lib/model/schema";
import { BRIEF_LEVEL_IDS, levelIdsFor, nearestLevel } from "./levels";
import { MAX_FOLLOW_UPS } from "./followups";
import { ROOM_TYPE_IDS, roomType } from "./rooms";
import { dedupeWords, roomIdFromName } from "./rules";

/**
 * What Claude is asked to return. These are kept simple (no ids, rooms
 * referred to by name) and then checked and repaired in code before the app
 * uses them.
 */

export const AiFollowUps = z.object({
  questions: z.array(
    z.object({
      question: z.string().describe("One short, friendly question in plain words."),
      why: z.string().describe("One short sentence on why the answer changes the design."),
      options: z.array(z.string()).describe("Two to four short quick answers, or none if it needs a written answer."),
    }),
  ),
});
export type AiFollowUps = z.infer<typeof AiFollowUps>;

export const AiBrief = z.object({
  summary: z.string().describe("Two or three plain sentences describing the house and how it should feel."),
  floors: z.number().int().describe("Floors above ground, 1 to 3."),
  basement: z.boolean(),
  garageBays: z.number().int(),
  openKitchen: z.boolean(),
  rooms: z.array(
    z.object({
      type: z.enum(ROOM_TYPE_IDS as [string, ...string[]]),
      name: z.string().describe("A unique name, like 'Bedroom 2'."),
      sqft: z.number().describe("Target floor area in square feet."),
      level: z.enum(BRIEF_LEVEL_IDS),
      notes: z.string().describe("A short note on what matters for this room, or an empty string."),
    }),
  ),
  adjacencies: z.array(
    z.object({
      a: z.string().describe("A room name from the rooms list."),
      b: z.string().describe("Another room name from the rooms list."),
      strength: z.enum(["must", "nice", "avoid"]),
    }),
  ),
  vibe: z.array(z.string()).describe("Short words or phrases for the feel and style."),
  priorities: z.array(z.string()).describe("The most important goals, most important first."),
  accessibility: z.array(z.string()),
});
export type AiBrief = z.infer<typeof AiBrief>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keep at most a few follow-ups, with tidy text and ids. */
export function followUpsFromAi(ai: AiFollowUps): FollowUp[] {
  return ai.questions
    .map((q) => ({
      question: q.question.trim(),
      why: q.why.trim() || undefined,
      options: q.options.map((o) => o.trim()).filter(Boolean).slice(0, 4),
    }))
    .filter((q) => q.question.length > 0)
    .slice(0, MAX_FOLLOW_UPS)
    .map((q, i) => ({ ...q, id: `ai-${i + 1}`, answer: "" }));
}

/**
 * Turn Claude's brief into a valid DesignBrief. Sizes are clamped to sensible
 * ranges for each room type, rooms on floors that don't exist move to the
 * nearest one, names are made unique, and links to unknown rooms are dropped.
 * If the result is unusable, the rule-based draft is returned instead.
 */
export function briefFromAi(ai: AiBrief, draft: DesignBrief): DesignBrief {
  const floors = clamp(Math.round(ai.floors), 1, 3);
  const basement = ai.basement;
  const allowed = levelIdsFor(floors, basement);

  const ids = new Set<string>();
  const names = new Set<string>();
  const byName = new Map<string, string>();
  const rooms: DesignBrief["rooms"] = [];
  for (const r of ai.rooms) {
    const base = r.name.trim() || roomType(r.type).label;
    let name = base;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    names.add(name.toLowerCase());
    const t = roomType(r.type);
    const sqft = Number.isFinite(r.sqft) ? r.sqft : t.sqft;
    const id = roomIdFromName(name, ids);
    if (!byName.has(base.toLowerCase())) byName.set(base.toLowerCase(), id);
    byName.set(name.toLowerCase(), id);
    const room: DesignBrief["rooms"][number] = {
      id,
      type: t.id,
      name,
      targetSqFt: Math.round(clamp(sqft, t.min, t.max) / 5) * 5,
      levelId: nearestLevel(r.level, allowed),
    };
    if (r.notes.trim()) room.notes = r.notes.trim();
    rooms.push(room);
  }
  if (rooms.length < 3 || !rooms.some((r) => r.type === "kitchen")) return draft;

  const adjacencies: DesignBrief["adjacencies"] = [];
  for (const e of ai.adjacencies) {
    const a = byName.get(e.a.trim().toLowerCase());
    const b = byName.get(e.b.trim().toLowerCase());
    if (!a || !b || a === b) continue;
    if (adjacencies.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) continue;
    adjacencies.push({ a, b, strength: e.strength });
  }

  return {
    rooms,
    adjacencies,
    floors,
    basement,
    garageBays: clamp(Math.round(ai.garageBays), 0, 4),
    openKitchen: ai.openKitchen,
    primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId,
    vibe: dedupeWords(ai.vibe).slice(0, 12),
    priorities: dedupeWords(ai.priorities).slice(0, 12),
    accessibility: dedupeWords(ai.accessibility).slice(0, 12),
    freeText: draft.freeText,
    summary: ai.summary.trim() || draft.summary,
    source: "ai",
  };
}

/** Claude's view of a draft brief: the same shape it is asked to return. */
export function briefToAiShape(brief: DesignBrief): AiBrief {
  const name = new Map(brief.rooms.map((r) => [r.id, r.name]));
  return {
    summary: brief.summary ?? "",
    floors: brief.floors,
    basement: brief.basement,
    garageBays: brief.garageBays,
    openKitchen: brief.openKitchen,
    rooms: brief.rooms.map((r) => ({
      type: r.type,
      name: r.name,
      sqft: r.targetSqFt,
      level: nearestLevel(r.levelId, [...BRIEF_LEVEL_IDS]),
      notes: r.notes ?? "",
    })),
    adjacencies: brief.adjacencies.map((e) => ({ a: name.get(e.a) ?? e.a, b: name.get(e.b) ?? e.b, strength: e.strength })),
    vibe: brief.vibe,
    priorities: brief.priorities,
    accessibility: brief.accessibility,
  };
}
