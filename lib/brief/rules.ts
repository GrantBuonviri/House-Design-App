import type { Adjacency, ChosenRoom, DesignBrief, DiscoveryAnswers, Plot, Point, Profile } from "@/lib/model/schema";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import { GARAGE_SQFT, roomType, sqftFromDims } from "./rooms";
import { MAIN_LEVEL_ID, levelIdsFor } from "./levels";

/** Everything the brief is built from. */
export type BriefContext = {
  answers: DiscoveryAnswers;
  profile: Profile;
  plot: Plot | null;
  /** Where the house sits on the land (plot inches), when it is placed. */
  spot?: Point;
};

type Room = DesignBrief["rooms"][number];

const SIDE_NAME = { N: "north", E: "east", S: "south", W: "west" } as const;

const SLEEPING = new Set(["primary-bedroom", "primary-bath", "primary-closet", "bedroom", "bathroom"]);
const DOWNSTAIRS = new Set(["bonus", "media", "gym", "workshop", "playroom", "craft", "storage", "mechanical", "guest-suite"]);

/** Connections that almost every house wants, added when the user didn't say otherwise. */
const OBVIOUS: [string, string, Adjacency["strength"]][] = [
  ["kitchen", "dining", "must"],
  ["kitchen", "pantry", "must"],
  ["kitchen", "family", "must"],
  ["kitchen", "living", "nice"],
  ["entry", "living", "nice"],
  ["garage", "mudroom", "must"],
  ["mudroom", "kitchen", "nice"],
  ["mudroom", "laundry", "nice"],
  ["primary-bedroom", "primary-bath", "must"],
  ["primary-bath", "primary-closet", "must"],
  ["half-bath", "entry", "nice"],
  ["porch", "entry", "must"],
  ["patio", "living", "nice"],
  ["deck", "kitchen", "nice"],
  ["outdoor-kitchen", "kitchen", "nice"],
  ["workshop", "garage", "nice"],
];

const FEEL_WORDS: [RegExp, string][] = [
  [/\bcozy|\bcosy|\bsnug/, "Cozy"],
  [/\bairy|\bspacious|\bhigh ceiling|\btall ceiling|\bvaulted/, "Airy with tall ceilings"],
  [/\bbright|\bsunny|\bnatural light|\blots of light/, "Bright and sunny"],
  [/\bopen\b|\bopen plan|\bopen concept/, "Open plan"],
  [/\bmodern farmhouse/, "Modern farmhouse"],
  [/\bmountain/, "Mountain modern"],
  [/\bcraftsman/, "Craftsman"],
  [/\brustic/, "Rustic"],
  [/\bscandinavian|\bnordic/, "Scandinavian"],
  [/\bmid-century|\bmid century/, "Mid-century"],
  [/\bminimal/, "Minimal"],
  [/\bwarm/, "Warm"],
  [/\bcalm|\bquiet|\bpeaceful|\bserene/, "Calm and quiet"],
  [/\bwood|\btimber|\bstone|\bnatural material/, "Natural materials"],
  [/\bcontemporary/, "Contemporary"],
  [/\bcottage/, "Cottage"],
  [/\bindustrial/, "Industrial"],
  [/\bsimple|\bunfussy/, "Simple"],
];

/** Where a room goes when the user left its floor to the app. */
export function ruleLevel(type: string, above: number, below: number): string {
  if (below > 0 && DOWNSTAIRS.has(type)) return "basement-1";
  if (above > 1 && (SLEEPING.has(type) || type === "bonus" || type === "laundry")) return "floor-2";
  return MAIN_LEVEL_ID;
}

/** The size of a room: its dimensions if given, otherwise a typical size. */
export function ruleSqft(room: Pick<ChosenRoom, "type" | "lengthIn" | "widthIn">, garageCars: number): number {
  const fromDims = sqftFromDims(room.lengthIn, room.widthIn);
  if (fromDims) return fromDims;
  if (room.type === "garage" && garageCars > 0) return GARAGE_SQFT[Math.min(garageCars, 4)];
  return roomType(room.type).sqft;
}

/**
 * A complete Design Brief from the rooms page. The user's rooms are the
 * brief's rooms: same ids, names and count. A smarter version can take this
 * function's place later without changing the page.
 */
export function buildRuleBrief(ctx: BriefContext): DesignBrief {
  const a = ctx.answers;
  const allowed = levelIdsFor(a.floorsAbove, a.floorsBelow);

  const rooms: Room[] = a.rooms.map((r) => {
    const room: Room = {
      id: r.id,
      type: roomType(r.type).id,
      name: r.name.trim() || roomType(r.type).label,
      targetSqFt: ruleSqft(r, a.garageCars),
      levelId: r.levelId && allowed.includes(r.levelId) ? r.levelId : ruleLevel(r.type, a.floorsAbove, a.floorsBelow),
    };
    if (r.lengthIn && r.widthIn) {
      room.lengthIn = r.lengthIn;
      room.widthIn = r.widthIn;
    }
    if (r.description.trim()) room.notes = r.description.trim();
    return room;
  });

  const hasGarage = rooms.some((r) => r.type === "garage");
  return {
    rooms,
    adjacencies: withObviousConnections(rooms, a.connections),
    floors: a.floorsAbove,
    floorsBelow: a.floorsBelow,
    garageBays: hasGarage ? a.garageCars : 0,
    openKitchen: !/\bclosed kitchen|\bseparate kitchen|\bkitchen (?:as )?its own room/i.test(a.feel),
    primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId,
    vibe: feelWords(a.feel),
    priorities: rulePriorities(ctx),
    accessibility: [],
    freeText: a.feel.trim() || undefined,
    summary: ruleSummary(ctx, rooms),
    source: "rules",
  };
}

