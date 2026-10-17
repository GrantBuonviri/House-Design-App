import type { Point } from "@/lib/model/schema";
import { add, scale } from "@/lib/plan/geometry";
import { openingType } from "@/lib/plan/catalog";
import type { OpeningGeometry } from "@/lib/plan/walls";
import { COLORS } from "./colors";
import { PATTERN } from "./finishes";
import { MeshBuilder, type Frame, type RGB } from "./mesh";
import type { ExteriorLook } from "./exterior";

/**
 * Doors, windows and openings in 3D. The frame, casing and glass of a window
 * go into the builders you pass in. A door's moving parts (the leaf, the
 * sliding pane, the garage door) come back as `DoorLeaf`s drawn closed, each
 * with the motion that opens it, so the walkthrough can swing them.
 */

/** How a door leaf gets from closed to open. Plan inches and radians, like the rest of lib/house3d. */
export type DoorMotion =
  /** Turns about the upright line through `hinge`; `angle` is the turn when fully open (plan angles run from east toward south). */
  | { kind: "swing"; hinge: Point; angle: number }
  /** Slides along the wall by `shift`. */
  | { kind: "slide"; shift: Point }
  /** Rolls up into the header: shrinks toward `topIn` (the height of its top, above the main floor). */
  | { kind: "roll"; topIn: number };

export type DoorLeaf = { motion: DoorMotion; solid: MeshBuilder; glass: MeshBuilder };

/** The turn, in plan angle, that takes a leaf pointing along `from` to point along `to`. */
const turnBetween = (from: Point, to: Point) => Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);

