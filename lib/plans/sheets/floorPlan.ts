import type { Fixture, Level, Point } from "@/lib/model/schema";
import { add, dist, dot, isRectangle, leftNormal, polygonCenter, rotate, scale, sub, unit, edgesOf, boundsOf } from "@/lib/plan/geometry";
import { openingType } from "@/lib/plan/catalog";
import { openingRooms, roleOf, sharedWall } from "@/lib/plan/connect";
import { roomSqft } from "@/lib/plan/measure";
import { ceilingFor, INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { stairsDrawing } from "@/lib/plan/stairs";
import { HALF_WALL_IN, openingGeometries, solidWalls, wallPieces, type OpeningGeometry, type WallPiece } from "@/lib/plan/walls";
import { floorFootprint, offsetRing } from "@/lib/house3d/footprint";
import { codeNum, codeRef } from "@/lib/codes/data";
import { escapeCheck, operationOf, OPERATION_LABEL } from "@/lib/codes/openings";
import { atticAccessSpot, inchText, isSleeping } from "@/lib/codes/rules";
import { houseFacts } from "../house";
import { levelCabinets } from "./cabinets";
import { cabinetCorners } from "@/lib/plan/cabinets";
import { DRAW_AREA } from "../frame";
import { viewTitle } from "../view";
import { archFeet, capHeight, DASH, ellipse, heading, HEADING_H, line, lineHeight, POCHE, rect, SCALES, table, textBlock, textWidth, readable, type Item, type Weight } from "../draw";
import type { Project } from "@/lib/model/schema";

/**
 * A floor plan sheet: walls (cut, filled dark), doors with their swings,
 * windows, stairs, fixtures, room names with sizes, door and window tags,
 * three strings of outside dimensions, a legend and plan notes, and the view
 * title with its scale, scale bar and north arrow.
 */

/** Width of the legend and notes column at the right of the drawing area. */
const NOTES_W = 5.6;
/** Room around the house for the dimension strings, sheet inches. */
const DIM_MARGIN = 1.9;
/** The view title band under the drawing. */
const TITLE_BAND = 1.1;

export type FloorPlanSheet = { items: Item[]; scaleLabel: string };

/** The plan drawn lightly, under the electrical, plumbing and mechanical layers, with how plan inches map to the sheet. */
export type PlanBase = FloorPlanSheet & { inPerFt: number; T: (p: Point) => Point; s: number; area: { x0: number; y0: number; x1: number; y1: number } };

/** Grey walls for the systems plans, so the devices on top read first. */
export const BASE_POCHE = "#b4b4b4";
/** The light fill inside a half wall's outline. */
const HALF_WALL_FILL = "#e4e4e4";

export function floorPlanSheet(project: Project, level: Level, viewNumber = 1): FloorPlanSheet {
  return drawPlan(project, level, viewNumber, false);
}

export function planBase(project: Project, level: Level): PlanBase {
  return drawPlan(project, level, 1, true) as PlanBase;
}

function drawPlan(project: Project, level: Level, viewNumber: number, base: boolean): FloorPlanSheet | PlanBase {
  const h = houseFacts(project);
  const plan = h.plan(level.id);
  const t = h.exteriorIn;
  const pieces = wallPieces(plan, t);
  const geos = openingGeometries(plan);
  const solids = solidWalls(pieces, geos);
  const items: Item[] = [];

  // ---------- Where the drawing goes, and at what scale ----------
  const own = plan.stairs.map((s) => stairsDrawing(s, h.riseFor(s, level)));
  const allPts = [...plan.rooms.flatMap((r) => r.polygon), ...own.flatMap((d) => d.footprint), ...h.stairsOn(level.id).flat()];
  const b = boundsOf(allPts)!;
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0, x1: DRAW_AREA.x1 - NOTES_W - 0.3, y1: DRAW_AREA.y1 - TITLE_BAND };
  const bw = (b.x1 - b.x0) / 12;
  const bh = (b.y1 - b.y0) / 12;
  const fits = (inPerFt: number) => bw * inPerFt + DIM_MARGIN * 2 <= area.x1 - area.x0 && bh * inPerFt + DIM_MARGIN * 2 <= area.y1 - area.y0;
  const choice = SCALES.slice(1).find((s) => fits(s.inPerFt)) ?? SCALES[SCALES.length - 1];
  const s = choice.inPerFt / 12;
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const center = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
  const T = (p: Point): Point => ({ x: center.x + (p.x - mid.x) * s, y: center.y + (p.y - mid.y) * s });
  const Ts = (pts: Point[]) => pts.map(T);
  const pline = (pts: Point[], w: Weight = "fine", dash?: number[]) => items.push({ t: "line", pts: Ts(pts), w, dash });
  const ppoly = (pts: Point[], stroke?: Weight, fill?: string, dash?: number[]) => items.push({ t: "poly", pts: Ts(pts), stroke, fill, dash });

  // ---------- Walls ----------
  for (const w of solids) {
    if (w.open) {
      pline([w.a, w.b], "fine", DASH.hidden);
      continue;
    }
    const u = unit(sub(w.b, w.a));
    const n = leftNormal(u);
    const half = w.thicknessIn / 2;
    const a = w.capA ? add(w.a, scale(u, -half)) : w.a;
    const e = w.capB ? add(w.b, scale(u, half)) : w.b;
    const outline = [add(a, scale(n, half)), add(e, scale(n, half)), add(e, scale(n, -half)), add(a, scale(n, -half))];
    // A half wall is drawn in outline with a light fill, so it reads as lower than the full-height walls.
    if (w.piece.height) ppoly(outline, "fine", HALF_WALL_FILL);
    else ppoly(outline, undefined, base ? BASE_POCHE : POCHE);
  }
  // Each half wall gets a note along it: "42" HALF WALL", and the cap when it has one.
  if (!base) {
    for (const p of pieces) {
      if (!p.height) continue;
      const u = unit(sub(p.b, p.a));
      const text = p.height === "half-cap" ? `${HALF_WALL_IN}" HALF WALL W/ CAP` : `${HALF_WALL_IN}" HALF WALL`;
      items.push({ t: "text", at: T(add(scale(add(p.a, p.b), 0.5), scale(leftNormal(u), p.thicknessIn / 2 + 9))), text, size: 5.5, align: "center", valign: "middle", rotate: readable(u) });
    }
  }

  // ---------- Doors and windows ----------
  const thicknessAt = (g: OpeningGeometry) => nearestPiece(pieces, g.center)?.thicknessIn ?? INTERIOR_WALL_IN;
  const egress = new Set<string>();
  for (const g of geos) {
    const o = g.opening;
    if (o.kind === "window" && openingRooms(plan, o).some((id) => isSleeping(plan.rooms.find((r) => r.id === id) ?? {})) && escapeCheck(o, level.kind === "basement").ok) egress.add(o.id);
  }
  for (const g of geos) drawOpening(g, thicknessAt(g));
  if (!base) for (const g of geos) drawTag(g, thicknessAt(g));

  function drawOpening(g: OpeningGeometry, th: number) {
    const o = g.opening;
    const type = openingType(o.style);
    const w = o.widthIn;
    const at = (x: number, y: number) => add(add(g.center, scale(g.u, x)), scale(g.n, y));
    const sv = o.side; // swing side along n
    if (o.kind === "window") {
      ppoly([at(-w / 2, th / 2), at(w / 2, th / 2), at(w / 2, -th / 2), at(-w / 2, -th / 2)], "fine");
      pline([at(-w / 2, 0), at(w / 2, 0)], "fine");
      pline([at(-w / 2, th / 6), at(w / 2, th / 6)], "hair");
      return;
    }
    if (o.kind === "opening") {
      pline([at(-w / 2, th / 2), at(w / 2, th / 2)], "hair", DASH.hidden);
      pline([at(-w / 2, -th / 2), at(w / 2, -th / 2)], "hair", DASH.hidden);
      return;
    }
    if (type.swings) {
      const leaf = (hx: number, r: number) => {
        const toward = hx < 0 ? 1 : -1;
        const H = at(hx, 0);
        const pts: Point[] = [];
        for (let k = 0; k <= 18; k++) {
          const a = (k / 18) * (Math.PI / 2);
          pts.push(add(H, add(scale(g.u, toward * r * Math.cos(a)), scale(g.n, sv * r * Math.sin(a)))));
        }
        pline(pts, "hair");
        pline([H, add(H, scale(g.n, sv * r))], "medium");
      };
      if (type.double) {
        leaf(-w / 2, w / 2);
        leaf(w / 2, w / 2);
      } else leaf(o.hinge === "start" ? -w / 2 : w / 2, w);
      return;
    }
    if (o.style === "door-slider") {
      ppoly([at(-w / 2, th / 4), at(2, th / 4), at(2, 0), at(-w / 2, 0)], "fine");
      ppoly([at(-2, 0), at(w / 2, 0), at(w / 2, -th / 4), at(-2, -th / 4)], "fine");
      return;
    }
    if (o.style === "door-pocket") {
      ppoly([at(-w / 2 - w, 1.2), at(-w / 2, 1.2), at(-w / 2, -1.2), at(-w / 2 - w, -1.2)], "hair", undefined, DASH.hidden);
      pline([at(-w / 2, 0), at(-w / 2 + w * 0.2, 0)], "medium");
      return;
    }
    if (o.style === "door-barn") {
      pline([at(-w / 2 - 4, sv * (th / 2 + 2)), at(w / 2 + 4, sv * (th / 2 + 2))], "heavy");
      return;
    }
    // Garage door: a dashed line where the door rolls up, and its size.
    pline([at(-w / 2, 0), at(w / 2, 0)], "medium", DASH.hidden);
    const label = `${archFeet(w)} x ${archFeet(o.heightIn)} OVERHEAD DOOR`;
    const p = T(at(0, -sv * (th / 2 + 14)));
    items.push({ t: "text", at: p, text: label, size: 6, align: "center", valign: "middle", rotate: readable(g.u) });
  }

  function drawTag(g: OpeningGeometry, th: number) {
    const o = g.opening;
    const tag = h.tags.get(o.id);
    if (!tag) return;
    // Doors: on the side away from the swing. Windows: outside.
    const dir = o.kind === "door" ? scale(g.n, -o.side) : g.n;
    const off = (th / 2) * s + 0.2;
    const c = add(T(g.center), scale(dir, off));
    if (o.kind === "door") items.push({ t: "circle", c, r: 0.11, stroke: "fine", fill: "#ffffff" });
    else items.push({ t: "poly", pts: hexagon(c, 0.12), stroke: "fine", fill: "#ffffff" });
    items.push({ t: "text", at: c, text: tag, size: 5.5, bold: true, align: "center", valign: "middle" });
    const extra = [h.safety.has(o.id) ? "TEMP" : "", egress.has(o.id) ? "EGR" : ""].filter(Boolean).join(" ");
    if (extra) items.push({ t: "text", at: add(c, { x: 0.15, y: 0 }), text: extra, size: 5, bold: true, valign: "middle" });
  }

  // ---------- Stairs ----------
  const notes: string[] = [];
  plan.stairs.forEach((st, i) => {
    const d = own[i];
    ppoly(d.footprint, "medium");
    for (const [a, e] of d.lines) pline([a, e], "fine");
    pline(d.arrow, "fine");
    arrowHead(d.arrow[d.arrow.length - 2], d.arrow[d.arrow.length - 1]);
    const start = T(d.arrow[0]);
    const towards = unit(sub(T(d.arrow[1]), start));
    items.push({ t: "text", at: sub(start, scale(towards, 0.16)), text: `UP ${d.risers}R`, size: 6, bold: true, align: "center", valign: "middle" });
    if (d.risers >= codeNum("stairs.handrailRequiredRisers")) {
      const c = T(polygonCenter(d.footprint));
      items.push({ t: "text", at: add(c, { x: 0, y: 0 }), text: "HANDRAIL", size: 5, align: "center", valign: "middle", rotate: readable(sub(d.arrow[1], d.arrow[0])) - 90 });
    }
    notes.push(
      `Stairs: ${d.risers} risers at ${f2(d.riserIn)}" max ${inchText(codeNum("stairs.maxRiser"))}, 10" treads, ${archFeet(st.widthIn)} wide. Handrail ${codeNum("stairs.handrailMinHeight")}" to ${codeNum("stairs.handrailMaxHeight")}" above the nosings on at least one side (${codeRef("stairs.handrailMinHeight")}). Guards where a side drops more than 30" (IRC R312.1).`,
    );
  });
  const below = h.levels.filter((l) => l.elevationIn < level.elevationIn);
  for (const l of below) {
    for (const st of h.plan(l.id).stairs.filter((x) => x.toLevelId === level.id)) {
      const d = stairsDrawing(st, h.riseFor(st, l));
      ppoly(d.footprint, "fine", undefined, DASH.hidden);
      const end = T(d.arrow[d.arrow.length - 1]);
      const back = unit(sub(T(d.arrow[d.arrow.length - 2]), end));
      items.push({ t: "text", at: sub(end, scale(back, -0.16)), text: "DN", size: 6, bold: true, align: "center", valign: "middle" });
    }
  }

  // ---------- Fixtures ----------
  for (const f of plan.fixtures) drawFixture(f);
  // Upper and tall cabinets, dashed (details on the cabinet sheet).
  for (const c of levelCabinets(project, level).cabinets) if (c.kind === "tall" || c.bottomIn > 24) ppoly(cabinetCorners(c), "hair", undefined, DASH.hidden);

  function drawFixture(f: Fixture) {
    const L = (x: number, y: number) => add(rotate({ x, y }, f.rotation), { x: f.x, y: f.y });
    const w = f.widthIn;
    const d = f.depthIn;
    const box = [L(-w / 2, -d / 2), L(w / 2, -d / 2), L(w / 2, d / 2), L(-w / 2, d / 2)];
    const label = (text: string) => items.push({ t: "text", at: T(L(0, 0)), text, size: 5, align: "center", valign: "middle", rotate: readable(rotate({ x: 1, y: 0 }, f.rotation)) });
    if (f.kind === "closet") {
      pline([L(-w / 2, 0), L(w / 2, 0)], "hair", DASH.center);
      pline([L(-w / 2, -d / 2 + 12), L(w / 2, -d / 2 + 12)], "hair");
      return;
    }
    ppoly(box, "fine");
    switch (f.kind) {
      case "sink":
      case "laundry-sink":
        ppoly([L(-w / 2 + 3, -d / 2 + 4), L(w / 2 - 3, -d / 2 + 4), L(w / 2 - 3, d / 2 - 3), L(-w / 2 + 3, d / 2 - 3)], "hair");
        break;
      case "range":
        for (const [x, y] of [
          [-w / 4, -d / 4],
          [w / 4, -d / 4],
          [-w / 4, d / 4],
          [w / 4, d / 4],
        ])
          items.push({ t: "circle", c: T(L(x, y)), r: Math.min(w, d) * 0.15 * s, stroke: "hair" });
        break;
      case "fridge":
        label("REF");
        break;
      case "dishwasher":
        label("DW");
        break;
      case "toilet":
        ppoly([L(-w / 2, -d / 2), L(w / 2, -d / 2), L(w / 2, -d / 2 + d * 0.3), L(-w / 2, -d / 2 + d * 0.3)], "hair");
        items.push({ ...ellipse(T(L(0, d * 0.12)), w * 0.4 * s, d * 0.36 * s, f.rotation, "hair") });
        break;
      case "vanity": {
        const n = w >= 60 ? 2 : 1;
        for (let i = 0; i < n; i++) items.push(ellipse(T(L(n === 1 ? 0 : (i === 0 ? -1 : 1) * w * 0.25, 1)), Math.min(8, w / 5) * s, d * 0.28 * s, f.rotation, "hair"));
        break;
      }
      case "tub":
        ppoly([L(-w / 2 + 3, -d / 2 + 3), L(w / 2 - 3, -d / 2 + 3), L(w / 2 - 3, d / 2 - 3), L(-w / 2 + 3, d / 2 - 3)], "hair");
        break;
      case "shower":
        pline([L(-w / 2, -d / 2), L(w / 2, d / 2)], "hair");
        pline([L(w / 2, -d / 2), L(-w / 2, d / 2)], "hair");
        break;
      case "washer":
        label("W");
        break;
      case "dryer":
        label("D");
        break;
      case "water-heater":
        items.push({ t: "circle", c: T(L(0, 0)), r: w * 0.4 * s, stroke: "hair" });
        label("WH");
        break;
      case "furnace":
        label("FAU");
        break;
      case "fireplace":
        pline([L(-w * 0.35, d / 2), L(-w * 0.25, -d / 4), L(w * 0.25, -d / 4), L(w * 0.35, d / 2)], "hair");
        break;
      case "island":
      case "counter":
        break;
    }
  }

  // ---------- Room names ----------
  const ceiling = ceilingFor(h.basics, level);
  for (const r of plan.rooms) {
    const c = T(polygonCenter(r.polygon));
    const name = r.name.toUpperCase();
    const lines: { text: string; size: number; bold?: boolean }[] = [{ text: name, size: 7.5, bold: true }];
    if (isRectangle(r.polygon)) {
      const [e0, e1] = edgesOf(r.polygon);
      const a = dist(e0.a, e0.b) - INTERIOR_WALL_IN;
      const bb = dist(e1.a, e1.b) - INTERIOR_WALL_IN;
      lines.push({ text: `${archFeet(Math.max(a, bb))} x ${archFeet(Math.min(a, bb))}`, size: 6 });
    }
    lines.push({ text: `${roomSqft(r).toLocaleString("en-US")} SF`, size: 6 });
    const total = lines.reduce((sum, l) => sum + lineHeight(l.size), 0);
    let y = c.y - total / 2;
    for (const l of lines) {
      y += lineHeight(l.size);
      items.push({ t: "text", at: { x: c.x, y: y - lineHeight(l.size) + capHeight(l.size) + 0.02 }, text: l.text, size: l.size, bold: l.bold, align: "center" });
    }
  }

  if (base) return { items, scaleLabel: choice.label, inPerFt: choice.inPerFt, T, s, area };

  // ---------- Garage separation ----------
  const garages = plan.rooms.filter((r) => roleOf(r) === "garage");
  const gyp = inchText(codeNum("garage.gypsumGarageSide"));
  for (const g of garages) {
    for (const r of plan.rooms) {
      if (r.id === g.id || roleOf(r) === "garage" || roleOf(r) === "outdoor") continue;
      const sw = sharedWall(g, r);
      if (!sw || sw.t1 - sw.t0 < 24) continue;
      const a = g.polygon[sw.edge];
      const e = g.polygon[(sw.edge + 1) % g.polygon.length];
      const u = unit(sub(e, a));
      const m = add(a, scale(u, (sw.t0 + sw.t1) / 2));
      // Inside the garage: the side toward its middle.
      let n = leftNormal(u);
      if (dot(sub(polygonCenter(g.polygon), m), n) < 0) n = scale(n, -1);
      const p = add(T(m), scale(n, (INTERIOR_WALL_IN / 2) * s + 0.1));
      items.push({ t: "text", at: p, text: `${gyp} TYPE X GYP. BD., GARAGE SIDE (${codeRef("garage.gypsumGarageSide")})`, size: 5, align: "center", valign: "middle", rotate: readable(u) });
    }
  }
  const garageDoors = plan.openings.filter((o) => o.kind === "door" && o.style !== "door-garage" && openingRooms(plan, o).some((id) => garages.some((g) => g.id === id)) && openingRooms(plan, o).some((id) => id && !garages.some((g) => g.id === id) && roleOf(plan.rooms.find((r) => r.id === id) ?? {}) !== "outdoor"));
  if (garages.length) {
    notes.push(`Garage to house: ${gyp} Type X gypsum board on the garage side of walls and ceilings between the garage and the house (${codeRef("garage.gypsumGarageSide")}, Idaho amendment).`);
    if (garageDoors.length) notes.push(`${garageDoors.map((o) => h.tags.get(o.id)).join(", ")}: solid wood or solid-core door at least ${inchText(codeNum("garage.doorSolidWoodThickness"))} thick, solid or honeycomb steel, or ${codeNum("garage.doorFireRatingMinutes")}-minute rated (${codeRef("garage.doorFireRatingMinutes")}).`);
  }

  // ---------- Attic access ----------
  const attic = project.house3d.roof.style === "flat" ? null : atticAccessSpot(h);
  if (attic && attic.level.id === level.id) {
    const c = polygonCenter(attic.room.polygon);
    const aw = codeNum("attic.accessMinWidth");
    const al = codeNum("attic.accessMinLength");
    ppoly([add(c, { x: -aw / 2, y: -al / 2 }), add(c, { x: aw / 2, y: -al / 2 }), add(c, { x: aw / 2, y: al / 2 }), add(c, { x: -aw / 2, y: al / 2 })], "fine", undefined, DASH.hidden);
    items.push({ t: "text", at: T(add(c, { x: 0, y: al / 2 + 6 })), text: "ATTIC ACCESS ABOVE", size: 5, align: "center", valign: "top" });
    notes.push(`Attic access: ${aw}" x ${al}" clear opening at least, in ${attic.room.name} (${codeRef("attic.accessMinWidth")}).`);
  }

  // ---------- Dimensions ----------
  dimensions(items, plan, level, pieces, geos, t, T, s);

  // ---------- Legend and notes column ----------
  const nx = DRAW_AREA.x1 - NOTES_W;
  let ny = DRAW_AREA.y0;
  items.push(...heading("Legend", nx, ny, NOTES_W));
  ny += HEADING_H + 0.08;
  const legend = (draw: (c: Point) => Item[], text: string) => {
    const c = { x: nx + 0.25, y: ny + 0.12 };
    items.push(...draw(c));
    const tb = textBlock(text, nx + 0.6, ny + 0.04, NOTES_W - 0.6, 6.5);
    items.push(...tb.items);
    ny += Math.max(0.3, tb.height + 0.1);
  };
  legend((c) => [rect(c.x - 0.2, c.y - 0.05, 0.4, 0.1, undefined, POCHE)], `Wall, cut. Outside walls ${h.basics?.exteriorWall ?? "2x6"} studs at 16" on center with sheathing; inside walls 2x4 studs at 16" on center.`);
  legend((c) => [{ t: "circle", c, r: 0.11, stroke: "fine" }, { t: "text", at: c, text: "D1", size: 5.5, bold: true, align: "center", valign: "middle" }], "Door tag. Sizes in the table below; more in the door schedule (A-601).");
  legend((c) => [{ t: "poly", pts: hexagon(c, 0.12), stroke: "fine" }, { t: "text", at: c, text: "W1", size: 5.5, bold: true, align: "center", valign: "middle" }], "Window tag. Sizes in the table below; more in the window schedule (A-601).");
  legend((c) => [{ t: "text", at: c, text: "TEMP", size: 5, bold: true, align: "center", valign: "middle" }], `Safety glass (tempered or laminated) needed here (IRC R308.4).`);
  legend((c) => [{ t: "text", at: c, text: "EGR", size: 5, bold: true, align: "center", valign: "middle" }], `Emergency escape window: clear opening at least ${codeNum(level.kind === "basement" ? "egress.netClearOpeningGradeFloor" : "egress.netClearOpening")} sq ft, ${codeNum("egress.minClearHeight")}" high, ${codeNum("egress.minClearWidth")}" wide, sill no higher than ${codeNum("egress.maxSillHeight")}" (${codeRef("egress.netClearOpening")}).`);
  legend((c) => [line({ x: c.x - 0.2, y: c.y }, { x: c.x + 0.2, y: c.y }, "fine", DASH.hidden)], "Dashed: above, below, or the open side of a porch or deck.");

  ny += 0.1;
  items.push(...heading("Plan notes", nx, ny, NOTES_W));
  ny += HEADING_H + 0.08;
  const general = [
    "Outside dimensions are to the outside face of the wall sheathing. Room sizes are clear, inside the walls. Verify all dimensions on site before building.",
    `Ceiling height on this floor: ${archFeet(ceiling)} unless noted.`,
    ...notes,
    "Smoke and carbon monoxide alarms, outlets, switches and lights are on the electrical plan; fans, registers and the thermostat on the mechanical plan.",
  ];
  general.forEach((n, i) => {
    items.push({ t: "text", at: { x: nx, y: ny + capHeight(6.5) }, text: `${i + 1}.`, size: 6.5 });
    const tb = textBlock(n, nx + 0.22, ny, NOTES_W - 0.22, 6.5);
    items.push(...tb.items);
    ny += tb.height + 0.08;
  });

  // The doors and windows on this floor.
  const rows = geos
    .filter((g) => h.tags.has(g.opening.id))
    .sort((a, b) => tagOrder(h.tags.get(a.opening.id)!) - tagOrder(h.tags.get(b.opening.id)!))
    .map((g) => {
      const o = g.opening;
      const kind = o.kind === "window" ? `${OPERATION_LABEL[operationOf(o)]} window, sill ${archFeet(o.sillIn ?? 30)}` : openingType(o.style).label;
      const glass = h.safety.has(o.id) ? "Tempered" : "";
      return [h.tags.get(o.id)!, `${archFeet(o.widthIn)} x ${archFeet(o.heightIn)}`, kind, glass];
    });
  if (rows.length) {
    ny += 0.1;
    items.push(...heading("Doors and windows on this floor", nx, ny, NOTES_W));
    ny += HEADING_H + 0.06;
    const tb = table(nx, ny, [
      { title: "Tag", width: 0.5 },
      { title: "Size (W x H)", width: 1.35 },
      { title: "Type", width: 2.65 },
      { title: "Glass", width: 1.1 },
    ], rows, { size: 6, maxHeight: DRAW_AREA.y1 - ny, boldFirst: true });
    items.push(...tb.items);
    if (tb.fitted < rows.length) items.push({ t: "text", at: { x: nx, y: ny + tb.height + 0.15 }, text: `${rows.length - tb.fitted} more in the door and window schedule.`, size: 6 });
  }

  // ---------- View title ----------
  items.push(...viewTitle(area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: viewNumber, title: `${level.name} plan`, scaleLabel: choice.label, inPerFt: choice.inPerFt, north: true }));

  return { items, scaleLabel: choice.label };

  function arrowHead(from: Point, to: Point) {
    const a = T(to);
    const d = unit(sub(a, T(from)));
    const n = leftNormal(d);
    items.push({ t: "poly", pts: [a, add(sub(a, scale(d, 0.1)), scale(n, 0.04)), add(sub(a, scale(d, 0.1)), scale(n, -0.04))], fill: "#000000" });
  }
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
const tagOrder = (tag: string) => (tag[0] === "D" ? 0 : 100000) + Number(tag.slice(1));


