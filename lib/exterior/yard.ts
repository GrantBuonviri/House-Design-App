import type { Level, PlanBasics, Plot, Point } from "@/lib/model/schema";
import { exteriorWallIn } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { add, boundsOf, dist, lerp, pointInPolygon, project, scale, sub, unit } from "@/lib/plan/geometry";
import { distanceToPolygonEdge } from "@/lib/land/geometry";
import { areaKind } from "@/lib/plan/measure";
import { openingGeometries, wallPieces, type OpeningGeometry } from "@/lib/plan/walls";
import { levelHeights } from "@/lib/house3d/levels";

/**
 * The yard around the house, laid out by code from the floor plan and the
 * lot: a driveway from the garage door to the road, a front walk from the
 * front door to the driveway, planting beds with shrubs along the outside
 * walls, a few trees, and lawn over the rest near the house. The 3D view
 * draws it and the cost estimate measures it, so they always agree.
 * Everything is in plan inches (x east, y south).
 */

/** A straight piece of paving or a bed: from a to b, this wide. */
export type Strip = { a: Point; b: Point; width: number };

/** An outdoor light on a wall: where it is, and which way the wall faces. */
export type WallLight = { p: Point; out: Point; levelId: string };

export type Yard = {
  driveway: Strip[];
  walk: Strip[];
  beds: Strip[];
  /** Lawn, as square cells (their top-left corners) `cell` inches across. */
  lawn: { cell: number; cells: Point[] };
  shrubs: Point[];
  trees: Point[];
  lights: WallLight[];
  /** Toward the road. */
  roadDir: Point;
};

const FT = 12;
export const LAWN_CELL_IN = 24;
/** How far the yard reaches from the house. */
const YARD_REACH_IN = 25 * FT;
const BED_IN = 48;
const WALK_IN = 48;
const SHRUB_EVERY_IN = 72;

export function stripArea(s: Strip): number {
  return dist(s.a, s.b) * s.width;
}

function onStrip(p: Point, s: Strip, margin = 0): boolean {
  // Quick no for points well away from the strip's box.
  const r = s.width / 2 + margin;
  if (p.x < Math.min(s.a.x, s.b.x) - r || p.x > Math.max(s.a.x, s.b.x) + r || p.y < Math.min(s.a.y, s.b.y) - r || p.y > Math.max(s.a.y, s.b.y) + r) return false;
  const pr = project(p, s.a, s.b);
  return pr.t >= -margin && pr.t <= pr.length + margin && pr.d <= s.width / 2 + margin;
}

const ROAD: Record<Plot["roadSide"], Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

/** The lot's outline in plan inches. */
function lotOutline(plot: Plot | null, offset: Point, house: { x0: number; y0: number; x1: number; y1: number }): Point[] {
  if (plot) {
    const pts = plot.outline.length ? plot.outline : [{ x: 0, y: 0 }, { x: plot.widthIn, y: 0 }, { x: plot.widthIn, y: plot.depthIn }, { x: 0, y: plot.depthIn }];
    return pts.map((p) => sub(p, offset));
  }
  const m = 60 * FT;
  return [
    { x: house.x0 - m, y: house.y0 - m },
    { x: house.x1 + m, y: house.y0 - m },
    { x: house.x1 + m, y: house.y1 + 40 * FT },
    { x: house.x0 - m, y: house.y1 + 40 * FT },
  ];
}

