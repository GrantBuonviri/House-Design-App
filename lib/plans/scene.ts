import type { Point, Project } from "@/lib/model/schema";
import { add, dist, dot, leftNormal, lerp, pointInPolygon, polygonArea, project as projectOn, scale, sub, unit } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { openingType } from "@/lib/plan/catalog";
import { openingGeometries } from "@/lib/plan/walls";
import { COVERED, floorFootprint, offsetRing, roofFootprint, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { levelHeights, type LevelHeights } from "@/lib/house3d/levels";
import { roofShape, ROOF_THICK_IN, type RoofShape } from "@/lib/house3d/roof";
import { lotOffsetFor, siteFor, type Site } from "@/lib/house3d/site";
import { lookOutside } from "@/lib/house3d/build";
import { openingSpan } from "@/lib/house3d/openings";
import { COLORS } from "@/lib/house3d/colors";
import { PATTERN } from "@/lib/house3d/finishes";
import type { ExteriorLook } from "@/lib/house3d/exterior";
import type { RGB } from "@/lib/house3d/mesh";
import { operationOf } from "@/lib/codes/openings";
import { houseFacts } from "./house";
import { DASH, type Item, type Weight } from "./draw";
import { flatProject } from "@/lib/plan/flatten";

/**
 * The outside of the house as flat faces in 3D (inches; x east, y south, z up
 * from the main floor), made from the same walls, openings, roofs and floor
 * heights as the 3D view. Elevations look at it straight from one side and
 * the 3D views from above a corner; both draw the faces facing the viewer
 * from back to front, each filled, so whatever is behind is covered and
 * hidden lines disappear.
 */

export type V3 = { x: number; y: number; z: number };

export type FaceKind = "ground" | "foundation" | "wall" | "gable" | "fascia" | "roof" | "post" | "slab";

/** A line drawn on a face (window frames, siding laps), covered along with it. */
export type Detail = { pts: V3[]; closed?: boolean; w: Weight; fill?: string; color3d?: string; dash?: number[] };

export type Face = {
  kind: FaceKind;
  /** Polygons to fill (a roof face can be several triangles). */
  fills: V3[][];
  /** Its outline, drawn after the fill. */
  edges: V3[][];
  /** Outward normal. */
  n: V3;
  color: RGB;
  details: Detail[];
  /** Tags and labels on the face (door and window tags). */
  tags: { at: V3; text: string; shape: "circle" | "hexagon" }[];
  /** For material callouts: what this face is. */
  role?: "siding" | "accent" | "roof" | "window" | "entry" | "garage" | "trim";
  levelId?: string;
};

export type HouseScene = {
  faces: Face[];
  heights: LevelHeights;
  site: Site;
  look: ExteriorLook;
  /** Highest point of the roofs. */
  topIn: number;
  /** Outside faces of the walls on every floor, plan inches. */
  rings: { levelId: string; floorIn: number; ring: Point[] }[];
  /** The roof outlines and shapes, for the roof plan. */
  roofs: { levelId: string; shape: RoofShape; flat: boolean; eave: Point[] }[];
  /** Openings on outside walls, with their wall face. */
  openings: { id: string; levelId: string; tag?: string; kind: string; style: string; center: V3; n: V3; widthIn: number; heightIn: number }[];
  /** Spots on the stone or brick band, for its callout. */
  accentSpots: { at: V3; n: V3; levelId: string }[];
};

const v = (p: Point, z: number): V3 => ({ x: p.x, y: p.y, z });
const v3sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** A linear RGB color as "#rrggbb", lighter or darker by `shade`. */
export function rgbHex(c: RGB, shade = 1): string {
  return "#" + c.map((x) => Math.round(Math.min(1, Math.pow(Math.max(0, x * shade), 1 / 2.2)) * 255).toString(16).padStart(2, "0")).join("");
}

const covers = (polys: Point[][], p: Point) => polys.some((poly) => pointInPolygon(p, poly));

const cache = new WeakMap<Project, HouseScene>();

export function houseScene(project: Project): HouseScene {
  project = flatProject(project);
  const hit = cache.get(project);
  if (hit) return hit;
  const h = houseFacts(project);
  const plans = project.floorPlans;
  const heights = levelHeights(project.levels, h.basics);
  const site = siteFor(project.plot, lotOffsetFor(project), plans);
  const look = lookOutside({ exterior: project.exterior, house3d: project.house3d });
  const t = h.exteriorIn;
  const faces: Face[] = [];
  const rings: HouseScene["rings"] = [];
  const openings: HouseScene["openings"] = [];
  const accentSpots: HouseScene["accentSpots"] = [];
  const ordered = [...h.drawn].sort((a, b) => heights[a.id].floorIn - heights[b.id].floorIn);
  const indoor = (id: string) => h.plan(id).rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon);
  const face = (f: Omit<Face, "details" | "tags"> & Partial<Pick<Face, "details" | "tags">>): Face => {
    const out = { details: [], tags: [], ...f };
    faces.push(out);
    return out;
  };

  ordered.forEach((level, i) => {
    const plan = h.plan(level.id);
    const { floorIn, ceilingIn } = heights[level.id];
    const topIn = floorIn + ceilingIn;
    const above = ordered[i + 1];
    const abovePolys = above ? indoor(above.id) : [];
    const belowPolys = ordered.slice(0, i).flatMap((l) => indoor(l.id));
    const band = look.accent?.place === "base" && level.kind !== "basement" && Math.abs(floorIn) <= 12 ? look.accent : null;
    const geos = openingGeometries(plan);

    for (const region of floorFootprint(plan)) {
      for (const raw of [region.outline, ...region.holes]) {
        const ring = offsetRing(raw, t / 2);
        rings.push({ levelId: level.id, floorIn, ring });
        ring.forEach((a, k) => {
          const b = ring[(k + 1) % ring.length];
          const len = dist(a, b);
          if (len < 0.5) return;
          const u = unit(sub(b, a));
          const n = leftNormal(u);
          const inside = (p: Point) => add(p, scale(n, -(t + 2)));
          // Split the wall where a floor above covers part of it: there the siding runs up to that floor.
          const runs: { s0: number; s1: number; up: number }[] = [];
          const steps = Math.max(1, Math.round(len / 6));
          for (let s = 0; s < steps; s++) {
            const m = lerp(a, b, (s + 0.5) / steps);
            const up = above && covers(abovePolys, inside(m)) ? heights[above.id].floorIn : topIn;
            const last = runs[runs.length - 1];
            if (last && last.up === up) last.s1 = (s + 1) / steps;
            else runs.push({ s0: s / steps, s1: (s + 1) / steps, up });
          }
          const runFaces = runs.map((r) => {
            const p0 = lerp(a, b, r.s0);
            const p1 = lerp(a, b, r.s1);
            const wall = face({
              kind: "wall",
              fills: [[v(p0, floorIn), v(p1, floorIn), v(p1, r.up), v(p0, r.up)]],
              edges: [[v(p0, floorIn), v(p1, floorIn), v(p1, r.up), v(p0, r.up), v(p0, floorIn)]],
              n: { x: n.x, y: n.y, z: 0 },
              color: look.siding.color,
              role: "siding",
              levelId: level.id,
            });
            const bz = band ? floorIn + Math.min(band.heightIn, r.up - floorIn) : floorIn;
            wall.details.push(...hatch(p0, p1, bz, r.up, look.siding.pattern));
            if (band) {
              // A stone or brick band along the base, drawn on the wall.
              wall.details.push({ pts: [v(p0, floorIn), v(p1, floorIn), v(p1, bz), v(p0, bz)], closed: true, w: "fine", fill: "#ffffff", color3d: rgbHex(band.color) });
              wall.details.push(...hatch(p0, p1, floorIn, bz, band.pattern));
              accentSpots.push({ at: v(lerp(p0, p1, 0.5), floorIn + band.heightIn / 2), n: { x: n.x, y: n.y, z: 0 }, levelId: level.id });
            }
            return wall;
          });
          // Doors and windows on this stretch of wall.
          for (const g of geos) {
            const c = add(g.center, scale(n, t / 2));
            const pr = projectOn(c, a, b);
            if (pr.d > 1.5 || pr.t <= 1 || pr.t >= len - 1 || Math.abs(dot(g.n, n)) < 0.99) continue;
            const ri = Math.max(0, runs.findIndex((r) => pr.t / len >= r.s0 - 1e-6 && pr.t / len <= r.s1 + 1e-6));
            const wall = runFaces[ri];
            const span = openingSpan(g, ceilingIn);
            const o = g.opening;
            const e0 = add(pr.point, scale(u, -o.widthIn / 2));
            const e1 = add(pr.point, scale(u, o.widthIn / 2));
            const tag = h.tags.get(o.id);
            const mid = v(pr.point, floorIn + (span.bottom + span.top) / 2);
            openingDetails(wall, e0, e1, floorIn + span.bottom, floorIn + span.top, o.style, o.kind === "window" ? operationOf(o) : null, look);
            if (tag) wall.tags.push({ at: mid, text: tag, shape: o.kind === "window" ? "hexagon" : "circle" });
            openings.push({ id: o.id, levelId: level.id, tag, kind: o.kind, style: o.style, center: mid, n: { x: n.x, y: n.y, z: 0 }, widthIn: o.widthIn, heightIn: span.top - span.bottom });
          }
          // Foundation below the lowest floor, down to the ground.
          const mid = inside(lerp(a, b, 0.5));
          if (floorIn <= 1 && !covers(belowPolys, mid)) {
            let low = Infinity;
            const nS = Math.max(2, Math.ceil(len / 24));
            for (let s = 0; s <= nS; s++) low = Math.min(low, site.groundAt(lerp(a, b, s / nS)));
            const bottom = Math.min(low, floorIn - 8);
            face({
              kind: "foundation",
              fills: [[v(a, bottom), v(b, bottom), v(b, floorIn), v(a, floorIn)]],
              edges: [[v(a, bottom), v(b, bottom), v(b, floorIn), v(a, floorIn), v(a, bottom)]],
              n: { x: n.x, y: n.y, z: 0 },
              color: COLORS.foundation,
              levelId: level.id,
            });
          }
        });
      }
    }

    // Porches, decks and patios: the floor, its edge down to the ground, and posts under a porch roof.
    for (const room of plan.rooms) {
      if (areaKind(room) !== "outdoor") continue;
      const thick = 5;
      const poly = room.polygon;
      const color = room.type === "deck" ? look.deck.color : room.type === "patio" ? look.patio.color : COLORS.concrete;
      face({ kind: "slab", fills: [poly.map((p) => v(p, floorIn))], edges: [[...poly, poly[0]].map((p) => v(p, floorIn))], n: { x: 0, y: 0, z: 1 }, color, levelId: level.id });
      const low = Math.min(...poly.map(site.groundAt));
      const z0 = floorIn <= 1 ? Math.min(low, floorIn - thick) : floorIn - thick - 8;
      poly.forEach((p, k) => {
        const q = poly[(k + 1) % poly.length];
        const n = leftNormal(unit(sub(q, p)));
        face({ kind: "slab", fills: [[v(p, z0), v(q, z0), v(q, floorIn), v(p, floorIn)]], edges: [[v(p, z0), v(q, z0), v(q, floorIn), v(p, floorIn), v(p, z0)]], n: { x: n.x, y: n.y, z: 0 }, color: floorIn <= 1 ? COLORS.foundation : look.deck.color, levelId: level.id });
      });
      if (COVERED.has(room.type ?? "")) {
        const house = indoor(level.id);
        for (const c of poly) {
          if (house.some((hp) => pointInPolygon(c, hp) || hp.some((x, j) => projectOn(c, x, hp[(j + 1) % hp.length]).d < 8))) continue;
          const toward = unit(sub(centerOf(poly), c));
          const pc = add(c, scale(toward, 4));
          const r = 2.75;
          const sq = [add(pc, { x: -r, y: -r }), add(pc, { x: r, y: -r }), add(pc, { x: r, y: r }), add(pc, { x: -r, y: r })];
          sq.forEach((p, k) => {
            const q = sq[(k + 1) % 4];
            const n = leftNormal(unit(sub(q, p)));
            face({ kind: "post", fills: [[v(p, floorIn), v(q, floorIn), v(q, topIn), v(p, topIn)]], edges: [[v(p, floorIn), v(q, floorIn), v(q, topIn), v(p, topIn), v(p, floorIn)]], n: { x: n.x, y: n.y, z: 0 }, color: look.trim, role: "trim", levelId: level.id });
          });
        }
      }
    }
  });

  // Roofs: the same regions and shapes the 3D view and the cost use.
  const roofs: HouseScene["roofs"] = [];
  let topIn = Math.max(0, ...ordered.map((l) => heights[l.id].floorIn + heights[l.id].ceilingIn));
  ordered.forEach((level, i) => {
    const regions = roofFootprint(h.plan(level.id));
    const next = ordered.slice(i + 1).find((l) => h.plan(l.id).rooms.length > 0);
    const above = next ? floorFootprint(h.plan(next.id)) : [];
    const exposed = subtractRegions(regions, above);
    const { floorIn, ceilingIn } = heights[level.id];
    const flat = level.kind === "basement" || floorIn < 0;
    for (const found of exposed) {
      const r: Region = { ...found, holes: found.holes.filter((hole) => polygonArea(hole) > 150 * 144) };
      const shape = roofShape(r, floorIn + ceilingIn, t, project.house3d.roof, flat, next && { regions: above, topIn: heights[next.id].floorIn + heights[next.id].ceilingIn });
      const eave = offsetRing(offsetRing(r.outline, t / 2), project.house3d.roof.style === "flat" || flat || shape.fellBack ? Math.min(project.house3d.roof.overhangIn, 6) : project.house3d.roof.overhangIn);
      roofs.push({ levelId: level.id, shape, flat: flat || shape.fellBack || project.house3d.roof.style === "flat", eave });
      for (const tri of shape.tris) topIn = Math.max(topIn, ...tri.h);
      roofFaces(shape, look, level.id, face);
    }
  });

  const scene: HouseScene = { faces, heights, site, look, topIn, rings, roofs, openings, accentSpots };
  cache.set(project, scene);
  return scene;
}