function hexagon(c: Point, r: number): Point[] {
  return Array.from({ length: 6 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 3), y: c.y + r * Math.sin((i * Math.PI) / 3) }));
}

function nearestPiece(pieces: WallPiece[], p: Point): WallPiece | null {
  let best: { d: number; piece: WallPiece } | null = null;
  for (const piece of pieces) {
    const u = unit(sub(piece.b, piece.a));
    const t = Math.max(0, Math.min(dist(piece.a, piece.b), dot(sub(p, piece.a), u)));
    const d = dist(p, add(piece.a, scale(u, t)));
    if (!best || d < best.d) best = { d, piece };
  }
  return best?.piece ?? null;
}

// ---------- Dimension strings ----------

type DimPoint = { at: number; obj: number };

/**
 * Three strings around the outside on each side: openings (door and window
 * centers and the wall corners), the wall corners, and the overall size.
 * Measured to the outside face of the walls. Walls at an angle get their
 * own length, along the wall.
 */
function dimensions(items: Item[], plan: ReturnType<ReturnType<typeof houseFacts>["plan"]>, level: Level, pieces: WallPiece[], geos: OpeningGeometry[], t: number, T: (p: Point) => Point, s: number) {
  void level;
  void pieces;
  const regions = floorFootprint(plan);
  if (!regions.length) return;
  const outlines = regions.map((r) => offsetRing(r.outline, t / 2));
  const all = outlines.flat();
  const b = boundsOf(all)!;
  const sides: { dir: Point; vertical: boolean; base: number; sign: number }[] = [
    { dir: { x: 0, y: -1 }, vertical: false, base: b.y0, sign: -1 },
    { dir: { x: 0, y: 1 }, vertical: false, base: b.y1, sign: 1 },
    { dir: { x: -1, y: 0 }, vertical: true, base: b.x0, sign: -1 },
    { dir: { x: 1, y: 0 }, vertical: true, base: b.x1, sign: 1 },
  ];
  const ext = geos.filter((g) => g.opening.kind !== "opening" && pieces.some((p) => p.exterior && !p.open && distToSeg(g.center, p.a, p.b) < 1));
  for (const side of sides) {
    const along = (p: Point) => (side.vertical ? p.y : p.x);
    const across = (p: Point) => (side.vertical ? p.x : p.y);
    const corners: DimPoint[] = [];
    for (const ring of outlines) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const e = ring[(i + 1) % ring.length];
        const u = unit(sub(e, a));
        const n = leftNormal(u);
        if (dot(n, side.dir) > 0.999 && dist(a, e) > 6) {
          corners.push({ at: along(a), obj: across(a) }, { at: along(e), obj: across(e) });
        }
      }
    }
    if (!corners.length) continue;
    const openings: DimPoint[] = ext
      .filter((g) => dot(g.n, side.dir) > 0.999 || dot(scale(g.n, -1), side.dir) > 0.999)
      .filter((g) => {
        // Only openings on a wall facing this side, at the outside of the house.
        const fromEdge = side.sign * (across(g.center) - side.base);
        return fromEdge > -12 * 40 && corners.some((c) => Math.abs(c.obj - across(g.center)) < t);
      })
      .map((g) => ({ at: along(g.center), obj: across(g.center) + (side.sign * t) / 2 }));
    const uniq = (pts: DimPoint[]) => pts.sort((p, q) => p.at - q.at).filter((p, i, arr) => i === 0 || p.at - arr[i - 1].at > 0.75);
    const overall: DimPoint[] = [
      { at: side.vertical ? b.y0 : b.x0, obj: side.base },
      { at: side.vertical ? b.y1 : b.x1, obj: side.base },
    ];
    // The overall extents: the corner points at each end of the house.
    for (const o of overall) {
      const nearest = corners.reduce((best, c) => (Math.abs(c.at - o.at) < Math.abs(best.at - o.at) ? c : best), corners[0]);
      if (Math.abs(nearest.at - o.at) < 1) o.obj = nearest.obj;
      else o.obj = across(all.reduce((best, p) => (Math.abs(along(p) - o.at) < Math.abs(along(best) - o.at) ? p : best), all[0]));
    }
    // Extension lines run to the outermost wall at each point, so they never cross the house.
    const outermost = (at: number, fallback: number) => {
      let best: number | null = null;
      for (const ring of outlines) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const e = ring[(i + 1) % ring.length];
          const [p0, p1] = [along(a), along(e)];
          if ((at < Math.min(p0, p1) - 0.5) || (at > Math.max(p0, p1) + 0.5)) continue;
          const v = Math.abs(p1 - p0) < 1e-6 ? (side.sign < 0 ? Math.min(across(a), across(e)) : Math.max(across(a), across(e))) : across(a) + ((across(e) - across(a)) * (at - p0)) / (p1 - p0);
          if (best === null || side.sign * v > side.sign * best) best = v;
        }
      }
      return best ?? fallback;
    };
    for (const pt of [...corners, ...openings, ...overall]) pt.obj = outermost(pt.at, pt.obj);
    const cornerStr = uniq([...corners]);
    const openStr = uniq([...cornerStr.map((c) => ({ ...c })), ...openings]);
    const strings: DimPoint[][] = [];
    if (openings.length) strings.push(openStr);
    if (cornerStr.length > 2) strings.push(cornerStr);
    strings.push(uniq(overall));
    strings.forEach((str, k) => drawString(items, str, side, 0.55 + k * 0.4, T, s));
  }

  // Walls at an angle: their length, along the wall.
  for (const ring of outlines) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const e = ring[(i + 1) % ring.length];
      const u = unit(sub(e, a));
      if (Math.abs(u.x) > 0.999 || Math.abs(u.y) > 0.999 || dist(a, e) < 24) continue;
      const n = leftNormal(u);
      const A = add(T(a), scale(n, 0.45));
      const E = add(T(e), scale(n, 0.45));
      items.push(line(add(T(a), scale(n, 0.06)), add(A, scale(n, 0.06)), "hair"), line(add(T(e), scale(n, 0.06)), add(E, scale(n, 0.06)), "hair"), line(A, E, "hair"));
      for (const p of [A, E]) items.push(tick(p, u));
      items.push({ t: "text", at: add(scale(add(A, E), 0.5), scale(n, 0.05)), text: archFeet(dist(a, e)), size: 6.5, align: "center", rotate: readable(u) });
    }
  }
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const u = unit(sub(b, a));
  const L = dist(a, b);
  const t = Math.max(0, Math.min(L, dot(sub(p, a), u)));
  return dist(p, add(a, scale(u, t)));
}

