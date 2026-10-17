import type { DesignBrief, FloorPlan, Opening, PlanRoom, Point } from "@/lib/model/schema";
import { planWarnings } from "./checks";
import { roomLinks } from "./connect";
import type { Plans } from "./edit";
import type { PlanContext } from "./fromSketch";
import { leftNormal, pointInPolygon, polygonCenter, sub, unit } from "./geometry";
import { areaKind, roomSqft } from "./measure";
import { overruns } from "./setbacks";
import { hostSegment } from "./walls";

/**
 * One score for a whole floor plan, so the alternatives can be ranked and
 * their reasons can carry numbers: how close the rooms are to the brief and
 * how many wished-for connections are kept, south glass in the living spaces
 * less west glass, the building cost, how far past the setbacks the house
 * reaches, and how many things are left to check. The brief's priorities
 * change the weights (`priorityWeights`).
 */

export type Weights = { fit: number; sun: number; cost: number; setbacks: number; problems: number; quiet: number };
export const DEFAULT_WEIGHTS: Weights = { fit: 3, sun: 2, cost: 2, setbacks: 3, problems: 4, quiet: 0 };

export type ScoreContext = PlanContext & {
  /** The land and where the house sits on it, for the land checks in Things to check. */
  land?: { plot: PlanContext["plot"]; offset: Point } | null;
  /** The likely building cost of a set of plans (the cost panel's estimate), or null when it can't be priced. */
  costOf?: (plans: Plans) => number | null;
  weights?: Weights;
};

export type PlanScore = {
  /** Rooms with a brief size, and how far off it they are on average (0.1 = 10%). */
  sized: number;
  offBrief: number;
  /** Brief rooms within 10% of their brief size, by name. */
  matching: string[];
  /** The brief's connections, and how many have a door or opening between the two rooms. */
  connections: number;
  kept: number;
  /** Sq ft of glass facing south in living spaces, and facing west anywhere. */
  southGlass: number;
  westGlass: number;
  /** Sq ft of east glass in bedrooms, for morning sun. */
  morningGlass: number;
  /** Likely building cost, or null. */
  cost: number | null;
  /** Inches the house reaches past the setbacks or lot lines, added up over the sides it crosses. */
  pastSetbacks: number;
  /** Things to check. */
  problems: number;
  /** Average distance (ft) from each bedroom to the garage and kitchen, or null without both. */
  quietFt: number | null;
  total: number;
};

const LIVING = new Set(["living", "family", "dining", "great-room", "sunroom", "kitchen"]);
const BEDROOMS = new Set(["bedroom", "primary-bedroom", "guest-suite"]);
const NOISY = new Set(["garage", "kitchen"]);
/** Doors of these styles are mostly glass. */
const GLASS_DOORS = new Set(["door-slider", "door-french"]);

/** Points for each part, before the weights: 10% closer to the brief, 1 connection, 20 sq ft of good glass (40 of morning glass), $5,000, 1 ft past a setback, 1 thing to check, 5 ft of quiet. */
function points(s: Omit<PlanScore, "total">) {
  return {
    fit: -s.offBrief * 10 + s.kept,
    sun: (s.southGlass - s.westGlass + s.morningGlass / 2) / 20,
    cost: s.cost === null ? 0 : -s.cost / 5000,
    setbacks: -s.pastSetbacks / 12,
    problems: -s.problems,
    quiet: (s.quietFt ?? 0) / 5,
  };
}

/** Which way an opening's wall faces, outward from its room. */
function facing(plan: FloorPlan, o: Opening): Point | null {
  if (!("roomId" in o.host)) return null;
  const seg = hostSegment(plan, o.host);
  return seg ? leftNormal(unit(sub(seg.b, seg.a))) : null;
}

/** Glass on outside walls, in sq ft: south-facing in living spaces, west-facing in any room, and east-facing in bedrooms. */
export function glassFacing(plans: Plans): { south: number; west: number; morning: number } {
  let south = 0;
  let west = 0;
  let morning = 0;
  for (const plan of Object.values(plans)) {
    const byId = new Map(plan.rooms.map((r) => [r.id, r]));
    for (const o of plan.openings) {
      if (o.kind !== "window" && !(o.kind === "door" && GLASS_DOORS.has(o.style))) continue;
      const room = "roomId" in o.host ? byId.get(o.host.roomId) : undefined;
      const n = facing(plan, o);
      if (!room || !n || !outsideWall(plan, room, o)) continue;
      const sqft = (o.widthIn * o.heightIn) / 144;
      if (n.y >= 0.5 && LIVING.has(room.type ?? "")) south += sqft;
      if (n.x <= -0.5) west += sqft;
      if (n.x >= 0.5 && BEDROOMS.has(room.type ?? "")) morning += sqft;
    }
  }
  return { south: Math.round(south), west: Math.round(west), morning: Math.round(morning) };
}

