import type { FloorPlan, Fixture, Point, Product, Selection } from "@/lib/model/schema";
import { add, project, rotate, round1 } from "@/lib/plan/geometry";
import { wallPieces } from "@/lib/plan/walls";
import { roomFinishes } from "@/lib/interior/picks";
import { roomAt } from "./layer";

/**
 * Faucets, tub spouts and shower heads. Like stair railings they're worked
 * out from the fixtures every time: every sink, vanity, laundry sink, prep
 * sink, tub and shower gets one, so moving, copying or deleting the fixture
 * brings its faucet along. Only changes are saved, on the fixture
 * (`Fixture.faucet`): a different shape, slid along the basin, or removed.
 *
 * The faucet's product (and so its finish color) is the room's Interior
 * design pick for that category, so one pick covers every faucet of that
 * kind in the room.
 */

export type FaucetKind = "kitchen" | "bath" | "laundry" | "prep" | "tub" | "shower";

export type FaucetShape =
  | "pull-down"
  | "pull-out"
  | "bridge"
  | "wall-mount"
  | "single"
  | "widespread"
  | "vessel"
  | "deck"
  | "wall-spout"
  | "freestanding"
  | "standard"
  | "rain"
  | "handheld"
  | "utility"
  | "pot-filler"
  | "spigot";

export const FAUCET_SHAPES: Record<FaucetShape, { label: string }> = {
  "pull-down": { label: "Pull-down (high arc)" },
  "pull-out": { label: "Pull-out (low spout)" },
  bridge: { label: "Bridge (two handles)" },
  "wall-mount": { label: "Wall-mount" },
  single: { label: "Single lever" },
  widespread: { label: "Widespread (spout + two handles)" },
  vessel: { label: "Vessel (tall)" },
  deck: { label: "On the tub rim" },
  "wall-spout": { label: "Wall spout + valve" },
  freestanding: { label: "Freestanding floor filler" },
  standard: { label: "Shower head on an arm" },
  rain: { label: "Rain head" },
  handheld: { label: "Hand shower on a slide bar" },
  utility: { label: "Utility (two handles)" },
  "pot-filler": { label: "Pot filler" },
  spigot: { label: "Hose spigot" },
};

/** The shapes each kind of faucet can take, the usual one first. */
export const SHAPES_FOR: Record<FaucetKind, FaucetShape[]> = {
  kitchen: ["pull-down", "pull-out", "bridge", "wall-mount"],
  prep: ["pull-down", "pull-out", "bridge", "wall-mount"],
  bath: ["single", "widespread", "vessel", "wall-mount"],
  laundry: ["utility", "pull-down", "wall-mount"],
  tub: ["wall-spout", "deck", "freestanding"],
  shower: ["standard", "rain", "handheld"],
};

/** Which fixtures get a faucet, and what kind. */
export const FAUCET_KIND: Record<string, FaucetKind> = {
  sink: "kitchen",
  "prep-sink": "prep",
  vanity: "bath",
  "laundry-sink": "laundry",
  tub: "tub",
  shower: "shower",
};

/** The Interior design category whose pick is the faucet's product. */
export const FAUCET_CATEGORY: Record<FaucetKind, string> = {
  kitchen: "kitchen-faucets",
  prep: "kitchen-faucets",
  laundry: "kitchen-faucets",
  bath: "bath-faucets",
  tub: "showers",
  shower: "showers",
};

/** Where the basin sits on each fixture: its width and depth as shares of the fixture's, and the deck height. */
const BASIN: Record<string, { w: number; d: number; deckIn: number }> = {
  sink: { w: 0.75, d: 0.6, deckIn: 36 },
  "prep-sink": { w: 0.7, d: 0.6, deckIn: 36 },
  vanity: { w: 0.5, d: 0.55, deckIn: 34 },
  "laundry-sink": { w: 0.85, d: 0.7, deckIn: 34 },
};

