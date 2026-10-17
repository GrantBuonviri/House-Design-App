import type { DesignBrief, FloorPlan, Level, Opening, PlanBasics, PlanRoom, Plot, Point } from "@/lib/model/schema";
import { landUnder } from "@/lib/land/onLot";
import { placeName } from "@/lib/land/implications";
import { formatFeetInches } from "@/lib/model/units";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { INTERIOR_WALL_IN, ceilingFor, levelAbove, levelBelow, riseBetween } from "./basics";
import { OUTSIDE, openingRooms, reachable, roleOf, roomLinks } from "./connect";
import { planOf, type Plans } from "./edit";
import { dist, edgesOf, isRectangle, polygonCenter, polygonsOverlap, scale, add, sub } from "./geometry";
import { areaKind, roomSqft } from "./measure";
import { MIN_STAIRS_WIDTH_IN, stackedHeadroom } from "./stairs";
import { codeNum, codeSetKey } from "@/lib/codes/data";
import { escapeCheck, glassSqft, openableSqft, operationOf } from "@/lib/codes/openings";
import { clearSqft, clearWidthIn, isHabitable } from "@/lib/codes/rules";
import { windowWells } from "./wells";
import { findGaps, type Gap } from "./overlaps";
import { isWayIn, stairsBoxes, stairsFootprints, wayInRooms } from "./suggest";
import { CANTILEVER_MAX_IN, overhangsOf, pulledBack, supportOf } from "./support";
import { flatPlans } from "./flatten";
import { overruns, type SetbackLimit } from "./setbacks";
import { tooWideForCurve } from "./bend";
import { pointOnEdge } from "./arcs";
import { hostSegment, openingGeometry, type OpeningGeometry } from "./walls";
import { listHits, swingClear, swingRoom, type SwingExtras } from "./swing";
import { cabinetCorners, cabinetLayout } from "./cabinets";
import { fixtureType, openingType } from "./catalog";
import { furnishProblems, type LayerKind } from "@/lib/furnish/layer";
import { FAUCET_KIND } from "@/lib/furnish/faucets";
import { leftoverClosets } from "@/lib/furnish/closets";

/**
 * Friendly checks on a floor plan: rooms you can't get into, bedrooms without
 * a window, narrow hallways, missing stairs, rooms far from the size the
 * brief asked for. Each is tagged "code" (something a building inspector
 * checks) or "comfort" (a guideline for a house that works well, or a drawing
 * to tidy up).
 */

export type WarningTag = "code" | "comfort";

export type PlanWarning = {
  id: string;
  levelId: string;
  text: string;
  /** "code": an inspector checks it. "comfort": a guideline for a comfortable house. */
  tag: WarningTag;
  /** Rooms to select when the warning is clicked. */
  roomIds: string[];
  /** Where to look on the drawing, if anywhere in particular. */
  at: Point | null;
  /** Two rooms a few inches apart: the "Close gap" button pushes them together. */
  gap?: Gap;
  /** A room hanging past the floor below: the "Pull back" button trims it to fit. */
  pullBack?: { roomId: string };
  /** Stairs stacked too tight: the "Make these U-shaped" button turns both into U-shaped stairs in the same spot. */
  stairsU?: { lower: { levelId: string; id: string }; upper: { levelId: string; id: string } };
  /** A Furnish item that lost its spot: "Move inside" (when it can) and "Delete" buttons. */
  furnish?: { kind: LayerKind; id: string; canMoveInside: boolean };
  /** A bedroom (or basement) with no window to climb out of: "Make this an escape window". */
  escape?: { roomId: string };
  /** A closet piece whose rod and shelf were deleted in Furnish: "Remove the closet walls" (on the floor plan). */
  closetWalls?: { stem: string };
  /** A sink, tub or shower whose faucet was taken off in Furnish: "Put the faucet back". */
  noFaucet?: { fixtureId: string };
  /** A door whose swing hits something: "Flip the swing" and "Switch to a pocket door". */
  swing?: { openingId: string };
};

/** What a door's swing shouldn't hit on a level beyond the plan's own fixtures, rooms and doors: the stairs and the kitchen cabinets. */
export function swingExtras(plans: Plans, ctx: Pick<Ctx, "levels" | "basics">, level: Level): SwingExtras {
  const plan = planOf(plans, level.id);
  return {
    stairs: stairsFootprints(plans, ctx, level),
    cabinets: cabinetLayout(plan, ceilingFor(ctx.basics, level)).cabinets.map((c) => ({ outline: cabinetCorners(c), label: "the cabinets" })),
  };
}