/** A window or glass door on a wall with no indoor room on the other side. */
function outsideWall(plan: FloorPlan, room: PlanRoom, o: Opening): boolean {
  if (o.kind === "window") return true;
  const n = facing(plan, o);
  const seg = hostSegment(plan, o.host);
  if (!n || !seg) return false;
  const u = unit(sub(seg.b, seg.a));
  const at = { x: seg.a.x + u.x * o.offsetIn + n.x * 12, y: seg.a.y + u.y * o.offsetIn + n.y * 12 };
  return !plan.rooms.some((r) => r.id !== room.id && areaKind(r) === "living" && pointInPolygon(at, r.polygon));
}

const allRooms = (plans: Plans) => Object.entries(plans).flatMap(([levelId, p]) => p.rooms.map((room) => ({ levelId, room, plan: p })));

/** How close the rooms are to their brief sizes, and how many of the brief's connections are kept. */
export function briefFit(plans: Plans, brief: DesignBrief | null) {
  const rooms = allRooms(plans);
  const offs: number[] = [];
  const matching: string[] = [];
  for (const b of brief?.rooms ?? []) {
    const found = rooms.filter((x) => x.room.briefRoomId === b.id);
    if (!found.length || !b.targetSqFt) continue;
    const have = found.reduce((n, x) => n + roomSqft(x.room), 0);
    const off = Math.abs(have - b.targetSqFt) / b.targetSqFt;
    offs.push(off);
    if (off <= 0.1) matching.push(found[0].room.name);
  }
  let connections = 0;
  let kept = 0;
  const links = new Map(Object.entries(plans).map(([id, p]) => [id, roomLinks(p)]));
  for (const e of brief?.adjacencies ?? []) {
    const a = rooms.find((x) => x.room.briefRoomId === e.a);
    const b = rooms.find((x) => x.room.briefRoomId === e.b);
    if (!a || !b) continue;
    connections++;
    if (a.levelId === b.levelId && links.get(a.levelId)?.get(a.room.id)?.has(b.room.id)) kept++;
  }
  return { sized: offs.length, offBrief: offs.length ? offs.reduce((s, x) => s + x, 0) / offs.length : 0, matching, connections, kept };
}

/** Average distance (ft) from each bedroom to the garage and kitchen on its floor. */
export function quietFt(plans: Plans): number | null {
  const ds: number[] = [];
  for (const plan of Object.values(plans)) {
    const noisy = plan.rooms.filter((r) => NOISY.has(r.type ?? "")).map((r) => polygonCenter(r.polygon));
    if (!noisy.length) continue;
    for (const bed of plan.rooms.filter((r) => BEDROOMS.has(r.type ?? ""))) {
      const c = polygonCenter(bed.polygon);
      ds.push(Math.min(...noisy.map((n) => Math.hypot(n.x - c.x, n.y - c.y))) / 12);
    }
  }
  return ds.length ? Math.round(ds.reduce((s, x) => s + x, 0) / ds.length) : null;
}

export function scorePlan(plans: Plans, ctx: ScoreContext): PlanScore {
  const fit = briefFit(plans, ctx.brief);
  const glass = glassFacing(plans);
  const limits = ctx.limits ?? [];
  const pastSetbacks = limits.length
    ? Object.values(plans).reduce((n, p) => n + overruns(p.rooms.filter((r) => areaKind(r) !== "outdoor").flatMap((r) => r.polygon), limits).reduce((t, o) => t + o.byIn, 0), 0)
    : 0;
  const problems = ctx.basics ? planWarnings(plans, { levels: ctx.levels, brief: ctx.brief, basics: ctx.basics, land: ctx.land, limits }).length : 0;
  const s: Omit<PlanScore, "total"> = {
    ...fit,
    southGlass: glass.south,
    westGlass: glass.west,
    morningGlass: glass.morning,
    cost: ctx.costOf ? ctx.costOf(plans) : null,
    pastSetbacks: Math.round(pastSetbacks),
    problems,
    quietFt: quietFt(plans),
  };
  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  const p = points(s);
  const total = (Object.keys(p) as (keyof Weights)[]).reduce((n, k) => n + w[k] * p[k], 0);
  return { ...s, total: Math.round(total * 10) / 10 };
}

// ---------- Priorities ----------

/** Brief priorities about the land itself (a rock, the road, trees) don't steer the rooms. */
const ABOUT_THE_LAND = /\b(rock|lane|road|street|trees?|walkout|views?|corner lot)\b/i;

const KEYWORDS: { re: RegExp; apply: (w: Weights) => Weights }[] = [
  { re: /\b(sun|light|bright)/i, apply: (w) => ({ ...w, sun: w.sun * 2 }) },
  { re: /\b(budget|cost|afford)/i, apply: (w) => ({ ...w, cost: w.cost * 2 }) },
  { re: /\b(space|big|room)/i, apply: (w) => ({ ...w, fit: w.fit * 1.5 }) },
  { re: /\b(quiet|privacy|private)/i, apply: (w) => ({ ...w, quiet: Math.max(w.quiet, 2) }) },
];

/**
 * The score weights from the brief's priorities, and the priorities that
 * changed them (to say "Ranked for: …"). Each kind of keyword counts once.
 */