/** The tub's rim, and shower heights on the wall. */
export const TUB_RIM_IN = 20;
export const SHOWER_HEAD_IN = 78;
export const SHOWER_VALVE_IN = 48;
export const CHROME = "#c8ccd0";

export type Faucet = {
  /** The fixture's id: one faucet per fixture. */
  key: string;
  fixtureId: string;
  levelId: string;
  kind: FaucetKind;
  shape: FaucetShape;
  /** The faucet's back: on the counter behind the basin, or on the wall. Its +y (turned by `rotation`) points over the basin. */
  at: Point;
  rotation: number;
  /** The deck or rim it stands on, inches above the floor (0 for showers and floor fillers). */
  z: number;
  /** How far it's slid along the back of the basin from the middle (inches, + to the fixture's right). */
  alongIn: number;
  /** The most it can slide either way. */
  maxAlongIn: number;
  /** Finish color, from the picked product (chrome when nothing is picked). */
  color: string;
  product?: Product;
  /** A tub with no separate shower in the room: it also gets a shower head and the valve above the spout. */
  shower?: boolean;
  /** Nothing changed from the automatic faucet. */
  auto: boolean;
  /** Taken off (listed only when asked for, so it can be put back). */
  removed?: boolean;
};

const has = (name: string, ...words: string[]) => words.some((w) => name.includes(w));

/** The shape that fits a picked product (by words in its name), else the usual one for the fixture. */
export function defaultShape(fixtureKind: string, product?: Pick<Product, "name">, againstWall = true): FaucetShape {
  const kind = FAUCET_KIND[fixtureKind];
  if (!kind) return "single";
  const allowed = SHAPES_FOR[kind];
  const name = (product?.name ?? "").toLowerCase();
  const fromName: FaucetShape | null = has(name, "pull-down", "pulldown", "pull down")
    ? "pull-down"
    : has(name, "pull-out", "pullout", "pull out")
      ? "pull-out"
      : has(name, "bridge")
        ? "bridge"
        : has(name, "freestanding", "floor mount", "floor-mount")
          ? "freestanding"
          : has(name, "wall mount", "wall-mount", "wallmount")
            ? kind === "tub" ? "wall-spout" : "wall-mount"
            : has(name, "widespread", "two-handle", "2-handle")
              ? kind === "kitchen" || kind === "prep" ? "bridge" : "widespread"
              : has(name, "vessel")
                ? "vessel"
                : has(name, "hand shower", "handheld", "hand-held")
                  ? "handheld"
                  : has(name, "rain")
                    ? "rain"
                    : null;
  if (kind === "tub" && !againstWall) return "freestanding";
  if (fromName && allowed.includes(fromName) && !(fromName === "freestanding" && kind !== "tub")) return fromName;
  return kind === "tub" ? (againstWall ? "wall-spout" : "freestanding") : allowed[0];
}

/** A point in the fixture's own frame (its back toward -y), placed on the plan. */
const local = (fx: Fixture, x: number, y: number) => add({ x: fx.x, y: fx.y }, rotate({ x, y }, fx.rotation ?? 0));

/**
 * The face of the full-height wall right behind a fixture's edge, from the
 * edge's middle `p` and the way out to the wall (`out`, a unit vector), or
 * null when no wall is there. Room outlines run along the middle of walls,
 * so a faucet put on the outline would sit inside the wall.
 */
function wallFace(plan: FloorPlan, p: Point, out: Point, exteriorIn: number): Point | null {
  let best: { d: number; at: Point } | null = null;
  for (const w of wallPieces(plan, exteriorIn)) {
    if (w.open || w.height || w.thicknessIn <= 0) continue;
    const pr = project(p, w.a, w.b);
    if (pr.d > w.thicknessIn / 2 + 3) continue;
    // Signed distance from p out to the wall's middle line, then back half the wall.
    const toMid = (pr.point.x - p.x) * out.x + (pr.point.y - p.y) * out.y;
    const shift = toMid - w.thicknessIn / 2;
    if (!best || pr.d < best.d) best = { d: pr.d, at: { x: p.x + out.x * shift, y: p.y + out.y * shift } };
  }
  return best?.at ?? null;
}

