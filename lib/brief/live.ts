import type { Adjacency, ChosenRoom, DesignBrief, DiscoveryAnswers, Profile, Project } from "@/lib/model/schema";
import { locationOf } from "@/lib/location/current";
import { WHOLE_FLOOR } from "@/lib/plan/doors";
import { DEFAULT_WEIGHTS, priorityWeights, type Weights } from "@/lib/plan/score";
import { syncLevels, MAIN_LEVEL_ID } from "./levels";
import { PRIORITIES, type PriorityId } from "./priorities";
import { buildRuleBrief, guessOpenKitchen, obviousConnections, samePair } from "./rules";

/**
 * The Design Brief is worked out from the rooms page's answers on every
 * edit: the answers are the only saved copy of what the user picked, and
 * `project.brief` is what every later stage reads.
 */

type Inputs = Pick<Project, "discovery" | "profile" | "location">;

/** The brief for the project's answers as they are now. */
export function briefFrom(p: Inputs): DesignBrief {
  return buildRuleBrief({ answers: p.discovery.answers, profile: p.profile, costIndex: locationOf(p).costIndex, plot: null });
}

/**
 * `next` with its brief (and floors) worked out again when an edit changed
 * what the brief is made from: the answers, who it's for and the budget, or
 * the place. A house with no brief yet gets one once it has a room.
 * Taking away floors with rooms is asked about by the page first.
 */
export function withLiveBrief<T extends Inputs & Pick<Project, "brief" | "levels">>(prev: T | null, next: T): T {
  if (prev && next.discovery === prev.discovery && next.profile === prev.profile && next.location === prev.location) return next;
  if (!next.brief && next.discovery.answers.rooms.length === 0) return next;
  const brief = briefFrom(next);
  return { ...next, brief, levels: syncLevels(next.levels, brief) };
}

// ---------- From a brief back to the answers ----------

type Room = DesignBrief["rooms"][number];

const pairKey = (e: Pick<Adjacency, "a" | "b">) => [e.a, e.b].sort().join("|");
const edgeKey = (e: Adjacency) => `${pairKey(e)}|${e.strength}`;

/** The ticks that change the ranking the way these free-typed priorities did (houses saved before the tick list). */
export function priorityIdsFrom(texts: string[]): PriorityId[] {
  const field = (label: string) => {
    const w = priorityWeights([label]).weights;
    return (Object.keys(w) as (keyof Weights)[]).find((k) => w[k] !== DEFAULT_WEIGHTS[k])!;
  };
  return PRIORITIES.filter((p) => {
    const k = field(p.label);
    return texts.some((t) => priorityWeights([t]).weights[k] !== DEFAULT_WEIGHTS[k]);
  }).map((p) => p.id);
}

/** The user's connections from a brief's list: everything but the obvious ones the app adds itself, and the obvious ones taken out. */
function connectionsFrom(rooms: Pick<Room, "id" | "type">[], adjacencies: Adjacency[]) {
  const auto = obviousConnections(rooms);
  const autoKeys = new Set(auto.map(edgeKey));
  return {
    connections: adjacencies.filter((e) => !autoKeys.has(edgeKey(e))),
    removedConnections: auto.filter((e) => !adjacencies.some((o) => samePair(o, e.a, e.b))).map(({ a, b }) => ({ a, b })),
  };
}

/** True when two briefs have the same rooms, sizes, floors and connections. */
export function sameBrief(a: DesignBrief, b: DesignBrief): boolean {
  const room = (r: Room) => JSON.stringify([r.id, r.type, r.name, r.targetSqFt, r.levelId ?? MAIN_LEVEL_ID, r.lengthIn ?? null, r.widthIn ?? null, r.notes?.trim() || null]);
  const edges = (x: DesignBrief) => JSON.stringify(x.adjacencies.map(edgeKey).sort());
  return (
    a.rooms.length === b.rooms.length &&
    a.rooms.every((r, i) => room(r) === room(b.rooms[i])) &&
    edges(a) === edges(b) &&
    a.floors === b.floors &&
    a.floorsBelow === b.floorsBelow &&
    a.garageBays === b.garageBays &&
    a.openKitchen === b.openKitchen
  );
}

