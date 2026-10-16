import type { Point } from "@/lib/model/schema";
import { add, dist, scale, sub } from "@/lib/plan/geometry";

/**
 * Doors you can open in the walkthrough, as plain data and math so they can
 * be tested. A door is closed, opening, open or closing (its `amount`, 0 to 1).
 * It opens by itself when you walk into it (unless it's locked), shuts again a
 * few seconds after you've gone, and opens or closes by hand when you click it
 * (a door opened by hand stays open until you close it).
 *
 * Plan inches (x east, y south) and heights above the main floor.
 */

/** The Doors picker: doors as they'd be lived in, all open, all closed, or taken off (frames only). */
export type DoorMode = "normal" | "open" | "closed" | "none";

export const DOOR_MODES: { id: DoorMode; label: string; note: string }[] = [
  { id: "normal", label: "Normal", note: "Closed, and they open as you walk into them" },
  { id: "open", label: "All open", note: "Every door open" },
  { id: "closed", label: "All closed", note: "Every door shut" },
  { id: "none", label: "No doors", note: "Frames only, and every doorway walkable" },
];

export type DoorMotionKind = "swing" | "slide" | "roll";

export type DoorInfo = {
  id: string;
  levelId: string;
  style: string;
  /** "Bathroom door", for messages. */
  label: string;
  /** The middle of the doorway on its wall line; `u` runs along the wall, `n` across it (unit vectors). */
  center: Point;
  u: Point;
  n: Point;
  widthIn: number;
  /** Bottom and top of the doorway, above the main floor. */
  z0: number;
  z1: number;
  motion: DoorMotionKind;
  locked: boolean;
};

export type DoorState = {
  /** 0 shut to 1 open, moving toward `open`. */
  amount: number;
  /** Heading for open (true) or shut (false). */
  open: boolean;
  /** Opened by hand: stays open until closed by hand. */
  hand: boolean;
  /** Seconds since you were last close to a door that opened by itself. */
  idle: number;
};
export type DoorStates = Record<string, DoorState>;

/** How long each kind of door takes to move, in seconds. */
export const DOOR_SECONDS: Record<DoorMotionKind, number> = { swing: 0.4, slide: 0.6, roll: 1.2 };
/** A door that opened by itself shuts this long after you've left it. */
export const CLOSE_AFTER_S = 4;
/** A door this open (or more) lets you through. */
export const PASSABLE_AMOUNT = 0.5;
/** How far from a door's face you are when it starts to open. */
const TRIGGER_DEPTH_IN = 42;
const BODY_IN = 10;

export const motionOf = (style: string): DoorMotionKind => (style === "door-garage" ? "roll" : style === "door-slider" || style === "door-pocket" || style === "door-barn" || style === "door-bifold" ? "slide" : "swing");

const shut = (): DoorState => ({ amount: 0, open: false, hand: false, idle: 0 });

export function newDoorStates(doors: DoorInfo[]): DoorStates {
  return Object.fromEntries(doors.map((d) => [d.id, shut()]));
}

/** How far along the door and across it you are, if you're on its floor. */
function relative(d: DoorInfo, p: Point, feet: number): { along: number; across: number } | null {
  if (Math.abs(feet - d.z0) > 30) return null;
  const v = sub(p, d.center);
  return { along: v.x * d.u.x + v.y * d.u.y, across: v.x * d.n.x + v.y * d.n.y };
}

/** Close enough, and facing the doorway, that it should start opening. */
export function inTrigger(d: DoorInfo, p: Point, feet: number): boolean {
  const r = relative(d, p, feet);
  return !!r && Math.abs(r.along) <= d.widthIn / 2 + BODY_IN && Math.abs(r.across) <= TRIGGER_DEPTH_IN;
}

/** Near enough that an open door should wait (you're in or beside the doorway, or inside its swing). */
export function inHold(d: DoorInfo, p: Point, feet: number): boolean {
  const r = relative(d, p, feet);
  return !!r && Math.hypot(r.along, r.across) <= d.widthIn + 16;
}

/** Standing in the doorway itself, where a closing door would shove you. */
export function inDoorway(d: DoorInfo, p: Point, feet: number): boolean {
  const r = relative(d, p, feet);
  return !!r && Math.abs(r.along) <= d.widthIn / 2 + BODY_IN + 2 && Math.abs(r.across) <= BODY_IN + 8;
}

