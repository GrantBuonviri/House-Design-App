import type { Point, Project } from "@/lib/model/schema";
import { add } from "@/lib/plan/geometry";
import { exteriorPick } from "@/lib/exterior/picks";
import type { ExteriorCategoryId } from "@/lib/catalog/exterior";
import { codeNum, codeRef } from "@/lib/codes/data";
import { inchText } from "@/lib/codes/rules";
import { DRAW_AREA } from "../frame";
import { placeShort } from "../local";
import { archFeet, capHeight, DASH, heading, HEADING_H, line, SCALES, textBlock, textWidth, type Item } from "../draw";
import { houseFacts } from "../house";
import { frontSide, realLotOk, type Compass } from "../lot";
import { dot3, drawView, houseScene, sideView, viewExtent, type Face, type HouseScene, type V3 } from "../scene";
import { viewTitle } from "../view";

/**
 * Exterior elevations: the four sides of the house seen straight on, drawn
 * from the same walls, openings and roofs as the 3D view, with the ground
 * line, floor and plate heights, door and window tags, and callouts naming
 * the outside materials picked in the Exterior design window (X in the Walkthrough).
 */

const NOTES_W = 4.6;
/** Room left of each elevation for material callouts, and right of it for the height marks. */
const CALLOUT_W = 2.5;
const MARKS_W = 2.1;
const TITLE_H = 0.9;
/** How far below the ground the hidden footings are drawn. */
const BELOW_IN = 48;

const NAMES: Record<Compass, string> = { N: "North", E: "East", S: "South", W: "West" };
const OPPOSITE: Record<Compass, Compass> = { N: "S", S: "N", E: "W", W: "E" };
const RIGHT_OF: Record<Compass, Compass> = { S: "E", E: "N", N: "W", W: "S" };

export type ElevationSheet = { items: Item[]; scaleLabel: string; part: number; parts: number };

type Side = { side: Compass; label: string };

/** The elevation sheets: all four sides on one sheet when they fit at 1/4" = 1'-0", otherwise two to a sheet. */
export function elevationSheets(project: Project): ElevationSheet[] {
  const sc = houseScene(project);
  const front = frontSide(project);
  const sides: Side[] = [
    { side: front, label: `${NAMES[front]} elevation (front)` },
    { side: RIGHT_OF[front], label: `${NAMES[RIGHT_OF[front]]} elevation` },
    { side: OPPOSITE[front], label: `${NAMES[OPPOSITE[front]]} elevation (rear)` },
    { side: OPPOSITE[RIGHT_OF[front]], label: `${NAMES[OPPOSITE[RIGHT_OF[front]]]} elevation` },
  ];
  const sizes = sides.map((s) => {
    const e = viewExtent(sc.faces, sideView(s.side));
    return { w: (e.r1 - e.r0) / 12, h: (e.u1 - Math.min(e.u0, -BELOW_IN)) / 12 + 1 };
  });
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0, x1: DRAW_AREA.x1 - NOTES_W - 0.3, y1: DRAW_AREA.y1 };
  const W = area.x1 - area.x0;
  const H = area.y1 - area.y0;
  const fits = (inPerFt: number, perSheet: 2 | 4) => {
    const cols = perSheet === 4 ? 2 : 1;
    const cellW = (W - (cols - 1) * 0.4) / cols;
    const cellH = (H - 0.4) / 2;
    return sizes.every((z) => z.w * inPerFt + CALLOUT_W + MARKS_W <= cellW && z.h * inPerFt + TITLE_H + 0.3 <= cellH);
  };
  let pick: { scale: (typeof SCALES)[number]; perSheet: 2 | 4 } | null = null;
  for (const scale of SCALES.slice(1)) {
    if (fits(scale.inPerFt, 4)) pick = { scale, perSheet: 4 };
    else if (fits(scale.inPerFt, 2)) pick = { scale, perSheet: 2 };
    if (pick) break;
  }
  pick ??= { scale: SCALES[SCALES.length - 1], perSheet: 2 };
  const { scale, perSheet } = pick;
  const groups = perSheet === 4 ? [sides] : [sides.slice(0, 2), sides.slice(2)];
  return groups.map((group, gi) => {
    const items: Item[] = [];
    const cols = perSheet === 4 ? 2 : 1;
    const cellW = (W - (cols - 1) * 0.4) / cols;
    const cellH = (H - 0.4) / 2;
    group.forEach((s, i) => {
      const cell = { x: area.x0 + (i % cols) * (cellW + 0.4), y: area.y0 + Math.floor(i / cols) * (cellH + 0.4), w: cellW, h: cellH };
      items.push(...elevation(project, sc, s, scale, cell, gi * group.length + i + 1));
    });
    items.push(...notes(project, sc, gi > 0));
    return { items, scaleLabel: scale.label, part: gi, parts: groups.length };
  });
}