const SHAPE_NAME = { straight: "straight", l: "L-shaped", u: "U-shaped" } as const;

/** "Make these U-shaped": both stairs become U-shaped in the same spot, the upper one turned the same way as the lower so the flights stack. */
export function makeStairsU(plans: Plans, fix: NonNullable<PlanWarning["stairsU"]>): Plans {
  const lower = planOf(plans, fix.lower.levelId).stairs.find((s) => s.id === fix.lower.id);
  if (!lower) return plans;
  const set = (levelId: string, id: string, patch: Partial<FloorPlan["stairs"][number]>) => {
    const p = planOf(plans, levelId);
    return { ...p, stairs: p.stairs.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
  };
  const next = { ...plans, [fix.lower.levelId]: set(fix.lower.levelId, fix.lower.id, { shape: "u" }) };
  return { ...next, [fix.upper.levelId]: set(fix.upper.levelId, fix.upper.id, { shape: "u", rotation: lower.rotation, flip: lower.flip }) };
}

const BEDROOMS = new Set(["bedroom", "primary-bedroom", "guest-suite"]);
/** Below this, a hallway feels tight (inside, wall to wall). */
export const MIN_HALL_CLEAR_IN = 36;
/** Rooms this far from the brief's size get a note (and at least 20 to 30 sq ft off, so small rooms aren't flagged for a few feet). */
const TOO_SMALL = 0.75;
const TOO_BIG = 1.4;

/** Warning kinds (the part of the id after the floor) that a building inspector checks. Everything else is "comfort". */
const CODE_KINDS = new Set(["egress", "egress-basement", "setback", "light", "code-area", "code-width", "headroom", "stairwidth", "narrow", "overhang", "nofront", "land:lot"]);
/** The tag for a warning, from its key (its id without the floor). */
export function tagOf(key: string): WarningTag {
  const [kind, sub] = key.split(":");
  return CODE_KINDS.has(kind) || CODE_KINDS.has(`${kind}:${sub}`) ? "code" : "comfort";
}

type Ctx = {
  levels: Level[];
  brief: DesignBrief | null;
  basics: PlanBasics | null;
  /** The land and where the house sits on it (plot point = plan point + offset), for the land checks. */
  land?: { plot: Plot | null; offset: Point } | null;
  /** How far inside the lot lines the house has to stay (see lib/plans/lot.ts `setbackLimits`). */
  limits?: SetbackLimit[];
};

export function planWarnings(plans: Plans, ctx: Ctx): PlanWarning[] {
  const saved = plans;
  plans = flatPlans(plans);
  const out: PlanWarning[] = [];
  const levels = [...ctx.levels].sort((a, b) => a.elevationIn - b.elevationIn);
  for (const level of levels) out.push(...cachedLevelWarnings(saved, plans, ctx, levels, level));

  if (ctx.land?.plot) out.push(...landWarnings(plans, levels, ctx.land.plot, ctx.land.offset));

  // Rooms from the brief that aren't drawn anywhere yet.
  if (ctx.brief && levels.some((l) => planOf(plans, l.id).rooms.length)) {
    const drawn = new Set(levels.flatMap((l) => planOf(plans, l.id).rooms.map((r) => r.briefRoomId)));
    for (const b of ctx.brief.rooms) {
      if (drawn.has(b.id)) continue;
      const levelId = b.levelId && levels.some((l) => l.id === b.levelId) ? b.levelId : MAIN_LEVEL_ID;
      out.push({ id: `${levelId}:missing:${b.id}`, levelId, tag: "comfort", text: `${b.name} from your brief isn't in the plan yet.`, roomIds: [], at: null });
    }
  }
  return out;
}

/**
 * One floor's warnings are kept and reused while nothing they look at has
 * changed: the floor itself, the stairs and support from the floor below,
 * whether the floor above has rooms and stairs, the main floor over a
 * basement, and the brief, basics, setbacks and code in force.
 */
type LevelEntry = { deps: unknown[]; out: PlanWarning[] };
const levelCache = new Map<string, LevelEntry[]>();
/** Entries kept per floor: enough for the plan, Furnish and a few alternatives being scored. */
const KEEP_PER_LEVEL = 8;

function levelDeps(saved: Plans, ctx: Ctx, levels: Level[], level: Level): unknown[] {
  const below = levelBelow(levels, level);
  const above = levelAbove(levels, level);
  const ground = level.kind === "main" || level.kind === "basement";
  return [
    saved[level.id],
    below ? (ground ? saved[below.id]?.stairs : saved[below.id]) : null,
    above ? (saved[above.id]?.rooms.length ?? 0) > 0 : null,
    above ? saved[above.id]?.stairs : null,
    // Headroom looks at the stairs on whatever floor these stairs go up to.
    ...(saved[level.id]?.stairs ?? []).map((s) => (s.toLevelId ? saved[s.toLevelId]?.stairs : null)),
    ...(level.kind === "basement" ? levels.filter((l) => l.kind === "main").map((l) => saved[l.id]?.rooms) : []),
    ctx.levels,
    ctx.brief,
    ctx.basics,
    JSON.stringify(ctx.limits ?? []),
    codeSetKey(),
  ];
}

function cachedLevelWarnings(saved: Plans, plans: Plans, ctx: Ctx, levels: Level[], level: Level): PlanWarning[] {
  const deps = levelDeps(saved, ctx, levels, level);
  const list = levelCache.get(level.id) ?? [];
  const i = list.findIndex((e) => e.deps.length === deps.length && e.deps.every((d, k) => d === deps[k]));
  if (i >= 0) {
    const [hit] = list.splice(i, 1);
    list.unshift(hit);
    return hit.out;
  }
  const out = levelWarnings(saved, plans, ctx, levels, level);
  list.unshift({ deps, out });
  if (list.length > KEEP_PER_LEVEL) list.pop();
  levelCache.set(level.id, list);
  return out;
}

function levelWarnings(saved: Plans, plans: Plans, ctx: Ctx, levels: Level[], level: Level): PlanWarning[] {
  const out: PlanWarning[] = [];
  const add_ = (levelId: string, key: string, text: string, rooms: PlanRoom[] = [], at?: Point | null) =>
    out.push({ id: `${levelId}:${key}`, levelId, tag: tagOf(key), text, roomIds: rooms.map((r) => r.id), at: at === undefined ? (rooms[0] ? polygonCenter(rooms[0].polygon) : null) : at });
  const plan = planOf(plans, level.id);
  if (!plan.rooms.length) return out;
  const links = roomLinks(plan);
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  const doors = (r: PlanRoom) => [...(links.get(r.id) ?? [])];

  // Rooms drawn on top of each other.
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i];
      const b = plan.rooms[j];
      if (polygonsOverlap(a.polygon, b.polygon)) add_(level.id, `overlap:${a.id}:${b.id}`, `${a.name} and ${b.name} overlap.`, [a, b], scale(add(polygonCenter(a.polygon), polygonCenter(b.polygon)), 0.5));
    }
  }

  // Rooms left a few inches apart.
  for (const g of findGaps(plan)) {
    const a = byId.get(g.aId)!;
    const b = byId.get(g.bId)!;
    add_(level.id, `gap:${a.id}:${b.id}`, `${a.name} and ${b.name} are ${formatFeetInches(g.gapIn)} apart.`, [a, b], g.at);
    out[out.length - 1].gap = g;
  }

  // Doors and windows are flat, so a tight curve can't take a wide one.
  for (const w of tooWideForCurve(planOf(saved, level.id))) {
    const o = w.opening;
    const seg = hostSegment(planOf(saved, level.id), o.host);
    const at = seg ? pointOnEdge(seg.a, seg.b, seg.bulge ?? 0, o.offsetIn) : null;
    const host = "roomId" in o.host ? byId.get(o.host.roomId) : undefined;
    const label = openingType(o.style).label;
    const fix = w.fits >= 12 ? `Try one ${formatFeetInches(w.fits)} wide or less` : "Make the curve gentler";
    add_(level.id, `curvewide:${o.id}`, `${label} too wide for this curve: it's ${formatFeetInches(o.widthIn)} across but the wall bends away from it. ${fix}.`, host ? [host] : [], at);
  }

  // Doors and windows that run into each other, past the end of their wall, or up through the ceiling.
  for (const p of openingProblems(planOf(saved, level.id), ceilingFor(ctx.basics, level))) {
    const host = p.roomId ? byId.get(p.roomId) : undefined;
    add_(level.id, p.key, p.text, host ? [host] : [], p.at);
  }

  // Rooms hanging past the outside walls of the floor below.
  const support = supportOf(plans, levels, level);
  if (support) {
    for (const o of overhangsOf(plan.rooms, support.regions)) {
      if (o.ok) continue;
      const r = byId.get(o.roomId)!;
      const past = `${r.name} hangs ${formatFeetInches(o.depthIn)} past the outside wall of the ${support.below.name.toLowerCase()}.`;
      const why = o.kind === "cantilever" ? ` That's more than a short cantilever's ${formatFeetInches(CANTILEVER_MAX_IN)}: set it to On posts or Engineered, or pull it back.` : " Nothing holds it up.";
      add_(level.id, `overhang:${r.id}`, past + why, [r], o.at);
      if (pulledBack(r, support.regions)) out[out.length - 1].pullBack = { roomId: r.id };
    }
  }

  // No way in at all.
  const noDoor = plan.rooms.filter((r) => doors(r).length === 0);
  for (const r of noDoor) add_(level.id, `nodoor:${r.id}`, `${r.name} has no door or opening.`, [r]);

  // A way in from outside on the main floor.
  if (level.id === MAIN_LEVEL_ID || level.kind === "main") {
    const outdoor = new Set(plan.rooms.filter((r) => areaKind(r) === "outdoor").map((r) => r.id));
    // The garage door doesn't count: people come in through a front door.
    const toOutside = plan.rooms.some((r) => !outdoor.has(r.id) && roleOf(r) !== "garage" && doors(r).some((id) => id === OUTSIDE || outdoor.has(id)));
    if (!toOutside) add_(level.id, "nofront", "There's no front door yet. Add one with the Doors and windows tool, on an outside wall of the entry or a living space.", [], null);
  }

  // Rooms with doors that still can't be reached from the way in.
  const seeds = wayInRooms(plan, stairsBoxes(plans, ctx, level));
  if (seeds.length) {
    const seen = reachable(plan, seeds);
    for (const r of plan.rooms) {
      if (seen.has(r.id) || noDoor.includes(r) || areaKind(r) === "outdoor") continue;
      add_(level.id, `cutoff:${r.id}`, `${r.name} can't be reached from the rest of the floor.`, [r]);
    }
  }

  // Bedrooms, offices and the like that you only get to through a bedroom.
  for (const r of plan.rooms) {
    if (roleOf(r) !== "private" || r.type === "bathroom" || r.type === "half-bath") continue;
    const next = doors(r)
      .filter((id) => id !== OUTSIDE)
      .map((id) => byId.get(id)!)
      .filter((n) => n.type !== "closet");
    if (!next.length || next.some((n) => isWayIn(n, r) || roleOf(n) === "outdoor")) continue;
    const via = next.filter((n) => BEDROOMS.has(n.type ?? "") || roleOf(n) === "suite");
    if (via.length === next.length) add_(level.id, `through:${r.id}`, `${r.name} can only be reached through ${via.map((n) => n.name).join(" or ")}.`, [r]);
  }

  // Bedrooms need a window you could climb out of: the same clear-opening math as the code check (lib/codes/openings.ts), so fixed windows never count.
  const below = level.kind === "basement";
  // Below ground, a window only gets you out with a well dug outside it (not where the main floor covers the ground).
  const wells = below ? new Set(windowWells(plans, levels, ctx.basics).map((w) => w.openingId)) : null;
  const escapes = (o: FloorPlan["openings"][number]) => escapeCheck(o, below).ok && (!wells || wells.has(o.id));
  const outsideDoor = (id: string | null) => plan.openings.some((o) => o.kind === "door" && openingRooms(plan, o).includes(null) && (id === null || openingRooms(plan, o).includes(id)));
  for (const r of plan.rooms.filter((x) => BEDROOMS.has(x.type ?? ""))) {
    if (outsideDoor(r.id)) continue;
    const windows = plan.openings.filter((o) => o.kind === "window" && openingRooms(plan, o).includes(r.id));
    if (windows.some(escapes)) continue;
    const opening = windows.filter((o) => operationOf(o) !== "fixed");
    if (!windows.length) add_(level.id, `egress:${r.id}`, `${r.name} has no window. A bedroom needs one you could climb out of in an emergency.`, [r]);
    else if (!opening.length) add_(level.id, `egress:${r.id}`, `${r.name}'s windows don't open, so there's no way to climb out in an emergency.`, [r]);
    else if (opening.every((o) => escapeCheck(o, below).ok)) add_(level.id, `egress:${r.id}`, `${r.name}'s windows are in walls buried under the floor above, so there's no room for a window well to climb out through.`, [r]);
    else add_(level.id, `egress:${r.id}`, `${r.name}'s windows don't open wide enough to climb out of in an emergency (${escapeCheck(opening.find((o) => !escapeCheck(o, below).ok)!, below).problems[0]}).`, [r]);
    out[out.length - 1].escape = { roomId: r.id };
  }
  // A basement with rooms to live in needs a way out: an escape window (with a well) or a door outside.
  if (below && plan.rooms.some((r) => isHabitable(r) && areaKind(r) === "living") && !outsideDoor(null) && !plan.openings.some((o) => o.kind === "window" && escapes(o))) {
    const big = [...plan.rooms].filter((r) => isHabitable(r) && areaKind(r) === "living").sort((a, b) => roomSqft(b) - roomSqft(a))[0];
    add_(level.id, "egress-basement", `The ${level.name.toLowerCase()} has no emergency escape window or door outside.`, [big]);
    out[out.length - 1].escape = { roomId: big.id };
  }

  // Rooms reaching past a setback or the lot line.
  for (const r of plan.rooms) {
    if (areaKind(r) === "outdoor") continue;
    const worst = overruns(r.polygon, ctx.limits ?? []).sort((a, b) => b.byIn - a.byIn)[0];
    if (!worst) continue;
    const side = worst.name.toLowerCase();
    add_(level.id, `setback:${r.id}`, worst.pastLine ? `${r.name} is ${formatFeetInches(worst.byIn)} past the ${side} lot line.` : `${r.name} is ${formatFeetInches(worst.byIn)} past the ${side} setback.`, [r], worst.point);
  }

  // Light and air (R303): glass of 8% of the floor and 4% opening. A soft note, since the code allows electric light and a whole-house fresh-air fan instead.
  if (plan.openings.some((o) => o.kind === "window")) {
    for (const r of plan.rooms) {
      if (areaKind(r) !== "living" || !isHabitable(r)) continue;
      const mine = plan.openings.filter((o) => openingRooms(plan, o).includes(r.id));
      const glass = mine.reduce((n, o) => n + glassSqft(o), 0);
      const open = mine.reduce((n, o) => n + openableSqft(o), 0);
      const floor = clearSqft(r);
      const needGlass = (floor * codeNum("light.glazingPctOfFloor")) / 100;
      const needOpen = (floor * codeNum("light.ventOpenablePctOfFloor")) / 100;
      const short: string[] = [];
      if (glass < needGlass) short.push(`${Math.round(glass)} sq ft of glass (it wants ${Math.round(needGlass)}, which is ${codeNum("light.glazingPctOfFloor")}% of the floor)`);
      if (open < needOpen) short.push(`${Math.round(open)} sq ft that opens (it wants ${Math.round(needOpen)}, which is ${codeNum("light.ventOpenablePctOfFloor")}%)`);
      if (short.length) add_(level.id, `light:${r.id}`, `${r.name} has ${short.join(" and ")}. More or bigger windows give it light and fresh air (R303).`, [r]);
    }
  }

  // Doors that hit something when they open: another door, a fixture or cabinet, the stairs, a closet or the far wall.
  const extras = swingExtras(plans, ctx, level);
  const warned = new Set<string>();
  for (const o of plan.openings) {
    if (o.kind !== "door" || !openingType(o.style).swings) continue;
    const c = swingClear(plan, o, extras);
    // Two doors that hit each other get one warning, on the first.
    const hits = c.hits.filter((h) => h !== "another door's swing" || c.doors.some((id) => !warned.has(id)));
    if (!hits.length) continue;
    warned.add(o.id);
    const g = openingGeometry(plan, o);
    const into = g ? swingRoom(plan, g) : null;
    const who = into ? `The door into ${into.name}` : "An outside door";
    add_(level.id, `swing:${o.id}`, `${who} hits ${listHits(hits)} when it opens.`, into ? [into] : [], g?.center ?? null);
    out[out.length - 1].swing = { openingId: o.id };
  }

  // The code's smallest rooms: 70 sq ft and 7' across inside the walls (kitchens excepted), the same as the code check.
  for (const r of plan.rooms.filter((x) => isHabitable(x) && x.type !== "kitchen" && areaKind(x) === "living")) {
    const a = clearSqft(r);
    const w = clearWidthIn(r);
    if (a < codeNum("rooms.minHabitableArea")) add_(level.id, `code-area:${r.id}`, `${r.name} is about ${Math.round(a)} sq ft inside the walls. Code wants rooms you live in to be at least ${codeNum("rooms.minHabitableArea")} sq ft.`, [r]);
    else if (w < codeNum("rooms.minHabitableDimension") - 0.5) add_(level.id, `code-width:${r.id}`, `${r.name} is ${formatFeetInches(Math.round(w))} across at the narrowest. Code wants at least ${formatFeetInches(codeNum("rooms.minHabitableDimension"))} inside the walls.`, [r]);
  }

  // Hallways at least 3 ft wide inside.
  for (const r of plan.rooms.filter((x) => x.type === "hall")) {
    if (!isRectangle(r.polygon)) continue;
    const clear = Math.min(...edgesOf(r.polygon).map((e) => dist(e.a, e.b))) - INTERIOR_WALL_IN;
    if (clear < MIN_HALL_CLEAR_IN - 0.5) add_(level.id, `narrow:${r.id}`, `${r.name} is ${formatFeetInches(Math.round(clear))} wide inside. Code wants hallways at least 3' wide.`, [r]);
  }

  // Stairs: some up to the next floor, and wide enough.
  const above = levelAbove(levels, level);
  if (above && planOf(plans, above.id).rooms.length && !plan.stairs.some((s) => s.toLevelId === above.id)) {
    add_(level.id, "nostairs", `There are no stairs up to the ${above.name.toLowerCase()} yet. Add them with the Stairs tool.`, [], null);
  }
  for (const s of plan.stairs) {
    const to = levels.find((l) => l.id === s.toLevelId);
    for (const u of to ? planOf(plans, to.id).stairs : []) {
      const up = levels.find((l) => l.id === u.toLevelId);
      if (!to || !up) continue;
      const room = stackedHeadroom(s, riseBetween(ctx.basics, level, to), u, riseBetween(ctx.basics, to, up));
      if (room >= codeNum("stairs.minHeadroom")) continue;
      const both = s.shape === u.shape ? `two ${SHAPE_NAME[s.shape]} stairs stacked on top of each other leave` : `the stairs up to the ${up.name.toLowerCase()} leave`;
      const canFix = s.shape !== "u" || u.shape !== "u" || (u.rotation ?? 0) !== (s.rotation ?? 0) || u.flip !== s.flip;
      out.push({
        id: `${level.id}:headroom:${s.id}:${u.id}`,
        levelId: level.id,
        tag: "code",
        text: `Not enough headroom over the stairs from ${level.name}: ${both} about ${formatFeetInches(Math.max(0, Math.round(room)))} over them (${formatFeetInches(codeNum("stairs.minHeadroom"))} is the minimum).${canFix ? " U-shaped stairs stack without this problem." : ""}`,
        roomIds: [],
        at: { x: s.x, y: s.y },
        stairsU: canFix ? { lower: { levelId: level.id, id: s.id }, upper: { levelId: to.id, id: u.id } } : undefined,
      });
    }
    if (s.widthIn < MIN_STAIRS_WIDTH_IN - 0.5) add_(level.id, `stairwidth:${s.id}`, `The stairs are ${formatFeetInches(s.widthIn)} wide. 3' is the usual minimum.`, [], { x: s.x, y: s.y });
  }

  // Rooms far from the size the brief asked for.
  for (const r of plan.rooms) {
    const want = ctx.brief?.rooms.find((b) => b.id === r.briefRoomId)?.targetSqFt;
    if (!want) continue;
    const have = roomSqft(r);
    const f = (n: number) => Math.round(n).toLocaleString("en-US");
    if (have < want * TOO_SMALL && want - have >= 20) add_(level.id, `too-small:${r.id}`, `${r.name} is ${f(have)} sq ft, much smaller than the ${f(want)} your brief asked for.`, [r]);
    else if (have > want * TOO_BIG && have - want >= 30) add_(level.id, `too-big:${r.id}`, `${r.name} is ${f(have)} sq ft, much bigger than the ${f(want)} your brief asked for.`, [r]);
  }

  // Furnish items outside their room, off their wall, or in a doorway.
  for (const fp of furnishProblems(planOf(saved, level.id))) {
    out.push({ id: `${level.id}:${fp.key}`, levelId: level.id, tag: "comfort", text: fp.text, roomIds: fp.item.roomId ? [fp.item.roomId] : [], at: fp.at, furnish: { kind: fp.item.kind, id: fp.item.id, canMoveInside: fp.canMoveInside } });
  }
  // A sink, tub or shower whose faucet was taken off.
  for (const fx of planOf(saved, level.id).fixtures) {
    if (!fx.faucet?.removed || !FAUCET_KIND[fx.kind]) continue;
    const what = fixtureType(fx.kind).label.toLowerCase();
    out.push({ id: `${level.id}:no-faucet:${fx.id}`, levelId: level.id, tag: "comfort", text: `This ${what} has no faucet.`, roomIds: fx.roomId ? [fx.roomId] : [], at: { x: fx.x, y: fx.y }, noFaucet: { fixtureId: fx.id } });
  }
  // Closet walls and doors left after the closet's rod and shelf were deleted.
  for (const lc of leftoverClosets(planOf(saved, level.id))) {
    const what = lc.roomId ? "The walk-in closet's walls and door are" : "The closet's walls and door are";
    out.push({ id: `${level.id}:closet-left:${lc.stem}`, levelId: level.id, tag: "comfort", text: `${what} still there after its rod and shelf were deleted.`, roomIds: lc.roomId ? [lc.roomId] : [], at: lc.at, closetWalls: { stem: lc.stem } });
  }

  return out;
}

