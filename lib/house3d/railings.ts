import type { PlanStairs, Point } from "@/lib/model/schema";
import { add, dist, lerp, scale, sub, unit } from "@/lib/plan/geometry";
import { HALF_WALL_THICK_IN, HANDRAIL_OFF_IN, POST_IN, railingAt, type Railing, type RiseOf } from "@/lib/plan/railings";
import { COLORS } from "./colors";
import type { LevelHeights } from "./levels";
import { hex, MeshBuilder, toScene, type Frame, type RGB, type Vec3 } from "./mesh";

/**
 * Stair railings in 3D (the railings themselves are worked out in
 * lib/plan/railings.ts): wood posts, cap rail and shoe with white square
 * balusters by default, black metal, or glass panels under a wood cap;
 * handrails on small brackets off the wall; half walls with a wood cap; and
 * full walls. Fast graphics draws one see-through panel in place of the
 * balusters, to keep it light.
 */

const METAL = hex("#26262a");
const BALUSTER_IN = { wood: 1.25, metal: 0.75 } as const;
/** Balusters are no more than 4" apart. */
const GAP_IN = 4;
const RAIL_IN = 1.5;

/** How far stairs climb from a floor, from the floor heights (null when they're too short to build). Matches the 3D stairs and walking. */
export function riseFromHeights(heights: LevelHeights): RiseOf {
  return (s: PlanStairs, from: string) => {
    const h = heights[from];
    if (!h) return null;
    const to = s.toLevelId ? heights[s.toLevelId] : undefined;
    const rise = to ? to.floorIn - h.floorIn : h.ceilingIn + 13;
    return rise > 12 ? rise : null;
  };
}

/** What a floor's railings are drawn into: solid and glass, plus balusters (Pretty graphics) or a see-through panel in their place (Fast). */
export type RailingMeshes = { solid: MeshBuilder; glass: MeshBuilder; balusters: MeshBuilder; panel: MeshBuilder };

/**
 * A beam along a plan line, `thick` across, its bottom and top at each end
 * given separately so it can follow a flight's slope.
 */
export function beam(mb: MeshBuilder, f: Frame, a: Point, b: Point, thick: number, za: [number, number], zb: [number, number], color: RGB) {
  if (dist(a, b) < 1e-6) return;
  const u = unit(sub(b, a));
  const n = { x: u.y, y: -u.x };
  const h = thick / 2;
  const aL = add(a, scale(n, h));
  const bL = add(b, scale(n, h));
  const aR = add(a, scale(n, -h));
  const bR = add(b, scale(n, -h));
  mb.upright(f, aL, bL, za[0], za[1], zb[0], zb[1], n, color);
  mb.upright(f, aR, bR, za[0], za[1], zb[0], zb[1], { x: -n.x, y: -n.y }, color);
  mb.upright(f, aL, aR, za[0], za[1], za[0], za[1], { x: -u.x, y: -u.y }, color);
  mb.upright(f, bL, bR, zb[0], zb[1], zb[0], zb[1], u, color);
  const V = (p: Point, z: number): Vec3 => toScene(f, p, z);
  mb.quad(V(aL, za[1]), V(bL, zb[1]), V(bR, zb[1]), V(aR, za[1]), color, [0, 1, 0]);
  mb.quad(V(aL, za[0]), V(bL, zb[0]), V(bR, zb[0]), V(aR, za[0]), color, [0, -1, 0]);
}

/** Where the railing's top stops sloping and runs flat under the floor above (0 to 1 along it), or null. */
function kinkAt(r: Railing): number | null {
  if (r.maxTop === undefined) return null;
  const ta = r.za + r.heightIn;
  const tb = r.zb + r.heightIn;
  if ((ta - r.maxTop) * (tb - r.maxTop) >= 0) return null;
  return (r.maxTop - ta) / (tb - ta);
}

/**
 * Draw one railing on a floor `floorIn` above the main floor. `wallTopIn` is
 * how high a full wall goes above that floor.
 */