/** The yard, or null when there's no floor plan on the ground yet. */
export function yardLayout(plans: Plans, levels: Level[], basics: PlanBasics | null, plot: Plot | null, offset: Point): Yard | null {
  const heights = levelHeights(levels, basics);
  const ground = levels.filter((l) => l.kind !== "basement" && Math.abs(heights[l.id]?.floorIn ?? 99) <= 12 && (plans[l.id]?.rooms.length ?? 0) > 0);
  if (!ground.length) return null;
  const exteriorIn = exteriorWallIn(basics);
  const rooms = ground.flatMap((l) => planOf(plans, l.id).rooms);
  const indoor = rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon);
  const all = rooms.map((r) => r.polygon);
  const hb = boundsOf(all.flat());
  if (!hb) return null;
  const lot = lotOutline(plot, offset, hb);
  const lb = boundsOf(lot)!;
  const roadDir = ROAD[plot?.roadSide ?? "S"];
  const side = { x: -roadDir.y, y: roadDir.x };
  /** The point on the road edge straight out from p. */
  const toRoad = (p: Point): Point => {
    switch (plot?.roadSide ?? "S") {
      case "N":
        return { x: p.x, y: lb.y0 };
      case "S":
        return { x: p.x, y: lb.y1 };
      case "E":
        return { x: lb.x1, y: p.y };
      case "W":
        return { x: lb.x0, y: p.y };
    }
  };
  // Each room's box, so most points can skip the slower outline checks.
  const boxes = all.map((poly) => boundsOf(poly)!);
  const insideHouse = (p: Point, margin = 0) =>
    all.some((poly, i) => {
      const b = boxes[i];
      if (p.x < b.x0 - margin || p.x > b.x1 + margin || p.y < b.y0 - margin || p.y > b.y1 + margin) return false;
      return pointInPolygon(p, poly) || (margin > 0 && distanceToPolygonEdge(p, poly) < margin);
    });
  const outward = (og: OpeningGeometry): Point => (indoor.some((poly) => pointInPolygon(add(og.center, scale(og.n, exteriorIn / 2 + 12)), poly)) ? scale(og.n, -1) : og.n);

  // Doors on outside walls of the ground floors.
  const doors: { og: OpeningGeometry; out: Point; levelId: string; style: string }[] = [];
  const walls: { a: Point; b: Point; thick: number; out: Point; levelId: string }[] = [];
  for (const l of ground) {
    const plan = planOf(plans, l.id);
    const pieces = wallPieces(plan, exteriorIn).filter((p) => p.exterior && !p.open);
    for (const og of openingGeometries(plan)) {
      if (og.opening.kind !== "door") continue;
      const host = pieces.find((p) => {
        const pr = project(og.center, p.a, p.b);
        return pr.d < 2 && pr.t > 0 && pr.t < pr.length;
      });
      if (host) doors.push({ og, out: outward(og), levelId: l.id, style: og.opening.style });
    }
    for (const p of pieces) {
      const u = unit(sub(p.b, p.a));
      const left = { x: u.y, y: -u.x };
      const mid = lerp(p.a, p.b, 0.5);
      const out = indoor.some((poly) => pointInPolygon(add(mid, scale(left, p.thicknessIn / 2 + 12)), poly)) ? scale(left, -1) : left;
      walls.push({ a: p.a, b: p.b, thick: p.thicknessIn, out, levelId: l.id });
    }
  }
  const towardRoad = (d: { og: OpeningGeometry }) => -dist(d.og.center, toRoad(d.og.center));

  // Driveway: out from the widest garage door, then on to the road.
  const driveway: Strip[] = [];
  const garage = doors.filter((d) => d.style === "door-garage").sort((a, b) => b.og.opening.widthIn - a.og.opening.widthIn || towardRoad(b) - towardRoad(a))[0];
  if (garage) {
    const width = Math.max(12 * FT, garage.og.opening.widthIn + 4 * FT);
    const start = add(garage.og.center, scale(garage.out, exteriorIn / 2));
    if (garage.out.x * roadDir.x + garage.out.y * roadDir.y > 0.7) driveway.push({ a: start, b: toRoad(start), width });
    else {
      // A side-load garage: an apron out from the door, then a turn to the road.
      const apron = add(start, scale(garage.out, 24 * FT));
      driveway.push({ a: start, b: add(apron, scale(garage.out, width / 2)), width });
      driveway.push({ a: apron, b: toRoad(apron), width });
    }
  } else {
    // No garage: a parking pad off the road, beside the house.
    const frontExt = Math.max(...all.flat().map((p) => p.x * roadDir.x + p.y * roadDir.y));
    const sideExt = Math.min(...all.flat().map((p) => p.x * side.x + p.y * side.y));
    const along = sideExt + 7 * FT;
    const start = { x: roadDir.x * (frontExt + 2 * FT) + side.x * along, y: roadDir.y * (frontExt + 2 * FT) + side.y * along };
    const end = toRoad(start);
    if (dist(start, end) > 4 * FT) driveway.push({ a: start, b: end, width: 12 * FT });
  }
  const paved = (p: Point, margin = 0) => driveway.some((s) => onStrip(p, s, margin));

  // Front walk: from the front door (the one nearest the road) to the driveway, or to the road.
  const walk: Strip[] = [];
  const entries = doors.filter((d) => d.style === "door-entry");
  const front = (entries.length ? entries : doors.filter((d) => d.style !== "door-garage" && d.style !== "door-slider")).sort((a, b) => towardRoad(b) - towardRoad(a))[0];
  if (front) {
    const start = add(front.og.center, scale(front.out, exteriorIn / 2));
    let step = add(start, scale(front.out, 5 * FT));
    // Out past a porch in front of the door.
    for (let k = 0; k < 6 && insideHouse(step); k++) step = add(step, scale(front.out, 3 * FT));
    walk.push({ a: start, b: step, width: WALK_IN });
    let target = toRoad(step);
    // The nearest edge of the driveway, if that's closer than the road.
    for (const s of driveway) {
      const len = dist(s.a, s.b);
      const u = unit(sub(s.b, s.a));
      const t = Math.max(Math.min(24, len / 2), Math.min(len - 24, (step.x - s.a.x) * u.x + (step.y - s.a.y) * u.y));
      const mid = add(s.a, scale(u, t));
      const side = (step.x - mid.x) * -u.y + (step.y - mid.y) * u.x >= 0 ? 1 : -1;
      const edge = add(mid, scale({ x: -u.y, y: u.x }, side * (s.width / 2 - 6)));
      if (dist(step, edge) < dist(step, target)) target = edge;
    }
    if (dist(step, target) > 12) walk.push({ a: step, b: target, width: WALK_IN });
  }
  const walked = (p: Point, margin = 0) => walk.some((s) => onStrip(p, s, margin));

  // Planting beds along the outside walls, with gaps at doors, porches and paving.
  const beds: Strip[] = [];
  const shrubs: Point[] = [];
  for (const w of walls) {
    const len = dist(w.a, w.b);
    const u = unit(sub(w.b, w.a));
    const off = w.thick / 2 + BED_IN / 2;
    const ok = (t: number) => {
      const c = add(add(w.a, scale(u, t)), scale(w.out, off));
      if (insideHouse(c) || paved(c, 18) || walked(c, 18) || !pointInPolygon(c, lot)) return false;
      return !doors.some((d) => {
        const pr = project(d.og.center, w.a, w.b);
        return pr.d < w.thick && Math.abs(pr.t - t) < d.og.opening.widthIn / 2 + 24;
      });
    };
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const t0 = Math.max(0, run[0] - 12);
        const t1 = Math.min(len, run[run.length - 1] + 12);
        const at = (t: number) => add(add(w.a, scale(u, t)), scale(w.out, off));
        beds.push({ a: at(t0), b: at(t1), width: BED_IN });
        for (let t = t0 + SHRUB_EVERY_IN / 2; t <= t1 - 18; t += SHRUB_EVERY_IN) shrubs.push(at(t));
      }
      run = [];
    };
    for (let t = 12; t <= len - 12; t += 24) {
      if (ok(t)) run.push(t);
      else flush();
    }
    flush();
  }

  // Trees: two out front, two in back, wherever they fit on the lot.
  const corners = all.flat();
  const hc = { x: (hb.x0 + hb.x1) / 2, y: (hb.y0 + hb.y1) / 2 };
  const ext = (d: Point) => Math.max(...corners.map((p) => (p.x - hc.x) * d.x + (p.y - hc.y) * d.y));
  const frontExt = ext(roadDir);
  const backExt = ext(scale(roadDir, -1));
  const sideExt = Math.max(ext(side), ext(scale(side, -1)));
  const treeOk = (p: Point) =>
    pointInPolygon(p, lot) && distanceToPolygonEdge(p, lot) > 6 * FT && !insideHouse(p, 12 * FT) && !paved(p, 8 * FT) && !walked(p, 8 * FT);
  const trees: Point[] = [];
  const spots: [number, number][] = [
    [frontExt + 18 * FT, -1],
    [frontExt + 18 * FT, 1],
    [-(backExt + 25 * FT), -0.6],
    [-(backExt + 25 * FT), 0.6],
  ];
  for (const [d, s] of spots) {
    for (const k of [1, 0.6, 1.4, 0.3]) {
      const p = add(add(hc, scale(roadDir, d * (k < 1 ? 1 : k))), scale(side, s * sideExt * k));
      if (treeOk(p) && trees.every((t) => dist(t, p) > 15 * FT)) {
        trees.push(p);
        break;
      }
    }
  }

  // Lawn: the rest of the ground near the house, inside the lot.
  const cells: Point[] = [];
  const x0 = Math.max(lb.x0, hb.x0 - YARD_REACH_IN);
  const y0 = Math.max(lb.y0, hb.y0 - YARD_REACH_IN);
  const x1 = Math.min(lb.x1, hb.x1 + YARD_REACH_IN);
  const y1 = Math.min(lb.y1, hb.y1 + YARD_REACH_IN);
  const c = LAWN_CELL_IN;
  for (let y = Math.floor(y0 / c) * c; y < y1; y += c) {
    for (let x = Math.floor(x0 / c) * c; x < x1; x += c) {
      const m = { x: x + c / 2, y: y + c / 2 };
      if (!pointInPolygon(m, lot) || insideHouse(m, exteriorIn / 2 + 6) || paved(m, 6) || walked(m, 6) || beds.some((b) => onStrip(m, b))) continue;
      cells.push({ x, y });
    }
  }

  // Outdoor lights: one beside each outside door, and one each side of a garage door.
  const lights: WallLight[] = [];
  for (const d of doors) {
    const half = d.og.opening.widthIn / 2 + 12;
    const at = (s: number) => add(add(d.og.center, scale(d.og.u, s * half)), scale(d.out, exteriorIn / 2 + 3));
    if (d.style === "door-garage") lights.push({ p: at(-1), out: d.out, levelId: d.levelId }, { p: at(1), out: d.out, levelId: d.levelId });
    else lights.push({ p: at(1), out: d.out, levelId: d.levelId });
  }

  return { driveway, walk, beds, lawn: { cell: c, cells }, shrubs, trees, lights, roadDir };
}

/** Square feet of each part of the yard, for the cost estimate. */
export function yardAmounts(y: Yard) {
  const sq = (n: number) => n / 144;
  return {
    driveSqft: sq(y.driveway.reduce((s, x) => s + stripArea(x), 0)),
    walkSqft: sq(y.walk.reduce((s, x) => s + stripArea(x), 0)),
    bedSqft: sq(y.beds.reduce((s, x) => s + stripArea(x), 0)),
    lawnSqft: sq(y.lawn.cells.length * y.lawn.cell * y.lawn.cell),
    shrubs: y.shrubs.length,
    trees: y.trees.length,
    lights: y.lights.length,
  };
}