/**
 * The house on its land: sitting on a big rock, in water, on a creek or
 * river bank, in a dry wash's path, or past the lot line. Checked for the
 * floors on the ground (the main floor and anything below it).
 */
function landWarnings(plans: Plans, levels: Level[], plot: Plot, offset: Point): PlanWarning[] {
  const out: PlanWarning[] = [];
  const main = levels.find((l) => l.id === MAIN_LEVEL_ID) ?? levels.find((l) => l.kind === "main");
  const ground = levels.filter((l) => l === main || l.kind === "basement");
  const seen = new Set<string>();
  for (const level of ground) {
    const rooms = planOf(plans, level.id).rooms;
    if (!rooms.length) continue;
    const toPlot = (p: Point) => ({ x: p.x + offset.x, y: p.y + offset.y });
    const toPlan = (p: Point) => ({ x: p.x - offset.x, y: p.y - offset.y });
    for (const hit of landUnder(plot, rooms.map((r) => r.polygon.map(toPlot)))) {
      const room = rooms[hit.footprint];
      let key: string;
      let text: string;
      let at: Point;
      if (hit.kind === "rock") {
        key = `rock:${hit.rock.id}`;
        text = `${room.name} sits on the big rock near the ${placeName(plot, hit.rock.at)}. Move the house on the lot, or budget for removing the rock.`;
        at = toPlan(hit.rock.at);
      } else if (hit.kind === "water") {
        key = `water:${hit.water}`;
        text = `${room.name} is in the ${hit.water}. Move the house on the lot to dry ground.`;
        at = toPlan(hit.at);
      } else if (hit.kind === "bank") {
        key = `bank:${hit.water}`;
        text = `${room.name} is ${hit.distFt} ft from the ${hit.water}, on its bank. Keep the house back from the water and above the flood line.`;
        at = toPlan(hit.at);
      } else if (hit.kind === "wash") {
        key = "wash";
        text = `${room.name} is in the path of the dry wash, which can run fast in spring. Move the house out of it.`;
        at = toPlan(hit.at);
      } else {
        key = "lot";
        text = `${room.name} reaches past the lot line. Use Move on lot to put the house back on the land.`;
        at = toPlan(hit.at);
      }
      // One warning per thing per floor, on the first room that touches it.
      if (seen.has(`${level.id}:${key}`)) continue;
      seen.add(`${level.id}:${key}`);
      out.push({ id: `${level.id}:land:${key}`, levelId: level.id, tag: tagOf(`land:${key}`), text, roomIds: [room.id], at });
    }
  }
  return out;
}

