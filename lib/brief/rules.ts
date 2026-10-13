import type { DesignBrief, DiscoveryAnswers, FollowUp, Plot, Profile } from "@/lib/model/schema";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import { EXTRA_ROOM_OPTIONS, OUTDOOR_OPTIONS, isHeated, roomType } from "./rooms";
import type { BriefLevelId } from "./levels";

/** Everything the brief is built from. */
export type BriefContext = {
  answers: DiscoveryAnswers;
  profile: Profile;
  plot: Plot | null;
  followUps: FollowUp[];
};

type Room = DesignBrief["rooms"][number];
type Adjacency = DesignBrief["adjacencies"][number];

const ONE_FLOOR = "Everything needed on one floor";
const SIDE_NAME = { N: "north", E: "east", S: "south", W: "west" } as const;
const WATER_NAME = { creek: "creek", pond: "pond", lake: "lake", wash: "wash" } as const;

/** A short, stable id made from a room name, like "bedroom-2". */
export function roomIdFromName(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export function wantsBasement(answers: DiscoveryAnswers, plot: Plot | null): boolean {
  if (answers.basement === "yes") return true;
  if (answers.basement === "no") return false;
  if (!plot) return false;
  const f = plotImplications(plot).foundation.type;
  return f === "walkout" || f === "stepped";
}

/** Rounds to the nearest 5 sq ft. */
function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

const GARAGE_SQFT = [0, 288, 528, 792, 1056];

/**
 * A complete Design Brief from the answers using simple rules. Used when no
 * API key is set, when Claude can't be reached, and as the starting draft
 * Claude refines.
 */
export function buildRuleBrief(ctx: BriefContext): DesignBrief {
  const { answers: a, profile, plot } = ctx;
  const basement = wantsBasement(a, plot);
  const oneFloor = a.accessibility.includes(ONE_FLOOR);
  const floors = a.floors;
  const upper: BriefLevelId = floors >= 2 ? "upper" : "main";
  const size = 0.92 + (a.cozyAiry / 100) * 0.2;
  const entertaining = a.quietEntertaining > 65;

  const rooms: Room[] = [];
  const ids = new Set<string>();
  const add = (type: string, name: string, levelId: BriefLevelId, opts: { sqft?: number; notes?: string } = {}) => {
    const t = roomType(type);
    const sqft = opts.sqft ?? t.sqft * (isHeated(type) ? size : 1);
    const room: Room = { id: roomIdFromName(name, ids), type, name, targetSqFt: round5(sqft), levelId };
    if (opts.notes) room.notes = opts.notes;
    rooms.push(room);
    return room;
  };

  // Living spaces
  add("entry", "Entry", "main");
  add("living", "Living room", "main", entertaining ? { sqft: 380 * size } : {});
  const kitchenNotes = {
    open: "Open to the living room",
    semi: "Partly open, with a wide opening to the living room",
    closed: "Its own room",
  }[a.kitchen];
  add("kitchen", "Kitchen", "main", {
    sqft: (220 + (a.dining === "eat-in" ? 60 : 0) + (entertaining ? 40 : 0)) * size,
    notes:
      a.dining === "eat-in"
        ? `${kitchenNotes}. Eat-in table.`
        : a.pantry === "cabinet"
          ? `${kitchenNotes}. Pantry cabinet.`
          : kitchenNotes,
  });
  if (a.dining !== "eat-in") {
    add("dining", "Dining", "main", {
      sqft: (entertaining ? 200 : 160) * size,
      notes: a.dining === "separate" ? "Its own room" : "Open to the kitchen",
    });
  }
  if (a.pantry === "walk-in") add("pantry", "Walk-in pantry", "main");

  // Bedrooms and baths
  const primaryLevel: BriefLevelId =
    floors === 1 || oneFloor || a.primarySuite !== "upper" ? "main" : "upper";
  const otherBedroomLevel: BriefLevelId = oneFloor ? "main" : upper;
  if (a.bedrooms > 0) {
    add("primary-bedroom", "Primary bedroom", primaryLevel);
    if (a.fullBaths > 0) add("primary-bath", "Primary bath", primaryLevel);
    add("primary-closet", "Primary closet", primaryLevel, { notes: "Walk-in" });
  }
  const wingNote =
    a.bedroomPrivacy === "separate-wing"
      ? "In a separate wing from the primary suite"
      : a.bedroomPrivacy === "split" && primaryLevel === otherBedroomLevel
        ? "On the other side of the house from the primary suite"
        : undefined;
  for (let i = 2; i <= a.bedrooms; i++) add("bedroom", `Bedroom ${i}`, otherBedroomLevel, { notes: wingNote });

  const otherBaths = Math.max(0, a.fullBaths - (a.bedrooms > 0 ? 1 : 0));
  for (let i = 0; i < otherBaths; i++) {
    // The first extra bath serves the other bedrooms; any more go on the main floor for guests.
    const level = i === 0 ? otherBedroomLevel : "main";
    add("bathroom", otherBaths === 1 ? "Hall bath" : `Bathroom ${i + 2}`, level);
  }
  for (let i = 0; i < a.halfBaths; i++) add("half-bath", a.halfBaths === 1 ? "Powder room" : `Powder room ${i + 1}`, "main");

  // Work and service rooms
  for (let i = 0; i < a.offices; i++) add("office", a.offices === 1 ? "Office" : `Office ${i + 1}`, "main");
  if (a.mudroom) add("mudroom", "Mudroom", "main", { notes: a.garageBays > 0 ? "Between the garage and the kitchen" : undefined });
  const laundryLevel: BriefLevelId =
    a.laundry === "basement" && basement ? "basement" : a.laundry === "near-bedrooms" ? (oneFloor ? "main" : primaryLevel) : "main";
  add("laundry", "Laundry", laundryLevel, {
    notes: a.laundry === "off-mudroom" ? "Off the mudroom" : a.laundry === "near-bedrooms" ? "Near the bedrooms" : undefined,
  });
  const storageSqft = { light: 30, average: 60, lots: 140 }[a.storage];
  add("storage", "Storage", basement ? "basement" : "main", { sqft: storageSqft });
  add("mechanical", "Mechanical room", basement ? "basement" : "main", { sqft: basement ? 80 : 40 });

  // Extra rooms
  const downstairs = new Set(["bonus", "media", "gym", "workshop", "playroom", "guest-suite", "craft"]);
  for (const label of a.extraRooms) {
    const opt = EXTRA_ROOM_OPTIONS.find((o) => o.label === label);
    const type = opt?.type ?? "other";
    let level: BriefLevelId = "main";
    if (basement && downstairs.has(type)) level = "basement";
    else if (type === "bonus" && floors >= 2) level = "upper";
    add(type, label, level, type === "workshop" && a.garageBays > 0 && level === "main" ? { notes: "Next to the garage" } : {});
  }
  if (basement && a.basement === "yes" && !rooms.some((r) => r.levelId === "basement" && isHeated(r.type) && r.type !== "storage" && r.type !== "mechanical")) {
    add("family", "Rec room", "basement");
  }

  // Garage and outdoor spaces
  if (a.garageBays > 0) {
    add("garage", a.garageBays === 1 ? "One-car garage" : `${a.garageBays}-car garage`, "main", {
      sqft: GARAGE_SQFT[Math.min(a.garageBays, 4)],
    });
  }
  const outdoorScale = a.indoorOutdoor === "lots" ? 1.3 : a.indoorOutdoor === "low" ? 0.8 : 1;
  for (const label of a.outdoor) {
    const opt = OUTDOOR_OPTIONS.find((o) => o.label === label);
    const type = opt?.type ?? "patio";
    add(type, label, "main", { sqft: roomType(type).sqft * outdoorScale });
  }

  return {
    rooms,
    adjacencies: ruleAdjacencies(rooms, a),
    floors,
    basement,
    garageBays: a.garageBays,
    openKitchen: a.kitchen !== "closed",
    primarySuiteLevel: a.bedrooms > 0 ? primaryLevel : undefined,
    vibe: ruleVibe(a),
    priorities: rulePriorities(ctx, basement),
    accessibility: [...a.accessibility],
    freeText: ruleFreeText(ctx),
    summary: ruleSummary(ctx, rooms, basement, profile),
    source: "rules",
  };
}

function ruleAdjacencies(rooms: Room[], a: DiscoveryAnswers): Adjacency[] {
  const out: Adjacency[] = [];
  const all = (type: string) => rooms.filter((r) => r.type === type);
  const first = (type: string) => all(type)[0];
  const link = (x: Room | undefined, y: Room | undefined, strength: Adjacency["strength"]) => {
    if (!x || !y || x.id === y.id) return;
    if (out.some((e) => (e.a === x.id && e.b === y.id) || (e.a === y.id && e.b === x.id))) return;
    out.push({ a: x.id, b: y.id, strength });
  };
  const open = a.kitchen !== "closed";

  link(first("entry"), first("living"), open ? "must" : "nice");
  link(first("kitchen"), first("dining"), "must");
  link(first("kitchen"), first("living"), open ? "must" : "nice");
  link(first("kitchen"), first("family"), "must");
  link(first("kitchen"), first("pantry"), "must");
  link(first("garage"), first("mudroom"), "must");
  link(first("mudroom"), first("kitchen"), "nice");
  if (!first("mudroom")) link(first("garage"), first("kitchen"), "nice");
  if (a.laundry === "off-mudroom") link(first("laundry"), first("mudroom"), "must");
  else if (a.laundry === "near-bedrooms") {
    const closet = first("primary-closet");
    if (closet && closet.levelId === first("laundry")?.levelId) link(first("laundry"), closet, "nice");
  }
  link(first("primary-bedroom"), first("primary-bath"), "must");
  link(first("primary-bath"), first("primary-closet"), "must");
  if (a.bedroomPrivacy !== "together") {
    for (const b of all("bedroom")) {
      if (b.levelId === first("primary-bedroom")?.levelId) link(first("primary-bedroom"), b, "avoid");
    }
  } else {
    for (const b of all("bedroom")) link(first("primary-bedroom"), b, "nice");
  }
  if (all("bedroom").length) link(all("bedroom")[0], first("bathroom"), "must");
  link(first("half-bath"), first("entry"), "nice");
  for (const o of all("office")) {
    if (a.quietEntertaining > 60) link(o, first("living"), "avoid");
    link(o, first("entry"), "nice");
  }
  for (const m of all("media")) for (const b of all("bedroom")) if (b.levelId === m.levelId) link(m, b, "avoid");
  const outdoorStrength = a.indoorOutdoor === "lots" ? "must" : "nice";
  link(first("patio"), open ? first("living") : first("dining") ?? first("living"), outdoorStrength);
  link(first("deck"), first("kitchen"), outdoorStrength);
  link(first("outdoor-kitchen"), first("kitchen"), "nice");
  link(first("porch"), first("entry"), "must");
  link(first("workshop"), first("garage"), "nice");
  return out;
}

function ruleVibe(a: DiscoveryAnswers): string[] {
  const words = [...a.styleWords];
  if (a.cozyAiry < 35) words.push("Cozy");
  if (a.cozyAiry > 65) words.push("Airy with tall ceilings");
  if (a.openDefined < 35) words.push("Open plan");
  if (a.openDefined > 65) words.push("Defined rooms");
  if (a.indoorOutdoor === "lots") words.push("Connected to the outdoors");
  return dedupe(words);
}

function rulePriorities(ctx: BriefContext, basement: boolean): string[] {
  const { answers: a, profile, plot } = ctx;
  const out: string[] = [];
  if (a.quietEntertaining > 65) out.push("Room to host and entertain");
  if (a.quietEntertaining < 35) out.push("Calm, quiet spaces");
  if (a.bedroomPrivacy === "separate-wing") out.push("Primary suite in its own wing");
  if (a.bedroomPrivacy === "split") out.push("Split bedrooms for privacy");
  if (a.indoorOutdoor === "lots") out.push("Easy indoor-outdoor living");
  if (a.storage === "lots") out.push("Plenty of storage");
  if (a.offices > 0 || (profile.workFromHome ?? 0) > 0) out.push("A quiet place to work");
  if ((profile.kids ?? 0) > 0) out.push("Kid-friendly spaces in view of the kitchen");
  if (profile.olderRelatives) out.push("A bedroom and full bath on the main floor");
  if (plot) {
    const imp = plotImplications(plot);
    if (imp.sun.rating === "excellent" || imp.sun.rating === "good") out.push("Living spaces on the sunny south side");
    else out.push("Bring in winter light with high south windows");
    for (const w of plot.waterFeatures) {
      if (w.kind !== "wash") out.push(`Views toward the ${WATER_NAME[w.kind]}`);
    }
    if (basement && imp.foundation.type !== "slab" && imp.foundation.type !== "crawlspace") {
      out.push(`Walkout basement on the ${compassName(plot.slope.downhillDeg)} (downhill) side`);
    }
    out.push(`Entry and garage on the ${SIDE_NAME[plot.roadSide]} side, facing the road`);
  }
  return dedupe(out);
}

function ruleFreeText(ctx: BriefContext): string | undefined {
  const parts: string[] = [];
  const { answers: a, followUps } = ctx;
  if (a.dailyRoutine.trim()) parts.push(`A typical day: ${a.dailyRoutine.trim()}`);
  if (a.anythingElse.trim()) parts.push(a.anythingElse.trim());
  for (const f of followUps) if (f.answer.trim()) parts.push(`${f.question} ${f.answer.trim()}`);
  return parts.length ? parts.join("\n\n") : undefined;
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
  return { rooms: heated, heated: round5(heated * 1.15), garage, outdoor };
}

function ruleSummary(ctx: BriefContext, rooms: Room[], basement: boolean, profile: Profile): string {
  const a = ctx.answers;
  const { heated } = briefTotals({ rooms });
  const floors = a.floors === 1 ? "single-story" : a.floors === 2 ? "two-story" : "three-story";
  const baths = a.fullBaths + (a.halfBaths ? 0.5 * a.halfBaths : 0);
  const feel = ruleVibe(a).slice(0, 3).join(", ").toLowerCase();
  const who = profile.ownerName ? `${profile.ownerName}'s` : "A";
  return (
    `${who} ${floors} house${basement ? " with a basement" : ""}: ${a.bedrooms} bedrooms, ${baths} baths, ` +
    `about ${heated.toLocaleString("en-US")} sq ft of living space` +
    (a.garageBays ? ` and a ${a.garageBays}-car garage` : "") +
    "." +
    (feel ? ` The feel: ${feel}.` : "")
  );
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const t = s.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
export { dedupe as dedupeWords };