export function priorityWeights(priorities: string[] = [], base: Weights = DEFAULT_WEIGHTS): { weights: Weights; rankedFor: string[] } {
  let weights = base;
  const rankedFor: string[] = [];
  for (const k of KEYWORDS) {
    const hit = priorities.find((p) => k.re.test(p) && !ABOUT_THE_LAND.test(p));
    if (!hit) continue;
    weights = k.apply(weights);
    if (!rankedFor.includes(hit)) rankedFor.push(hit);
  }
  return { weights, rankedFor };
}

// ---------- Comparing ----------

const money = (n: number) => `$${Math.round(Math.abs(n) / 100) * 100 >= 1000 ? (Math.round(Math.abs(n) / 100) * 100).toLocaleString("en-US") : Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What an alternative changes, in numbers, biggest first (by how much each
 * moves the score): "+38 sq ft south glass", "saves $4,100", "living room
 * now matches your brief".
 */
export function compareScores(now: PlanScore, alt: PlanScore, weights: Weights = DEFAULT_WEIGHTS): string[] {
  const out: { text: string; weight: number }[] = [];
  const push = (text: string, weight: number) => text && Math.abs(weight) > 0.001 && out.push({ text, weight: Math.abs(weight) });
  const pn = points(now);
  const pa = points(alt);

  const south = alt.southGlass - now.southGlass;
  if (Math.abs(south) >= 1) push(`${south > 0 ? "+" : "−"}${Math.abs(south)} sq ft south glass`, (weights.sun * south) / 20);
  const west = alt.westGlass - now.westGlass;
  if (Math.abs(west) >= 1) push(`${west > 0 ? "+" : "−"}${Math.abs(west)} sq ft west glass`, (weights.sun * west) / 20);
  const morning = alt.morningGlass - now.morningGlass;
  if (Math.abs(morning) >= 1) push(`${morning > 0 ? "+" : "−"}${Math.abs(morning)} sq ft morning glass in bedrooms`, (weights.sun * morning) / 40);
  if (alt.cost !== null && now.cost !== null && Math.abs(alt.cost - now.cost) >= 100) {
    const d = alt.cost - now.cost;
    push(d > 0 ? `+${money(d)}` : `saves ${money(d)}`, weights.cost * (pa.cost - pn.cost));
  }
  const newlyMatching = alt.matching.filter((n) => !now.matching.includes(n));
  const kept = alt.kept - now.kept;
  const fitMove = weights.fit * (pa.fit - pn.fit);
  if (newlyMatching.length === 1) push(`${newlyMatching[0].toLowerCase()} now matches your brief`, fitMove);
  else if (newlyMatching.length > 1) push(`${newlyMatching.length} more rooms match your brief`, fitMove);
  else if (kept) push(kept > 0 ? `+${plural(kept, "connection", "connections")} from your brief` : `${plural(-kept, "connection", "connections")} from your brief lost`, fitMove);
  else if (Math.round(Math.abs(alt.offBrief - now.offBrief) * 100) >= 1) {
    const d = Math.round((now.offBrief - alt.offBrief) * 100);
    push(`rooms ${Math.abs(d)}% ${d > 0 ? "closer to" : "further from"} your brief`, fitMove);
  }
  const past = alt.pastSetbacks - now.pastSetbacks;
  if (Math.abs(past) >= 6) push(alt.pastSetbacks === 0 ? "stays inside the setbacks" : `${Math.round(Math.abs(past) / 12)} ft ${past > 0 ? "further past" : "back from"} a setback`, (weights.setbacks * past) / 12);
  const problems = alt.problems - now.problems;
  if (problems) push(problems > 0 ? `${plural(problems, "new thing", "new things")} to check` : `${plural(-problems, "fewer thing", "fewer things")} to check`, weights.problems * problems);
  if (alt.quietFt !== null && now.quietFt !== null && Math.abs(alt.quietFt - now.quietFt) >= 3) {
    const d = alt.quietFt - now.quietFt;
    push(`bedrooms ${Math.abs(d)} ft ${d > 0 ? "farther from" : "closer to"} the garage and kitchen`, Math.max(weights.quiet, 0.5) * (d / 5));
  }
  return out.sort((a, b) => b.weight - a.weight).map((x) => x.text);
}

/** Every number in a score, for the "Why this?" line. */
export function scoreDetails(s: PlanScore): string {
  const parts: string[] = [];
  if (s.sized) parts.push(`rooms ${Math.round(s.offBrief * 100)}% off your brief on average`);
  if (s.connections) parts.push(`${s.kept} of ${s.connections} brief connections`);
  parts.push(`${s.southGlass} sq ft south glass`, `${s.westGlass} sq ft west glass`);
  if (s.morningGlass) parts.push(`${s.morningGlass} sq ft east glass in bedrooms`);
  if (s.cost !== null) parts.push(`about ${money(s.cost)} to build`);
  parts.push(s.pastSetbacks ? `${Math.round(s.pastSetbacks / 12)} ft past the setbacks` : "inside the setbacks");
  parts.push(plural(s.problems, "thing", "things") + " to check");
  if (s.quietFt !== null) parts.push(`bedrooms ${s.quietFt} ft from the garage and kitchen`);
  return parts.join(" · ");
}
