import type { Adjacency, ChosenRoom, DesignBrief, DiscoveryAnswers, Plot, Point, Profile } from "@/lib/model/schema";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import { rates as loadRates } from "@/lib/cost/rates";
import { GARAGE_SQFT, roomType, sqftFromDims } from "./rooms";
import { MAIN_LEVEL_ID, levelIdsFor } from "./levels";
import { ACCESSIBLE_TAG, PRIORITIES } from "./priorities";

/** Everything the brief is built from. */
export type BriefContext = {
  answers: DiscoveryAnswers;
  profile: Profile;
  /** The place's cost level (1.00 = US average); the default place's when not given. */
  costIndex?: number;
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
export function ruleSqft(room: Pick<ChosenRoom, "type" | "lengthIn" | "widthIn" | "sqft">, garageCars: number): number {
  const fromDims = sqftFromDims(room.lengthIn, room.widthIn);
  if (fromDims) return fromDims;
  if (room.sqft) return room.sqft;
  if (room.type === "garage" && garageCars > 0) return GARAGE_SQFT[Math.min(garageCars, 4)];
  return roomType(room.type).sqft;
}

/** A room with a typed size (length × width, or sq ft) keeps it. */
export const hasTypedSize = (r: Pick<ChosenRoom, "lengthIn" | "widthIn" | "sqft">) => Boolean(sqftFromDims(r.lengthIn, r.widthIn) || r.sqft);

const CLOSED_KITCHEN = /\bclosed kitchen|\bseparate kitchen|\bkitchen (?:as )?its own room/i;

/** The app's guess for open or closed when the user didn't pick: open, unless the feel asks for a closed kitchen. */
export const guessOpenKitchen = (feel: string) => !CLOSED_KITCHEN.test(feel);

const BEDROOMS = ["primary-bedroom", "bedroom", "guest-suite"];

/**
 * With "easy to get around" ticked, the rooms the app moves to the main
 * floor so there's a bedroom and a full bathroom on it: only rooms whose
 * floor the app picks, never one the user typed. The primary bedroom goes
 * with its bath and closet. Returns room ids, empty when nothing moves.
 */
export function mainFloorPicks(answers: Pick<DiscoveryAnswers, "rooms" | "floorsAbove" | "floorsBelow" | "accessible">): string[] {
  if (!answers.accessible) return [];
  const allowed = levelIdsFor(answers.floorsAbove, answers.floorsBelow);
  const typed = (r: ChosenRoom) => Boolean(r.levelId && allowed.includes(r.levelId));
  const level = (r: ChosenRoom) => (typed(r) ? r.levelId! : ruleLevel(r.type, answers.floorsAbove, answers.floorsBelow));
  const onMain = (types: string[]) => answers.rooms.some((r) => types.includes(r.type) && level(r) === MAIN_LEVEL_ID);
  const movable = (type: string) => answers.rooms.find((r) => r.type === type && !typed(r) && level(r) !== MAIN_LEVEL_ID);
  const out: string[] = [];
  if (!onMain(BEDROOMS)) {
    const bed = BEDROOMS.map(movable).find(Boolean);
    if (bed) {
      out.push(bed.id);
      if (bed.type === "primary-bedroom") for (const t of ["primary-bath", "primary-closet"]) for (const r of answers.rooms) if (r.type === t && !typed(r) && level(r) !== MAIN_LEVEL_ID) out.push(r.id);
    }
  }
  const baths = ["bathroom", "primary-bath"];
  const bathOnMain = onMain(baths) || answers.rooms.some((r) => out.includes(r.id) && baths.includes(r.type));
  if (!bathOnMain) {
    const bath = baths.map(movable).find(Boolean);
    if (bath) out.push(bath.id);
  }
  return out;
}

/**
 * A complete Design Brief from the rooms page. The user's rooms are the
 * brief's rooms: same ids, names and count. Anything the user typed wins;
 * blanks are the app's picks. Worked out again on every edit
 * (lib/brief/live.ts), so nothing here is saved on its own.
 */
export function buildRuleBrief(ctx: BriefContext): DesignBrief {
  const a = ctx.answers;
  const allowed = levelIdsFor(a.floorsAbove, a.floorsBelow);
  const toMain = new Set(mainFloorPicks(a));

  const rooms: Room[] = a.rooms.map((r) => {
    const room: Room = {
      id: r.id,
      type: roomType(r.type).id,
      name: r.name.trim() || roomType(r.type).label,
      targetSqFt: ruleSqft(r, a.garageCars),
      levelId: r.levelId && allowed.includes(r.levelId) ? r.levelId : toMain.has(r.id) ? MAIN_LEVEL_ID : ruleLevel(r.type, a.floorsAbove, a.floorsBelow),
    };
    if (r.lengthIn) room.lengthIn = r.lengthIn;
    if (r.widthIn) room.widthIn = r.widthIn;
    if (r.description.trim()) room.notes = r.description.trim();
    return room;
  });

  fitSizes(rooms, new Set(a.rooms.filter(hasTypedSize).map((r) => r.id)), ctx);
  const hasGarage = rooms.some((r) => r.type === "garage");
  return {
    rooms,
    adjacencies: withObviousConnections(rooms, a.connections, a.removedConnections),
    floors: a.floorsAbove,
    floorsBelow: a.floorsBelow,
    garageBays: hasGarage ? a.garageCars : 0,
    openKitchen: a.openKitchen ?? guessOpenKitchen(a.feel),
    primarySuiteLevel: rooms.find((r) => r.type === "primary-bedroom")?.levelId,
    vibe: feelWords(a.feel),
    priorities: PRIORITIES.filter((p) => a.priorities.includes(p.id)).map((p) => p.label),
    accessibility: a.accessible ? [ACCESSIBLE_TAG] : [],
    freeText: a.feel.trim() || undefined,
    summary: ruleSummary(ctx, rooms),
    source: "rules",
  };
}

// ---------- Sizes that fit the household ----------

/** Rooms that grow and shrink with the number of people. */
const SHARED = new Set(["living", "family", "dining", "kitchen"]);
const BEDROOM_TYPES = new Set(["bedroom", "guest-suite", "primary-bedroom"]);
/** No default bedroom is smaller than 10 x 11 ft. */
const MIN_BEDROOM_SQFT = 110;

export type Sizing = {
  /** Null when neither the profile nor the bedrooms say. */
  people: number | null;
  /** True when the people come from the bedroom count (one each, two in the primary bedroom), not the profile. */
  guessed: boolean;
  /** Living space the budget pays for, in sq ft (budget / the place's cost per sq ft), or null without a budget. */
  targetSqft: number | null;
};

/** How many people the house is for, and the size the budget pays for. */
export function householdSizing(answers: Pick<DiscoveryAnswers, "rooms">, profile: Profile, costIndex: number = loadRates().costLevelBase.index): Sizing {
  const told = (profile.adults ?? 0) + (profile.kids ?? 0);
  const beds = answers.rooms.reduce((n, r) => n + (r.type === "primary-bedroom" ? 2 : r.type === "bedroom" ? 1 : 0), 0);
  const people = told > 0 ? told : beds > 0 ? beds : null;
  const { low, high } = profile.budget ?? {};
  const budget = low && high ? (low + high) / 2 : (high ?? low ?? 0);
  const perSqft = loadRates().calibration.costPerSqft[1] * costIndex;
  return { people, guessed: told === 0, targetSqft: budget > 0 ? Math.round(budget / perSqft / 50) * 50 : null };
}

/** Living, family, dining and kitchen sizes for this many people: about 6% bigger per person over 4, 85% for 1 or 2, the usual size for 3 or 4. */
export function householdFactor(people: number): number {
  if (people <= 2) return 0.85;
  return 1 + 0.06 * Math.max(0, people - 4);
}

const clampTo = (type: string, sqft: number) => {
  const t = roomType(type);
  const floor = BEDROOM_TYPES.has(type) ? Math.max(t.min, MIN_BEDROOM_SQFT) : t.min;
  return Math.round(Math.min(t.max, Math.max(floor, sqft)) / 5) * 5;
};

/**
 * Rooms without a typed size scale with the household, then all of them
 * together toward the size the budget pays for, when the rooms add up to
 * more than 115% or less than 85% of it. Typed sizes never change. Changes
 * `rooms` in place.
 */
function fitSizes(rooms: Room[], typed: Set<string>, ctx: BriefContext) {
  const sizing = householdSizing(ctx.answers, ctx.profile, ctx.costIndex);
  const free = rooms.filter((r) => !typed.has(r.id) && r.type !== "garage" && roomType(r.type).category !== "outdoor");
  const k = sizing.people === null ? 1 : householdFactor(sizing.people);
  for (const r of free) if (SHARED.has(r.type)) r.targetSqFt = clampTo(r.type, r.targetSqFt * k);
  if (sizing.targetSqft) {
    const { heated } = briefTotals({ rooms });
    if (heated > sizing.targetSqft * 1.15 || heated < sizing.targetSqft * 0.85) {
      const fixed = rooms.filter((r) => !free.includes(r) && roomType(r.type).category !== "garage" && roomType(r.type).category !== "outdoor").reduce((n, r) => n + r.targetSqFt, 0);
      const flexible = free.reduce((n, r) => n + r.targetSqFt, 0);
      const s = flexible > 0 ? Math.max(0.5, Math.min(2, (sizing.targetSqft / 1.15 - fixed) / flexible)) : 1;
      for (const r of free) r.targetSqFt = clampTo(r.type, r.targetSqFt * s);
    }
  }
  for (const r of free) if (BEDROOM_TYPES.has(r.type)) r.targetSqFt = clampTo(r.type, r.targetSqFt);
}

/** The brief's one line about default sizes: "Sizes fit 5 people and about 2,400 sq ft." Null when every room has a typed size. */
export function sizingNote(answers: Pick<DiscoveryAnswers, "rooms">, profile: Profile, costIndex?: number): string | null {
  if (!answers.rooms.some((r) => !hasTypedSize(r))) return null;
  const s = householdSizing(answers, profile, costIndex);
  if (s.people === null) return s.targetSqft ? `Sizes fit about ${s.targetSqft.toLocaleString("en-US")} sq ft. Rooms you gave a size keep it.` : null;
  const who = `${s.people} ${s.people === 1 ? "person" : "people"}${s.guessed ? " (counted from the bedrooms)" : ""}`;
  return `Sizes fit ${who}${s.targetSqft ? ` and about ${s.targetSqft.toLocaleString("en-US")} sq ft` : ""}. Rooms you gave a size keep it.`;
}

export const samePair = (e: Pick<Adjacency, "a" | "b">, a: string, b: string) => (e.a === a && e.b === b) || (e.a === b && e.b === a);

/** The obvious connections for these rooms (kitchen and dining, garage and mudroom...), between the first room of each type. */
export function obviousConnections(rooms: Pick<Room, "id" | "type">[]): Adjacency[] {
  const first = (type: string) => rooms.find((r) => r.type === type);
  const out: Adjacency[] = [];
  for (const [ta, tb, strength] of OBVIOUS) {
    const x = first(ta);
    const y = first(tb);
    if (x && y) out.push({ a: x.id, b: y.id, strength });
  }
  return out;
}

/** The user's connections exactly as they are, plus the obvious ones they didn't mention or take out. */
export function withObviousConnections(rooms: Pick<Room, "id" | "type">[], userConnections: Adjacency[], removed: { a: string; b: string }[] = []): Adjacency[] {
  const ids = new Set(rooms.map((r) => r.id));
  const out = userConnections.filter((e) => ids.has(e.a) && ids.has(e.b) && e.a !== e.b);
  for (const e of obviousConnections(rooms)) {
    if (!out.some((o) => samePair(o, e.a, e.b)) && !removed.some((o) => samePair(o, e.a, e.b))) out.push(e);
  }
  return out;
}

export function feelWords(feel: string): string[] {
  const text = feel.toLowerCase();
  return FEEL_WORDS.filter(([re]) => re.test(text)).map(([, word]) => word);
}

/** Tips from the feel and the land ("Entry and garage on the north side…"), shown under the priorities. They don't change the ranking. */
export function briefTips(ctx: BriefContext): string[] {
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
