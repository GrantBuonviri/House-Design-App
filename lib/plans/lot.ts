import type { LotSide, Plot, Point, Project, RealLot } from "@/lib/model/schema";
import { add, clockwise, dist, dot, polygonArea, scale, sub, unit } from "@/lib/plan/geometry";
import { lotOffsetFor } from "@/lib/house3d/site";
import { offsetRing, roofFootprint } from "@/lib/house3d/footprint";
import { plotRoadEdges } from "@/lib/land/custom";
import { bearingVector } from "@/lib/land/generate";
import { houseFacts } from "./house";

/**
 * The lot the site plan is drawn on, in plan inches (x east, y south): the
 * owner's real lot from "My real lot" when it's filled in, otherwise the
 * app's made-up land. For a real lot it also works out where the house sits
 * and how far it is from each lot line, for the setback checks.
 */

export type Compass = "N" | "E" | "S" | "W";
const TOWARD: Record<Compass, Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

export type LotLine = { side: LotSide; a: Point; b: Point; lengthFt: number; street: boolean; setbackFt: number | null; setbackName: string };

export type SetbackCheck = { side: LotSide; name: string; requiredFt: number | null; providedFt: number; ok: boolean | null };

export type SiteLayout = {
  real: boolean;
  /** Lot corners, clockwise on screen. */
  outline: Point[];
  lines: LotLine[];
  /** The compass side the street is on. */
  streetSide: Compass;
  areaSqft: number;
  /** Outside faces of the house (all floors, with covered porches), plan inches. */
  house: Point[][];
  checks: SetbackCheck[];
  /** Easement strips. */
  easements: { side: LotSide; widthFt: number; kind: string; pts: Point[] }[];
  /** For the made-up lot: plot point = plan point + offset. */
  offset: Point;
  /** Problems with the lot entry, in plain words. */
  problems: string[];
};

const FT = 12;

/** The lot's corners in its own frame (x along the front to the right, y back from the street, feet), or a problem. */
export function lotCorners(lot: RealLot): { pts: [Point, Point, Point, Point] } | { problem: string } {
  const F = lot.frontFt;
  const rect = lot.shape === "rectangle";
  const R = rect ? F : lot.rearFt;
  const L = lot.leftFt;
  const Rt = rect ? L : lot.rightFt;
  if (!(F > 0) || !(L > 0) || !(R > 0) || !(Rt > 0)) return { problem: "Enter every side length of the lot" };
  let a = 0;
  if (Math.abs(R - F) > 0.01) a = (Rt * Rt - L * L - (R - F) * (R - F)) / (2 * (R - F));
  else if (Math.abs(L - Rt) > 0.01) return { problem: "With the front and rear the same length, the left and right sides must match too" };
  const hh = L * L - a * a;
  if (hh <= 1) return { problem: "Those side lengths don't make a lot shape with the front and rear parallel. Check them against the plat." };
  const h = Math.sqrt(hh);
  return { pts: [{ x: 0, y: 0 }, { x: F, y: 0 }, { x: a + R, y: h }, { x: a, y: h }] };
}

/** Is the real lot filled in well enough to draw? */
export function realLotOk(lot: RealLot | null): lot is RealLot {
  return !!lot && "pts" in lotCorners(lot);
}

/** The house's outside faces on every floor, porches included. */
export function houseOutlines(project: Project): Point[][] {
  const h = houseFacts(project);
  return h.drawn.flatMap((l) => roofFootprint(h.plan(l.id)).map((r) => offsetRing(r.outline, h.exteriorIn / 2)));
}

/** Perpendicular distance from p to the line through a and b. */
function lineDist(p: Point, a: Point, b: Point): number {
  const u = unit(sub(b, a));
  return Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
}

const cache = new WeakMap<Project, SiteLayout | null>();

/** The site the site plan draws, or null when there's neither a real lot nor a made-up one. */
export function siteLayout(project: Project): SiteLayout | null {
  if (cache.has(project)) return cache.get(project)!;
  const out = layout(project);
  cache.set(project, out);
  return out;
}