const samePair = (e: Adjacency, a: string, b: string) => (e.a === a && e.b === b) || (e.a === b && e.b === a);

/** The user's connections exactly as they are, plus the obvious ones they didn't mention. */
export function withObviousConnections(rooms: Room[], userConnections: Adjacency[]): Adjacency[] {
  const ids = new Set(rooms.map((r) => r.id));
  const out = userConnections.filter((e) => ids.has(e.a) && ids.has(e.b) && e.a !== e.b);
  const first = (type: string) => rooms.find((r) => r.type === type);
  for (const [ta, tb, strength] of OBVIOUS) {
    const x = first(ta);
    const y = first(tb);
    if (x && y && !out.some((e) => samePair(e, x.id, y.id))) out.push({ a: x.id, b: y.id, strength });
  }
  return out;
}

export function feelWords(feel: string): string[] {
  const text = feel.toLowerCase();
  return FEEL_WORDS.filter(([re]) => re.test(text)).map(([, word]) => word);
}

function rulePriorities(ctx: BriefContext): string[] {
  const { answers: a, plot, spot } = ctx;
  const out: string[] = [];
  if (/\bentertain|\bhost|\bparties|\bparty\b|\bguests/i.test(a.feel)) out.push("Room to host and entertain");
  if (/\bprivacy|\bprivate/i.test(a.feel)) out.push("Privacy between spaces");
  if (/\bstorage/i.test(a.feel)) out.push("Plenty of storage");
  if (/\boutdoor|\bpatio|\bdeck|\bgarden|\byard/i.test(a.feel)) out.push("Easy indoor-outdoor living");
  if (plot) {
    const imp = plotImplications(plot, spot);
    if (imp.sun.rating === "excellent" || imp.sun.rating === "good") out.push("Living spaces on the sunny south side");
    else out.push("Bring in winter light with high south windows");
    for (const w of plot.waterFeatures) {
      if (w.kind !== "wash") out.push(`Views toward the ${w.kind}`);
    }
    if (a.floorsBelow > 0 && (imp.foundation.type === "walkout" || imp.foundation.type === "stepped")) {
      out.push(`Walkout basement on the ${compassName(plot.slope.downhillDeg)} (downhill) side`);
    }
    out.push(`Entry and garage on the ${SIDE_NAME[plot.roadSide]} side, facing the road`);
    if (plot.roads.some((r) => r.kind === "side")) out.push("A corner lot: keep the side street side tidy, since it shows too");
    if (plot.features.some((f) => f.kind === "rock")) out.push("Place the house around the big rock, or budget to remove it");
    if (plot.features.some((f) => f.kind === "tree")) out.push("Keep the trees for shade and privacy");
    if (plot.lanes.length) out.push("Keep the house clear of the private lane");
  }
  return [...new Set(out)];
}

export function briefTotals(brief: Pick<DesignBrief, "rooms">) {
  let heated = 0;
  let garage = 0;
  let outdoor = 0;
  for (const r of brief.rooms) {
    const c = roomType(r.type).category;
    if (c === "garage") garage += r.targetSqFt;
    else if (c === "outdoor") outdoor += r.targetSqFt;
    else heated += r.targetSqFt;
  }
  // Halls, stairs and walls add roughly 15% on top of the rooms themselves.
  return { rooms: heated, heated: Math.round((heated * 1.15) / 5) * 5, garage, outdoor };
}

/** Things a house almost always needs, for a heads-up in the summary. */
export function missingEssentials(rooms: Pick<Room, "type">[]): string[] {
  const has = (...types: string[]) => rooms.some((r) => types.includes(r.type));
  const out: string[] = [];
  if (!has("kitchen")) out.push("there's no kitchen yet");
  const fullBath = has("bathroom", "primary-bath");
  if (has("bedroom", "primary-bedroom", "guest-suite") && !fullBath) out.push("there are bedrooms but no full bathroom");
  else if (rooms.length > 0 && !fullBath && !has("half-bath")) out.push("there's no bathroom yet");
  return out;
}

const STORIES = ["", "single-story", "two-story", "three-story", "four-story", "five-story"];

function ruleSummary(ctx: BriefContext, rooms: Room[]): string {
  const a = ctx.answers;
  const count = (...types: string[]) => rooms.filter((r) => types.includes(r.type)).length;
  const bedrooms = count("bedroom", "primary-bedroom", "guest-suite");
  const baths = count("bathroom", "primary-bath") + 0.5 * count("half-bath");
  const { heated } = briefTotals({ rooms });
  const who = ctx.profile.ownerName ? `${ctx.profile.ownerName}'s` : "A";
  const below = a.floorsBelow === 0 ? "" : a.floorsBelow === 1 ? " with a basement" : ` with ${a.floorsBelow} basement levels`;
  const parts: string[] = [];
  if (bedrooms) parts.push(`${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}`);
  if (baths) parts.push(`${baths} ${baths === 1 ? "bath" : "baths"}`);
  parts.push(`about ${heated.toLocaleString("en-US")} sq ft of living space`);
  const garage = rooms.some((r) => r.type === "garage") && a.garageCars > 0 ? ` and a ${a.garageCars}-car garage` : "";
  let text = `${who} ${STORIES[a.floorsAbove]} house${below}: ${parts.join(", ")}${garage}.`;
  const feel = feelWords(a.feel).slice(0, 3).join(", ").toLowerCase();
  if (feel) text += ` The feel: ${feel}.`;
  const missing = missingEssentials(rooms);
  if (missing.length) text += ` Heads up: ${missing.join(", and ")}.`;
  return text;
}