function tick(p: Point, along: Point): Item {
  const d = rotate(along, -45);
  return line(add(p, scale(d, -0.05)), add(p, scale(d, 0.05)), "medium");
}

function drawString(items: Item[], pts: DimPoint[], side: { vertical: boolean; base: number; sign: number }, offset: number, T: (p: Point) => Point, s: number) {
  if (pts.length < 2) return;
  const P = (along: number, across: number) => T(side.vertical ? { x: across, y: along } : { x: along, y: across });
  const baseSheet = side.vertical ? P(0, side.base).x : P(0, side.base).y;
  const pos = baseSheet + side.sign * offset;
  const S = (along: number): Point => {
    const q = P(along, side.base);
    return side.vertical ? { x: pos, y: q.y } : { x: q.x, y: pos };
  };
  const u = side.vertical ? { x: 0, y: 1 } : { x: 1, y: 0 };
  items.push(line(S(pts[0].at), S(pts[pts.length - 1].at), "hair"));
  for (const p of pts) {
    const obj = P(p.at, p.obj);
    const from = side.vertical ? { x: obj.x + side.sign * 0.06, y: obj.y } : { x: obj.x, y: obj.y + side.sign * 0.06 };
    const to = S(p.at);
    const past = side.vertical ? { x: to.x + side.sign * 0.06, y: to.y } : { x: to.x, y: to.y + side.sign * 0.06 };
    if ((side.vertical ? Math.abs(past.x - from.x) : Math.abs(past.y - from.y)) > 0.05) items.push(line(from, past, "hair"));
    items.push(tick(to, u));
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const len = pts[i + 1].at - pts[i].at;
    const text = archFeet(len);
    const room = len * s;
    const tight = textWidth(text, 6.5) > room - 0.04;
    const m = scale(add(S(pts[i].at), S(pts[i + 1].at)), 0.5);
    // Text on the outside of the line; tight spaces step out one more line, alternating.
    const out = 0.05 + (tight && i % 2 ? 0.14 : 0);
    const at = side.vertical ? { x: m.x - out, y: m.y } : { x: m.x, y: m.y - out };
    items.push({ t: "text", at, text, size: tight ? 5.5 : 6.5, align: "center", rotate: side.vertical ? 90 : 0 });
  }
}
