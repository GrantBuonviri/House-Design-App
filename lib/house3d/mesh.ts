import { ShapeUtils, Vector2 } from "three";
import type { Point } from "@/lib/model/schema";

/**
 * Plain triangle data for the 3D house, built without touching the GPU so it
 * can be tested. Everything going in is in plan inches (x east, y south) with
 * heights in inches above the main floor; everything coming out is in scene
 * feet with x east, y up and z south, centered on the house.
 */

export const IN_PER_UNIT = 12;

export type Vec3 = [number, number, number];

/** Where a plan point and height land in the scene. */
export type Frame = { ox: number; oy: number };

export function toScene(f: Frame, p: Point, z: number): Vec3 {
  return [(p.x - f.ox) / IN_PER_UNIT, z / IN_PER_UNIT, (p.y - f.oy) / IN_PER_UNIT];
}

/** A color as 0 to 1 channels in linear light, ready for the renderer. */
export type RGB = [number, number, number];

export function hex(color: string): RGB {
  const n = parseInt(color.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
  return [c[0], c[1], c[2]];
}

export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** A floor pattern per corner (see PATTERN in finishes.ts); left out when there are none. */
  patterns?: Float32Array;
  /** How many triangles. */
  count: number;
};

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

/** Collects triangles. Points go in already in scene units (see `toScene`). */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private pat: number[] = [];
  private patterned = false;
  /** The floor pattern given to triangles added from now on (0 for none). */
  pattern = 0;

  get empty() {
    return this.pos.length === 0;
  }

  /** One triangle, wound so its front faces `facing` (or its own normal when none is given). */
  tri(a: Vec3, b: Vec3, c: Vec3, color: RGB, facing?: Vec3) {
    let n = cross3(sub3(b, a), sub3(c, a));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-10) return;
    if (facing && dot3(n, facing) < 0) {
      [b, c] = [c, b];
      n = [-n[0], -n[1], -n[2]];
    }
    n = norm3(n);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
      this.pat.push(this.pattern);
    }
    if (this.pattern) this.patterned = true;
  }

  /** A flat four-cornered face, corners in order around it. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, facing: Vec3) {
    this.tri(a, b, c, color, facing);
    this.tri(a, c, d, color, facing);
  }

  /**
   * A flat face from a polygon (with holes) lying in a horizontal plane:
   * `outline` and `holes` are plan points, all at height `z`.
   */
  flat(f: Frame, outline: Point[], holes: Point[][], z: number, color: RGB, up: boolean) {
    const v = (ps: Point[]) => ps.map((p) => new Vector2(p.x, p.y));
    const contour = v(outline);
    const hs = holes.map(v);
    let tris: number[][];
    try {
      tris = ShapeUtils.triangulateShape(contour, hs);
    } catch {
      return;
    }
    const all = [...outline, ...holes.flat()];
    const facing: Vec3 = up ? [0, 1, 0] : [0, -1, 0];
    for (const [i, j, k] of tris) this.tri(toScene(f, all[i], z), toScene(f, all[j], z), toScene(f, all[k], z), color, facing);
  }

  /**
   * A slanted flat face (like a roof plane) from a polygon in plan with a
   * height at each corner. Wound to face up.
   */
  sloped(f: Frame, outline: Point[], heights: number[], color: RGB) {
    let tris: number[][];
    try {
      tris = ShapeUtils.triangulateShape(outline.map((p) => new Vector2(p.x, p.y)), []);
    } catch {
      return;
    }
    for (const [i, j, k] of tris) this.tri(toScene(f, outline[i], heights[i]), toScene(f, outline[j], heights[j]), toScene(f, outline[k], heights[k]), color, [0, 1, 0]);
  }

  /**
   * An upright face between two plan points, from z0 to z1 at each end
   * (which can differ, for the sides of a sloped roof). Faces toward `out`
   * in plan (a direction, not a point).
   */
  upright(f: Frame, a: Point, b: Point, z0a: number, z1a: number, z0b: number, z1b: number, out: Point, color: RGB) {
    const facing: Vec3 = [out.x, 0, out.y];
    const A0 = toScene(f, a, z0a);
    const A1 = toScene(f, a, z1a);
    const B0 = toScene(f, b, z0b);
    const B1 = toScene(f, b, z1b);
    this.tri(A0, B0, B1, color, facing);
    this.tri(A0, B1, A1, color, facing);
  }

  /**
   * A box standing on the plan: a thick line from a to b, `thickness`
   * across, from z0 up to z1. `colors` paints each side: left and right of
   * the line (walking from a to b), the two ends, and the top and bottom.
   */
  box(
    f: Frame,
    a: Point,
    b: Point,
    thickness: number,
    z0: number,
    z1: number,
    colors: { left: RGB; right: RGB; ends: RGB; top: RGB; bottom?: RGB; leftPattern?: number },
  ) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6 || z1 - z0 < 1e-6) return;
    const u = { x: dx / L, y: dy / L };
    const n = { x: u.y, y: -u.x }; // left of a -> b
    const h = thickness / 2;
    const pl = (p: Point, s: number): Point => ({ x: p.x + n.x * h * s, y: p.y + n.y * h * s });
    const aL = pl(a, 1);
    const bL = pl(b, 1);
    const aR = pl(a, -1);
    const bR = pl(b, -1);
    const was = this.pattern;
    if (colors.leftPattern !== undefined) this.pattern = colors.leftPattern;
    this.upright(f, aL, bL, z0, z1, z0, z1, n, colors.left);
    this.pattern = was;
    this.upright(f, aR, bR, z0, z1, z0, z1, { x: -n.x, y: -n.y }, colors.right);
    this.upright(f, aL, aR, z0, z1, z0, z1, { x: -u.x, y: -u.y }, colors.ends);
    this.upright(f, bL, bR, z0, z1, z0, z1, u, colors.ends);
    const top = [aL, bL, bR, aR];
    this.quad(...(top.map((p) => toScene(f, p, z1)) as [Vec3, Vec3, Vec3, Vec3]), colors.top, [0, 1, 0]);
    if (colors.bottom) this.quad(...(top.map((p) => toScene(f, p, z0)) as [Vec3, Vec3, Vec3, Vec3]), colors.bottom, [0, -1, 0]);
  }

  /** A box around its middle point, turned `rotationDeg` clockwise (plan), `w` wide along x and `d` deep along y. */
  block(f: Frame, c: Point, rotationDeg: number, w: number, d: number, z0: number, z1: number, color: RGB, top?: RGB) {
    const t = (rotationDeg * Math.PI) / 180;
    const ux = { x: Math.cos(t), y: Math.sin(t) };
    const a = { x: c.x - (ux.x * w) / 2, y: c.y - (ux.y * w) / 2 };
    const b = { x: c.x + (ux.x * w) / 2, y: c.y + (ux.y * w) / 2 };
    this.box(f, a, b, d, z0, z1, { left: color, right: color, ends: color, top: top ?? color, bottom: color });
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.col),
      ...(this.patterned ? { patterns: new Float32Array(this.pat) } : {}),
      count: this.pos.length / 9,
    };
  }
}
