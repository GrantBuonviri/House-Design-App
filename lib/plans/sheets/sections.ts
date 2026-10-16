import type { Level, PlanStairs, Point, Project } from "@/lib/model/schema";
import { floorFootprint } from "@/lib/house3d/footprint";
import { ROOF_THICK_IN } from "@/lib/house3d/roof";
import { FLOOR_STRUCTURE_IN, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { flightSplit, stepsFor, TREAD_IN } from "@/lib/plan/stairs";
import { wallPieces } from "@/lib/plan/walls";
import { pointInPolygon } from "@/lib/plan/geometry";
import { areaKind } from "@/lib/plan/measure";
import { codeNum, codeRef, codeText } from "@/lib/codes/data";
import { structureOf } from "@/lib/structure";
import { along, lineIntervals, other, pt, regionBounds, type Axis } from "@/lib/structure/geometry";
import { JOIST_DEPTH } from "@/lib/structure/tables";
import { DRAW_AREA } from "../frame";
import { archFeet, DASH, POCHE, SCALES, type Item, type Weight } from "../draw";
import { houseFacts } from "../house";
import { houseScene } from "../scene";
import { viewTitle } from "../view";
import { NotesColumn } from "./symbols";

/**
 * Building sections (A-301): the house cut across both ways, showing the
 * footings, foundation, floors, walls, ceilings and roof at their real
 * heights, with the insulation in each. And the stair section (A-501): each
 * flight drawn from the side with its risers, treads, headroom, handrail and
 * guard heights.
 */

const NOTES_W = 5.6;
const SHEET_PART = { x0: DRAW_AREA.x0, x1: DRAW_AREA.x1 - NOTES_W - 0.3 };

type Cut = { axis: Axis; at: number; name: string; number: number };
type SectionSheet = { items: Item[]; scaleLabel: string };

/** Height of the roof above a plan point, or null (inches, main floor = 0). */
function roofHeightAt(project: Project, p: Point): number | null {
  const sc = houseScene(project);
  let best: number | null = null;
  for (const f of sc.faces) {
    if (f.kind !== "roof" || Math.abs(f.n.z) < 0.2) continue;
    for (const fill of f.fills) {
      if (!pointInPolygon(p, fill.map((q) => ({ x: q.x, y: q.y })))) continue;
      const p0 = fill[0];
      const z = p0.z - (f.n.x * (p.x - p0.x) + f.n.y * (p.y - p0.y)) / f.n.z;
      best = best === null ? z : Math.max(best, z);
    }
  }
  return best;
}

/** Where to cut: through the middle of the house, where the cut crosses the most of it. */
function cuts(project: Project): Cut[] {
  const s = structureOf(project);
  const h = houseFacts(project);
  if (!s.main) return [];
  const regions = floorFootprint(h.plan(s.main.id));
  const b = regionBounds(regions);
  if (!b) return [];
  const pick = (axis: Axis): number => {
    const cross = other(axis);
    const lo = cross === "x" ? b.x0 : b.y0;
    const hi = cross === "x" ? b.x1 : b.y1;
    let best = { at: (lo + hi) / 2, len: -1 };
    for (let k = 6; k <= 14; k++) {
      const at = lo + ((hi - lo) * k) / 20 + 0.37;
      const len = lineIntervals(regions, axis, at).reduce((t, [p, q]) => t + q - p, 0) - Math.abs(at - (lo + hi) / 2) * 0.2;
      if (len > best.len) best = { at, len };
    }
    return best.at;
  };
  return [
    { axis: "x", at: pick("x"), name: "Section A", number: 1 },
    { axis: "y", at: pick("y"), name: "Section B", number: 2 },
  ];
}

export function sectionCuts(project: Project): Cut[] {
  return cuts(project);
}

export function sectionSheets(project: Project): SectionSheet[] {
  const list = cuts(project);
  const drawn = list.map((c) => sectionDrawing(project, c));
  // Both on one sheet when they fit at the same scale.
  const room = DRAW_AREA.y1 - DRAW_AREA.y0 - 0.6;
  const width = SHEET_PART.x1 - SHEET_PART.x0;
  const scale = SCALES.slice(1).find((sc) => drawn.every((d) => d.w * sc.inPerFt / 12 <= width) && drawn.reduce((t, d) => t + d.h * (sc.inPerFt / 12) + 1.4, 0) <= room) ?? null;
  const notes = sectionNotes(project);
  if (scale) {
    const items: Item[] = [];
    let y = DRAW_AREA.y0 + 0.3;
    for (const d of drawn) {
      const k = scale.inPerFt / 12;
      items.push(...d.draw(SHEET_PART.x0 + (width - d.w * k) / 2, y, k));
      y += d.h * k + 0.55;
      items.push(...viewTitle(SHEET_PART.x0 + 0.1, y, { number: d.cut.number, title: d.cut.name, scaleLabel: scale.label, inPerFt: scale.inPerFt }));
      y += 0.85;
    }
    items.push(...notes);
    return [{ items, scaleLabel: scale.label }];
  }
  // Otherwise one per sheet.
  return drawn.map((d) => {
    const sc = SCALES.slice(1).find((x) => d.w * (x.inPerFt / 12) <= width && d.h * (x.inPerFt / 12) + 1.4 <= room) ?? SCALES[SCALES.length - 1];
    const k = sc.inPerFt / 12;
    const items = d.draw(SHEET_PART.x0 + (width - d.w * k) / 2, DRAW_AREA.y0 + 0.3, k);
    items.push(...viewTitle(SHEET_PART.x0 + 0.1, DRAW_AREA.y0 + 0.3 + d.h * k + 0.55, { number: d.cut.number, title: d.cut.name, scaleLabel: sc.label, inPerFt: sc.inPerFt }));
    items.push(...notes);
    return { items, scaleLabel: sc.label };
  });
}

function sectionNotes(project: Project): Item[] {
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  const s = structureOf(project);
  const wall = project.plan.basics?.exteriorWall ?? "2x6";
  col.heading("Section notes");
  col.notes([
    `Outside walls: ${wall} studs, ${codeText("energy.woodWallR")} insulation (${codeRef("energy.woodWallR")}), wood structural panel sheathing, weather barrier, siding. 1/2" gypsum board inside.`,
    `Ceiling under the attic: R-${codeNum("energy.ceilingR")} (${codeRef("energy.ceilingR")}), trusses at 24" on center by the truss supplier (S-301).`,
    s.foundation?.zones.crawlspace.length ? `Floor over the crawlspace: R-${codeNum("energy.floorR")} (${codeRef("energy.floorR")}), or insulate the crawlspace walls ${codeText("energy.crawlWallR")} for a conditioned crawlspace.` : "",
    s.foundation?.zones.slab.length ? `Slab edge: ${codeText("energy.slabR")} (${codeRef("energy.slabR")}).` : "",
    s.basement ? `Basement walls: ${codeText("energy.basementWallR")} (${codeRef("energy.basementWallR")}).` : "",
    `Footings ${codeNum("design.frostDepth")}" below grade at least (frost depth); sizes on the foundation plan (S-101). Framing sizes on S-201 to S-401.`,
    `Grade falls away from the house ${codeNum("site.gradeFall")}" in the first ${codeNum("site.gradeFallDistance")} ft (${codeRef("site.gradeFall")}). Wood siding at least ${codeNum("siding.woodClearanceToGrade")}" above grade.`,
  ].filter(Boolean));
  return col.items;
}

/** One section, ready to place: its size in plan inches and a function that draws it at a scale. */
function sectionDrawing(project: Project, cut: Cut) {
  const h = houseFacts(project);
  const s = structureOf(project);
  const sc = houseScene(project);
  const axis = cut.axis;
  const levels = [...(s.basement ? [s.basement] : []), ...(s.main ? [s.main] : []), ...s.upper];
  const at = (u: number): Point => pt(axis, u, cut.at);
  const parts: { kind: "rect" | "line"; pts: Point[]; w?: Weight; fill?: string; dash?: number[] }[] = [];
  const texts: { u: number; z: number; text: string; size: number; bold?: boolean; align?: "left" | "center" | "right" }[] = [];
  const rect = (u0: number, z0: number, u1: number, z1: number, fill?: string, w: Weight = "fine") =>
    parts.push({ kind: "rect", pts: [{ x: u0, y: z0 }, { x: u1, y: z0 }, { x: u1, y: z1 }, { x: u0, y: z1 }], fill, w });
  const ln = (pts: Point[], w: Weight = "fine", dash?: number[]) => parts.push({ kind: "line", pts, w, dash });

  let uMin = Infinity;
  let uMax = -Infinity;
  let zMin = 0;
  let zMax = 0;
  const t = h.exteriorIn;
  const mainF = s.floors.find((f) => f.levelId === s.main?.id);
  const depthOf = (levelId: string) => {
    const f = s.floors.find((x) => x.levelId === levelId);
    return f?.joist ? JOIST_DEPTH[f.joist.size] + 0.75 : FLOOR_STRUCTURE_IN - 1;
  };

  for (const level of levels) {
    const plan = h.plan(level.id);
    const { floorIn, ceilingIn } = sc.heights[level.id];
    const regions = floorFootprint(plan);
    const ivs = lineIntervals(regions, axis, cut.at);
    for (const [u0, u1] of ivs) {
      uMin = Math.min(uMin, u0 - t);
      uMax = Math.max(uMax, u1 + t);
      // Outside walls, cut.
      rect(u0 - t / 2, floorIn, u0 + t / 2, floorIn + ceilingIn, POCHE);
      rect(u1 - t / 2, floorIn, u1 + t / 2, floorIn + ceilingIn, POCHE);
      // Ceiling.
      ln([{ x: u0 + t / 2, y: floorIn + ceilingIn }, { x: u1 - t / 2, y: floorIn + ceilingIn }], "fine");
      // Floor: framing over a crawlspace, basement or floor; a slab otherwise.
      const framedAt = (u: number) => {
        const q = at(u);
        if (plan.rooms.some((r) => areaKind(r) === "garage" && pointInPolygon(q, r.polygon))) return false;
        return s.floors.some((f) => f.levelId === level.id && f.regions.some((r) => pointInPolygon(q, r.outline)));
      };
      const n = Math.max(1, Math.round((u1 - u0) / 6));
      let start = u0;
      let kind = framedAt(u0 + 3);
      for (let i = 1; i <= n; i++) {
        const u = u0 + ((u1 - u0) * i) / n;
        const next = i < n ? framedAt(u + 3) : !kind;
        if (next === kind) continue;
        const a = start === u0 ? u0 - t / 2 : start;
        const b = i === n ? u1 + t / 2 : u;
        if (kind) rect(a, floorIn - depthOf(level.id), b, floorIn, "#e6e6e6");
        else rect(a, floorIn - codeNum("struct.slabMinThickness") - 0.5, b, floorIn, "#d0d0d0");
        start = u;
        kind = next;
      }
      // Room names along the cut.
      for (const [r0, r1] of roomSpans(plan, axis, cut.at, u0, u1)) {
        const room = plan.rooms.find((r) => pointInPolygon(at((r0 + r1) / 2), r.polygon));
        if (room && r1 - r0 > 48) texts.push({ u: (r0 + r1) / 2, z: floorIn + Math.min(48, ceilingIn / 2), text: room.name.toUpperCase(), size: 7, bold: true, align: "center" });
      }
      zMax = Math.max(zMax, floorIn + ceilingIn);
    }
    // Inside walls crossing the cut.
    for (const p of wallPieces(plan, t)) {
      if (p.exterior || p.open) continue;
      const wa = along(p.a, other(axis));
      const wb = along(p.b, other(axis));
      if ((wa - cut.at) * (wb - cut.at) > 0 || Math.abs(wa - wb) < 1) continue;
      const k = (cut.at - wa) / (wb - wa);
      const u = along(p.a, axis) + k * (along(p.b, axis) - along(p.a, axis));
      rect(u - INTERIOR_WALL_IN / 2, floorIn, u + INTERIOR_WALL_IN / 2, floorIn + ceilingIn, "#7a7a7a");
    }
    if (!ivs.length) continue;
    // Level marker at the left.
    zMin = Math.min(zMin, floorIn);
    texts.push({ u: Infinity, z: floorIn, text: `${level.name.toUpperCase()}  ${archFeet(floorIn)}`, size: 7, bold: true, align: "left" });
    texts.push({ u: Infinity, z: floorIn + ceilingIn, text: `CEILING ${archFeet(ceilingIn)} A.F.F.`, size: 6, align: "left" });
  }
  if (!Number.isFinite(uMin)) {
    uMin = 0;
    uMax = 240;
  }
  // Roof: top and underside, sampled along the cut.
  const step = 6;
  const over = project.house3d.roof.overhangIn + t;
  let run: Point[] = [];
  const roofLines: Point[][] = [];
  for (let u = uMin - over; u <= uMax + over; u += step) {
    const z = roofHeightAt(project, at(u));
    if (z === null) {
      if (run.length > 1) roofLines.push(run);
      run = [];
      continue;
    }
    run.push({ x: u, y: z });
    zMax = Math.max(zMax, z);
  }
  if (run.length > 1) roofLines.push(run);
  for (const r of roofLines) {
    ln(r, "medium");
    ln(r.map((p) => ({ x: p.x, y: p.y - ROOF_THICK_IN })), "fine");
    uMin = Math.min(uMin, r[0].x);
    uMax = Math.max(uMax, r[r.length - 1].x);
  }
  // Ground and foundation under the outside walls of the lowest floors.
  const ground = (u: number) => sc.site.groundAt(at(u));
  const gpts: Point[] = [];
  for (let u = uMin - 48; u <= uMax + 48; u += 12) gpts.push({ x: u, y: ground(u) });
  ln(gpts, "medium");
  const frost = codeNum("design.frostDepth");
  const lines = s.foundation?.lines ?? [];
  const baseIvs = s.basement ? lineIntervals(floorFootprint(h.plan(s.basement.id)), axis, cut.at) : [];
  for (const base of [s.basement, s.main]) {
    if (!base) continue;
    const floorIn = sc.heights[base.id].floorIn;
    for (const [u0, u1] of lineIntervals(floorFootprint(h.plan(base.id)), axis, cut.at)) {
      for (const u of [u0, u1]) {
        // The main floor's walls over the basement sit on the basement walls.
        if (base === s.main && baseIvs.some(([b0, b1]) => u > b0 - 12 && u < b1 + 12)) continue;
        const p = at(u);
        const near = lines.map((l) => ({ l, d: distToSeg(p, l.a, l.b) })).sort((x, y) => x.d - y.d)[0];
        const fw = near && near.d < 24 ? (near.l.footing?.widthIn ?? 12) : 12;
        const ft = near && near.d < 24 ? (near.l.footing?.thicknessIn ?? 6) : 6;
        const inward = at(u === u0 ? u0 + 12 : u1 - 12);
        const onFraming = base === s.main && mainF?.regions.some((r) => pointInPolygon(inward, r.outline)) && !h.plan(base.id).rooms.some((r) => areaKind(r) === "garage" && pointInPolygon(inward, r.polygon));
        const top = floorIn - (onFraming ? depthOf(base.id) : codeNum("struct.slabMinThickness") + 0.5);
        const bottom = Math.min(ground(u), floorIn) - frost;
        rect(u - 4, bottom, u + 4, top, "#9a9a9a");
        rect(u - fw / 2, bottom - ft, u + fw / 2, bottom, "#9a9a9a");
        zMin = Math.min(zMin, bottom - ft);
      }
    }
  }
  zMin -= 12;
  const w = uMax - uMin + 120;
  const hgt = zMax - zMin + 24;
  const draw = (x0: number, y0: number, k: number): Item[] => {
    const X = (u: number) => x0 + (u - uMin + 60) * k;
    const Y = (z: number) => y0 + (zMax + 12 - z) * k;
    const items: Item[] = [];
    for (const p of parts) {
      const pts = p.pts.map((q) => ({ x: X(q.x), y: Y(q.y) }));
      if (p.kind === "rect") items.push({ t: "poly", pts, fill: p.fill, stroke: p.w });
      else items.push({ t: "line", pts, w: p.w ?? "fine", dash: p.dash });
    }
    for (const tx of texts) {
      const x = Number.isFinite(tx.u) ? X(tx.u) : X(uMin - 56);
      items.push({ t: "text", at: { x, y: Y(tx.z) - 0.04 }, text: tx.text, size: tx.size, bold: tx.bold, align: tx.align });
      if (!Number.isFinite(tx.u)) items.push({ t: "line", pts: [{ x: X(uMin - 56), y: Y(tx.z) }, { x: X(uMin) - 0.05, y: Y(tx.z) }], w: "hair", dash: DASH.center });
    }
    // Pitch mark on the first roof line.
    const r = roofLines[0];
    if (r && project.house3d.roof.style !== "flat") {
      const label = `${project.house3d.roof.pitch}:12`;
      const m = r[Math.floor(r.length / 4)];
      items.push({ t: "text", at: { x: X(m.x), y: Y(m.y) - 0.12 }, text: label, size: 7, bold: true, align: "center" });
    }
    const gl = { x: X(uMax + 30), y: Y(ground(uMax)) - 0.05 };
    items.push({ t: "text", at: gl, text: "GRADE", size: 6, align: "left" });
    return items;
  };
  return { cut, w, h: hgt, draw };
}

/** Rooms along a cut between two points, as spans. */
function roomSpans(plan: ReturnType<ReturnType<typeof houseFacts>["plan"]>, axis: Axis, at: number, u0: number, u1: number): [number, number][] {
  const out: [number, number][] = [];
  for (const r of plan.rooms) for (const iv of lineIntervals([{ outline: r.polygon, holes: [] }], axis, at)) if (iv[1] > u0 && iv[0] < u1) out.push([Math.max(u0, iv[0]), Math.min(u1, iv[1])]);
  return out;
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
}

// ---------- A-501 Stair section ----------

export function stairSectionSheet(project: Project): SectionSheet {
  const h = houseFacts(project);
  const flights: { level: Level; s: PlanStairs; rise: number }[] = [];
  for (const level of h.levels) for (const s of h.plan(level.id).stairs) flights.push({ level, s, rise: h.riseFor(s, level) });
  const items: Item[] = [];
  const sc = SCALES[0]; // 1/2" = 1'
  const k = sc.inPerFt / 12;
  let y = DRAW_AREA.y0 + 0.4;
  let x = SHEET_PART.x0 + 0.3;
  let rowH = 0;
  flights.slice(0, 4).forEach((f, i) => {
    const d = stairProfile(f.s, f.rise);
    const w = d.w * k;
    const hh = d.h * k;
    if (x + w > SHEET_PART.x1) {
      x = SHEET_PART.x0 + 0.3;
      y += rowH + 1.2;
      rowH = 0;
    }
    items.push(...d.draw(x, y, k));
    items.push(...viewTitle(x, y + hh + 0.5, { number: i + 1, title: `${f.level.name} stairs`, scaleLabel: sc.label, inPerFt: sc.inPerFt, barFeet: [0, 1, 2, 4] }));
    x += Math.max(w, 6) + 0.8;
    rowH = Math.max(rowH, hh + 0.6);
  });
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Stair notes");
  col.notes([
    `Risers ${archInch(codeNum("stairs.maxRiser"))} high at most, treads ${archInch(codeNum("stairs.minTread"))} deep at least, no more than ${archInch(codeNum("stairs.maxRiserVariation"))} difference between the biggest and smallest in a flight (${codeRef("stairs.maxRiser")}).`,
    `Nosings ${archInch(codeNum("stairs.nosingMin"))} to ${archInch(codeNum("stairs.nosingMax"))} on solid risers (${codeRef("stairs.nosingMin")}).`,
    `At least ${archInch(codeNum("stairs.minWidth"))} wide and ${archFeet(codeNum("stairs.minHeadroom"))} headroom, measured up from the nosing line (${codeRef("stairs.minHeadroom")}).`,
    `Handrail on at least one side, ${codeNum("stairs.handrailMinHeight")}" to ${codeNum("stairs.handrailMaxHeight")}" above the nosings, for stairs with ${codeNum("stairs.handrailRequiredRisers")} or more risers (${codeRef("stairs.handrailMinHeight")}).`,
    `Guards where a side is open more than ${codeNum("guards.requiredDrop")}" above the floor below: ${codeNum("guards.minHeight")}" high at landings and floors, ${codeNum("guards.minHeightStairSides")}" along the stair, openings that won't pass a ${codeNum("guards.maxOpening")}" sphere (${codeRef("guards.minHeight")}).`,
    `Landings at least ${archInch(codeNum("stairs.landingMinDepth"))} deep in the direction of travel (${codeRef("stairs.landingMinDepth")}). Enclosed space under the stairs: 1/2" gypsum board (R302.7).`,
  ]);
  items.push(...col.items);
  return { items, scaleLabel: sc.label };
}

const archInch = (n: number) => `${Math.round(n * 1000) / 1000}"`.replace(/\.375"/, ' 3/8"').replace(/\.75"/, ' 3/4"').replace(/\.25"/, ' 1/4"').replace(/\.5"/, ' 1/2"');

/** The stair seen from the side, unfolded at the landing for L and U stairs. */
function stairProfile(s: PlanStairs, rise: number) {
  const { risers, riserIn, treads } = stepsFor(rise);
  const T = TREAD_IN;
  const landing = s.shape === "straight" ? null : flightSplit(treads);
  const landingDepth = s.widthIn;
  // Steps as (run, height) from the bottom.
  const pts: Point[] = [{ x: 0, y: 0 }];
  let u = 0;
  let z = 0;
  for (let i = 0; i < risers; i++) {
    z += riserIn;
    pts.push({ x: u, y: z });
    const last = i === risers - 1;
    if (last) break;
    const atLanding = landing && i === landing.n1;
    u += atLanding ? landingDepth : T;
    pts.push({ x: u, y: z });
  }
  const run = u;
  const floorD = FLOOR_STRUCTURE_IN;
  const w = run + 96;
  const hgt = rise + 112;
  const draw = (x0: number, y0: number, k: number): Item[] => {
    const X = (a: number) => x0 + (a + 36) * k;
    const Y = (b: number) => y0 + (rise + 90 - b) * k;
    const P = (q: Point) => ({ x: X(q.x), y: Y(q.y) });
    const items: Item[] = [];
    // Lower floor and upper floor with its structure.
    items.push({ t: "line", pts: [P({ x: -36, y: 0 }), P({ x: run + 60, y: 0 })], w: "medium" });
    items.push({ t: "poly", pts: [P({ x: run, y: rise }), P({ x: run + 60, y: rise }), P({ x: run + 60, y: rise - floorD }), P({ x: run, y: rise - floorD })], fill: "#d0d0d0", stroke: "fine" });
    // Steps and stringer.
    items.push({ t: "line", pts: pts.map(P), w: "heavy" });
    items.push({ t: "line", pts: [P({ x: T * 0.6, y: -6 }), P({ x: run, y: rise - riserIn - 10 })], w: "fine", dash: DASH.hidden });
    // Nosing line, headroom and handrail.
    const nose = (a: number) => (a / Math.max(run, 1)) * (rise - riserIn) + riserIn;
    const hr = codeNum("stairs.minHeadroom");
    items.push({ t: "line", pts: [P({ x: 0, y: nose(0) + hr }), P({ x: run, y: nose(run) + hr })], w: "fine", dash: DASH.center });
    items.push({ t: "text", at: P({ x: run / 3, y: nose(run / 3) + hr + 4 }), text: `${archFeet(hr)} MIN. HEADROOM`, size: 6, rotate: (Math.atan2((rise - riserIn) * k, run * k) * 180) / Math.PI });
    const rail = (codeNum("stairs.handrailMinHeight") + codeNum("stairs.handrailMaxHeight")) / 2;
    items.push({ t: "line", pts: [P({ x: 0, y: nose(0) + rail }), P({ x: run, y: nose(run) + rail })], w: "medium" });
    items.push({ t: "text", at: P({ x: (run * 2) / 3, y: nose((run * 2) / 3) + rail + 3 }), text: `HANDRAIL ${codeNum("stairs.handrailMinHeight")}"-${codeNum("stairs.handrailMaxHeight")}"`, size: 6, rotate: (Math.atan2((rise - riserIn) * k, run * k) * 180) / Math.PI });
    // Guard at the top.
    const g = codeNum("guards.minHeight");
    items.push({ t: "line", pts: [P({ x: run, y: rise }), P({ x: run, y: rise + g }), P({ x: run + 48, y: rise + g })], w: "fine" });
    items.push({ t: "text", at: P({ x: run + 50, y: rise + g }), text: `GUARD ${g}" MIN.`, size: 6 });
    // Dimensions in words.
    items.push({ t: "text", at: P({ x: -30, y: rise / 2 }), text: `${risers} RISERS @ ${archInch(Math.round(riserIn * 8) / 8)}`, size: 6.5, bold: true, rotate: 90, align: "center" });
    items.push({ t: "text", at: P({ x: run / 2, y: -12 }), text: `${treads} TREADS @ ${T}"${landing ? `, LANDING ${archFeet(landingDepth)}` : ""} = ${archFeet(run)} RUN`, size: 6.5, bold: true, align: "center" });
    items.push({ t: "text", at: P({ x: run + 4, y: rise - floorD - 8 }), text: `TOTAL RISE ${archFeet(rise)}`, size: 6 });
    return items;
  };
  return { w, h: hgt, draw };
}