/**
 * The answers that give back this brief, for houses saved when the brief was
 * a separate copy the user could edit. Sizes and floors are kept as typed
 * values only where they differ from what the app would pick now, as long as
 * the result still gives the same brief; otherwise every size and floor is
 * kept as typed.
 */
export function answersFromBrief(brief: DesignBrief, prev: DiscoveryAnswers, ctx: { profile: Profile; costIndex?: number }): DiscoveryAnswers {
  const hasGarage = brief.rooms.some((r) => r.type === "garage");
  const feel = prev.feel.trim() ? prev.feel : (brief.freeText ?? "").slice(0, 3000);
  const base: DiscoveryAnswers = {
    ...prev,
    floorsAbove: brief.floors,
    floorsBelow: brief.floorsBelow,
    garageCars: hasGarage ? Math.max(0, Math.min(4, brief.garageBays)) : prev.garageCars,
    feel,
    openKitchen: brief.openKitchen === guessOpenKitchen(feel) ? undefined : brief.openKitchen,
    priorities: priorityIdsFrom(brief.priorities),
    accessible: brief.accessibility.some((t) => WHOLE_FLOOR.test(t)),
    ...connectionsFrom(brief.rooms, brief.adjacencies),
  };
  const typed: ChosenRoom[] = brief.rooms.map((r) => {
    const room: ChosenRoom = { id: r.id, type: r.type, name: r.name, description: (r.notes ?? "").slice(0, 1000), levelId: r.levelId ?? MAIN_LEVEL_ID };
    if (r.lengthIn) room.lengthIn = r.lengthIn;
    if (r.widthIn) room.widthIn = r.widthIn;
    if (!(r.lengthIn && r.widthIn)) room.sqft = r.targetSqFt;
    return room;
  });
  const build = (rooms: ChosenRoom[]) => buildRuleBrief({ answers: { ...base, rooms }, profile: ctx.profile, costIndex: ctx.costIndex, plot: null });
  const guess = build(typed.map((r) => ({ ...r, sqft: undefined, levelId: undefined }))).rooms;
  const loose = typed.map((r, i) => ({
    ...r,
    sqft: r.sqft === guess[i].targetSqFt ? undefined : r.sqft,
    levelId: r.levelId === guess[i].levelId ? undefined : r.levelId,
  }));
  const target = { ...brief, garageBays: hasGarage ? base.garageCars : 0 };
  return { ...base, rooms: sameBrief(build(loose), target) ? loose : typed };
}

/**
 * The answers after an edit on the Design Brief page, which shows the brief:
 * only what changed between `before` and `after` is written, as typed
 * values, so the app keeps picking the rest.
 */
export function applyBriefEdit(answers: DiscoveryAnswers, before: DesignBrief, after: DesignBrief): DiscoveryAnswers {
  const rooms = after.rooms.map((r): ChosenRoom => {
    const was = before.rooms.find((b) => b.id === r.id);
    const mine = answers.rooms.find((a) => a.id === r.id);
    if (!was || !mine) return { id: r.id, type: r.type, name: r.name, description: r.notes ?? "", levelId: r.levelId, lengthIn: r.lengthIn, widthIn: r.widthIn };
    const next = { ...mine };
    if (r.name !== was.name) next.name = r.name;
    if (r.type !== was.type) next.type = r.type;
    if (r.lengthIn !== was.lengthIn) next.lengthIn = r.lengthIn;
    if (r.widthIn !== was.widthIn) next.widthIn = r.widthIn;
    if (r.targetSqFt !== was.targetSqFt && !(r.lengthIn && r.widthIn)) next.sqft = r.targetSqFt;
    if (r.levelId !== was.levelId) next.levelId = r.levelId;
    if ((r.notes ?? "") !== (was.notes ?? "")) next.description = r.notes ?? "";
    return next;
  });
  const out: DiscoveryAnswers = { ...answers, rooms, floorsAbove: after.floors, floorsBelow: after.floorsBelow };
  if (after.garageBays !== before.garageBays) out.garageCars = Math.max(0, Math.min(4, after.garageBays));
  if (after.openKitchen !== before.openKitchen) out.openKitchen = after.openKitchen;
  if (after.adjacencies !== before.adjacencies) Object.assign(out, connectionsFrom(after.rooms, after.adjacencies));
  return out;
}