function elevation(project: Project, sc: HouseScene, s: Side, scale: (typeof SCALES)[number], cell: { x: number; y: number; w: number; h: number }, number: number): Item[] {
  const items: Item[] = [];
  const h = houseFacts(project);
  const view = sideView(s.side);
  const e = viewExtent(sc.faces, view);
  const k = scale.inPerFt / 12;
  const drawW = (e.r1 - e.r0) * k;
  const drawH = (e.u1 - Math.min(e.u0, -BELOW_IN)) * k;
  // Centered in the space between the callouts and the height marks, above the title.
  const room = cell.w - CALLOUT_W - MARKS_W;
  const ox = cell.x + CALLOUT_W + (room - drawW) / 2 - e.r0 * k;
  const oy = cell.y + Math.max(0.3, (cell.h - TITLE_H - drawH) / 2) + e.u1 * k;
  const X = (r: number) => ox + r * k;
  const Y = (z: number) => oy - z * k;
  const P = (p: V3) => ({ x: X(dot3(p, view.right)), y: Y(p.z) });

  items.push(...drawView(sc.faces, view, k, { x: ox, y: oy }));

  // The ground: what the house stands in, covering foundations below it.
  const toward = { x: view.toward.x, y: view.toward.y };
  const right = { x: view.right.x, y: view.right.y };
  const front = sc.faces.filter((f) => (f.kind === "foundation" || f.kind === "slab") && dot3(f.n, view.toward) > 0.5);
  const dmax = Math.max(...sc.faces.flatMap((f) => f.fills.flat().map((p) => dot3(p, view.toward))));
  const profile: Point[] = [];
  const ext = 6 * 12;
  for (let r = e.r0 - ext; r <= e.r1 + ext + 0.1; r += 6) {
    let best: { d: number; p: Point } | null = null;
    for (const f of front) {
      const [a, b] = f.fills[0];
      const ra = dot3(a, view.right);
      const rb = dot3(b, view.right);
      if (r < Math.min(ra, rb) || r > Math.max(ra, rb) || Math.abs(rb - ra) < 0.1) continue;
      const t = (r - ra) / (rb - ra);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const d = p.x * toward.x + p.y * toward.y;
      if (!best || d > best.d) best = { d, p };
    }
    const p = best?.p ?? add({ x: right.x * r, y: right.y * r }, { x: toward.x * dmax, y: toward.y * dmax });
    profile.push({ x: X(r), y: Y(sc.site.groundAt(p)) });
  }
  const bottom = Y(Math.min(e.u0, -BELOW_IN) - 6);
  items.push({ t: "poly", pts: [...profile, { x: profile[profile.length - 1].x, y: bottom }, { x: profile[0].x, y: bottom }], fill: "#ffffff" });
  items.push({ t: "line", pts: profile, w: "heavy" });
  items.push({ t: "text", at: { x: profile[0].x, y: profile[0].y + 0.16 }, text: "FINISHED GRADE", size: 5.5 });

  // Footings, hidden under the ground, for the walls nearest this side.
  const frost = codeNum("design.frostDepth");
  for (const f of front) {
    if (f.kind !== "foundation") continue;
    const [a, b] = f.fills[0];
    const ra = Math.min(dot3(a, view.right), dot3(b, view.right));
    const rb = Math.max(dot3(a, view.right), dot3(b, view.right));
    if (rb - ra < 12) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = mid.x * toward.x + mid.y * toward.y;
    // Only foundation walls with nothing nearer in front of their middle.
    const nearer = front.some((g) => g !== f && g.kind === "foundation" && overlaps(g, view, (ra + rb) / 2) && depthOf(g, view) > d + 6);
    if (nearer) continue;
    const ground = Math.min(sc.site.groundAt({ x: a.x, y: a.y }), sc.site.groundAt({ x: b.x, y: b.y }));
    const footTop = ground - frost + 10;
    const footBot = ground - frost;
    const x0 = X(ra);
    const x1 = X(rb);
    items.push({ t: "line", pts: [{ x: x0 - 6 * k, y: Y(footTop) }, { x: x1 + 6 * k, y: Y(footTop) }, { x: x1 + 6 * k, y: Y(footBot) }, { x: x0 - 6 * k, y: Y(footBot) }, { x: x0 - 6 * k, y: Y(footTop) }], w: "fine", dash: DASH.hidden });
  }

  // Heights at the right: floors, wall tops and the top of the roof.
  const mx = X(e.r1) + 0.35;
  const marks: { z: number; name: string }[] = [];
  for (const l of h.drawn) {
    const ht = sc.heights[l.id];
    marks.push({ z: ht.floorIn, name: `${l.name} floor` });
    marks.push({ z: ht.floorIn + ht.ceilingIn, name: `${l.name} wall top` });
  }
  const roofTop = Math.max(...sc.faces.filter((f) => f.kind === "roof" && dot3(f.n, view.toward) > -1).flatMap((f) => f.fills.flat().map((p) => p.z)), -Infinity);
  if (Number.isFinite(roofTop)) marks.push({ z: roofTop, name: "Top of roof" });
  marks.sort((a, b) => a.z - b.z);
  let lastY = Infinity;
  for (const m of marks) {
    let y = Y(m.z);
    if (lastY - y < 0.32) y = lastY - 0.32;
    lastY = y;
    items.push({ t: "line", pts: [{ x: X(e.r1) + 0.05, y: Y(m.z) }, { x: mx - 0.12, y: Y(m.z) }, { x: mx, y }], w: "hair", dash: DASH.center });
    items.push({ t: "circle", c: { x: mx + 0.08, y }, r: 0.07, stroke: "fine" });
    items.push({ t: "poly", pts: [{ x: mx + 0.08, y: y - 0.07 }, { x: mx + 0.15, y }, { x: mx + 0.08, y }, { x: mx + 0.08, y: y + 0.07 }, { x: mx + 0.01, y }, { x: mx + 0.08, y }], fill: "#000000" });
    items.push({ t: "text", at: { x: mx + 0.22, y: y - 0.03 }, text: m.name.toUpperCase(), size: 5.5, bold: true });
    items.push({ t: "text", at: { x: mx + 0.22, y: y + 0.11 }, text: heightText(m.z), size: 5.5 });
  }

  // Material callouts at the left.
  const calls = callouts(project, sc, view);
  const targets = calls.map((c) => ({ ...c, pt: P(c.at) })).sort((a, b) => a.pt.y - b.pt.y);
  let cy = cell.y + 0.35;
  const tw = CALLOUT_W - 0.35;
  const cx = Math.max(cell.x + 0.05, X(e.r0) - 0.5 - tw);
  for (const c of targets) {
    const b = textBlock(c.text, cx, Math.max(cy, Math.min(c.pt.y - 0.1, cell.y + cell.h - TITLE_H - 0.5)), tw, 6);
    const ty = b.items.length ? (b.items[0] as Extract<Item, { t: "text" }>).at.y - capHeight(6) / 2 : cy;
    items.push(...b.items);
    const end = { x: cx + Math.min(tw, Math.max(...b.items.map((t) => (t.t === "text" ? textWidth(t.text, 6) : 0)))) + 0.06, y: ty };
    items.push(line(end, c.pt, "hair"));
    items.push({ t: "circle", c: c.pt, r: 0.025, fill: "#000000" });
    cy = ty - capHeight(6) / 2 + b.height + 0.12;
  }

  items.push(...viewTitle(cell.x + CALLOUT_W - 0.4, cell.y + cell.h - 0.45, { number, title: s.label, scaleLabel: scale.label, inPerFt: scale.inPerFt, minWidth: 3.5 }));
  return items;
}

