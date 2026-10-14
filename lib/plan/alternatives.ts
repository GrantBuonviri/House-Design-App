import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { OUTSIDE, openingRooms, sharedWall } from "./connect";
import { applyChanges, edgeFacing, mirrorAxis, type PlanChange } from "./changes";
import { planOf, type Plans } from "./edit";
import type { PlanContext } from "./fromSketch";
import { roomSqft } from "./measure";

/** One of the floor plan's "Show me alternatives" designs. */
export type PlanAlternative = {
  title: string;
  why: string;
  plans: Plans;
  /** Rooms that changed, to point them out. */
  changed: string[];
  /** Changes the whole house at once (a flip), so it can't be taken one floor at a time. */
  wholeHouse: boolean;
};

/** An idea for an alternative: a title, a why, and the changes to try. */
export type Idea = { title: string; why: string; changes: PlanChange[] };

const LIVING = new Set(["living", "family", "dining", "great-room", "sunroom"]);
const SIDES = ["N", "E", "S", "W"] as const;
const change = (op: PlanChange["op"], room: string, extra: Partial<PlanChange> = {}): PlanChange => ({ op, room, other: "", side: "none", feet: 0, ...extra });

/** Apply an idea; null when none of its changes work or the plan wouldn't change. */
export function tryIdea(plans: Plans, idea: Idea, ctx: PlanContext): PlanAlternative | null {
  const res = applyChanges(plans, idea.changes, ctx);
  if (!res.applied.length || signature(res.plans) === signature(plans)) return null;
  return { title: idea.title, why: idea.why, plans: res.plans, changed: res.changed, wholeHouse: res.mirrored };
}

/** The first of several ways to do an idea that works. */
function firstOf(plans: Plans, ideas: Idea[], ctx: PlanContext): PlanAlternative | null {
  for (const idea of ideas) {
    const alt = tryIdea(plans, idea, ctx);
    if (alt) return alt;
  }
  return null;
}

const allRooms = (plans: Plans) => Object.entries(plans).flatMap(([levelId, p]) => p.rooms.map((room) => ({ levelId, room, plan: p })));

function wideOpening(plan: FloorPlan, a: PlanRoom, b: PlanRoom): boolean {
  return plan.openings.some((o) => {
    if (o.kind !== "opening" || o.widthIn < 48) return false;
    const [x, y] = openingRooms(plan, o);
    return (x === a.id && y === b.id) || (x === b.id && y === a.id);
  });
}

