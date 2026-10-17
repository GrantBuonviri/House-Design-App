import type { Point } from "@/lib/model/schema";
import { add, rotate } from "@/lib/plan/geometry";
import { toScene, type Frame, type MeshBuilder, type RGB, type Vec3 } from "./mesh";

/**
 * Shape helpers for the detailed (Pretty) items: everything is drawn in an
 * item's own frame, in inches, with x across, y from the back (-) to the
 * front (+), and z up from the item's floor. Plain triangle data, like mesh.ts.
 */

/** One cross-section of a loft: an ellipse (or rounded rectangle, with a power above 2) around (cx, cy) at height z. */
export type Ring = { z: number; rx: number; ry: number; cx?: number; cy?: number; power?: number };

export class ItemFrame {
  constructor(
    readonly mb: MeshBuilder,
    readonly f: Frame,
    readonly center: Point,
    readonly rotation: number,
    readonly floorIn: number,
  ) {}

  /** A local point on the plan. */
  at(x: number, y: number): Point {
    return add(this.center, rotate({ x, y }, this.rotation));
  }

  /** A local point in the scene. */
  scene(x: number, y: number, z: number): Vec3 {
    return toScene(this.f, this.at(x, y), this.floorIn + z);
  }

  /** A box from x0 to x1, y0 to y1 and z0 to z1, with the given surface. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: RGB, pattern: number) {
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    this.mb.pattern = pattern;
    this.mb.block(this.f, this.at((x0 + x1) / 2, (y0 + y1) / 2), this.rotation, x1 - x0, y1 - y0, this.floorIn + z0, this.floorIn + z1, color);
  }

  /** A box with no top, open like a basin's outside shell. */
  openBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: RGB, pattern: number) {
    this.mb.pattern = pattern;
    const c = [this.at(x0, y0), this.at(x1, y0), this.at(x1, y1), this.at(x0, y1)];
    const z = (v: number) => this.floorIn + v;
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ctr = this.at((x0 + x1) / 2, (y0 + y1) / 2);
      this.mb.upright(this.f, a, b, z(z0), z(z1), z(z0), z(z1), { x: mid.x - ctr.x, y: mid.y - ctr.y }, color);
    }
    this.mb.flat(this.f, c, [], z(z0), color, false);
  }

  /** A flat slab from x0..x1, y0..y1 with a hole (local points) cut through it. */
  slabWithHole(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hole: { x: number; y: number }[], color: RGB, pattern: number) {
    this.mb.pattern = pattern;
    const outline = [this.at(x0, y0), this.at(x1, y0), this.at(x1, y1), this.at(x0, y1)];
    const h = hole.map((p) => this.at(p.x, p.y));
    this.mb.flat(this.f, outline, [h], this.floorIn + z1, color, true);
    this.mb.flat(this.f, outline, [h], this.floorIn + z0, color, false);
    const ctr = this.at((x0 + x1) / 2, (y0 + y1) / 2);
    for (let i = 0; i < 4; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % 4];
      this.mb.upright(this.f, a, b, this.floorIn + z0, this.floorIn + z1, this.floorIn + z0, this.floorIn + z1, { x: (a.x + b.x) / 2 - ctr.x, y: (a.y + b.y) / 2 - ctr.y }, color);
    }
  }

  /**
   * A surface swept through rings around an upright axis (`axis` "z") or one
   * pointing out of the front (`axis` "y": a ring's z is then how far forward
   * it is, and cx/cy its across and height). Each band faces away from the
   * solid when the rings run bottom to top up the outside, over the top and
   * down an inside (a basin), so one list draws a bowl with its rim.
   */
  loft(rings: Ring[], color: RGB, pattern: number, segments = 20, axis: "z" | "y" = "z") {
    this.mb.pattern = pattern;
    const ux = rotate({ x: 1, y: 0 }, this.rotation);
    const fwd = rotate({ x: 0, y: 1 }, this.rotation);
    const point = (r: Ring, k: number): Vec3 => {
      const t = (2 * Math.PI * k) / segments;
      const e = 2 / (r.power ?? 2);
      const c = Math.cos(t);
      const s = Math.sin(t);
      const u = Math.sign(c) * Math.abs(c) ** e * r.rx;
      const v = Math.sign(s) * Math.abs(s) ** e * r.ry;
      return axis === "z" ? this.scene((r.cx ?? 0) + u, (r.cy ?? 0) + v, r.z) : this.scene((r.cx ?? 0) + u, r.z, (r.cy ?? 0) + v);
    };
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i];
      const b = rings[i + 1];
      const dz = b.z - a.z;
      const dr = (b.rx + b.ry - a.rx - a.ry) / 2;
      for (let k = 0; k < segments; k++) {
        const t = (2 * Math.PI * (k + 0.5)) / segments;
        const c = Math.cos(t);
        const s = Math.sin(t);
        // Facing: out from the axis times the rise, less the axis times the widening.
        const facing: Vec3 =
          axis === "z"
            ? [(ux.x * c + fwd.x * s) * dz, -dr, (ux.y * c + fwd.y * s) * dz]
            : [ux.x * c * dz - fwd.x * dr, s * dz, ux.y * c * dz - fwd.y * dr];
        const p0 = point(a, k);
        const p1 = point(a, k + 1);
        const q0 = point(b, k);
        const q1 = point(b, k + 1);
        this.mb.tri(p0, p1, q1, color, facing);
        this.mb.tri(p0, q1, q0, color, facing);
      }
    }
  }

  /** A ring's outline as local points, for cutting a hole that a loft fills. */
  static ringPoints(r: Ring, segments = 20): { x: number; y: number }[] {
    const e = 2 / (r.power ?? 2);
    return Array.from({ length: segments }, (_, k) => {
      const t = (2 * Math.PI * k) / segments;
      const c = Math.cos(t);
      const s = Math.sin(t);
      return { x: (r.cx ?? 0) + Math.sign(c) * Math.abs(c) ** e * r.rx, y: (r.cy ?? 0) + Math.sign(s) * Math.abs(s) ** e * r.ry };
    });
  }
}

/** A color made darker (or lighter, above 1). */
export const shade = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

/** How bright a color looks, 0 to 1. */
export const lightness = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
