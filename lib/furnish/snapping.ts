import type { FloorPlan, Point } from "@/lib/model/schema";
import { add, dot, rotate, round1, scale } from "@/lib/plan/geometry";
import { furnitureType } from "@/lib/plan/furniture";
import { wallGaps } from "./stage";
import { roomAt, type LayerItem } from "./layer";

/**
 * Lining furniture up while it's placed or dragged: a nightstand slides up
 * against the side of the bed, a dresser lines up with the bed's foot, and
 * anything backed onto a wall slides into the corner when it's close. Only
 * items in the same room, turned the same way (or a quarter turn), line up.
 */

/** How close (in inches) an edge has to be before it jumps to line up. */
export const SNAP_REACH_IN = 6;
/** Items that touch are left this far apart so they never count as on top of each other. */
const TOUCH_GAP_IN = 0.1;
/** Where the wall snap leaves an item's back: half a wall plus a little air, from the wall's line (as `snapToWall`). */
const OFF_WALL_IN = 2.5;

export type SnapLine = { a: Point; b: Point };
export type Snapped = { x: number; y: number; lines: SnapLine[] };

type Box = Pick<LayerItem, "x" | "y" | "rotation" | "widthIn" | "depthIn">;
type Mover = Box & { id?: string; mount: LayerItem["mount"]; entryId: string };

const isFlat = (entryId: string) => entryId.startsWith("furniture:") && Boolean(furnitureType(entryId.slice(10))?.flat);
const turnOf = (deg: number) => (((Math.round(deg) % 360) + 360) % 360);

/** An item's half sizes along the mover's own across (u) and front-to-back (v) directions, or null when it's turned some other way. */
function halves(o: Box, rotation: number): { hu: number; hv: number } | null {
  const diff = turnOf(o.rotation - rotation);
  if (diff % 90 !== 0) return null;
  return diff % 180 === 0 ? { hu: o.widthIn / 2, hv: o.depthIn / 2 } : { hu: o.depthIn / 2, hv: o.widthIn / 2 };
}

type Pick1 = { shift: number; line: (moved: { u: number; v: number }) => SnapLine };

/**
 * The item moved to line up with what's around it. `onWall` keeps it on the
 * wall it was backed onto (it only slides along it). Wall-hung things only
 * line up their middles and sides with what's below them; they never touch.
 */
export function lineUp(plan: FloorPlan, m: Mover, others: LayerItem[], onWall: boolean, reachIn = SNAP_REACH_IN): Snapped {
  const u = rotate({ x: 1, y: 0 }, m.rotation);
  const v = rotate({ x: 0, y: 1 }, m.rotation);
  const at = (pu: number, pv: number) => add(scale(u, pu), scale(v, pv));
  const cu = dot({ x: m.x, y: m.y }, u);
  const cv = dot({ x: m.x, y: m.y }, v);
  const hu = m.widthIn / 2;
  const hv = m.depthIn / 2;
  const wall = m.mount === "wall";
  let bestU: Pick1 | null = null;
  let bestV: Pick1 | null = null;
  const consider = (axis: "u" | "v", shift: number, line: Pick1["line"]) => {
    if (Math.abs(shift) > reachIn) return;
    const best = axis === "u" ? bestU : bestV;
    if (best && Math.abs(best.shift) <= Math.abs(shift)) return;
    if (axis === "u") bestU = { shift, line };
    else bestV = { shift, line };
  };

  if (m.mount !== "ceiling" && !isFlat(m.entryId)) {
    const roomId = roomAt(plan, m)?.id;
    for (const o of others) {
      if (o.roomId && roomId && o.roomId !== roomId) continue;
      if (o.id === m.id || o.mount === "ceiling" || o.kind === "device" || isFlat(o.entryId)) continue;
      if (!wall && o.mount !== "floor") continue;
      const h = halves(o, m.rotation);
      if (!h) continue;
      const ou = dot({ x: o.x, y: o.y }, u);
      const ov = dot({ x: o.x, y: o.y }, v);
      const sideBySide = Math.abs(cv - ov) < hv + h.hv - 1;
      const inLine = Math.abs(cu - ou) < hu + h.hu - 1;
      // Across: touch its side, or line up middles and sides.
      if (sideBySide && !wall) {
        for (const s of [-1, 1]) {
          const target = ou + s * (h.hu + hu + TOUCH_GAP_IN);
          const edge = ou + s * h.hu;
          consider("u", target - cu, (p) => ({ a: at(edge, Math.max(p.v - hv, ov - h.hv)), b: at(edge, Math.min(p.v + hv, ov + h.hv)) }));
        }
      } else {
        const line = (edge: number) => (p: { u: number; v: number }) => ({ a: at(edge, p.v), b: at(edge, ov) });
        consider("u", ou - cu, line(ou));
        consider("u", ou - h.hu - (cu - hu), line(ou - h.hu));
        consider("u", ou + h.hu - (cu + hu), line(ou + h.hu));
      }
      if (onWall || wall) continue;
      // Front to back: touch its front or back, or line up fronts, backs and middles.
      if (inLine) {
        for (const s of [-1, 1]) {
          const target = ov + s * (h.hv + hv + TOUCH_GAP_IN);
          const edge = ov + s * h.hv;
          consider("v", target - cv, (p) => ({ a: at(Math.max(p.u - hu, ou - h.hu), edge), b: at(Math.min(p.u + hu, ou + h.hu), edge) }));
        }
      } else {
        const line = (edge: number) => (p: { u: number; v: number }) => ({ a: at(p.u, edge), b: at(ou, edge) });
        consider("v", ov - cv, line(ov));
        consider("v", ov - h.hv - (cv - hv), line(ov - h.hv));
        consider("v", ov + h.hv - (cv + hv), line(ov + h.hv));
      }
    }
  }

  // Into the corner: a floor item on a wall slides the last few inches until it meets the wall at its end.
  if (onWall && !wall && !bestU && turnOf(m.rotation) % 90 === 0) {
    for (const g of wallGaps(plan, m)) {
      const d = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[g.side];
      const along = dot(d, u);
      if (Math.abs(along) < 0.99) continue;
      const shift = along * (g.inches - OFF_WALL_IN);
      if (Math.abs(g.inches - OFF_WALL_IN) > 0.05) consider("u", shift, () => ({ a: g.guide.to, b: g.guide.to }));
    }
  }

  const du = (bestU as Pick1 | null)?.shift ?? 0;
  const dv = (bestV as Pick1 | null)?.shift ?? 0;
  const moved = { u: cu + du, v: cv + dv };
  const p = add({ x: m.x, y: m.y }, at(du, dv));
  const lines = ([bestU, bestV] as (Pick1 | null)[]).filter((b): b is Pick1 => Boolean(b)).map((b) => b.line(moved)).filter((l) => l.a.x !== l.b.x || l.a.y !== l.b.y);
  return { x: round1(p.x), y: round1(p.y), lines };
}
