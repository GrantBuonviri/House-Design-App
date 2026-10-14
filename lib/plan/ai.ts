import { z } from "zod";
import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { describePlot } from "@/lib/brief/describe";
import { CHANGE_OPS, CHANGE_SIDES, type PlanChange } from "./changes";
import { openingRooms } from "./connect";
import { planOf, type Plans } from "./edit";
import type { PlanContext } from "./fromSketch";
import { boundsOf, collinearOverlap, dist, dot, edgesOf, leftNormal, sub, unit } from "./geometry";
import { roomSqft } from "./measure";

/**
 * What Claude is asked for. Claude never draws: it lists small changes
 * (push a wall, swap two rooms, add a door, ...) and code applies them and
 * checks the result.
 */

const AiChange = z.object({
  op: z.enum(CHANGE_OPS),
  room: z.string().describe("A room id, exactly as given."),
  other: z.string().describe('swap, door, no_door, open_up: the other room\'s id, or "outside" for a door to the outside. Otherwise "".'),
  side: z.enum(CHANGE_SIDES).describe('grow, shrink, window, and a door to the outside: the side of the room. Otherwise "none".'),
  feet: z.number().describe("grow, shrink: how far the wall moves (1 to 6). window: how wide (2 to 10). Otherwise 0."),
});

export const AiPlanAlternatives = z.object({
  alternatives: z.array(
    z.object({
      title: z.string().describe("A short name for the idea, at most five words."),
      why: z.string().describe("One plain sentence on what changes and why it could suit them."),
      changes: z.array(AiChange).describe("One to four changes, applied in order."),
    }),
  ),
});
export type AiPlanAlternatives = z.infer<typeof AiPlanAlternatives>;

export const PLAN_ALTERNATIVES_SYSTEM = `You are an experienced residential architect in Boise, Idaho. The client has drawn a floor plan for their house. Suggest three alternatives that keep their plan but each try one clear improvement for their brief, such as a bigger pantry borrowing from the mudroom, an open kitchen, bedrooms with more privacy, more winter sun in the living spaces, a shorter walk from the garage to the kitchen, or rooms closer to the sizes in their brief.

You don't draw. Each alternative is a short list of changes that the app applies and checks:
- grow: push the wall on one side of room out by feet (1 to 6). A room on the other side gives up that space.
- shrink: pull the wall on one side of room in by feet. A room on the other side gains the space.
- swap: room and other trade places (their names, uses and fixtures); the walls stay.
- door: a door between room and other, or to the outside (other "outside", side = the wall it goes in).
- no_door: take away the doors between room and other (or "outside").
- open_up: take down most of the wall between room and other, leaving a wide opening.
- window: a window feet wide (2 to 10) in room's outside wall on side.
- mirror: flip the whole house east to west. Only when the road is on the north or south side.

Rules:
- Use room ids exactly as given. Sides are compass sides: N is north (up on the plan), y grows to the south.
- Each alternative makes one to four changes toward one idea, and the three ideas differ.
- A change that would put rooms on top of each other, leave a room too small or narrow, or cut a room off is skipped. So grow into living spaces, hallways with room to spare, or outward, rather than into small rooms.
- Unused fields: other "", side "none", feet 0.
- title: at most five words. why: one plain sentence a first-time home builder would understand.`;

const SIDES = ["N", "E", "S", "W"] as const;
const DIR = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
const ft = (inches: number) => Math.round(inches / 6) / 2;

/** What's on one side of a room: the rooms across each wall (and how you get through), and outside wall with its windows and doors. */
export function sideReport(plan: FloorPlan, room: PlanRoom, side: (typeof SIDES)[number]): string {
  const parts: string[] = [];
  let outside = 0;
  let windows = 0;
  let doors = 0;
  const across = new Map<string, number>();
  for (const e of edgesOf(room.polygon)) {
    if (dot(leftNormal(unit(sub(e.b, e.a))), DIR[side]) <= 0.7) continue;
    const length = dist(e.a, e.b);
    let shared = 0;
    for (const other of plan.rooms) {
      if (other.id === room.id) continue;
      for (const f of edgesOf(other.polygon)) {
        const o = collinearOverlap(e.a, e.b, f.a, f.b, 1);
        if (!o) continue;
        shared += o[1] - o[0];
        across.set(other.id, (across.get(other.id) ?? 0) + o[1] - o[0]);
      }
    }
    outside += Math.max(0, length - shared);
    for (const o of plan.openings) {
      if (!("roomId" in o.host) || o.host.roomId !== room.id || o.host.edge !== e.i) continue;
      if (o.kind === "window") windows++;
      else if (openingRooms(plan, o).filter(Boolean).length === 1) doors++;
    }
  }
  const between = (otherId: string) =>
    plan.openings
      .filter((o) => {
        if (o.kind === "window") return false;
        const [a, b] = openingRooms(plan, o);
        return (a === room.id && b === otherId) || (a === otherId && b === room.id);
      })
      .map((o) => (o.kind === "opening" ? `${ft(o.widthIn)} ft opening` : "door"));
  for (const [id, length] of across) {
    const other = plan.rooms.find((r) => r.id === id)!;
    const k = between(id);
    parts.push(`${other.name} (${id}), ${ft(length)} ft of wall${k.length ? `, ${k.join(" and ")}` : ""}`);
  }
  if (outside >= 12) {
    const has = [windows ? `${windows} window${windows > 1 ? "s" : ""}` : "", doors ? `${doors} door${doors > 1 ? "s" : ""}` : ""].filter(Boolean);
    parts.push(`outside, ${ft(outside)} ft of wall${has.length ? `, ${has.join(" and ")}` : ""}`);
  }
  return parts.length ? parts.join("; ") : "nothing";
}