/** The fixture's own direction (its -y is its back), turned onto the plan. */
const dirOf = (fx: Fixture, x: number, y: number) => rotate({ x, y }, fx.rotation ?? 0);

/** The tub's end that holds the faucet: the narrow end against a wall (with that wall's face), else its left end. */
function tubEnd(plan: FloorPlan, fx: Fixture, exteriorIn: number): { side: -1 | 1; face: Point | null; againstWall: boolean } {
  for (const side of [-1, 1] as const) {
    const face = wallFace(plan, local(fx, (side * fx.widthIn) / 2, 0), dirOf(fx, side, 0), exteriorIn);
    if (face) return { side, face, againstWall: true };
  }
  // No end on a wall: a tub along a wall (its back) still counts as against one.
  return { side: -1, face: null, againstWall: Boolean(wallFace(plan, local(fx, 0, -fx.depthIn / 2), dirOf(fx, 0, -1), exteriorIn)) };
}

/** How far a fixture's faucet can slide from the middle. */
export function maxAlong(fx: Pick<Fixture, "kind" | "widthIn">): number {
  const b = BASIN[fx.kind];
  if (b) return Math.max(0, round1((fx.widthIn * b.w) / 2 - 2));
  if (fx.kind === "shower") return Math.max(0, round1(fx.widthIn / 2 - 8));
  return 0;
}

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** The faucet a fixture gets (removed ones too, flagged), or null for fixtures that don't have one. */
export function faucetOf(
  plan: FloorPlan,
  levelId: string,
  fx: Fixture,
  selections: Selection[] = [],
  exteriorIn = 6.5,
): Faucet | null {
  const kind = FAUCET_KIND[fx.kind];
  if (!kind) return null;
  const room = (fx.roomId && plan.rooms.find((r) => r.id === fx.roomId)) || roomAt(plan, { x: fx.x, y: fx.y });
  const picks = selections.length && room ? roomFinishes(selections, room.id) : new Map<string, Product>();
  const product = picks.get(FAUCET_CATEGORY[kind]);
  const edit = fx.faucet;
  const max = maxAlong(fx);
  const alongIn = clamp(edit?.alongIn ?? 0, max);
  const base = {
    key: fx.id,
    fixtureId: fx.id,
    levelId,
    kind,
    alongIn,
    maxAlongIn: max,
    color: product?.color ?? CHROME,
    ...(product ? { product } : {}),
    auto: !edit || (edit.shape === undefined && !edit.alongIn && !edit.removed),
    ...(edit?.removed ? { removed: true } : {}),
  };
  const valid = (s: FaucetShape | undefined, wall: boolean) => (s && SHAPES_FOR[kind].includes(s) ? s : defaultShape(fx.kind, product, wall));
  if (kind === "tub") {
    const end = tubEnd(plan, fx, exteriorIn);
    const shape = valid(edit?.shape as FaucetShape | undefined, end.againstWall);
    const rotation = (fx.rotation ?? 0) + (end.side === -1 ? -90 : 90);
    // Freestanding fillers stand on the floor just past the tub's end.
    const out = shape === "freestanding" ? 6 : 0;
    const at = shape !== "freestanding" && end.face ? end.face : local(fx, end.side * (fx.widthIn / 2 + out), 0);
    const shower = end.againstWall && shape !== "freestanding" && !plan.fixtures.some((o) => o.kind === "shower" && o.id !== fx.id && sameRoom(plan, o, room?.id));
    return { ...base, shape, at: rnd(at), rotation, z: shape === "freestanding" ? 0 : TUB_RIM_IN, ...(shower ? { shower } : {}) };
  }
  const shape = valid(edit?.shape as FaucetShape | undefined, true);
  const back = (y: number) => {
    const p = local(fx, alongIn, y);
    return wallFace(plan, p, dirOf(fx, 0, -1), exteriorIn) ?? p;
  };
  if (kind === "shower") return { ...base, shape, at: rnd(back(-fx.depthIn / 2)), rotation: fx.rotation ?? 0, z: 0 };
  const b = BASIN[fx.kind];
  // Wall-mount faucets come out of the wall behind the fixture; the others stand on the deck just behind the basin.
  const at = shape === "wall-mount" ? back(-fx.depthIn / 2) : local(fx, alongIn, Math.max(-fx.depthIn / 2 + 1, -(b.d * fx.depthIn) / 2 - 1.5));
  return { ...base, shape, at: rnd(at), rotation: fx.rotation ?? 0, z: b.deckIn };
}