export type OpeningProblem = { key: string; text: string; roomId: string | null; at: Point };

const openingName = (o: Opening) => (o.kind === "opening" ? "Opening" : openingType(o.style).label);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** How far apart two lines can be and still be the same wall (both sides of a shared wall), inches. */
const SAME_WALL_IN = 8;

/**
 * Doors and windows that can't be built as drawn: two that overlap on the
 * same wall, one running past the end of its wall, and one whose top is
 * above the ceiling. Curved walls are left to `tooWideForCurve`.
 */
export function openingProblems(plan: FloorPlan, ceilingIn: number): OpeningProblem[] {
  const out: OpeningProblem[] = [];
  const roomOf = (o: Opening) => ("roomId" in o.host ? o.host.roomId : (openingRooms(plan, o).find((id) => id) ?? null));
  const straight: { o: Opening; g: OpeningGeometry }[] = [];
  for (const o of plan.openings) {
    const seg = hostSegment(plan, o.host);
    const g = openingGeometry(plan, o);
    if (!seg || !g) continue;
    const name = openingName(o);
    if (!seg.bulge) {
      straight.push({ o, g });
      if (o.widthIn > seg.length + 0.5) {
        out.push({ key: `opening-wide:${o.id}`, text: `${name} is ${formatFeetInches(o.widthIn)} wide, but its wall is only ${formatFeetInches(Math.round(seg.length))} long.`, roomId: roomOf(o), at: g.center });
      } else if (o.offsetIn - o.widthIn / 2 < -0.5 || o.offsetIn + o.widthIn / 2 > seg.length + 0.5) {
        out.push({ key: `opening-wide:${o.id}`, text: `${name} runs past the end of its wall. Slide it along the wall or make it narrower.`, roomId: roomOf(o), at: g.center });
      }
    }
    const top = (o.kind === "window" ? (o.sillIn ?? openingType(o.style).sillIn ?? 0) : 0) + o.heightIn;
    if (top > ceilingIn + 0.5) {
      const what = o.kind === "window" ? `${name}'s top is ${formatFeetInches(Math.round(top))} up` : `${name} is ${formatFeetInches(Math.round(top))} tall`;
      out.push({ key: `opening-tall:${o.id}`, text: `${what}, above the ${formatFeetInches(ceilingIn)} ceiling. Make it shorter${o.kind === "window" ? " or lower its sill" : ""}.`, roomId: roomOf(o), at: g.center });
    }
  }
  // Two openings in the same stretch of wall (either side of a shared wall counts).
  for (let i = 0; i < straight.length; i++) {
    for (let j = i + 1; j < straight.length; j++) {
      const a = straight[i].g;
      const b = straight[j].g;
      if (Math.abs(a.u.x * b.u.y - a.u.y * b.u.x) > 0.01) continue;
      const off = sub(b.center, a.center);
      if (Math.abs(off.x * a.n.x + off.y * a.n.y) > SAME_WALL_IN) continue;
      const t = (p: Point) => (p.x - a.a.x) * a.u.x + (p.y - a.a.y) * a.u.y;
      const [b0, b1] = [t(b.a), t(b.b)].sort((x, y) => x - y);
      const lap = Math.min(dist(a.a, a.b), b1) - Math.max(0, b0);
      if (lap <= 0.5) continue;
      const [oa, ob] = [straight[i].o, straight[j].o];
      out.push({ key: `opening-overlap:${oa.id}:${ob.id}`, text: `${openingName(oa)} and ${lower(openingName(ob))} overlap on the same wall by ${formatFeetInches(Math.round(lap))}. Slide one along the wall.`, roomId: roomOf(oa), at: scale(add(a.center, b.center), 0.5) });
    }
  }
  return out;
}

/** Splits warnings into the ones still showing and the ones the user dismissed (matched by id). */
export function splitDismissed(warnings: PlanWarning[], dismissed: string[]): { active: PlanWarning[]; dismissed: PlanWarning[] } {
  const set = new Set(dismissed);
  return { active: warnings.filter((w) => !set.has(w.id)), dismissed: warnings.filter((w) => set.has(w.id)) };
}

/** Adds an id to the dismissed list, dropping saved ids that no longer match any current warning. */
export function dismissWarning(dismissed: string[], id: string, warnings: PlanWarning[]): string[] {
  const live = new Set(warnings.map((w) => w.id));
  return [...new Set([...dismissed, id])].filter((d) => live.has(d));
}

/** Brings one dismissed item back. */
export function restoreWarning(dismissed: string[], id: string): string[] {
  return dismissed.filter((d) => d !== id);
}