function layout(project: Project): SiteLayout | null {
  const house = houseOutlines(project);
  const lot = project.plans.lot;
  if (realLotOk(lot)) return realLayout(lot, house);
  const plot = project.plot;
  if (!plot) return null;
  const offset = lotOffsetFor(project);
  const pts = (plot.outline.length ? plot.outline : [{ x: 0, y: 0 }, { x: plot.widthIn, y: 0 }, { x: plot.widthIn, y: plot.depthIn }, { x: 0, y: plot.depthIn }]).map((p) => sub(p, offset));
  const outline = clockwise(pts);
  const street = plot.roadSide;
  const roads = plot.roads.length ? plotRoadEdges(plot) : [];
  const main = roads.find((r) => r.road.kind === "main") ?? roads[0];
  // Lot lines are named from the main road: its real edge on designed land, the road side on made-up land.
  const toward = main ? bearingVector(main.facingDeg) : TOWARD[street];
  /** The road along this lot line, if any (lines and road edges share their corners). */
  const roadOn = (a: Point, b: Point) =>
    roads.find((r) => {
      const [ra, rb] = [sub(r.a, offset), sub(r.b, offset)];
      return (dist(ra, a) < 1 && dist(rb, b) < 1) || (dist(ra, b) < 1 && dist(rb, a) < 1);
    });
  // Name each side by the way it faces.
  const lines: LotLine[] = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const u = unit(sub(b, a));
    const out = { x: u.y, y: -u.x };
    const f = dot(out, toward);
    const r = dot(out, { x: toward.y, y: -toward.x });
    const road = roadOn(a, b);
    const side: LotSide = road?.road.kind === "main" || (f > 0.7 && road?.road.kind !== "side") ? "front" : f < -0.7 ? "rear" : r > 0 ? "right" : "left";
    return { side, a, b, lengthFt: dist(a, b) / FT, street: road ? true : !roads.length && side === "front", setbackFt: null, setbackName: "" };
  });
  const problems = project.plans.lot ? [lotProblem(project.plans.lot)].filter((x): x is string => !!x) : [];
  return { real: false, outline, lines, streetSide: street, areaSqft: polygonArea(outline) / 144, house, checks: [], easements: [], offset, problems };
}

function lotProblem(lot: RealLot): string | null {
  const c = lotCorners(lot);
  return "problem" in c ? c.problem : null;
}

function realLayout(lot: RealLot, house: Point[][]): SiteLayout {
  const corners = (lotCorners(lot) as { pts: Point[] }).pts.map((p) => scale(p, FT));
  const s = TOWARD[lot.streetSide];
  const r = { x: s.y, y: -s.x };
  const bk = scale(s, -1);
  const pts = house.flat();
  const [, fr, rr, rl] = corners;
  const h = rl.y;
  const a = rl.x;
  const L = Math.hypot(a, h);
  // The house in the lot's frame, before it's moved into place.
  const X = (p: Point) => dot(p, r);
  const Y = (p: Point) => dot(p, bk);
  const minY = pts.length ? Math.min(...pts.map(Y)) : 0;
  const maxY = pts.length ? Math.max(...pts.map(Y)) : 0;
  const frontIn = lot.houseFrontFt !== null ? lot.houseFrontFt * FT : ((lot.setbacks.front ?? 20) + 5) * FT;
  const dy = frontIn - minY;
  let dx: number;
  if (lot.houseLeftFt !== null) {
    // Distance to the left line, measured square to it.
    const m = pts.length ? Math.min(...pts.map((p) => (X(p) * h - (Y(p) + dy) * a) / L)) : 0;
    dx = (lot.houseLeftFt * FT * L - m * L) / h;
  } else {
    const ym = (minY + maxY) / 2 + dy;
    const xl = (a * ym) / h;
    const xr = fr.x + ((rr.x - fr.x) * ym) / h;
    const minX = pts.length ? Math.min(...pts.map(X)) : 0;
    const maxX = pts.length ? Math.max(...pts.map(X)) : 0;
    dx = (xl + xr) / 2 - (minX + maxX) / 2;
  }
  // Lot frame to plan: the house stays put and the lot moves around it.
  const toPlan = (q: Point): Point => add(scale(r, q.x - dx), scale(bk, q.y - dy));
  const outlinePlan = corners.map(toPlan);
  const sideOf: [LotSide, Point, Point][] = [
    ["front", outlinePlan[0], outlinePlan[1]],
    ["right", outlinePlan[1], outlinePlan[2]],
    ["rear", outlinePlan[2], outlinePlan[3]],
    ["left", outlinePlan[3], outlinePlan[0]],
  ];
  const streetSide = (side: LotSide) => side === "front" || side === lot.sideStreet;
  const setbackFor = (side: LotSide): [number | null, string] => {
    if (side === "front") return [lot.setbacks.front, "Front"];
    if (side === "rear") return [lot.setbacks.rear, "Rear"];
    if (side === lot.sideStreet) return [lot.setbacks.streetSide ?? lot.setbacks.side, "Street side"];
    return [lot.setbacks.side, side === "left" ? "Left side" : "Right side"];
  };
  const lines: LotLine[] = sideOf.map(([side, p, q]) => {
    const [setbackFt, setbackName] = setbackFor(side);
    return { side, a: p, b: q, lengthFt: dist(p, q) / FT, street: streetSide(side), setbackFt, setbackName };
  });
  const checks: SetbackCheck[] = lines.map((l) => {
    const provided = pts.length ? Math.min(...pts.map((p) => lineDist(p, l.a, l.b))) / FT : 0;
    return { side: l.side, name: l.setbackName, requiredFt: l.setbackFt, providedFt: provided, ok: l.setbackFt === null ? null : provided + 0.01 >= l.setbackFt };
  });
  // Easements: a strip inside each named side.
  const center = scale(outlinePlan.reduce((sum, p) => add(sum, p), { x: 0, y: 0 }), 0.25);
  const easements = lot.easements
    .filter((e) => e.widthFt > 0)
    .map((e) => {
      const l = lines.find((x) => x.side === e.side)!;
      const u = unit(sub(l.b, l.a));
      let n = { x: -u.y, y: u.x };
      if (dot(sub(center, l.a), n) < 0) n = scale(n, -1);
      const w = e.widthFt * FT;
      return { side: e.side, widthFt: e.widthFt, kind: e.kind, pts: [l.a, l.b, add(l.b, scale(n, w)), add(l.a, scale(n, w))] };
    });
  return { real: true, outline: clockwise(outlinePlan), lines, streetSide: lot.streetSide, areaSqft: polygonArea(outlinePlan) / 144, house, checks, easements, offset: { x: 0, y: 0 }, problems: [] };
}