/** The plan floor by floor, as Claude reads it: each room's size, box and what's on each side. */
export function describePlan(plans: Plans, ctx: Pick<PlanContext, "levels" | "brief">): string {
  const all = Object.values(plans).flatMap((p) => p.rooms.flatMap((r) => r.polygon));
  const bb = boundsOf(all);
  if (!bb) return "No rooms yet.";
  return ctx.levels
    .filter((l) => planOf(plans, l.id).rooms.length)
    .map((l) => {
      const plan = planOf(plans, l.id);
      const rooms = plan.rooms.map((r) => {
        const b = boundsOf(r.polygon)!;
        const want = ctx.brief?.rooms.find((x) => x.id === r.briefRoomId)?.targetSqFt;
        return {
          id: r.id,
          name: r.name,
          type: r.type ?? "other",
          sqft: roomSqft(r),
          ...(want ? { briefSqft: want } : {}),
          box: `x ${ft(b.x0 - bb.x0)} to ${ft(b.x1 - bb.x0)} ft, y ${ft(b.y0 - bb.y0)} to ${ft(b.y1 - bb.y0)} ft`,
          ...(r.polygon.length !== 4 ? { shape: `${r.polygon.length} corners` } : {}),
          ...Object.fromEntries(SIDES.map((s) => [s, sideReport(plan, r, s)])),
        };
      });
      const stairs = plan.stairs.length ? `\nStairs up: ${plan.stairs.map((s) => `${ft(s.widthIn)} ft wide at x ${ft(s.x - bb.x0)}, y ${ft(s.y - bb.y0)} ft`).join("; ")}` : "";
      return `${l.name} (${l.id}):\n${rooms.map((r) => JSON.stringify(r)).join("\n")}${stairs}`;
    })
    .join("\n\n");
}

function briefLines(ctx: Pick<PlanContext, "brief">): string[] {
  const b = ctx.brief;
  if (!b) return ["No design brief yet."];
  const name = new Map(b.rooms.map((r) => [r.id, r.name]));
  const conn = b.adjacencies.map((e) => `${name.get(e.a)} ${e.strength} ${name.get(e.b)}`);
  return [
    `Connections from their brief (must = share a wall or opening, nice = close by, avoid = keep apart):\n${conn.length ? conn.join("\n") : "None given."}`,
    b.openKitchen ? "They want an open kitchen." : "",
    b.summary ? `In a nutshell: ${b.summary}` : "",
    b.vibe.length ? `Feel: ${b.vibe.join(", ")}` : "",
    b.priorities.length ? `Priorities: ${b.priorities.join("; ")}` : "",
    b.freeText ? `In their words: ${b.freeText}` : "",
  ].filter(Boolean);
}

export function planAlternativesPrompt(plans: Plans, ctx: PlanContext, skip: string[] = []): string {
  return [
    `Their floor plan, floor by floor. Each room lists its box (feet from the house's north-west corner) and what is on each side.\n${describePlan(plans, ctx)}`,
    ...briefLines(ctx),
    `The land:\n${describePlot(ctx.plot)}`,
    skip.length ? `They have already seen these ideas, so try different ones: ${skip.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Claude's changes, cleaned up: known ops and sides, numbers in range. */
export function changesFrom(list: AiPlanAlternatives["alternatives"][number]["changes"]): PlanChange[] {
  return list.slice(0, 6).map((c) => ({
    op: c.op,
    room: c.room.trim(),
    other: c.other.trim(),
    side: c.side,
    feet: Number.isFinite(c.feet) ? Math.min(10, Math.max(0, c.feet)) : 0,
  }));
}