function depthOf(f: Face, view: ReturnType<typeof sideView>): number {
  const [a, b] = f.fills[0];
  return (dot3(a, view.toward) + dot3(b, view.toward)) / 2;
}

function overlaps(f: Face, view: ReturnType<typeof sideView>, r: number): boolean {
  const [a, b] = f.fills[0];
  const ra = dot3(a, view.right);
  const rb = dot3(b, view.right);
  return r >= Math.min(ra, rb) && r <= Math.max(ra, rb);
}

function heightText(z: number): string {
  if (Math.abs(z) < 0.25) return `±0'-0"`;
  return `${z > 0 ? "+" : "-"}${archFeet(Math.abs(z))}`;
}

/** What a pick is called on the drawings. */
function pickName(project: Project, id: ExteriorCategoryId): string | null {
  const p = exteriorPick(project.exterior.selections, id)?.product;
  return p ? `${p.name} (${p.brand})` : null;
}

/** Callouts naming the outside materials, each pointing at a spot it covers on this side. */
function callouts(project: Project, sc: HouseScene, view: ReturnType<typeof sideView>): { text: string; at: V3 }[] {
  const out: { text: string; at: V3 }[] = [];
  const seen = sc.faces.filter((f) => dot3(f.n, view.toward) > 0.2);
  const nearest = (fs: Face[]) => fs.sort((a, b) => maxDepth(b, view) - maxDepth(a, view))[0];
  const roof = project.house3d.roof;
  const roofFace = nearest(seen.filter((f) => f.kind === "roof" && area(f) > 40 * 144));
  if (roofFace) {
    const name = pickName(project, "roofing") ?? "Roofing to be picked";
    out.push({ text: `${name}. ${roof.style === "flat" ? "Low-slope roof" : `${roof.pitch}:12 pitch`}, ${roof.overhangIn}" overhang.`, at: centroid(roofFace) });
  }
  const fascia = nearest(seen.filter((f) => f.kind === "fascia" && Math.abs(f.n.x * view.toward.x + f.n.y * view.toward.y) > 0.9));
  if (fascia && roof.style !== "flat") {
    const g = pickName(project, "gutters");
    const t = pickName(project, "trim-paint");
    const c = centroid(fascia);
    out.push({ text: `Gutter${g ? `: ${g}` : ""} on fascia board${t ? `, trim paint ${t}` : ""}.`, at: c });
  }
  const walls = seen.filter((f) => f.kind === "wall" || f.kind === "gable");
  const big = nearest(walls.filter((f) => f.role === "siding" && area(f) > 60 * 144));
  if (big) {
    const name = pickName(project, "siding") ?? "Siding to be picked";
    const paint = pickName(project, "siding-paint");
    const c = centroid(big);
    out.push({ text: `${name}${paint ? `, painted ${paint}` : ""}, over a water-resistive barrier.`, at: { ...c, z: c.z + 18 } });
  }
  const accentName = pickName(project, "accent");
  if (accentName) {
    const spot = sc.accentSpots.filter((s) => dot3(s.n, view.toward) > 0.5).sort((a, b) => dot3(b.at, view.toward) - dot3(a.at, view.toward))[0];
    const gable = nearest(walls.filter((f) => f.kind === "gable" && f.role === "accent"));
    const at = spot?.at ?? (gable ? centroid(gable) : null);
    if (at) out.push({ text: `${accentName}${spot ? ", 3'-0\" band at the base of the walls" : " on the gable ends"}.`, at });
  }
  const opens = sc.openings.filter((o) => Math.abs(dot3(o.n, view.toward) - 1) < 0.01).sort((a, b) => dot3(b.center, view.toward) - dot3(a.center, view.toward));
  const win = opens.find((o) => o.kind === "window");
  if (win) out.push({ text: `${pickName(project, "windows") ?? "Windows"}. Tags match the floor plans.`, at: { ...win.center, z: win.center.z + win.heightIn / 2 - 4 } });
  const entry = opens.find((o) => o.style === "door-entry");
  if (entry) out.push({ text: `Front door${pickName(project, "entry-doors") ? `: ${pickName(project, "entry-doors")}` : ""}.`, at: { ...entry.center, z: entry.center.z + 12 } });
  const garage = opens.find((o) => o.style === "door-garage");
  if (garage) out.push({ text: `Garage door${pickName(project, "garage-doors") ? `: ${pickName(project, "garage-doors")}` : ""}.`, at: { ...garage.center, z: garage.center.z + 20 } });
  const found = nearest(seen.filter((f) => f.kind === "foundation"));
  if (found) {
    const c = centroid(found);
    const top = Math.max(...found.fills[0].map((p) => p.z));
    out.push({ text: `Concrete foundation, at least ${inchText(codeNum("foundation.exposedAboveGrade"))} above finished grade.`, at: { ...c, z: top - 3 } });
  }
  return out;
}

