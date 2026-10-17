import type { FloorPlan, Opening, Point } from "@/lib/model/schema";
import { CATEGORY_COLOR } from "@/lib/bubbles/shapes";
import { roomType } from "@/lib/brief/rooms";
import { openingType } from "@/lib/plan/catalog";
import { angleOf, dist } from "@/lib/plan/geometry";
import { DRAW_STEP_DEG, flatPlan } from "@/lib/plan/flatten";
import { clampOffset, nearestHost, openingGeometry, type OpeningGeometry } from "@/lib/plan/walls";

/** Small helpers for the floor plan canvas (PlanCanvas.tsx and PlanCanvasLayers.tsx). */

export type Box = { x0: number; y0: number; x1: number; y1: number };

export const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

export function roomFill(type?: string): string {
  return type ? CATEGORY_COLOR[roomType(type).category] : "#e6dfd2";
}

/** Text that reads left to right whichever way its wall runs. */
export function uprightAngle(d: Point): number {
  let a = angleOf(d);
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

export function pointIn(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) > 1) out.push(p);
  if (out.length > 2 && dist(out[0], out[out.length - 1]) <= 1) out.pop();
  return out;
}

/** Where a door or window would land if placed at this point. */
export function ghostOpeningAt(plan: FloorPlan, p: Point, style: string, s: number): { g: OpeningGeometry; thickness: number } | null {
  const near = nearestHost(plan, p, Math.max(30, 24 / s));
  if (!near) return null;
  const t = openingType(style);
  const o: Opening = {
    id: "ghost",
    host: near.seg.host,
    offsetIn: clampOffset(near.t, t.widths[0], near.seg.length),
    kind: t.kind,
    style: t.id,
    widthIn: t.widths[0],
    heightIn: t.heightIn,
    side: near.side,
    hinge: "start",
  };
  // On a curve the unit stands as a flat chord: work out where from the flattened wall.
  const withIt = near.seg.bulge ? flatPlan({ ...plan, openings: [o] }, DRAW_STEP_DEG) : { ...plan, openings: [o] };
  const g = openingGeometry(withIt, withIt.openings[0]);
  return g ? { g, thickness: 6 } : null;
}

const stripeTiles = new Map<string, HTMLCanvasElement | null>();

/** A tile of diagonal stripes for shading, made once per color and strength. Null where there's no document (tests). */
export function stripes(rgb = "200,50,40", alpha = 0.75): HTMLCanvasElement | null {
  const key = `${rgb}/${alpha}`;
  const cached = stripeTiles.get(key);
  if (cached !== undefined) return cached;
  let tile: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = c.height = 10;
    const g = c.getContext("2d");
    if (g) {
      g.strokeStyle = `rgba(${rgb},${alpha})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-2, 12);
      g.lineTo(12, -2);
      g.stroke();
      tile = c;
    }
  }
  stripeTiles.set(key, tile);
  return tile;
}