export function drawRailing(m: RailingMeshes, f: Frame, r: Railing, floorIn: number, wallTopIn: number) {
  const L = dist(r.a, r.b);
  if (L < 1) return;
  const at = (t: number) => lerp(r.a, r.b, t);
  const z = (t: number) => {
    const { bottom, top } = railingAt(r, t);
    return { bottom: floorIn + bottom, top: floorIn + top };
  };
  // Split where the top turns flat, so each piece is a straight beam.
  const k = kinkAt(r);
  const spans: [number, number][] = k === null ? [[0, 1]] : [[0, k], [k, 1]];
  const wood = COLORS.wood;
  const metal = r.style === "metal";
  const railColor = metal ? METAL : wood;

  if (r.kind === "wall") {
    beam(m.solid, f, r.a, r.b, HALF_WALL_THICK_IN, [floorIn, floorIn + wallTopIn], [floorIn, floorIn + wallTopIn], COLORS.drywall);
    return;
  }
  if (r.kind === "half-wall") {
    for (const [t0, t1] of spans) {
      const A = z(t0);
      const B = z(t1);
      if (A.top - A.bottom < 1 && B.top - B.bottom < 1) continue;
      beam(m.solid, f, at(t0), at(t1), HALF_WALL_THICK_IN, [A.bottom - 1.5, A.top - 1], [B.bottom - 1.5, B.top - 1], COLORS.drywall);
      beam(m.solid, f, at(t0), at(t1), HALF_WALL_THICK_IN + 1.5, [A.top - 1, A.top], [B.top - 1, B.top], wood);
    }
    return;
  }
  if (r.kind === "handrail") {
    const back = scale(r.toward, -HANDRAIL_OFF_IN);
    for (const [t0, t1] of spans) {
      const A = z(t0);
      const B = z(t1);
      beam(m.solid, f, at(t0), at(t1), 1.75, [A.top - 1.75, A.top], [B.top - 1.75, B.top], railColor);
    }
    // Brackets back to the wall, near each end and about every 4 ft.
    const n = Math.max(2, Math.ceil((L - 12) / 48) + 1);
    for (let i = 0; i < n; i++) {
      const t = L <= 12 ? 0.5 : (6 + ((L - 12) * i) / (n - 1)) / L;
      const p = at(t);
      const top = z(t).top;
      beam(m.solid, f, p, add(p, back), 0.75, [top - 3, top - 1.75], [top - 3, top - 1.75], METAL);
    }
    return;
  }

  // A guard: posts at each end, a shoe along the bottom, a cap rail, and balusters or glass between.
  const capW = metal ? 1.5 : POST_IN;
  for (const t of [0, 1]) {
    const p = add(at(t), scale(unit(sub(r.b, r.a)), (t ? -1 : 1) * (POST_IN / 2)));
    const { bottom, top } = z(t);
    m.solid.block(f, p, (Math.atan2(r.b.y - r.a.y, r.b.x - r.a.x) * 180) / Math.PI, POST_IN, POST_IN, bottom - 1, Math.max(top + 2, bottom + 6), railColor);
  }
  for (const [t0, t1] of spans) {
    const A = z(t0);
    const B = z(t1);
    if (A.top - A.bottom < 4 && B.top - B.bottom < 4) continue;
    beam(m.solid, f, at(t0), at(t1), capW, [A.top - RAIL_IN, A.top], [B.top - RAIL_IN, B.top], r.style === "glass" ? wood : railColor);
    beam(m.solid, f, at(t0), at(t1), capW, [A.bottom, A.bottom + RAIL_IN], [B.bottom, B.bottom + RAIL_IN], r.style === "glass" ? wood : railColor);
    const panel = (mb: MeshBuilder, color: RGB) => beam(mb, f, at(t0), at(t1), 0.5, [A.bottom + RAIL_IN, A.top - RAIL_IN], [B.bottom + RAIL_IN, B.top - RAIL_IN], color);
    if (r.style === "glass") panel(m.glass, COLORS.glass);
    else panel(m.panel, metal ? METAL : COLORS.trim);
  }
  if (r.style === "glass") return;
  const bw = BALUSTER_IN[r.style];
  const clear = L - POST_IN * 2;
  const count = Math.max(0, Math.ceil((clear - GAP_IN) / (bw + GAP_IN)));
  for (let i = 0; i < count; i++) {
    const t = (POST_IN + ((i + 1) * clear) / (count + 1)) / L;
    const { bottom, top } = z(t);
    if (top - bottom < RAIL_IN * 2 + 2) continue;
    m.balusters.block(f, at(t), 0, bw, bw, bottom + RAIL_IN, top - RAIL_IN, metal ? METAL : COLORS.trim);
  }
}