/** Where a point goes when turned `angle` about `c` (plan angles run from east toward south). */
export function turnAbout(p: Point, c: Point, angle: number): Point {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

const FRAME_IN = 2.5;
const CASING_IN = 0.75;
const SLAB_IN = 1.75;

/** Height of the bottom and top of an opening above its floor. */
export function openingSpan(og: OpeningGeometry, ceilingIn: number): { bottom: number; top: number } {
  const o = og.opening;
  const bottom = o.kind === "window" ? (o.sillIn ?? openingType(o.style).sillIn ?? 30) : 0;
  const top = Math.min(bottom + o.heightIn, ceilingIn - 1);
  return { bottom: Math.min(bottom, top - 6), top };
}

const at = (og: OpeningGeometry, t: number): Point => add(og.a, scale(og.u, t));

/**
 * Draw one door, window or opening. `wallIn` is the thickness of the wall
 * it's in, `floorIn` the floor height it stands on.
 */
export function drawOpening(
  solid: MeshBuilder,
  glass: MeshBuilder,
  f: Frame,
  og: OpeningGeometry,
  wallIn: number,
  floorIn: number,
  ceilingIn: number,
  /** Picked inside door and trim colors, for doors between rooms. */
  look?: { door: RGB; trim: RGB },
  /** Picked window frame, door and trim colors, for doors and windows in outside walls. */
  outside?: ExteriorLook,
): DoorLeaf[] {
  const o = og.opening;
  const w = o.widthIn;
  const { bottom, top } = openingSpan(og, ceilingIn);
  const z0 = floorIn + bottom;
  const z1 = floorIn + top;
  const depth = wallIn + 1;
  const plain = (c: RGB) => ({ left: c, right: c, ends: c, top: c, bottom: c });

  if (o.kind === "window") {
    const c = plain(outside?.frame ?? COLORS.frame);
    solid.box(f, og.a, at(og, FRAME_IN), depth, z0, z1, c);
    solid.box(f, at(og, w - FRAME_IN), og.b, depth, z0, z1, c);
    solid.box(f, og.a, og.b, depth, z1 - FRAME_IN, z1, c);
    solid.box(f, og.a, og.b, depth + 1.5, z0, z0 + FRAME_IN, c);
    // A middle bar on wide windows.
    if (w > 60) solid.box(f, at(og, w / 2 - 1), at(og, w / 2 + 1), 2, z0 + FRAME_IN, z1 - FRAME_IN, c);
    glass.box(f, at(og, FRAME_IN), at(og, w - FRAME_IN), 0.5, z0 + FRAME_IN, z1 - FRAME_IN, plain(COLORS.glass));
    return [];
  }

  // Doors and openings: a casing lining the sides and top.
  const c = plain(look?.trim ?? (outside && o.style !== "door-slider" ? outside.trim : undefined) ?? (o.style === "door-slider" && outside ? outside.patioFrame : COLORS.trim));
  solid.box(f, og.a, at(og, CASING_IN), depth, z0, z1, c);
  solid.box(f, at(og, w - CASING_IN), og.b, depth, z0, z1, c);
  solid.box(f, og.a, og.b, depth, z1 - CASING_IN, z1, c);
  if (o.kind === "opening") return [];

  const side = o.side ?? 1;
  const swing = scale(og.n, side);
  const leaves: DoorLeaf[] = [];
  const newLeaf = (motion: DoorMotion): DoorLeaf => {
    const l = { motion, solid: new MeshBuilder(), glass: new MeshBuilder() };
    // Painted door slabs with Pretty graphics.
    l.solid.pattern = PATTERN.paint;
    leaves.push(l);
    return l;
  };
  const style = o.style;
  const slabTop = z1 - CASING_IN - 0.25;
  // A hinged leaf, drawn closed in the doorway; it swings out to the hung side about its hinge.
  const hinged = (hingeT: number, dir: 1 | -1, length: number, color: RGB) => {
    const pivot = at(og, hingeT + dir * (CASING_IN + SLAB_IN / 2));
    const along = scale(og.u, dir);
    const l = newLeaf({ kind: "swing", hinge: pivot, angle: turnBetween(along, swing) });
    l.solid.box(f, pivot, add(pivot, scale(along, length)), SLAB_IN, z0 + 0.5, slabTop, plain(color));
  };
  if (style === "door-garage") {
    const l = newLeaf({ kind: "roll", topIn: z1 - CASING_IN });
    l.solid.box(f, at(og, CASING_IN), at(og, w - CASING_IN), 2, z0, z1 - CASING_IN, plain(outside?.garageDoor ?? COLORS.garageDoor));
    // Panel lines.
    for (let k = 1; k < 4; k++) {
      const z = z0 + ((z1 - z0) * k) / 4;
      l.solid.box(f, at(og, CASING_IN), at(og, w - CASING_IN), 2.6, z - 0.4, z + 0.4, plain(outside?.trim ?? COLORS.trim));
    }
    return leaves;
  }
  if (style === "door-slider") {
    const half = (w - 2 * CASING_IN) / 2;
    // The back pane stays; the front pane and its edge bar slide along it.
    const back = scale(og.n, 1.2);
    glass.box(f, add(at(og, CASING_IN), back), add(at(og, CASING_IN + half), back), 0.5, z0 + 1, z1 - CASING_IN, plain(COLORS.glass));
    const closedAt = w - CASING_IN - half - 1;
    const l = newLeaf({ kind: "slide", shift: scale(og.u, CASING_IN - closedAt) });
    l.glass.box(f, at(og, closedAt), at(og, w - CASING_IN), 0.5, z0 + 1, z1 - CASING_IN, plain(COLORS.glass));
    l.solid.box(f, at(og, closedAt), at(og, closedAt + 2), depth, z0, z1, c);
    return leaves;
  }
  if (style === "door-pocket") {
    // Slides into the wall beside it, out of sight.
    const run = w - 2 * CASING_IN;
    const l = newLeaf({ kind: "slide", shift: scale(og.u, (o.hinge ?? "start") === "start" ? -run : run) });
    l.solid.box(f, at(og, CASING_IN), at(og, w - CASING_IN), SLAB_IN, z0 + 0.5, slabTop, plain(look?.door ?? COLORS.door));
    return leaves;
  }
  if (style === "door-bifold") {
    // Two pairs of panels; each folds toward its own end and out into the room.
    const half = (w - 2 * CASING_IN) / 2;
    for (const [from, dir] of [[CASING_IN, 1], [w - CASING_IN, -1]] as const) {
      const l = newLeaf({ kind: "slide", shift: add(scale(og.u, -dir * half * 0.7), scale(swing, half * 0.35)) });
      l.solid.box(f, at(og, from), at(og, from + dir * half), SLAB_IN, z0 + 0.5, slabTop, plain(look?.door ?? COLORS.door));
    }
    return leaves;
  }
  if (style === "door-barn") {
    // Slides along the wall face, past the end of the opening.
    const off = scale(swing, wallIn / 2 + 1.5);
    const l = newLeaf({ kind: "slide", shift: scale(og.u, w * 0.85 + 2) });
    l.solid.box(f, add(at(og, -2), off), add(at(og, w + 2), off), SLAB_IN, z0 + 0.5, z1 + 2, plain(COLORS.wood));
    return leaves;
  }
  const color = style === "door-entry" ? (outside?.frontDoor ?? COLORS.frontDoor) : (look?.door ?? COLORS.door);
  if (style === "door-double") {
    const len = w / 2 - 1.9;
    hinged(0, 1, len, color);
    hinged(w, -1, len, color);
    return leaves;
  }
  const len = w - 2 * CASING_IN - SLAB_IN / 2 - 0.5;
  if ((o.hinge ?? "start") === "start") hinged(0, 1, len, color);
  else hinged(w, -1, len, color);
  return leaves;
}