function centerOf(poly: Point[]): Point {
  return scale(poly.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / poly.length);
}

/** Siding lines on a wall: laps every 6", battens every 16", none for stucco. */
function hatch(a: Point, b: Point, z0: number, z1: number, pattern: number): Detail[] {
  const out: Detail[] = [];
  if (pattern === PATTERN.lap || pattern === PATTERN.shake || pattern === PATTERN.plank || pattern === PATTERN.brick || pattern === PATTERN.stone) {
    const step = pattern === PATTERN.brick ? 8 : pattern === PATTERN.stone ? 10 : 6;
    for (let z = z0 + step; z < z1 - 1; z += step) out.push({ pts: [v(a, z), v(b, z)], w: "hair" });
  } else if (pattern === PATTERN.batten) {
    const len = dist(a, b);
    for (let s = 16; s < len - 2; s += 16) {
      const p = lerp(a, b, s / len);
      out.push({ pts: [v(p, z0), v(p, z1)], w: "hair" });
    }
  }
  return out;
}

/** A door or window drawn on its wall: the opening, frame, sash or panels, and a sill. */
function openingDetails(wall: Face, a: Point, b: Point, z0: number, z1: number, style: string, op: string | null, look: ExteriorLook) {
  const d = wall.details;
  const quad = (p: Point, q: Point, lo: number, hi: number): V3[] => [v(p, lo), v(q, lo), v(q, hi), v(p, hi)];
  const len = dist(a, b);
  const at = (s: number) => lerp(a, b, s / len);
  const glass = "#c9d6dc";
  const trim = rgbHex(look.trim);
  if (style.startsWith("window")) {
    const f = 2.5;
    // Trim around the window.
    d.push({ pts: quad(at(-3.5), at(len + 3.5), z0 - 1.5, z1 + 3.5), closed: true, w: "fine", fill: "#ffffff", color3d: trim });
    d.push({ pts: quad(at(f), at(len - f), z0 + f, z1 - f), closed: true, w: "fine", fill: "#ffffff", color3d: glass });
    d.push({ pts: [v(at(-5), z0 - 1.5), v(at(len + 5), z0 - 1.5)], w: "fine" });
    if (op === "single-hung" || op === "double-hung") d.push({ pts: [v(at(f), (z0 + z1) / 2), v(at(len - f), (z0 + z1) / 2)], w: "fine" });
    if (op === "slider") d.push({ pts: [v(at(len / 2), z0 + f), v(at(len / 2), z1 - f)], w: "fine" });
    // Casements and awnings: the usual dashed lines pointing to the hinges.
    if (op === "casement") d.push({ pts: [v(at(len - f), z1 - f), v(at(f), (z0 + z1) / 2), v(at(len - f), z0 + f)], w: "hair", dash: DASH.hidden });
    if (op === "awning") d.push({ pts: [v(at(f), z0 + f), v(at(len / 2), z1 - f), v(at(len - f), z0 + f)], w: "hair", dash: DASH.hidden });
    return;
  }
  const type = openingType(style);
  if (style === "door-garage") {
    d.push({ pts: quad(at(-4), at(len + 4), z0, z1 + 4), closed: true, w: "fine", fill: "#ffffff", color3d: trim });
    d.push({ pts: quad(at(0), at(len), z0, z1), closed: true, w: "fine", fill: "#ffffff", color3d: rgbHex(look.garageDoor) });
    for (let z = z0 + 21; z < z1 - 4; z += 21) d.push({ pts: [v(at(0), z), v(at(len), z)], w: "hair" });
    return;
  }
  if (style === "opening") {
    d.push({ pts: quad(at(0), at(len), z0, z1), closed: true, w: "fine", fill: "#ffffff", color3d: "#4a4a4a" });
    return;
  }
  d.push({ pts: quad(at(-3.5), at(len + 3.5), z0, z1 + 3.5), closed: true, w: "fine", fill: "#ffffff", color3d: trim });
  if (style === "door-slider") {
    d.push({ pts: quad(at(2), at(len - 2), z0 + 2, z1 - 2), closed: true, w: "fine", fill: "#ffffff", color3d: glass });
    d.push({ pts: [v(at(len / 2), z0 + 2), v(at(len / 2), z1 - 2)], w: "fine" });
    return;
  }
  const color = style === "door-entry" ? rgbHex(look.frontDoor) : "#efede7";
  d.push({ pts: quad(at(0), at(len), z0, z1), closed: true, w: "fine", fill: "#ffffff", color3d: color });
  const leaves = type.double ? 2 : 1;
  const lw = len / leaves;
  for (let k = 0; k < leaves; k++) {
    const s0 = k * lw;
    if (k) d.push({ pts: [v(at(s0), z0), v(at(s0), z1)], w: "fine" });
    // Two raised panels per leaf.
    d.push({ pts: quad(at(s0 + 6), at(s0 + lw - 6), z0 + 8, z0 + (z1 - z0) * 0.45), closed: true, w: "hair" });
    d.push({ pts: quad(at(s0 + 6), at(s0 + lw - 6), z0 + (z1 - z0) * 0.52, z1 - 6), closed: true, w: "hair" });
  }
}

