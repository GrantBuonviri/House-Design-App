import type { DesignBrief, FloorPlan, Level, PlanBasics, PlanRoom, Plot, Point } from "@/lib/model/schema";
import { landUnder } from "@/lib/land/onLot";
import { placeName } from "@/lib/land/implications";
import { formatFeetInches } from "@/lib/model/units";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { INTERIOR_WALL_IN, levelAbove, riseBetween } from "./basics";
import { OUTSIDE, openingRooms, reachable, roleOf, roomLinks } from "./connect";
import { planOf, type Plans } from "./edit";
import { dist, edgesOf, isRectangle, polygonCenter, polygonsOverlap, scale, add } from "./geometry";
import { areaKind, roomSqft } from "./measure";
import { MIN_STAIRS_WIDTH_IN, stackedHeadroom } from "./stairs";
import { codeNum } from "@/lib/codes/data";
import { findGaps, type Gap } from "./overlaps";
import { isWayIn, stairsBoxes, wayInRooms } from "./suggest";
import { CANTILEVER_MAX_IN, overhangsOf, pulledBack, supportOf } from "./support";
import { flatPlans } from "./flatten";
import { tooWideForCurve } from "./bend";
import { pointOnEdge } from "./arcs";
import { hostSegment } from "./walls";
import { openingType } from "./catalog";

/**
 * Friendly checks on a floor plan: rooms you can't get into, bedrooms without
 * a window, narrow hallways, missing stairs, rooms far from the size the
 * brief asked for. They're general guidelines for a comfortable house, not
 * building code.
 */

export type PlanWarning = {
  id: string;
  levelId: string;
  text: string;
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
};

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

type Ctx = {
  levels: Level[];
  brief: DesignBrief | null;
  basics: PlanBasics | null;
  /** The land and where the house sits on it (plot point = plan point + offset), for the land checks. */
  land?: { plot: Plot | null; offset: Point } | null;
};

/** A window you could climb out of: wide enough, and low enough to reach. */
const isEgress = (o: FloorPlan["openings"][number]) => o.kind === "window" && o.widthIn >= 24 && o.heightIn >= 24 && (o.sillIn ?? 30) <= 44;

export function planWarnings(plans: Plans, ctx: Ctx): PlanWarning[] {
  const saved = plans;
  plans = flatPlans(plans);
  const out: PlanWarning[] = [];
  const levels = [...ctx.levels].sort((a, b) => a.elevationIn - b.elevationIn);
  const add_ = (levelId: string, key: string, text: string, rooms: PlanRoom[] = [], at?: Point | null) =>
    out.push({ id: `${levelId}:${key}`, levelId, text, roomIds: rooms.map((r) => r.id), at: at === undefined ? (rooms[0] ? polygonCenter(rooms[0].polygon) : null) : at });

  for (const level of levels) {
    const plan = planOf(plans, level.id);
    if (!plan.rooms.length) continue;
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

    // Bedrooms need a window you could climb out of.
    for (const r of plan.rooms.filter((x) => BEDROOMS.has(x.type ?? ""))) {
      const windows = plan.openings.filter((o) => o.kind === "window" && openingRooms(plan, o).includes(r.id));
      if (!windows.length) add_(level.id, `egress:${r.id}`, `${r.name} has no window. A bedroom needs one you could climb out of in an emergency.`, [r]);
      else if (!windows.some(isEgress)) add_(level.id, `egress:${r.id}`, `${r.name}'s windows are too small or too high to climb out of in an emergency.`, [r]);
    }

    // Hallways at least 3 ft wide inside.
    for (const r of plan.rooms.filter((x) => x.type === "hall")) {
      if (!isRectangle(r.polygon)) continue;
      const clear = Math.min(...edgesOf(r.polygon).map((e) => dist(e.a, e.b))) - INTERIOR_WALL_IN;
      if (clear < MIN_HALL_CLEAR_IN - 0.5) add_(level.id, `narrow:${r.id}`, `${r.name} is ${formatFeetInches(Math.round(clear))} wide inside. Hallways are more comfortable at 3' or wider.`, [r]);
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
      if (have < want * TOO_SMALL && want - have >= 20) add_(level.id, `size:${r.id}`, `${r.name} is ${f(have)} sq ft, much smaller than the ${f(want)} your brief asked for.`, [r]);
      else if (have > want * TOO_BIG && have - want >= 30) add_(level.id, `size:${r.id}`, `${r.name} is ${f(have)} sq ft, much bigger than the ${f(want)} your brief asked for.`, [r]);
    }
  }

  if (ctx.land?.plot) out.push(...landWarnings(plans, levels, ctx.land.plot, ctx.land.offset));

  // Rooms from the brief that aren't drawn anywhere yet.
  if (ctx.brief && levels.some((l) => planOf(plans, l.id).rooms.length)) {
    const drawn = new Set(levels.flatMap((l) => planOf(plans, l.id).rooms.map((r) => r.briefRoomId)));
    for (const b of ctx.brief.rooms) {
      if (drawn.has(b.id)) continue;
      const levelId = b.levelId && levels.some((l) => l.id === b.levelId) ? b.levelId : MAIN_LEVEL_ID;
      out.push({ id: `${levelId}:missing:${b.id}`, levelId, text: `${b.name} from your brief isn't in the plan yet.`, roomIds: [], at: null });
    }
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
      out.push({ id: `${level.id}:land:${key}`, levelId: level.id, text, roomIds: [room.id], at });
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
