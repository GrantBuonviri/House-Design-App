import type { Point, Project } from "@/lib/model/schema";
import { add, boundsOf, dist, dot, leftNormal, lerp, project as projectOn, scale, sub, unit } from "@/lib/plan/geometry";
import { landDrawing } from "@/lib/bubbles/land";
import { yardLayout, yardAmounts, type Strip } from "@/lib/exterior/yard";
import { exteriorPick } from "@/lib/exterior/picks";
import { plotAcres } from "@/lib/land/generate";
import { changedBy, codeNum, codeRef } from "@/lib/codes/data";
import { inchText } from "@/lib/codes/rules";
import { DRAW_AREA } from "../frame";
import { zoningCode } from "../local";
import { archFeet, capHeight, DASH, GREY, heading, HEADING_H, LIGHT, table, textBlock, readable, type Item, type Weight } from "../draw";
import { houseFacts } from "../house";
import { houseFootprintSqft, lotAsPlot, siteLayout, type SiteLayout } from "../lot";
import { houseScene } from "../scene";
import { viewTitle } from "../view";

/**
 * The site plan: the lot with its lines and lengths, the street, setbacks
 * and easements, the house with its roof edge, the driveway and walk, how
 * far the house is from each lot line, which way the ground drains, and a
 * table of lot data and setbacks. On the app's made-up land it says so in
 * large letters.
 */

const NOTES_W = 6;
const TITLE_BAND = 1.1;

/** Site plan scales: 1" = 20' first, then the engineer's scales below it. */
export const SITE_SCALES = [20, 30, 40, 50, 60, 100].map((ft) => ({ inPerFt: 1 / ft, label: `1" = ${ft}'-0"`, ft }));