/** Roof triangles grouped into flat faces, the fascia along the open edges, and gable-end walls. */
function roofFaces(shape: RoofShape, look: ExteriorLook, levelId: string, face: (f: Omit<Face, "details" | "tags">) => Face) {
  type Group = { n: V3; tris: V3[][] };
  const groups: Group[] = [];
  for (const tri of shape.tris) {
    const pts = tri.p.map((p, i) => v(p, tri.h[i]));
    let n = cross(v3sub(pts[1], pts[0]), v3sub(pts[2], pts[0]));
    if (Math.hypot(n.x, n.y, n.z) < 1e-6) continue;
    n = norm(n);
    if (n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    const off = dot3(n, pts[0]);
    const g = groups.find((x) => dot3(x.n, n) > 0.9995 && Math.abs(dot3(x.n, x.tris[0][0]) - off) < 0.75);
    if (g) g.tris.push(pts);
    else groups.push({ n, tris: [pts] });
  }
  const key = (p: V3) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
  // Edges used by one triangle of the whole roof are its open edges (eaves and rakes).
  const roofUse = new Map<string, number>();
  for (const g of groups)
    for (const tri of g.tris)
      for (let i = 0; i < 3; i++) {
        const k = [key(tri[i]), key(tri[(i + 1) % 3])].sort().join("|");
        roofUse.set(k, (roofUse.get(k) ?? 0) + 1);
      }
  for (const g of groups) {
    const use = new Map<string, { a: V3; b: V3; n: number }>();
    for (const tri of g.tris)
      for (let i = 0; i < 3; i++) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        const k = [key(a), key(b)].sort().join("|");
        const e = use.get(k);
        if (e) e.n++;
        else use.set(k, { a, b, n: 1 });
      }
    const edges = [...use.values()].filter((e) => e.n === 1).map((e) => [e.a, e.b]);
    // One outline for the whole face when its edges join into a single loop, so no seams show between triangles.
    const loops = chain(edges, key);
    face({ kind: "roof", fills: loops.length === 1 ? loops : g.tris, edges, n: g.n, color: look.roof.color, role: "roof", levelId });
    // Fascia under the open edges.
    for (const e of use.values()) {
      if (e.n !== 1) continue;
      const k = [key(e.a), key(e.b)].sort().join("|");
      if (roofUse.get(k) !== 1) continue;
      const a = { x: e.a.x, y: e.a.y };
      const b = { x: e.b.x, y: e.b.y };
      if (dist(a, b) < 1) continue;
      // No fascia where the roof meets a wall above (that's flashing).
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (shape.flashing?.some((fl) => projectOn(m, fl.a, fl.b).d < 0.2)) continue;
      const c = centerOf(g.tris.flat().map((p) => ({ x: p.x, y: p.y })));
      let out = leftNormal(unit(sub(b, a)));
      if (dot(sub(c, a), out) > 0) out = scale(out, -1);
      const T = ROOF_THICK_IN;
      face({
        kind: "fascia",
        fills: [[e.a, e.b, { ...e.b, z: e.b.z - T }, { ...e.a, z: e.a.z - T }]],
        edges: [[e.a, e.b, { ...e.b, z: e.b.z - T }, { ...e.a, z: e.a.z - T }, e.a]],
        n: { x: out.x, y: out.y, z: 0 },
        color: look.trim,
        role: "trim",
        levelId,
      });
    }
  }
  const gable = look.accent?.place === "gables" ? look.accent : look.siding;
  for (const w of shape.walls) {
    const pts = w.p.map((p, i) => v(p, w.h[i]));
    const f = face({ kind: "gable", fills: [pts], edges: [[...pts, pts[0]]], n: { x: w.out.x, y: w.out.y, z: 0 }, color: gable.color, role: look.accent?.place === "gables" ? "accent" : "siding", levelId });
    // Siding lines, clipped to the gable's outline.
    const zs = pts.map((p) => p.z);
    const lo = Math.min(...zs);
    const hi = Math.max(...zs);
    const step = gable.pattern === PATTERN.lap || gable.pattern === PATTERN.shake ? 6 : gable.pattern === PATTERN.batten ? 0 : 0;
    if (step)
      for (let z = lo + step; z < hi - 1; z += step) {
        const cut = sliceAt(pts, z);
        if (cut) f.details.push({ pts: cut, w: "hair" });
      }
  }
}

