import type { Point } from "@/lib/model/schema";
import { add, rotate } from "@/lib/plan/geometry";
import type { Quality } from "@/lib/graphics";
import { SHOWER_HEAD_IN, SHOWER_VALVE_IN, type Faucet, type FaucetShape } from "@/lib/furnish/faucets";
import { hex, MeshBuilder, type Frame, type RGB } from "./mesh";

/**
 * Faucets, tub spouts, shower heads, pot fillers and hose spigots in 3D
 * (where they go is worked out in lib/furnish/faucets.ts). Each is drawn in
 * its own frame: its back at `at` (on the deck or the wall), +y over the
 * basin. Pretty graphics draws round posts and a curved gooseneck; Fast
 * draws the same faucet as plain blocks.
 */

export type FaucetLook = Pick<Faucet, "shape" | "at" | "rotation" | "z" | "color"> & { shower?: boolean };

/** Brass for hose spigots. */
export const BRASS = "#b08d57";
const DARK: RGB = hex("#3a3632");

class Drawer {
  constructor(
    private mb: MeshBuilder,
    private f: Frame,
    private at: Point,
    private rotation: number,
    private base: number,
    private color: RGB,
    private pretty: boolean,
    /** How high the base is above the floor (the deck or the tub rim). */
    readonly rim: number,
  ) {}

  private p(x: number, y: number): Point {
    return add(this.at, rotate({ x, y }, this.rotation));
  }

  /** A box in the faucet's frame, by its middle and size; z from its base. */
  box(x: number, y: number, w: number, d: number, z0: number, z1: number, color = this.color) {
    this.mb.block(this.f, this.p(x, y), this.rotation, w, d, this.base + z0, this.base + z1, color);
  }

  /** A round post (an octagon with Pretty, a square with Fast). */
  post(x: number, y: number, dia: number, z0: number, z1: number, color = this.color) {
    if (!this.pretty) return this.box(x, y, dia, dia, z0, z1, color);
    const n = 10;
    const outline = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return this.p(x + (Math.cos(t) * dia) / 2, y + (Math.sin(t) * dia) / 2);
    });
    const c = color;
    this.mb.prism(this.f, { outline, holes: [] }, this.base + z0, this.base + z1, () => ({ color: c }), c);
    this.mb.flat(this.f, outline, [], this.base + z0, c, false);
  }

  /** A gooseneck: up from the base at `top`, over toward +y, and down to `reach`; Fast draws it as an upside-down L. */
  gooseneck(x: number, top: number, reach: number, tube: number) {
    const R = reach / 2;
    if (!this.pretty) {
      this.box(x, R, tube, reach + tube, top + R - tube / 2, top + R + tube / 2);
      this.box(x, reach, tube, tube, top - 1, top + R);
      return;
    }
    const n = 9;
    const pt = (i: number) => {
      const t = (i / n) * Math.PI;
      return { y: R - R * Math.cos(t), z: top + R * Math.sin(t) };
    };
    for (let i = 0; i < n; i++) {
      const a = pt(i);
      const b = pt(i + 1);
      this.box(x, (a.y + b.y) / 2, tube, Math.abs(b.y - a.y) + tube * 0.7, Math.min(a.z, b.z) - tube / 2, Math.max(a.z, b.z) + tube / 2);
    }
    this.post(x, reach, tube * 1.2, top - 1.5, top);
  }

  /** A lever handle sticking out sideways at height z. */
  lever(x: number, y: number, z: number, length: number, dir: 1 | -1 = 1) {
    this.box(x + (dir * length) / 2, y, length, 0.6, z, z + 0.5);
  }

  /** A cross or knob handle on a short post. */
  handle(x: number, y: number, z0: number, h: number) {
    this.post(x, y, 1.6, z0, z0 + h);
    this.box(x, y, 2.6, 0.5, z0 + h - 0.6, z0 + h);
  }

  /** A round plate flat on the wall (the wall is at y = 0). */
  wallPlate(x: number, z: number, size: number) {
    this.box(x, 0.25, size, 0.5, z - size / 2, z + size / 2);
  }

  /** A spout straight out of the wall at height z. */
  wallSpout(x: number, z: number, reach: number, tube = 1.2) {
    this.box(x, reach / 2, tube, reach, z - tube / 2, z + tube / 2);
    this.box(x, reach - tube / 2, tube, tube, z - tube / 2 - 1, z - tube / 2);
  }

  /** A round shower head facing down. */
  head(x: number, y: number, z: number, dia: number) {
    this.post(x, y, dia, z - 1, z);
    this.post(x, y, dia * 0.8, z - 1.3, z - 1, DARK);
  }
}