export function siteSheet(project: Project): { items: Item[]; scaleLabel: string } {
  const site = siteLayout(project)!;
  const h = houseFacts(project);
  const sc = houseScene(project);
  const items: Item[] = [];

  // ---------- Scale and placement ----------
  const b = boundsOf([...site.outline, ...site.house.flat()])!;
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0 + (site.real ? 0 : 0.7), x1: DRAW_AREA.x1 - NOTES_W - 0.3, y1: DRAW_AREA.y1 - TITLE_BAND };
  const margin = 1.4;
  const fits = (inPerFt: number) => ((b.x1 - b.x0) / 12) * inPerFt + margin * 2 <= area.x1 - area.x0 && ((b.y1 - b.y0) / 12) * inPerFt + margin * 2 <= area.y1 - area.y0;
  const choice = SITE_SCALES.find((s) => fits(s.inPerFt)) ?? SITE_SCALES[SITE_SCALES.length - 1];
  const s = choice.inPerFt / 12;
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const center = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
  const T = (p: Point): Point => ({ x: center.x + (p.x - mid.x) * s, y: center.y + (p.y - mid.y) * s });
  const pline = (pts: Point[], w: Weight = "fine", dash?: number[], color?: string) => items.push({ t: "line", pts: pts.map(T), w, dash, color });
  const ppoly = (pts: Point[], stroke?: Weight, fill?: string, dash?: number[]) => items.push({ t: "poly", pts: pts.map(T), stroke, fill, dash });
  const label = (at: Point, text: string, size = 7, opts: { bold?: boolean; rotate?: number; color?: string } = {}) =>
    items.push({ t: "text", at: T(at), text, size, align: "center", valign: "middle", ...opts });
  const lotCenter = scale(site.outline.reduce((a, p) => add(a, p), { x: 0, y: 0 }), 1 / site.outline.length);

  // ---------- The land (sample lot only): contours and water ----------
  if (!site.real && project.plot) {
    const land = landDrawing(project.plot);
    const off = site.offset;
    for (let i = 0; i + 3 < land.contours.length; i += 4) {
      const a = { x: land.contours[i] - off.x, y: land.contours[i + 1] - off.y };
      const c = { x: land.contours[i + 2] - off.x, y: land.contours[i + 3] - off.y };
      if (!inside(a, site.outline, 12) && !inside(c, site.outline, 12)) continue;
      pline([a, c], "hair", undefined, GREY);
    }
    for (const w of land.water) {
      const pts = w.points.map((p) => sub(p, off));
      pline(w.closed ? [...pts, pts[0]] : pts, w.kind === "river" ? "medium" : "fine", DASH.dotted);
      if (w.kind === "river" || w.kind === "creek") {
        const i = Math.floor(pts.length / 2);
        if (pts.length > 1 && inside(pts[i], site.outline, 0)) label(pts[i], w.kind.toUpperCase(), 5.5, { rotate: readable(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])), color: GREY });
      }
    }
    // Private lanes: both edges, with a label along the middle.
    for (const l of land.lanes) {
      const pts = l.points.map((p) => sub(p, off));
      for (const k of [-1, 1]) pline(offsetLine(pts, (k * l.width) / 2), "fine");
      const i = Math.max(0, Math.floor(pts.length / 2) - 1);
      label(lerp(pts[i], pts[i + 1], 0.5), `${Math.round(l.width / 12)}' PRIVATE LANE`, 5.5, { rotate: readable(sub(pts[i + 1], pts[i])) });
    }
    for (const r of land.rocks) {
      const c = sub(r.at, off);
      items.push({ t: "circle", c: T(c), r: (r.size / 2) * s, stroke: "fine", fill: LIGHT });
      label(add(c, { x: 0, y: r.size / 2 + 0.1 / s }), `${Math.round(r.size / 12)}' ROCK`, 5, { color: GREY });
    }
    for (const t of land.trees) items.push({ t: "circle", c: T(sub(t.at, off)), r: (t.size / 2) * s, stroke: "hair" });
  }

  // ---------- Easements and setbacks ----------
  for (const e of site.easements) {
    ppoly(e.pts, "fine", undefined, DASH.hidden);
    const c = scale(e.pts.reduce((a, p) => add(a, p), { x: 0, y: 0 }), 0.25);
    const along = sub(e.pts[1], e.pts[0]);
    label(c, `${e.widthFt}' ${e.kind.toUpperCase()}`, 5.5, { rotate: readable(along) });
  }
  if (site.real) {
    const inset = setbackOutline(site);
    if (inset) {
      ppoly(inset, "fine", undefined, DASH.hidden);
      site.lines.forEach((l, i) => {
        if (l.setbackFt === null || l.setbackFt <= 0) return;
        const m = lerp(inset[i], inset[(i + 1) % inset.length], 0.25);
        label(add(m, scale(inwardOf(l.a, l.b, lotCenter), -10)), `${l.setbackFt}' ${l.setbackName.toUpperCase()} SETBACK`, 5, { rotate: readable(sub(l.b, l.a)), color: GREY });
      });
    }
  }

  // ---------- Driveway, walk, porches and decks ----------
  const lp = lotAsPlot(site, project.plot);
  const yard = yardLayout(project.floorPlans, project.levels, h.basics, lp.plot, lp.offset);
  const strip = (st: Strip) => {
    const n = scale(leftNormal(unit(sub(st.b, st.a))), st.width / 2);
    return [add(st.a, n), add(st.b, n), sub(st.b, n), sub(st.a, n)];
  };
  if (yard) {
    for (const d of yard.driveway) ppoly(strip(d), "fine", "#f2f2f2");
    for (const w of yard.walk) ppoly(strip(w), "fine", "#f2f2f2");
    if (yard.driveway.length) {
      const d = yard.driveway[yard.driveway.length - 1];
      label(lerp(d.a, d.b, 0.55), pickWord(project, "driveway", "DRIVEWAY"), 5.5, { rotate: readable(sub(d.b, d.a)) });
    }
    if (yard.walk.length) {
      const w = yard.walk[yard.walk.length - 1];
      if (dist(w.a, w.b) > 8 * 12) label(lerp(w.a, w.b, 0.5), "WALK", 5, { rotate: readable(sub(w.b, w.a)) });
    }
    for (const t of yard.trees) items.push({ t: "circle", c: T(t), r: 8 * 12 * s, stroke: "hair" });
  }
  for (const l of h.drawn) {
    for (const r of h.plan(l.id).rooms) {
      if (r.type !== "deck" && r.type !== "patio" && r.type !== "porch") continue;
      ppoly(r.polygon, "fine", "#ffffff");
      label(centerOf(r.polygon), (r.type === "porch" ? "COVERED PORCH" : r.type === "patio" ? "COVERED PATIO" : "DECK").toString(), 5);
    }
  }

  // ---------- The house ----------
  for (const ring of site.house) ppoly(ring, "heavy", LIGHT);
  for (const r of sc.roofs) ppoly(r.eave, "fine", undefined, DASH.hidden);
  const footprint = houseFootprintSqft(project);
  const stories = h.drawn.filter((l) => l.kind !== "basement").length;
  const hb = boundsOf(site.house.flat());
  if (hb) {
    const hc = { x: (hb.x0 + hb.x1) / 2, y: (hb.y0 + hb.y1) / 2 };
    label(add(hc, { x: 0, y: -0.16 / s }), "PROPOSED HOUSE", 8, { bold: true });
    label(add(hc, { x: 0, y: 0.04 / s }), `${Math.round(footprint).toLocaleString("en-US")} sq ft footprint`, 6.5);
    label(add(hc, { x: 0, y: 0.18 / s }), `Main floor ±0'-0", ${stories} ${stories === 1 ? "story" : "stories"}`, 6.5);

    // Drainage: arrows away from the house on each side.
    const fall = codeNum("site.gradeFall");
    const run = codeNum("site.gradeFallDistance");
    const arrows: [Point, Point][] = [
      [{ x: hc.x, y: hb.y0 }, { x: 0, y: -1 }],
      [{ x: hc.x, y: hb.y1 }, { x: 0, y: 1 }],
      [{ x: hb.x0, y: hc.y }, { x: -1, y: 0 }],
      [{ x: hb.x1, y: hc.y }, { x: 1, y: 0 }],
    ];
    for (const [p, d] of arrows) {
      const a = add(p, scale(d, 3 * 12));
      const e = add(p, scale(d, 3 * 12 + run * 12));
      if (!inside(e, site.outline, 0)) continue;
      pline([a, e], "fine");
      const ta = T(e);
      const u = unit(sub(T(e), T(a)));
      const n = leftNormal(u);
      items.push({ t: "poly", pts: [ta, add(sub(ta, scale(u, 0.09)), scale(n, 0.035)), add(sub(ta, scale(u, 0.09)), scale(n, -0.035))], fill: "#000000" });
      label(add(lerp(a, e, 0.5), scale(leftNormal(d), 0.08 / s)), `${inchText(fall)} FALL IN ${run}'`, 4.5, { rotate: readable(d) });
    }
  }

  // ---------- Lot lines, lengths, the street, and distances from the house ----------
  ppoly(site.outline, "heavy", undefined, DASH.center);
  for (const l of site.lines) {
    const inward = inwardOf(l.a, l.b, lotCenter);
    const m = lerp(l.a, l.b, 0.5);
    const rot = readable(sub(l.b, l.a));
    label(add(m, scale(inward, -0.14 / s)), `${l.lengthFt.toFixed(2)}'`, 7, { rotate: rot });
    if (l.street) label(add(m, scale(inward, -0.55 / s)), l.side === "front" ? "STREET" : "SIDE STREET", 10, { bold: true, rotate: rot });
    // How far the house is from this line, square to it.
    const pts = site.house.flat();
    if (!pts.length) continue;
    const near = pts.reduce((best, p) => (projectOn(p, l.a, l.b).d < projectOn(best, l.a, l.b).d ? p : best));
    const foot = projectOn(near, l.a, l.b).point;
    const d = dist(near, foot);
    if (d < 12) continue;
    pline([near, foot], "hair");
    for (const end of [near, foot]) {
      const t0 = T(end);
      const u = unit(sub(T(foot), T(near)));
      items.push({ t: "line", pts: [add(t0, scale(add(u, leftNormal(u)), 0.04)), sub(t0, scale(add(u, leftNormal(u)), 0.04))], w: "fine" });
    }
    label(add(lerp(near, foot, 0.5), scale(leftNormal(unit(sub(foot, near))), 0.09 / s)), archFeet(d), 6, { rotate: readable(sub(foot, near)) });
  }

  if (!site.real) {
    items.push({ t: "text", at: { x: (area.x0 + area.x1) / 2, y: DRAW_AREA.y0 + 0.45 }, text: designed(project) ? "DESIGNED LOT, NOT A SURVEYED PROPERTY" : "SAMPLE LOT, NOT A REAL PROPERTY", size: 26, bold: true, align: "center", color: "#9a9a9a" });
  }

  // ---------- Lot data, setbacks and notes ----------
  items.push(...notesColumn(project, site, footprint, yard ? yardAmounts(yard) : null));

  items.push(...viewTitle(area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: "Site plan", scaleLabel: choice.label, inPerFt: choice.inPerFt, barFeet: [0, choice.ft, choice.ft * 2, choice.ft * 4], north: true }));
  return { items, scaleLabel: choice.label };
}