/** Join edges into closed loops. */
function chain(edges: V3[][], key: (p: V3) => string): V3[][] {
  const used = new Set<V3[]>();
  const loops: V3[][] = [];
  for (const e of edges) {
    if (used.has(e)) continue;
    used.add(e);
    const loop = [e[0], e[1]];
    for (let guard = 0; guard < edges.length + 2; guard++) {
      const last = loop[loop.length - 1];
      if (key(last) === key(loop[0])) break;
      const next = edges.find((x) => !used.has(x) && (key(x[0]) === key(last) || key(x[1]) === key(last)));
      if (!next) return [];
      used.add(next);
      loop.push(key(next[0]) === key(last) ? next[1] : next[0]);
    }
    if (key(loop[loop.length - 1]) !== key(loop[0])) return [];
    loops.push(loop.slice(0, -1));
  }
  return loops;
}

/** Where a level line at height z crosses an upright convex polygon. */
function sliceAt(pts: V3[], z: number): V3[] | null {
  const hits: V3[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    if ((a.z - z) * (b.z - z) < 0) {
      const s = (z - a.z) / (b.z - a.z);
      hits.push({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z });
    }
  });
  return hits.length === 2 ? hits : null;
}

// ---------- Looking at it ----------

export type View = {
  /** From the house toward the viewer. */
  toward: V3;
  right: V3;
  up: V3;
};

