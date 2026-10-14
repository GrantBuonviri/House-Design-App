import type { Point } from "@/lib/model/schema";
import { add, scale } from "@/lib/plan/geometry";
import { openingType } from "@/lib/plan/catalog";
import type { OpeningGeometry } from "@/lib/plan/walls";
import { COLORS } from "./colors";
import { MeshBuilder, type Frame, type RGB } from "./mesh";

/**
 * Doors, windows and openings in 3D. Doors are shown open, so you can see
 * (and later walk) through them; garage doors are shown closed.
 */

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
export function drawOpening(solid: MeshBuilder, glass: MeshBuilder, f: Frame, og: OpeningGeometry, wallIn: number, floorIn: number, ceilingIn: number) {
  const o = og.opening;
  const w = o.widthIn;
  const { bottom, top } = openingSpan(og, ceilingIn);
  const z0 = floorIn + bottom;
  const z1 = floorIn + top;
  const depth = wallIn + 1;
  const plain = (c: RGB) => ({ left: c, right: c, ends: c, top: c, bottom: c });

  if (o.kind === "window") {
    const c = plain(COLORS.frame);
    solid.box(f, og.a, at(og, FRAME_IN), depth, z0, z1, c);
    solid.box(f, at(og, w - FRAME_IN), og.b, depth, z0, z1, c);
    solid.box(f, og.a, og.b, depth, z1 - FRAME_IN, z1, c);
    solid.box(f, og.a, og.b, depth + 1.5, z0, z0 + FRAME_IN, c);
    // A middle bar on wide windows.
    if (w > 60) solid.box(f, at(og, w / 2 - 1), at(og, w / 2 + 1), 2, z0 + FRAME_IN, z1 - FRAME_IN, c);
    glass.box(f, at(og, FRAME_IN), at(og, w - FRAME_IN), 0.5, z0 + FRAME_IN, z1 - FRAME_IN, plain(COLORS.glass));
    return;
  }

  // Doors and openings: a casing lining the sides and top.
  const c = plain(COLORS.trim);
  solid.box(f, og.a, at(og, CASING_IN), depth, z0, z1, c);
  solid.box(f, at(og, w - CASING_IN), og.b, depth, z0, z1, c);
  solid.box(f, og.a, og.b, depth, z1 - CASING_IN, z1, c);
  if (o.kind === "opening") return;

  const side = o.side ?? 1;
  const swing = scale(og.n, side);
  const leaf = (hingeT: number, dir: 1 | -1, width: number, color: RGB) => {
    // Swung fully open, standing out from the wall at the hinge.
    const hinge = add(at(og, hingeT + dir * (SLAB_IN / 2 + CASING_IN)), scale(swing, wallIn / 2));
    solid.box(f, hinge, add(hinge, scale(swing, width)), SLAB_IN, z0 + 0.5, z1 - CASING_IN - 0.25, plain(color));
  };
  const style = o.style;
  if (style === "door-garage") {
    solid.box(f, at(og, CASING_IN), at(og, w - CASING_IN), 2, z0, z1 - CASING_IN, plain(COLORS.garageDoor));
    // Panel lines.
    for (let k = 1; k < 4; k++) {
      const z = z0 + ((z1 - z0) * k) / 4;
      solid.box(f, at(og, CASING_IN), at(og, w - CASING_IN), 2.6, z - 0.4, z + 0.4, plain(COLORS.trim));
    }
    return;
  }
  if (style === "door-slider") {
    const half = (w - 2 * CASING_IN) / 2;
    glass.box(f, at(og, CASING_IN), at(og, CASING_IN + half + 1), 0.5, z0 + 1, z1 - CASING_IN, plain(COLORS.glass));
    const back = scale(og.n, 1.2);
    glass.box(f, add(at(og, CASING_IN), back), add(at(og, CASING_IN + half), back), 0.5, z0 + 1, z1 - CASING_IN, plain(COLORS.glass));
    solid.box(f, at(og, CASING_IN + half), at(og, CASING_IN + half + 2), depth, z0, z1, c);
    return;
  }
  if (style === "door-pocket") return;
  if (style === "door-barn") {
    // Slid open along the wall face, past the end of the opening.
    const off = scale(swing, wallIn / 2 + 1.5);
    solid.box(f, add(at(og, w * 0.85), off), add(at(og, w * 1.85 + 4), off), SLAB_IN, z0 + 0.5, z1 + 2, plain(COLORS.wood));
    return;
  }
  const color = style === "door-entry" ? COLORS.frontDoor : COLORS.door;
  if (style === "door-double") {
    leaf(0, 1, w / 2 - CASING_IN - 1, color);
    leaf(w, -1, w / 2 - CASING_IN - 1, color);
    return;
  }
  if ((o.hinge ?? "start") === "start") leaf(0, 1, w - 2 * CASING_IN - 1, color);
  else leaf(w, -1, w - 2 * CASING_IN - 1, color);
}