function notesColumn(project: Project, site: SiteLayout, footprint: number, amounts: ReturnType<typeof yardAmounts> | null): Item[] {
  const items: Item[] = [];
  const nx = DRAW_AREA.x1 - NOTES_W;
  let ny = DRAW_AREA.y0;
  const lot = project.plans.lot;
  items.push(...heading("Lot data", nx, ny, NOTES_W));
  ny += HEADING_H + 0.05;
  const acres = site.areaSqft / 43560;
  const rows: string[][] = [
    ["Site address", project.plans.address.trim() || "TBD"],
    ["Parcel number", project.plans.parcel.trim() || "TBD"],
    ["Lot", site.real ? "From the owner's entry of the recorded plat (My real lot)" : designed(project) ? `Land designed in the app${project.plot?.name ? ` ("${project.plot.name}")` : ""}, not a surveyed property` : `Sample lot from the app, not a real property${project.plot ? ` (${plotAcres(project.plot).toFixed(2)} acres)` : ""}`],
    ["Lot area", `${Math.round(site.areaSqft).toLocaleString("en-US")} sq ft (${acres.toFixed(2)} acres)`],
    ["House footprint", `${Math.round(footprint).toLocaleString("en-US")} sq ft, with garage and covered porches`],
    ["Lot coverage", `${((footprint / Math.max(1, site.areaSqft)) * 100).toFixed(1)}%`],
    ...(amounts ? [["Driveway and walk", `${Math.round(amounts.driveSqft + amounts.walkSqft).toLocaleString("en-US")} sq ft of paving`]] : []),
    ["Street", `On the ${({ N: "north", E: "east", S: "south", W: "west" } as const)[site.streetSide]} side${site.real && lot?.sideStreet !== "none" ? `, side street on the ${lot?.sideStreet}` : ""}${!site.real ? sideStreets(site) : ""}`],
    ...(site.real && lot?.heightLimitFt ? [["Height limit", `${lot.heightLimitFt} ft (zoning, as entered)`]] : []),
  ];
  let tb = table(nx, ny, [{ title: "", width: 1.7 }, { title: "", width: NOTES_W - 1.7 }], rows, { size: 7, boldFirst: true });
  items.push(...tb.items);
  ny += tb.height + 0.3;

  items.push(...heading("Setbacks", nx, ny, NOTES_W));
  ny += HEADING_H + 0.05;
  const setRows = site.real
    ? site.checks.map((c) => [c.name, c.requiredFt === null ? "Not entered" : `${c.requiredFt}'-0"`, c.providedFt < 0 ? `${archFeet(-c.providedFt * 12)} past` : archFeet(c.providedFt * 12), c.ok === null ? "Check" : c.ok ? "OK" : c.providedFt < 0 ? "OVER LOT LINE" : "TOO CLOSE"])
    : [["Fill in My real lot on the Plans page to show and check the setbacks.", "", "", ""]];
  tb = table(nx, ny, [{ title: "Side", width: 1.7 }, { title: "Required", width: 1.3 }, { title: "Provided", width: 1.5 }, { title: "Result", width: NOTES_W - 4.5 }], setRows, { size: 7, boldFirst: true });
  items.push(...tb.items);
  ny += tb.height + 0.3;

  items.push(...heading("Site notes", nx, ny, NOTES_W));
  ny += HEADING_H + 0.08;
  const notes = [
    site.real
      ? "Lot lines and lengths are as the owner entered them from the recorded plat. The plat or a licensed survey governs; find the property corners before building."
      : designed(project)
        ? "This lot was designed in the app. Fill in My real lot with the lot from the recorded plat (or copy it from your designed land) before this sheet is used for a permit."
        : "This lot is the app's sample land. Fill in My real lot with the lot from the recorded plat before this sheet is used for a permit.",
    "Distances to the lot lines are measured square to each line, from the outside face of the walls. The roof edge (dashed) reaches past the walls.",
    `Slope finished grade away from the house at least ${inchText(codeNum("site.gradeFall"))} in the first ${codeNum("site.gradeFallDistance")} ft (${codeRef("site.gradeFall")}). Carry roof water from the downspouts away from the foundation.`,
    `Walls closer than ${codeNum("fire.ratedWallDistance")} ft to a side or rear lot line need a 1-hour fire rating and no openings; eaves stay at least ${codeNum("fire.projectionMinDistance")} ft from the line (${codeRef("fire.ratedWallDistance")}${changedBy("fire.ratedWallDistance") ? `, as amended by ${changedBy("fire.ratedWallDistance")}` : ""}).`,
    "Show water, sewer, gas and power service routes as the utility companies lay them out. Call 811 before digging.",
    ...(!site.real && project.plot && !project.plot.isFlat ? [`Thin grey lines are ground contours of the sample land (every ${landDrawing(project.plot).contourFt} ft).`] : []),
    `Zoning (setbacks, height, lot coverage) is set by ${zoningCode()} for the lot's zone. Confirm with the city or county planning office.`,
  ];
  notes.forEach((n, i) => {
    items.push({ t: "text", at: { x: nx, y: ny + capHeight(7) }, text: `${i + 1}.`, size: 7 });
    const b = textBlock(n, nx + 0.22, ny, NOTES_W - 0.22, 7);
    items.push(...b.items);
    ny += b.height + 0.08;
  });
  return items;
}