/** Ways to push a room's wall out: away from the road first, then into living spaces with room to spare. */
function growOptions(plan: FloorPlan, room: PlanRoom, feet: number, ctx: PlanContext): { change: PlanChange; into: string }[] {
  const road = ctx.plot?.roadSide;
  const out: { change: PlanChange; into: string; score: number }[] = [];
  for (const side of SIDES) {
    const edge = edgeFacing(room, side);
    if (edge === null) continue;
    const across = plan.rooms.filter((r) => r.id !== room.id && sharedWall(room, r)?.edge === edge);
    const into = across.length ? across.map((r) => r.name).join(" and ") : OUTSIDE;
    const roomy = across.every((r) => LIVING.has(r.type ?? "") || r.type === "hall" || r.type === "other");
    if (!roomy) continue;
    const score = (into === OUTSIDE ? 10 : 5) + (side === road ? -8 : 0) + (side === "S" ? 1 : 0);
    out.push({ change: change("grow", room.id, { side, feet }), into, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The built-in ideas, each a small change to the user's own plan: an open
 * kitchen, a bigger kitchen, sizes closer to the brief, a roomier primary
 * bedroom, the house flipped side to side, a bigger living room, roomier
 * bedrooms, more winter sun. In that order; ones that don't fit are left out.
 */
export function ruleAlternatives(plans: Plans, ctx: PlanContext): PlanAlternative[] {
  const out: PlanAlternative[] = [];
  const push = (a: PlanAlternative | null) => a && out.push(a);
  const rooms = allRooms(plans);
  const kitchen = rooms.find((x) => x.room.type === "kitchen");

  // Open kitchen.
  if (kitchen) {
    const open = kitchen.plan.rooms.filter((r) => LIVING.has(r.type ?? "") && !wideOpening(kitchen.plan, kitchen.room, r) && (sharedWall(kitchen.room, r)?.t1 ?? 0) - (sharedWall(kitchen.room, r)?.t0 ?? 0) >= 72);
    if (open.length) {
      push(
        tryIdea(
          plans,
          {
            title: "Open kitchen",
            why: `Most of the wall between the kitchen and the ${open.map((r) => r.name.toLowerCase()).join(" and ")} comes down, so cooking and living share one space.`,
            changes: open.map((r) => change("open_up", kitchen.room.id, { other: r.id })),
          },
          ctx,
        ),
      );
    }
  }

  // A bigger kitchen.
  if (kitchen) {
    push(
      firstOf(
        plans,
        growOptions(kitchen.plan, kitchen.room, 2, ctx).map((g) => ({
          title: "Bigger kitchen",
          why: g.into === OUTSIDE ? "The kitchen grows 2 ft outward for more counter space." : `The kitchen grows 2 ft into the ${g.into.toLowerCase()} for more counter space.`,
          changes: [g.change],
        })),
        ctx,
      ),
    );
  }

  // Rooms well over the size the brief asked for, trimmed back on an outside wall.
  const changes: PlanChange[] = [];
  const trimmed: string[] = [];
  for (const { room, plan } of rooms) {
    const want = ctx.brief?.rooms.find((b) => b.id === room.briefRoomId)?.targetSqFt;
    const have = roomSqft(room);
    if (!want || have < want * 1.2 || have - want < 25) continue;
    for (const side of SIDES) {
      const edge = edgeFacing(room, side);
      if (edge === null) continue;
      const neighbors = plan.rooms.filter((r) => r.id !== room.id && sharedWall(room, r)?.edge === edge);
      if (neighbors.length) continue;
      const e = room.polygon;
      const length = Math.hypot(e[(edge + 1) % e.length].x - e[edge].x, e[(edge + 1) % e.length].y - e[edge].y) / 12;
      const feet = Math.min(4, Math.max(1, Math.round((have - want) / Math.max(1, length))));
      changes.push(change("shrink", room.id, { side, feet }));
      trimmed.push(room.name);
      break;
    }
  }
  if (changes.length) {
    push(
      tryIdea(
        plans,
        {
          title: "Closer to your brief",
          why: `${listOf(trimmed)} ${trimmed.length === 1 ? "is" : "are"} trimmed back toward the size${trimmed.length === 1 ? "" : "s"} your brief asked for, which saves building cost.`,
          changes,
        },
        ctx,
      ),
    );
  }

  // A roomier primary bedroom.
  const primary = rooms.find((x) => x.room.type === "primary-bedroom");
  if (primary) {
    push(
      firstOf(
        plans,
        growOptions(primary.plan, primary.room, 2, ctx).map((g) => ({
          title: "Roomier primary bedroom",
          why: g.into === OUTSIDE ? "The primary bedroom grows 2 ft outward, with space for a sitting corner." : `The primary bedroom grows 2 ft into the ${g.into.toLowerCase()}.`,
          changes: [g.change],
        })),
        ctx,
      ),
    );
  }

  // Flipped side to side.
  if (mirrorAxis(ctx) && rooms.length) {
    push(
      tryIdea(
        plans,
        {
          title: "Flipped side to side",
          why: "A mirror image: rooms on the east swap to the west, and the entry still faces the road.",
          changes: [change("mirror", rooms[0].room.id, { side: "E" })],
        },
        ctx,
      ),
    );
  }
  // A bigger living room.
  const living = rooms.filter((x) => ["living", "family", "great-room"].includes(x.room.type ?? "")).sort((a, b) => roomSqft(b.room) - roomSqft(a.room))[0];
  if (living) {
    push(
      firstOf(
        plans,
        growOptions(living.plan, living.room, 2, ctx).map((g) => ({
          title: `Bigger ${living.room.name.toLowerCase()}`,
          why: g.into === OUTSIDE ? `The ${living.room.name.toLowerCase()} grows 2 ft outward, for more room to gather.` : `The ${living.room.name.toLowerCase()} grows 2 ft into the ${g.into.toLowerCase()}.`,
          changes: [g.change],
        })),
        ctx,
      ),
    );
  }

  // Roomier bedrooms: the other bedrooms each push one outside wall out a little.
  const bedrooms = rooms.filter((x) => x.room.type === "bedroom");
  const bedroomChanges = bedrooms.flatMap(({ plan, room }) => {
    const g = growOptions(plan, room, 1.5, ctx).find((o) => o.into === OUTSIDE);
    return g ? [g.change] : [];
  });
  if (bedroomChanges.length) {
    push(
      tryIdea(
        plans,
        {
          title: bedrooms.length === 1 ? "Roomier bedroom" : "Roomier bedrooms",
          why: `${bedrooms.length === 1 ? "The bedroom grows" : "The other bedrooms each grow"} about 1½ ft outward, for space for a desk or a bigger bed.`,
          changes: bedroomChanges,
        },
        ctx,
      ),
    );
  }

  // More winter sun on the living spaces.
  const sunny = rooms.filter((x) => LIVING.has(x.room.type ?? "") || x.room.type === "kitchen");
  if (sunny.length) {
    push(
      tryIdea(
        plans,
        {
          title: "More winter sun",
          why: "Bigger windows on the south side of the living spaces, for low winter sun.",
          changes: sunny.map((x) => change("window", x.room.id, { side: "S", feet: x.room.type === "kitchen" ? 4 : 6 })),
        },
        ctx,
      ),
    );
  }

  return out;
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Enough of a plan to tell two apart. */
export function signature(plans: Plans): string {
  return JSON.stringify(
    Object.keys(plans)
      .sort()
      .map((id) => {
        const p = planOf(plans, id);
        return [p.rooms.map((r) => [r.id, r.name, r.polygon]), p.openings.map((o) => [o.host, Math.round(o.offsetIn), o.style, o.widthIn])];
      }),
  );
}

/** Up to `count` alternatives that differ from the user's plan and from each other, in order. */
export function pickDistinct(current: Plans, list: PlanAlternative[], count = 3): PlanAlternative[] {
  const seen = new Set([signature(current)]);
  const titles = new Set<string>();
  const out: PlanAlternative[] = [];
  for (const alt of list) {
    const sig = signature(alt.plans);
    if (seen.has(sig) || titles.has(alt.title.toLowerCase())) continue;
    seen.add(sig);
    titles.add(alt.title.toLowerCase());
    out.push(alt);
    if (out.length === count) break;
  }
  return out;
}