function maxDepth(f: Face, view: ReturnType<typeof sideView>): number {
  return Math.max(...f.fills.flat().map((p) => dot3(p, view.toward)));
}

function centroid(f: Face): V3 {
  const pts = f.fills.flat();
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length, z: s.z / pts.length };
}

/** Rough area of a face, square inches (its first polygon's bounding size along the wall and up). */
function area(f: Face): number {
  let total = 0;
  for (const poly of f.fills) {
    for (let i = 1; i < poly.length - 1; i++) {
      const a = poly[0];
      const b = poly[i];
      const c = poly[i + 1];
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      total += Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2;
    }
  }
  return total;
}

function notes(project: Project, sc: HouseScene, continued: boolean): Item[] {
  const items: Item[] = [];
  const nx = DRAW_AREA.x1 - NOTES_W;
  let ny = DRAW_AREA.y0;
  items.push(...heading("Elevation notes", nx, ny, NOTES_W));
  ny += HEADING_H + 0.08;
  if (continued) {
    items.push(...textBlock("See the elevation notes on the first elevation sheet.", nx, ny, NOTES_W, 7).items);
    return items;
  }
  const lot = project.plans.lot;
  const top = sc.topIn;
  const limit = realLotOk(lot) && lot.heightLimitFt ? lot.heightLimitFt : null;
  const list = [
    `Heights are above the main floor (±0'-0"). The main floor sits about 8" above the highest ground under the house.`,
    `The grade line follows the land along the nearest wall. Slope finished grade away from the house at least ${inchText(codeNum("site.gradeFall"))} in the first ${codeNum("site.gradeFallDistance")} ft (${codeRef("site.gradeFall")}).`,
    `Foundation walls show at least ${inchText(codeNum("foundation.exposedAboveGrade"))} above finished grade, ${inchText(codeNum("foundation.exposedAboveGradeVeneer"))} where there's masonry veneer (${codeRef("foundation.exposedAboveGrade")}).`,
    `Wood siding and sheathing at least ${inchText(codeNum("siding.woodClearanceToGrade"))} above the ground (${codeRef("siding.woodClearanceToGrade")}).`,
    "Siding over a water-resistive barrier, with flashing at every door, window and roof-to-wall joint (IRC R703.2, R703.4).",
    `House number on the street side, at least ${inchText(codeNum("address.minHeight"))} high, in a color that stands out (${codeRef("address.minHeight")}).`,
    `Roof designed for ${codeNum("design.roofSnowLoadMin")} psf snow and ${codeNum("design.windSpeed")} mph wind (IRC Table R301.2(1), ${placeShort()}).`,
    `Highest point of the roof: ${archFeet(top)} above the main floor.${limit ? ` Zoning height limit entered: ${limit} ft; check how ${placeShort()} measures it for your zone.` : " Check the zoning height limit for your lot with the city or county planning office."}`,
    "Door and window tags (D1, W1) match the floor plans. Dashed lines below the grade are footings.",
  ];
  list.forEach((n, i) => {
    items.push({ t: "text", at: { x: nx, y: ny + capHeight(7) }, text: `${i + 1}.`, size: 7 });
    const tb = textBlock(n, nx + 0.22, ny, NOTES_W - 0.22, 7);
    items.push(...tb.items);
    ny += tb.height + 0.08;
  });
  return items;
}