/** The land was drawn in the land designer rather than made up by the app. */
function designed(project: Project): boolean {
  return project.plot?.source === "custom";
}

/** ", side street on the left" for a designed corner lot. */
function sideStreets(site: SiteLayout): string {
  const sides = [...new Set(site.lines.filter((l) => l.street && l.side !== "front").map((l) => l.side))];
  return sides.length ? `, side street on the ${sides.join(" and ")}` : "";
}

/** A polyline moved sideways by d (left of its direction for positive d). */
function offsetLine(pts: Point[], d: number): Point[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const n = leftNormal(unit(sub(b, a)));
    return add(p, scale(n, d));
  });
}

function pickWord(project: Project, id: "driveway", fallback: string): string {
  const p = exteriorPick(project.exterior.selections, id)?.product;
  return p ? `${fallback}: ${p.name.toUpperCase()}` : fallback;
}

function centerOf(poly: Point[]): Point {
  return scale(poly.reduce((a, p) => add(a, p), { x: 0, y: 0 }), 1 / poly.length);
}

/** The unit normal of a lot line pointing into the lot. */
function inwardOf(a: Point, b: Point, center: Point): Point {
  const n = leftNormal(unit(sub(b, a)));
  return dot(sub(center, a), n) >= 0 ? n : scale(n, -1);
}


function inside(p: Point, poly: Point[], margin: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  if (c || !margin) return c;
  return poly.some((a, i) => projectOn(p, a, poly[(i + 1) % poly.length]).d < margin);
}

/** The buildable area: each lot line moved in by its setback (lines with none stay put). */
function setbackOutline(site: SiteLayout): Point[] | null {
  const lc = scale(site.outline.reduce((a, p) => add(a, p), { x: 0, y: 0 }), 1 / site.outline.length);
  const moved = site.lines.map((l) => {
    const n = inwardOf(l.a, l.b, lc);
    const d = (l.setbackFt ?? 0) * 12;
    return { a: add(l.a, scale(n, d)), b: add(l.b, scale(n, d)) };
  });
  const out: Point[] = [];
  for (let i = 0; i < moved.length; i++) {
    const p = moved[(i - 1 + moved.length) % moved.length];
    const q = moved[i];
    const x = intersect(p.a, p.b, q.a, q.b);
    if (!x) return null;
    out.push(x);
  }
  // Rotate so corner i starts line i.
  return out;
}

function intersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return add(a, scale(r, t));
}
