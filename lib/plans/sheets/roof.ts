import type { Point, Project } from "@/lib/model/schema";
import { add, boundsOf, dist, leftNormal, lerp, scale, sub, unit } from "@/lib/plan/geometry";
import { measureRoof } from "@/lib/cost/quantities";
import { exteriorPick } from "@/lib/exterior/picks";
import { codeEntry, codeNum, codeRef } from "@/lib/codes/data";
import { DRAW_AREA } from "../frame";
import { capHeight, DASH, heading, HEADING_H, SCALES, table, textBlock, readable, type Item, type Weight } from "../draw";
import { houseFacts } from "../house";
import { houseScene, type V3 } from "../scene";
import { viewTitle } from "../view";

/**
 * The roof plan: the roof from above with its eaves, ridges, hips and
 * valleys, slope arrows with the pitch, the walls below dashed, gutters and
 * downspouts, and the attic ventilation it needs.
 */

const NOTES_W = 5.6;
const TITLE_BAND = 1.1;
/** About one downspout for every 40 ft of gutter (a common rule of thumb, not a code number). */
const GUTTER_PER_DOWNSPOUT_FT = 40;

type Edge = { a: V3; b: V3; n: number; groups: number[] };

export function roofSheet(project: Project): { items: Item[]; scaleLabel: string; downspouts: number } {
  const h = houseFacts(project);
  const sc = houseScene(project);
  const roof = project.house3d.roof;
  const items: Item[] = [];
  const roofFaces = sc.faces.filter((f) => f.kind === "roof");
  const pts2 = [...roofFaces.flatMap((f) => f.fills.flat()), ...sc.rings.flatMap((r) => r.ring.map((p) => ({ ...p, z: 0 })))];
  const b = boundsOf(pts2.map((p) => ({ x: p.x, y: p.y })))!;
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0, x1: DRAW_AREA.x1 - NOTES_W - 0.3, y1: DRAW_AREA.y1 - TITLE_BAND };
  const fits = (inPerFt: number) => ((b.x1 - b.x0) / 12) * inPerFt + 1.6 <= area.x1 - area.x0 && ((b.y1 - b.y0) / 12) * inPerFt + 1.6 <= area.y1 - area.y0;
  const choice = SCALES.slice(1).find((x) => fits(x.inPerFt)) ?? SCALES[SCALES.length - 1];
  const s = choice.inPerFt / 12;
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const center = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
  const T = (p: Point): Point => ({ x: center.x + (p.x - mid.x) * s, y: center.y + (p.y - mid.y) * s });
  const pline = (pts: Point[], w: Weight = "fine", dash?: number[]) => items.push({ t: "line", pts: pts.map(T), w, dash });

  // Walls below, dashed.
  for (const r of sc.rings) pline([...r.ring, r.ring[0]], "fine", DASH.hidden);

  // Roof edges: used by one face, the outside edge; by two, a ridge, hip or valley.
  const key = (p: V3) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)},${Math.round(p.z * 2)}`;
  const edges = new Map<string, Edge>();
  roofFaces.forEach((f, gi) => {
    for (const e of f.edges) {
      const k = [key(e[0]), key(e[1])].sort().join("|");
      const x = edges.get(k);
      if (x) {
        x.n++;
        x.groups.push(gi);
      } else edges.set(k, { a: e[0], b: e[1], n: 1, groups: [gi] });
    }
  });
  const centroid = (gi: number) => {
    const ps = roofFaces[gi].fills.flat();
    return ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, y: a.y + p.y / ps.length, z: a.z + p.z / ps.length }), { x: 0, y: 0, z: 0 });
  };
  const gutters: { a: Point; b: Point; out: Point }[] = [];
  for (const e of edges.values()) {
    const a = { x: e.a.x, y: e.a.y };
    const c = { x: e.b.x, y: e.b.y };
    if (dist(a, c) < 1) continue;
    if (e.n === 1) {
      pline([a, c], "medium");
      // A level outside edge is an eave and gets a gutter; a sloped one is a rake.
      const g = roofFaces[e.groups[0]];
      const level = Math.abs(e.a.z - e.b.z) < 0.5;
      if (level && g.n.z < 0.999) {
        const cen = centroid(e.groups[0]);
        let out = leftNormal(unit(sub(c, a)));
        if ((cen.x - a.x) * out.x + (cen.y - a.y) * out.y > 0) out = scale(out, -1);
        gutters.push({ a, b: c, out });
      }
      continue;
    }
    pline([a, c], "fine");
    const m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, z: (e.a.z + e.b.z) / 2 };
    const low = e.groups.every((gi) => centroid(gi).z > m.z);
    const name = low ? "VALLEY" : Math.abs(e.a.z - e.b.z) < 0.5 ? "RIDGE" : "HIP";
    if (dist(a, c) * s > 0.7) items.push({ t: "text", at: add(T(lerp(a, c, 0.5)), { x: 0, y: -0.05 }), text: name, size: 4.5, align: "center", rotate: readable(sub(c, a)) });
  }

  // Slope arrows with the pitch, on each sloped face.
  for (const f of roofFaces) {
    if (f.n.z > 0.999) continue;
    const ps = f.fills.flat();
    const c = ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, y: a.y + p.y / ps.length }), { x: 0, y: 0 });
    const d = unit({ x: f.n.x, y: f.n.y });
    const len = Math.min(0.45, Math.sqrt(polyArea(f.fills)) * s * 0.3);
    if (len < 0.15) continue;
    const p0 = T(c);
    const p1 = add(p0, scale(d, len));
    items.push({ t: "line", pts: [p0, p1], w: "fine" });
    const n = leftNormal(d);
    items.push({ t: "poly", pts: [p1, add(sub(p1, scale(d, 0.08)), scale(n, 0.03)), add(sub(p1, scale(d, 0.08)), scale(n, -0.03))], fill: "#000000" });
    items.push({ t: "text", at: add(p0, scale(n, 0.07)), text: `${roof.pitch}:12`, size: 5.5, align: "center", rotate: readable(d) });
  }
  for (const r of sc.roofs.filter((x) => x.flat)) {
    const c = r.eave.reduce((a, p) => add(a, scale(p, 1 / r.eave.length)), { x: 0, y: 0 });
    items.push({ t: "text", at: T(c), text: "LOW-SLOPE ROOF", size: 6, align: "center", valign: "middle", bold: true });
  }

  // Gutters along the eaves, and downspouts at the ends of each run.
  for (const g of gutters) pline([add(g.a, scale(g.out, 5)), add(g.b, scale(g.out, 5))], "hair");
  let downspouts = 0;
  for (const run of joinRuns(gutters)) {
    const total = run.slice(1).reduce((sum, p, i) => sum + dist(run[i], p), 0) / 12;
    if (total < 4) continue;
    const want = Math.max(1, Math.ceil(total / GUTTER_PER_DOWNSPOUT_FT));
    const spots = want === 1 ? [run[run.length - 1]] : Array.from({ length: want }, (_, i) => along(run, i / (want - 1)));
    for (const p of spots) {
      const c = T(p);
      items.push({ t: "poly", pts: [add(c, { x: -0.04, y: -0.04 }), add(c, { x: 0.04, y: -0.04 }), add(c, { x: 0.04, y: 0.04 }), add(c, { x: -0.04, y: 0.04 })], stroke: "fine", fill: "#ffffff" });
      items.push({ t: "text", at: add(c, { x: 0.07, y: 0.12 }), text: "DS", size: 4.5, bold: true });
      downspouts++;
    }
  }

  // ---------- Notes and numbers ----------
  const m = measureRoof(project.floorPlans, project.levels, h.basics, roof);
  const nx = DRAW_AREA.x1 - NOTES_W;
  let ny = DRAW_AREA.y0;
  items.push(...heading("Roof", nx, ny, NOTES_W));
  ny += HEADING_H + 0.05;
  const pick = exteriorPick(project.exterior.selections, "roofing")?.product;
  const gutterPick = exteriorPick(project.exterior.selections, "gutters")?.product;
  const shingle = !pick || /shingle|asphalt/i.test(`${pick.kind ?? ""} ${pick.name}`);
  const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
  const rows: string[][] = [
    ["Shape", `${roof.style[0].toUpperCase()}${roof.style.slice(1)} roof, ${roof.style === "flat" ? "low slope" : `${roof.pitch}:12 pitch`}`],
    ["Overhang", `${roof.overhangIn}" past the outside walls`],
    ["Roofing", pick ? `${pick.name} (${pick.brand})` : "To be picked (Exterior page)"],
    ["Roof area", `${f0(m.roofSqft + m.flatSqft)} sq ft (sloped ${f0(m.roofSqft)}, low-slope ${f0(m.flatSqft)})`],
    ["Gutters", `${f0(gutters.reduce((sum, g) => sum + dist(g.a, g.b), 0) / 12)} ft${gutterPick ? `, ${gutterPick.name}` : ""}, ${downspouts} downspouts (DS)`],
    ["Hips and valleys", `${f0(m.hipValleyLf)} ft`],
  ];
  let tb = table(nx, ny, [{ title: "", width: 1.5 }, { title: "", width: NOTES_W - 1.5 }], rows, { size: 7, boldFirst: true });
  items.push(...tb.items);
  ny += tb.height + 0.3;

  items.push(...heading("Attic ventilation", nx, ny, NOTES_W));
  ny += HEADING_H + 0.05;
  const full = codeNum("attic.ventRatio");
  const reduced = codeNum("attic.ventRatioReduced");
  const attic = m.atticSqft;
  const vrows = [
    ["Attic floor area", `${f0(attic)} sq ft`],
    [`1/${full} of the area`, `${f0((attic / full) * 144)} sq in net free vent area, split between soffit and ridge vents`],
    [`1/${reduced} of the area`, `${f0((attic / reduced) * 144)} sq in, allowed only with the upper vents the exception calls for (${codeRef("attic.ventRatioReduced")})`],
  ];
  tb = table(nx, ny, [{ title: "", width: 1.5 }, { title: "", width: NOTES_W - 1.5 }], vrows, { size: 7, boldFirst: true });
  items.push(...tb.items);
  ny += tb.height + 0.08;
  items.push(...textBlock(`Net free area is printed on each vent. Required by ${codeRef("attic.ventRatio")}.`, nx, ny, NOTES_W, 6.5).items);
  ny += 0.4;

  items.push(...heading("Roof notes", nx, ny, NOTES_W));
  ny += HEADING_H + 0.08;
  const under = codeNum("roof.shingleDoubleUnderlaymentBelow");
  const minSlope = codeNum("roof.shingleMinSlope");
  const notes = [
    `Roof framing: engineered trusses from the truss supplier, with their drawings and layout before framing. Design loads: ${codeNum("design.roofSnowLoadMin")} psf snow, ${codeNum("design.windSpeed")} mph wind (IRC Table R301.2(1), Boise).`,
    shingle
      ? `Asphalt shingles need at least ${minSlope}:12 slope (${codeRef("roof.shingleMinSlope")})${roof.style !== "flat" && roof.pitch < under ? `; below ${under}:12, two layers of underlayment (${codeRef("roof.shingleDoubleUnderlaymentBelow")}).` : "."}${roof.style !== "flat" && roof.pitch < minSlope ? " THIS ROOF IS TOO FLAT FOR SHINGLES: pick metal or membrane roofing." : ""}`
      : `Lapped metal roofing without seam sealant needs at least ${codeNum("roof.metalLappedMinSlope")}:12 slope (${codeRef("roof.metalLappedMinSlope")}). Follow the maker's minimum for other panels.`,
    `Ice barrier underlayment: ${codeEntry("design.iceBarrierRequired").value === false ? "not required in Boise" : "required"} (IRC Table R301.2(1), Boise).`,
    "Gutters and downspouts: about one downspout for every 40 ft of gutter, each draining away from the foundation. Low-slope roofs drain to scuppers or drains by the roofer.",
    "Dashed lines are the outside walls below. Flashing at every wall, chimney and valley to the roofing maker's instructions.",
  ];
  notes.forEach((n, i) => {
    items.push({ t: "text", at: { x: nx, y: ny + capHeight(7) }, text: `${i + 1}.`, size: 7 });
    const b2 = textBlock(n, nx + 0.22, ny, NOTES_W - 0.22, 7);
    items.push(...b2.items);
    ny += b2.height + 0.08;
  });

  items.push(...viewTitle(area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: "Roof plan", scaleLabel: choice.label, inPerFt: choice.inPerFt, north: true }));
  return { items, scaleLabel: choice.label, downspouts };
}

function polyArea(polys: V3[][]): number {
  let a = 0;
  for (const p of polys) for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y;
  return Math.abs(a / 2);
}

/** Join gutter pieces that meet end to end (around corners too) into runs. */
function joinRuns(gs: { a: Point; b: Point }[]): Point[][] {
  const left = [...gs];
  const runs: Point[][] = [];
  while (left.length) {
    const g = left.shift()!;
    const pts = [g.a, g.b];
    for (let i = 0; i < left.length; i++) {
      const x = left[i];
      const end = pts[pts.length - 1];
      const start = pts[0];
      if (dist(x.a, end) < 1) pts.push(x.b);
      else if (dist(x.b, end) < 1) pts.push(x.a);
      else if (dist(x.b, start) < 1) pts.unshift(x.a);
      else if (dist(x.a, start) < 1) pts.unshift(x.b);
      else continue;
      left.splice(i, 1);
      i = -1;
    }
    runs.push(pts);
  }
  return runs;
}

/** The point a fraction t of the way along a polyline. */
function along(pts: Point[], t: number): Point {
  const total = pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
  let left = t * total;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (left <= d + 1e-6) return lerp(pts[i - 1], pts[i], d ? left / d : 0);
    left -= d;
  }
  return pts[pts.length - 1];
}