const rnd = (p: Point): Point => ({ x: round1(p.x), y: round1(p.y) });

function sameRoom(plan: FloorPlan, fx: Fixture, roomId: string | undefined): boolean {
  if (!roomId) return false;
  return (fx.roomId ?? roomAt(plan, { x: fx.x, y: fx.y })?.id) === roomId;
}

/** Every faucet on a floor. Removed ones are left out unless asked for. */
export function faucetsOn(
  plan: FloorPlan,
  levelId: string,
  selections: Selection[] = [],
  opts: { exteriorIn?: number; removed?: boolean } = {},
): Faucet[] {
  const out: Faucet[] = [];
  for (const fx of plan.fixtures) {
    const f = faucetOf(plan, levelId, fx, selections, opts.exteriorIn);
    if (f && (!f.removed || opts.removed)) out.push(f);
  }
  return out;
}

// ---------- Edits (saved on the fixture) ----------

export type FaucetChange = { shape?: FaucetShape | null; alongIn?: number };

function editFixture(plan: FloorPlan, fixtureId: string, edit: (f: Fixture) => Fixture["faucet"]): FloorPlan {
  return {
    ...plan,
    fixtures: plan.fixtures.map((f) => {
      if (f.id !== fixtureId || !FAUCET_KIND[f.kind]) return f;
      const next = edit(f);
      return next && Object.keys(next).length ? { ...f, faucet: next } : withoutFaucet(f);
    }),
  };
}

/** A different shape (null goes back to the automatic one), or slid along the basin (clamped). */
export function changeFaucet(plan: FloorPlan, fixtureId: string, change: FaucetChange): FloorPlan {
  return editFixture(plan, fixtureId, (f) => {
    const next = { ...(f.faucet ?? {}) };
    if (change.shape === null) delete next.shape;
    else if (change.shape) next.shape = change.shape;
    if (change.alongIn !== undefined) {
      const a = round1(clamp(change.alongIn, maxAlong(f)));
      if (a) next.alongIn = a;
      else delete next.alongIn;
    }
    return next;
  });
}

export const removeFaucet = (plan: FloorPlan, fixtureId: string) => editFixture(plan, fixtureId, (f) => ({ ...(f.faucet ?? {}), removed: true }));

/** Put a removed faucet back, as it was. */
export const restoreFaucet = (plan: FloorPlan, fixtureId: string) =>
  editFixture(plan, fixtureId, (f) => {
    const next = { ...(f.faucet ?? {}) };
    delete next.removed;
    return next;
  });

/** Every faucet on the floor back to automatic. */
export function resetFaucets(plan: FloorPlan): FloorPlan {
  if (!plan.fixtures.some((f) => f.faucet)) return plan;
  return { ...plan, fixtures: plan.fixtures.map(withoutFaucet) };
}

function withoutFaucet(f: Fixture): Fixture {
  if (!f.faucet) return f;
  const next = { ...f };
  delete next.faucet;
  return next;
}

/** A mirrored fixture's faucet slides the other way. */
export function mirrorFaucet(fx: Fixture): Fixture["faucet"] {
  if (!fx.faucet?.alongIn) return fx.faucet;
  return { ...fx.faucet, alongIn: -fx.faucet.alongIn };
}
