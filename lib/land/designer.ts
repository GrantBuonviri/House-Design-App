import type { CustomLand, Plot, Point, Project } from "@/lib/model/schema";
import { MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { planOf } from "@/lib/plan/edit";
import { lotOffsetFor } from "@/lib/house3d/site";
import { ACRE_SQ_IN, polygonArea } from "./generate";
import { drawingToCompass } from "./custom";
import { pointInPolygon } from "./geometry";

/** Editing helpers for the land designer. Pure functions on the designer's settings (inches, drawing frame). */

const FT = 12;
const MIN_CORNERS = 3;

export function boxOf(outline: Point[]) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Width and depth of the lot's box, in feet. */
export function boxFeet(outline: Point[]): { widthFt: number; depthFt: number } {
  const b = boxOf(outline);
  return { widthFt: (b.x1 - b.x0) / FT, depthFt: (b.y1 - b.y0) / FT };
}

export function acresOf(outline: Point[]): number {
  return polygonArea(outline) / ACRE_SQ_IN;
}

/**
 * Where a dragged corner lands: the side from the previous corner snaps to
 * 90° and 45° with whole-foot lengths, unless `free` (Shift is held).
 */
export function snapCorner(prev: Point, p: Point, free: boolean): Point {
  if (free) return { x: Math.round(p.x / FT) * FT, y: Math.round(p.y / FT) * FT };
  const dx = p.x - prev.x;
  const dy = p.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return p;
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const l = Math.max(FT, Math.round(len / FT) * FT);
  return { x: Math.round(prev.x + Math.cos(a) * l), y: Math.round(prev.y + Math.sin(a) * l) };
}

/** Snap an angle to every 15°, or leave it (to a whole degree) when `free`. */
export function snapAngle(deg: number, free: boolean): number {
  const d = ((deg % 360) + 360) % 360;
  return free ? Math.round(d) % 360 : (Math.round(d / 15) * 15) % 360;
}

/** Add a corner on side `edge` (default: its middle). Roads on that side now cover both new sides. */
export function insertCorner(land: CustomLand, edge: number, at?: Point): CustomLand {
  const o = land.outline;
  const a = o[edge];
  const b = o[(edge + 1) % o.length];
  const p = at ?? { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  const outline = [...o.slice(0, edge + 1), p, ...o.slice(edge + 1)];
  const roads = land.roads.flatMap((r) => {
    if (r.edge < edge) return [r];
    if (r.edge === edge) return [r, { ...r, id: crypto.randomUUID(), edge: edge + 1 }];
    return [{ ...r, edge: r.edge + 1 }];
  });
  return { ...land, outline, roads };
}

/** Remove corner `i` (never below three). Roads on the two joined sides become one. */
export function removeCorner(land: CustomLand, i: number): CustomLand {
  const n = land.outline.length;
  if (n <= MIN_CORNERS) return land;
  const outline = land.outline.filter((_, k) => k !== i);
  const merged = i === 0 ? n - 2 : i - 1;
  const mapEdge = (e: number) => {
    if (e === (i - 1 + n) % n || e === i) return merged;
    return e > i ? e - 1 : e;
  };
  const roads = [];
  const seen = new Set<number>();
  for (const r of [...land.roads].sort((x, y) => (x.kind === "main" ? -1 : 0) - (y.kind === "main" ? -1 : 0))) {
    const edge = mapEdge(r.edge);
    if (seen.has(edge)) continue;
    seen.add(edge);
    roads.push({ ...r, edge });
  }
  return { ...land, outline, roads: roads.sort((x, y) => x.edge - y.edge) };
}

export function sideLengthFt(outline: Point[], i: number): number {
  const a = outline[i];
  const b = outline[(i + 1) % outline.length];
  return Math.hypot(b.x - a.x, b.y - a.y) / FT;
}

/** Make side `i` exactly `ft` long by moving its far corner along the side. */
export function setSideLength(land: CustomLand, i: number, ft: number): CustomLand {
  const n = land.outline.length;
  const a = land.outline[i];
  const k = (i + 1) % n;
  const b = land.outline[k];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1 || !(ft >= 1)) return land;
  const f = (ft * FT) / len;
  const moved = { x: Math.round(a.x + (b.x - a.x) * f), y: Math.round(a.y + (b.y - a.y) * f) };
  return { ...land, outline: land.outline.map((p, idx) => (idx === k ? moved : p)) };
}

/** Stretch the whole land (outline and everything placed on it) about the top left of its box. */
export function scaleLand(land: CustomLand, kx: number, ky: number): CustomLand {
  const { x0, y0 } = boxOf(land.outline);
  const m = (p: Point): Point => ({ x: Math.round(x0 + (p.x - x0) * kx), y: Math.round(y0 + (p.y - y0) * ky) });
  const k = (kx + ky) / 2;
  return {
    ...land,
    outline: land.outline.map(m),
    water: land.water.map((w) => ({ ...w, points: w.points.map(m) })),
    features: land.features.map((f) => ({ ...f, at: m(f.at) })),
    lanes: land.lanes.map((l) => ({ ...l, points: l.points.map(m) })),
    ground: land.ground.map((g) => ({ ...g, at: m(g.at), radiusFt: g.radiusFt * k })),
  };
}

/** Set the box to `widthFt` by `depthFt`. */
export function resizeBox(land: CustomLand, widthFt: number, depthFt: number): CustomLand {
  const cur = boxFeet(land.outline);
  if (!(widthFt >= 10 && depthFt >= 10) || cur.widthFt <= 0 || cur.depthFt <= 0) return land;
  return scaleLand(land, widthFt / cur.widthFt, depthFt / cur.depthFt);
}

/** Resize to cover `acres`, keeping the proportions. */
export function resizeToAcres(land: CustomLand, acres: number): CustomLand {
  const area = polygonArea(land.outline);
  if (!(acres >= 0.05) || area <= 0) return land;
  const k = Math.sqrt((acres * ACRE_SQ_IN) / area);
  return scaleLand(land, k, k);
}

/** Where the land's compass-frame origin sits in the turned drawing (the plot's top-left of its box). */
export function plotOrigin(land: CustomLand): Point {
  const t = drawingToCompass(land.northDeg);
  const turned = land.outline.map(t.turn);
  return { x: Math.min(...turned.map((p) => p.x)), y: Math.min(...turned.map((p) => p.y)) };
}

/**
 * After editing land that already has a house on it: the lot offset that
 * keeps the house at the same spot on the drawing (the plot's origin can move
 * when a corner moves or north turns).
 */
export function offsetKeepingHouse(project: Project, before: CustomLand, after: CustomLand): Point {
  const o = lotOffsetFor(project);
  const a = plotOrigin(before);
  const b = plotOrigin(after);
  return { x: Math.round(o.x + a.x - b.x), y: Math.round(o.y + a.y - b.y) };
}

function houseCorners(project: Project, offset: Point): Point[] {
  const rooms = planOf(project.floorPlans, MAIN_LEVEL_ID).rooms;
  const all = rooms.length ? rooms : Object.values(project.floorPlans).flatMap((pl) => pl.rooms);
  return all.flatMap((r) => r.polygon).map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
}

/** Warnings after the land changed: the house hanging off the lot or sitting in water. */
export function houseWarnings(project: Project, plot: Plot, offset: Point): string[] {
  const pts = houseCorners(project, offset);
  if (!pts.length) return [];
  const out: string[] = [];
  if (pts.some((p) => !pointInPolygon(p, plot.outline))) out.push("The house now reaches past the edge of the lot. Use Move on lot in the flow sketch or floor plan to fix it.");
  const wet = plot.waterFeatures.filter((w) => w.kind === "pond" || w.kind === "lake");
  if (pts.some((p) => wet.some((w) => pointInPolygon(p, w.points)))) out.push("Part of the house is now in the water.");
  return out;
}