/** The lot as a plot, for laying out the driveway and yard on it. */
export function lotAsPlot(site: SiteLayout, plot: Plot | null): { plot: Plot; offset: Point } {
  if (!site.real && plot) return { plot, offset: site.offset };
  const base = plot ?? ({ seed: 0, isFlat: true, widthIn: 1, depthIn: 1, slope: { percent: 0, downhillDeg: 0 }, facingDeg: 0, drainage: { rating: "good", reason: "" }, soilNote: "", waterFeatures: [] } as unknown as Plot);
  // The real lot has its own corners, so the designed land's roads, lanes, rocks and water don't carry over.
  return { plot: { ...base, outline: site.outline, roadSide: site.streetSide, roads: [], lanes: [], features: [], ground: [], waterFeatures: [] }, offset: { x: 0, y: 0 } };
}

/** The side the front of the house faces: the street. */
export function frontSide(project: Project): Compass {
  const lot = project.plans.lot;
  if (realLotOk(lot)) return lot.streetSide;
  return project.plot?.roadSide ?? "S";
}

export type CopiedLot = Pick<RealLot, "shape" | "frontFt" | "rearFt" | "leftFt" | "rightFt" | "streetSide" | "sideStreet">;

/**
 * "Copy from my custom land": the side lengths and street of a designed lot,
 * for the My real lot form. It works when the lot has four sides with the
 * main road along one and the rear parallel to it; otherwise it says why.
 */
export function lotFromCustomLand(plot: Plot | null): { lot: CopiedLot } | { problem: string } {
  if (!plot || plot.source !== "custom") return { problem: "Design your own land on the Land step first." };
  const o = plot.outline;
  if (o.length !== 4) return { problem: `Your land has ${o.length} sides. My real lot needs four sides with the front and rear parallel, so enter it from the plat instead.` };
  const main = plotRoadEdges(plot).find((r) => r.road.kind === "main");
  if (!main) return { problem: "Your land has no main road. Put one on an edge in the land designer first." };
  const i = main.road.edge;
  const front = [o[i], o[(i + 1) % 4]];
  const rear = [o[(i + 2) % 4], o[(i + 3) % 4]];
  const uf = unit(sub(front[1], front[0]));
  const ur = unit(sub(rear[1], rear[0]));
  if (Math.abs(uf.x * ur.y - uf.y * ur.x) > Math.sin((1 * Math.PI) / 180)) {
    return { problem: "The rear of your land isn't parallel to the street, so it can't be entered as front, rear, left and right sides. Enter it from the plat instead." };
  }
  // Standing on the street looking at the lot, x runs to the right.
  const into = scale(bearingVector(main.facingDeg), -1);
  const right = { x: -into.y, y: into.x };
  const [fl, fr] = dot(front[0], right) <= dot(front[1], right) ? [front[0], front[1]] : [front[1], front[0]];
  // Each rear corner is next to the front corner on its side.
  const next = (p: Point) => {
    const k = o.indexOf(p);
    return rear.find((q) => q === o[(k + 1) % 4] || q === o[(k + 3) % 4])!;
  };
  const rl = next(fl);
  const rr = next(fr);
  const ft = (a: Point, b: Point) => Math.round((dist(a, b) / FT) * 100) / 100;
  const lot: CopiedLot = {
    shape: "four-sides",
    frontFt: ft(fl, fr),
    rearFt: ft(rl, rr),
    leftFt: ft(fl, rl),
    rightFt: ft(fr, rr),
    streetSide: main.side,
    sideStreet: "none",
  };
  if (Math.abs(lot.frontFt - lot.rearFt) < 0.05 && Math.abs(lot.leftFt - lot.rightFt) < 0.05) lot.shape = "rectangle";
  for (const r of plotRoadEdges(plot)) {
    if (r.road.kind !== "side") continue;
    const [a, b] = [o[r.road.edge], o[(r.road.edge + 1) % 4]];
    const has = (p: Point, q: Point) => (a === p && b === q) || (a === q && b === p);
    if (has(fl, rl)) lot.sideStreet = "left";
    else if (has(fr, rr)) lot.sideStreet = "right";
  }
  if ("problem" in lotCorners(lot as RealLot)) return { problem: "Those side lengths don't make a lot with the front and rear parallel. Enter it from the plat instead." };
  return { lot };
}