/** Move every door `dt` seconds on: who is near decides what opens and what shuts; the Doors picker overrides. */
export function stepDoors(states: DoorStates, doors: DoorInfo[], who: { p: Point; feet: number } | null, dt: number, mode: DoorMode): DoorStates {
  const out: DoorStates = {};
  for (const d of doors) {
    const was = states[d.id] ?? shut();
    let { open, hand, idle } = was;
    if (mode !== "normal") {
      open = mode === "open" || mode === "none";
      hand = false;
      idle = 0;
    } else if (hand) {
      open = true;
      idle = 0;
    } else if (open) {
      idle = who && inHold(d, who.p, who.feet) ? 0 : idle + dt;
      if (idle >= CLOSE_AFTER_S) open = false;
    } else if (!d.locked && who && inTrigger(d, who.p, who.feet)) {
      open = true;
      idle = 0;
    }
    const rate = dt / DOOR_SECONDS[d.motion];
    const amount = open ? Math.min(1, was.amount + rate) : Math.max(0, was.amount - rate);
    out[d.id] = { amount, open, hand, idle };
  }
  return out;
}

/** Click a door: open it (and it stays open), or close it. Null states means nothing changed, with the reason in `said`. */
export function toggleDoor(states: DoorStates, door: DoorInfo, who: { p: Point; feet: number } | null, mode: DoorMode): { states: DoorStates; said?: string } {
  if (mode !== "normal") return { states, said: mode === "none" ? "The doors are off. Change Doors to Normal to use them." : `Doors are set to ${mode === "open" ? "All open" : "All closed"}. Change Doors to Normal to use them.` };
  const was = states[door.id] ?? shut();
  if (was.open) {
    if (who && inDoorway(door, who.p, who.feet)) return { states, said: "Step out of the doorway first." };
    return { states: { ...states, [door.id]: { ...was, open: false, hand: false, idle: 0 } } };
  }
  return { states: { ...states, [door.id]: { ...was, open: true, hand: true, idle: 0 } } };
}

/** The door a ray from `eye` along `dir` (a unit vector; z is up) reaches first within `reach` inches. */
export function aimDoor(
  doors: DoorInfo[],
  eye: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  reach: number,
  /** True when a wall is in the way between two plan points at that height. */
  blocked?: (a: Point, b: Point, z: number) => boolean,
): DoorInfo | null {
  let best: { d: DoorInfo; t: number } | null = null;
  for (const d of doors) {
    const flat = dir.x * d.n.x + dir.y * d.n.y;
    if (Math.abs(flat) < 1e-6) continue;
    const t = ((d.center.x - eye.x) * d.n.x + (d.center.y - eye.y) * d.n.y) / flat;
    if (t <= 0 || t > reach || (best && t >= best.t)) continue;
    const hit = { x: eye.x + dir.x * t, y: eye.y + dir.y * t };
    const z = eye.z + dir.z * t;
    const along = (hit.x - d.center.x) * d.u.x + (hit.y - d.center.y) * d.u.y;
    if (Math.abs(along) > d.widthIn / 2 || z < d.z0 || z > d.z1) continue;
    if (blocked?.({ x: eye.x, y: eye.y }, add(hit, scale(sub({ x: eye.x, y: eye.y }, hit), 1 / Math.max(dist(eye, hit), 1e-6))), z)) continue;
    best = { d, t };
  }
  return best?.d ?? null;
}

/** The pose of a door leaf at `amount` (0 to 1), as plan math: the angle to turn by, the plan shift, and the share its height shrinks to. */
export function leafPose(motion: { kind: "swing"; angle: number } | { kind: "slide"; shift: Point } | { kind: "roll" }, amount: number): { turn: number; shift: Point; stretch: number } {
  if (motion.kind === "swing") return { turn: motion.angle * amount, shift: { x: 0, y: 0 }, stretch: 1 };
  if (motion.kind === "slide") return { turn: 0, shift: scale(motion.shift, amount), stretch: 1 };
  return { turn: 0, shift: { x: 0, y: 0 }, stretch: 1 - 0.92 * amount };
}