/** Looking straight at one side: "S" is the south elevation (seen from the south). */
export function sideView(side: "N" | "S" | "E" | "W"): View {
  const d = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } }[side];
  return { toward: { x: d.x, y: d.y, z: 0 }, right: { x: d.y, y: -d.x, z: 0 }, up: { x: 0, y: 0, z: 1 } };
}

/** Looking down at the house from above one corner (dx, dy: -1 or 1, east and south), `tilt` degrees above level. */
export function cornerView(dx: number, dy: number, tilt = 30): View {
  const a = (tilt * Math.PI) / 180;
  const hz = Math.cos(a) / Math.SQRT2;
  const toward = { x: dx * hz, y: dy * hz, z: Math.sin(a) };
  const right = norm({ x: toward.y, y: -toward.x, z: 0 });
  const up = cross(right, toward);
  return { toward, right, up };
}

export type Projected = { items: Item[]; bounds: { x0: number; y0: number; x1: number; y1: number } };

/**
 * The faces seen from a view, drawn into sheet items: `s` sheet inches per
 * real inch, `origin` where the house's (0, 0, 0) lands on the sheet.
 * `colored` fills faces in their material colors with light and shade
 * (3D views); otherwise in white (elevations).
 */
export function drawView(faces: Face[], view: View, s: number, origin: Point, opts: { colored?: boolean; skip?: (f: Face) => boolean } = {}): Item[] {
  const P = (p: V3): Point => ({ x: origin.x + dot3(p, view.right) * s, y: origin.y - dot3(p, view.up) * s });
  const depth = (f: Face) => Math.max(...f.fills.flat().map((p) => dot3(p, view.toward)));
  const RANK: Record<FaceKind, number> = { ground: 0, slab: 1, foundation: 2, wall: 3, gable: 4, post: 5, roof: 6, fascia: 7 };
  const seen = faces.filter((f) => !opts.skip?.(f) && dot3(f.n, view.toward) > 1e-3);
  const keyed = seen.map((f) => ({ f, d: depth(f) }));
  keyed.sort((a, b) => a.d - b.d || RANK[a.f.kind] - RANK[b.f.kind]);
  const sun = norm({ x: -0.45, y: 0.55, z: 0.7 });
  const items: Item[] = [];
  for (const { f } of keyed) {
    const shade = opts.colored ? 0.62 + 0.45 * Math.max(0, dot3(f.n, sun)) : 1;
    const fill = opts.colored ? rgbHex(f.color, shade) : "#ffffff";
    for (const poly of f.fills) items.push({ t: "poly", pts: poly.map(P), fill });
    for (const e of f.edges) items.push({ t: "line", pts: e.map(P), w: f.kind === "roof" || f.kind === "wall" ? "fine" : "fine", color: opts.colored ? "#333333" : undefined });
    for (const d of f.details) {
      if (opts.colored && d.w === "hair" && !d.closed) continue;
      const pts = d.pts.map(P);
      if (d.closed) items.push({ t: "poly", pts, fill: opts.colored ? d.color3d : d.fill, stroke: opts.colored ? "hair" : d.w, dash: d.dash });
      else items.push({ t: "line", pts, w: d.w, dash: d.dash, color: opts.colored ? "#555555" : undefined });
    }
    if (!opts.colored)
      for (const tag of f.tags) {
        const c = P(tag.at);
        const r = 0.1;
        if (tag.shape === "circle") items.push({ t: "circle", c, r, stroke: "fine", fill: "#ffffff" });
        else items.push({ t: "poly", pts: [0, 1, 2, 3, 4, 5].map((k) => ({ x: c.x + Math.cos((k * Math.PI) / 3) * r * 1.1, y: c.y + Math.sin((k * Math.PI) / 3) * r * 1.1 })), stroke: "fine", fill: "#ffffff" });
        items.push({ t: "text", at: c, text: tag.text, size: 5, bold: true, align: "center", valign: "middle" });
      }
  }
  return items;
}

/** The extent of the faces seen from a view, in real inches along its right and up axes. */
export function viewExtent(faces: Face[], view: View): { r0: number; r1: number; u0: number; u1: number } {
  let r0 = Infinity;
  let r1 = -Infinity;
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const f of faces) {
    if (dot3(f.n, view.toward) <= 1e-3) continue;
    for (const p of f.fills.flat()) {
      const r = dot3(p, view.right);
      const u = dot3(p, view.up);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
    }
  }
  return { r0, r1, u0, u1 };
}