function drawShape(d: Drawer, shape: FaucetShape, shower: boolean) {
  switch (shape) {
    case "pull-down":
      d.post(0, 0, 2.4, 0, 1);
      d.post(0, 0, 1.4, 0, 10);
      d.gooseneck(0, 10, 8, 1.2);
      d.lever(0.7, 0, 7, 3);
      return;
    case "pull-out":
      d.post(0, 0, 2.4, 0, 1);
      d.post(0, 0, 1.6, 0, 7);
      d.box(0, 4, 1.4, 8, 5.8, 7.2);
      d.post(0, 8, 1.8, 4.8, 7.2);
      d.lever(0.8, 0, 7.2, 3);
      return;
    case "bridge":
      d.handle(-4, 0, 0, 3.5);
      d.handle(4, 0, 0, 3.5);
      d.box(0, 0, 8, 1, 3, 4);
      d.post(0, 0, 1.2, 3, 8);
      d.gooseneck(0, 8, 7, 1);
      return;
    case "wall-mount":
      d.wallPlate(0, 9, 3);
      d.wallSpout(0, 9, 10);
      d.wallPlate(-4, 12, 2);
      d.wallPlate(4, 12, 2);
      d.box(-4, 1.5, 0.8, 2, 11.6, 12.4);
      d.box(4, 1.5, 0.8, 2, 11.6, 12.4);
      return;
    case "single":
      d.post(0, 0, 2.2, 0, 1);
      d.post(0, 0, 1.5, 0, 5);
      d.box(0, 2.5, 1.2, 5, 4, 5);
      d.box(0, -0.5, 0.6, 2.5, 5, 5.5);
      return;
    case "widespread":
      d.handle(-4, 0, 0, 3);
      d.handle(4, 0, 0, 3);
      d.post(0, 0, 1.4, 0, 5);
      d.gooseneck(0, 5, 4, 1);
      return;
    case "vessel":
      d.post(0, 0, 2.2, 0, 1);
      d.post(0, 0, 1.4, 0, 12);
      d.box(0, 2.8, 1.2, 5.6, 11, 12);
      d.box(0, -0.5, 0.6, 2.5, 12, 12.5);
      return;
    case "deck":
      d.post(0, 4, 1.6, 0, 6);
      d.box(0, 6.5, 1.4, 5, 5, 6.4);
      d.handle(-5, 4, 0, 3);
      d.handle(5, 4, 0, 3);
      if (shower) showerArm(d);
      return;
    case "wall-spout":
      d.wallPlate(0, 4, 2.5);
      d.wallSpout(0, 4, 7, 1.6);
      d.wallPlate(0, 12, 6);
      d.box(0, 1.5, 0.8, 2.5, 11.6, 12.4);
      d.lever(0, 2.5, 11.8, 3);
      if (shower) showerArm(d);
      return;
    case "freestanding":
      d.post(0, 0, 3, 0, 0.6);
      d.post(0, 0, 1.6, 0, 34);
      d.gooseneck(0, 34, 8, 1.4);
      d.lever(0.8, 0, 28, 3);
      return;
    case "standard":
      d.wallPlate(0, SHOWER_VALVE_IN, 6.5);
      d.box(0, 1.5, 0.8, 2.5, SHOWER_VALVE_IN - 0.4, SHOWER_VALVE_IN + 0.4);
      d.lever(0, 2.5, SHOWER_VALVE_IN - 0.2, 3.5);
      showerArm(d);
      return;
    case "rain":
      d.wallPlate(0, SHOWER_VALVE_IN, 6.5);
      d.lever(0, 2, SHOWER_VALVE_IN - 0.2, 3.5);
      d.wallPlate(0, SHOWER_HEAD_IN + 4, 2.5);
      d.box(0, 7, 1, 14, SHOWER_HEAD_IN + 3.5, SHOWER_HEAD_IN + 4.5);
      d.box(0, 14, 10, 10, SHOWER_HEAD_IN + 2.5, SHOWER_HEAD_IN + 3.5);
      d.box(0, 14, 9, 9, SHOWER_HEAD_IN + 2.3, SHOWER_HEAD_IN + 2.5, DARK);
      return;
    case "handheld":
      d.wallPlate(0, SHOWER_VALVE_IN, 6.5);
      d.lever(0, 2, SHOWER_VALVE_IN - 0.2, 3.5);
      d.box(9, 1.2, 1, 1, SHOWER_VALVE_IN + 6, SHOWER_HEAD_IN - 4);
      d.box(9, 0.4, 1.4, 0.8, SHOWER_VALVE_IN + 5, SHOWER_VALVE_IN + 6.5);
      d.box(9, 0.4, 1.4, 0.8, SHOWER_HEAD_IN - 5, SHOWER_HEAD_IN - 3.5);
      d.post(9, 2.8, 1.2, SHOWER_HEAD_IN - 14, SHOWER_HEAD_IN - 6);
      d.head(9, 2.8, SHOWER_HEAD_IN - 4.5, 3.5);
      return;
    case "utility":
      d.handle(-3, 0, 0, 3);
      d.handle(3, 0, 0, 3);
      d.post(0, 0, 1.2, 0, 6);
      d.gooseneck(0, 6, 6, 1);
      return;
    case "pot-filler":
      d.wallPlate(0, 0, 3);
      d.box(0, 1.5, 1.2, 3, -0.6, 0.6);
      d.post(0, 3, 1.6, -1.2, 1.2);
      d.box(5, 3, 10, 1.1, -0.5, 0.5);
      d.post(10, 3, 1.4, -1, 1);
      d.box(15, 3, 10, 1.1, -0.5, 0.5);
      d.post(20, 3, 1.2, -3, 0.5);
      d.lever(1, 3, 1.2, 2.5);
      return;
    case "spigot":
      d.post(0, 0.25, 2.6, -1.3, 1.3);
      d.box(0, 2, 1.4, 3.5, -0.7, 0.7);
      d.box(0, 3.5, 1.2, 1.2, -2.2, 0.7);
      d.post(0, 2, 0.6, 0.7, 1.8);
      d.post(0, 2, 2.6, 1.8, 2.2, hex("#c0392b"));
      return;
  }
}

/** The tub/shower head and arm high on the wall, above a tub spout or a shower valve. */
function showerArm(d: Drawer) {
  // Heights in the faucet's frame are from its base (the tub rim for tubs): the head is 78" off the floor either way.
  const z = SHOWER_HEAD_IN - d.rim;
  d.wallPlate(0, z + 2, 2.5);
  d.box(0, 3, 1, 6, z + 1.5, z + 2.5);
  d.box(0, 6, 1, 1, z, z + 2);
  d.head(0, 6.5, z, 4.5);
}

/** One faucet (or pot filler, or spigot) into `mb`. `floorIn` is its floor's height. */
export function drawFaucet(mb: MeshBuilder, f: Frame, fc: FaucetLook, floorIn: number, quality: Quality) {
  const d = new Drawer(mb, f, fc.at, fc.rotation, floorIn + fc.z, hex(fc.color), quality === "pretty", fc.z);
  drawShape(d, fc.shape, Boolean(fc.shower));
}
