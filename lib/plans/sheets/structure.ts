import { windowWells, wellNote } from "@/lib/plan/wells";
import type { Level, Point, Project } from "@/lib/model/schema";
import { add, boundsOf, dist, leftNormal, lerp, polygonCenter, scale, sub, unit } from "@/lib/plan/geometry";
import { wallPieces } from "@/lib/plan/walls";
import { codeEntry, codeNum, codeRef, codeTable, codeText } from "@/lib/codes/data";
import { structureOf, type Structure } from "@/lib/structure";
import { lineIntervals, other, pt, regionBounds, stripPositions } from "@/lib/structure/geometry";
import { LUMBER_NAME } from "@/lib/structure/tables";
import type { FloorFraming } from "@/lib/structure/framing";
import type { FoundationLine, Zone } from "@/lib/structure/foundation";
import { DRAW_AREA } from "../frame";
import { archFeet, DASH, SCALES, textWidth, type Item, type Weight } from "../draw";
import { houseFacts } from "../house";
import { houseScene } from "../scene";
import { viewTitle } from "../view";
import { NotesColumn } from "./symbols";
import { anyCurvedWalls, CURVED_FRAMING_NOTE } from "../curves";
import { flowTables } from "./schedules";

/**
 * The structural sheets: foundation plan (S-101), floor framing plans
 * (S-201 and up), roof framing (S-301), wall bracing (S-401 and up), and the
 * structural notes with the header schedule (S-001). All drawn from
 * lib/structure, which sizes everything from the IRC's prescriptive tables.
 */

const NOTES_W = 5.6;
const TITLE_BAND = 1.1;
const MARGIN = 1.2;
const GHOST = "#9a9a9a";
export const ENGINEER = "ENGINEER REQUIRED";

export type StructSheet = { items: Item[]; scaleLabel: string };

type Frame = { T: (p: Point) => Point; s: number; inPerFt: number; scaleLabel: string; area: { x0: number; y0: number; x1: number; y1: number } };

/** One scale and placement for every structural plan, so they line up sheet to sheet. */
const wellsOf = (project: Project) => windowWells(project.floorPlans, project.levels, project.plan.basics);

function structFrame(project: Project): Frame {
  const h = houseFacts(project);
  const sc = houseScene(project);
  const pts = [...h.drawn.flatMap((l) => h.plan(l.id).rooms.flatMap((r) => r.polygon)), ...sc.roofs.flatMap((r) => r.eave), ...wellsOf(project).flatMap((w) => w.outline)];
  const b = boundsOf(pts) ?? { x0: 0, y0: 0, x1: 120, y1: 120 };
  const area = { x0: DRAW_AREA.x0, y0: DRAW_AREA.y0, x1: DRAW_AREA.x1 - NOTES_W - 0.3, y1: DRAW_AREA.y1 - TITLE_BAND };
  const fits = (k: number) => ((b.x1 - b.x0) / 12) * k + MARGIN * 2 <= area.x1 - area.x0 && ((b.y1 - b.y0) / 12) * k + MARGIN * 2 <= area.y1 - area.y0;
  const choice = SCALES.slice(1).find((x) => fits(x.inPerFt)) ?? SCALES[SCALES.length - 1];
  const s = choice.inPerFt / 12;
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const c = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
  return { T: (p) => ({ x: c.x + (p.x - mid.x) * s, y: c.y + (p.y - mid.y) * s }), s, inPerFt: choice.inPerFt, scaleLabel: choice.label, area };
}

class Draw {
  items: Item[] = [];
  constructor(public f: Frame) {}
  line(pts: Point[], w: Weight = "fine", dash?: number[], color?: string) {
    this.items.push({ t: "line", pts: pts.map(this.f.T), w, dash, color });
  }
  poly(pts: Point[], stroke?: Weight, fill?: string, dash?: number[]) {
    this.items.push({ t: "poly", pts: pts.map(this.f.T), stroke, fill, dash });
  }
  /** Text in a white box, centered on a plan point. */
  tag(at: Point, text: string, size = 6.5, bold = false, rotate = 0) {
    const c = this.f.T(at);
    const w = textWidth(text, size, bold) + 0.08;
    const hgt = (size / 72) * 1.15;
    if (!rotate) this.items.push({ t: "poly", pts: [add(c, { x: -w / 2, y: -hgt / 2 }), add(c, { x: w / 2, y: -hgt / 2 }), add(c, { x: w / 2, y: hgt / 2 }), add(c, { x: -w / 2, y: hgt / 2 })], fill: "#ffffff" });
    this.items.push({ t: "text", at: c, text, size, bold, align: "center", valign: "middle", rotate: rotate || undefined });
  }
  /** A band of a given thickness along a plan segment. */
  band(a: Point, b: Point, thick: number, stroke?: Weight, fill?: string, dash?: number[]) {
    const n = scale(leftNormal(unit(sub(b, a))), thick / 2);
    this.poly([add(a, n), add(b, n), sub(b, n), sub(a, n)], stroke, fill, dash);
  }
}

/** Walls of a floor, drawn as thin outlines. */
function ghostWalls(d: Draw, project: Project, level: Level, w: Weight = "hair", dash?: number[]) {
  const h = houseFacts(project);
  for (const p of wallPieces(h.plan(level.id), h.exteriorIn)) {
    if (p.open || p.thicknessIn <= 0) continue;
    const n = scale(leftNormal(unit(sub(p.b, p.a))), p.thicknessIn / 2);
    d.line([add(p.a, n), add(p.b, n)], w, dash, GHOST);
    d.line([sub(p.a, n), sub(p.b, n)], w, dash, GHOST);
  }
}

function engineerBubble(d: Draw, at: Point) {
  d.tag(at, ENGINEER, 6, true);
}

const ft = (inches: number) => archFeet(inches);

// ---------- S-101 Foundation plan ----------

const ZONE_NOTE: Record<Zone, string> = {
  basement: "BASEMENT: CONCRETE SLAB ON GRADE",
  crawlspace: "CRAWLSPACE",
  slab: "CONCRETE SLAB ON GRADE",
  garage: "GARAGE SLAB",
};

/** Footing marks: one per distinct footing and wall. */
export function footingMarks(s: Structure): { mark: string; key: string; zone: Zone; stories: number; footing: FoundationLine["footing"]; wallNote?: string }[] {
  const out: ReturnType<typeof footingMarks> = [];
  for (const l of s.foundation?.lines ?? []) {
    const key = `${l.zone}|${l.stories}|${l.footing?.widthIn}|${l.footing?.thicknessIn}|${l.wallNote ?? ""}`;
    if (!out.some((m) => m.key === key)) out.push({ mark: `F${out.length + 1}`, key, zone: l.zone, stories: l.stories, footing: l.footing, wallNote: l.wallNote });
  }
  return out;
}
const lineKey = (l: FoundationLine) => `${l.zone}|${l.stories}|${l.footing?.widthIn}|${l.footing?.thicknessIn}|${l.wallNote ?? ""}`;

export function foundationSheet(project: Project): StructSheet {
  const s = structureOf(project);
  const f = structFrame(project);
  const d = new Draw(f);
  const fd = s.foundation!;
  const wallT = Math.max(codeNum("struct.foundationWallMinThickness"), 8);
  const marks = footingMarks(s);

  // Zones: lightly shaded slabs, labels in the middle.
  for (const z of ["basement", "crawlspace", "slab", "garage"] as Zone[]) {
    for (const r of fd.zones[z]) {
      if (z !== "crawlspace") d.poly(r.outline, undefined, "#f2f2f2");
      const c = polygonCenter(r.outline);
      d.tag(c, ZONE_NOTE[z], 7, true);
      const sub = z === "crawlspace" ? `Ground: 6-mil vapor retarder` : z === "garage" ? `${codeNum("struct.slabMinThickness") + 0.5}" concrete, ${codeTable<number>("struct.concreteStrength").garageSlab} psi, slope to the door` : `${codeNum("struct.slabMinThickness")}" min. on ${codeNum("struct.slabBaseCourse")}" base, ${codeNum("struct.slabVaporRetarder")}-mil vapor retarder`;
      d.tag(add(c, { x: 0, y: 14 / f.s / 72 }), sub, 6);
    }
  }
  // Footings (dashed, both faces) and walls (filled).
  for (const l of fd.lines) {
    const fw = l.footing?.widthIn ?? 12;
    d.band(l.a, l.b, fw, "hair", undefined, DASH.hidden);
    d.band(l.a, l.b, wallT, undefined, "#5a5a5a");
  }
  // Marks, on the longest wall of each kind.
  for (const m of marks) {
    const lines = fd.lines.filter((l) => lineKey(l) === m.key).sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
    const l = lines[0];
    if (!l) continue;
    const out = leftNormal(unit(sub(l.b, l.a)));
    d.tag(add(lerp(l.a, l.b, 0.5), scale(out, 30)), m.mark, 7, true);
  }
  for (const w of fd.interior) {
    d.band(w.a, w.b, w.footing?.widthIn ?? 12, "hair", undefined, DASH.hidden);
    d.tag(lerp(w.a, w.b, 0.5), `THICKENED SLAB UNDER BEARING WALL, ${w.footing?.widthIn ?? 12}" WIDE`, 5.5);
  }
  // Girders and piers.
  const mainF = s.floors.find((x) => x.levelId === s.main?.id);
  for (const g of mainF?.girders ?? []) {
    d.line([g.a, g.b], "medium", DASH.center);
    d.tag(lerp(g.a, g.b, 0.5), g.pick ? `${g.pick.size.replace(/^(\d)-/, "($1) ")} GIRDER` : `GIRDER: ${ENGINEER}`, 6, true, Math.abs(g.a.x - g.b.x) < 1 ? 90 : 0);
  }
  fd.piers.forEach((p) => {
    const h2 = p.sizeIn / 2;
    d.poly([add(p.at, { x: -h2, y: -h2 }), add(p.at, { x: h2, y: -h2 }), add(p.at, { x: h2, y: h2 }), add(p.at, { x: -h2, y: h2 })], "fine", undefined, DASH.hidden);
    d.poly([add(p.at, { x: -4, y: -4 }), add(p.at, { x: 4, y: -4 }), add(p.at, { x: 4, y: 4 }), add(p.at, { x: -4, y: 4 })], "fine", "#5a5a5a");
  });
  // Window wells outside basement escape windows.
  const wells = wellsOf(project);
  for (const w of wells) {
    d.poly(w.outline, "fine");
    d.tag(lerp(w.outline[0], w.outer, 0.5), w.ladder ? "WELL W/ LADDER" : "WELL", 5.5, true);
  }
  // Crawlspace vents and access.
  for (const v of fd.vents) d.tag(v, "V", 5.5, true);
  if (fd.access) d.tag(fd.access, "CRAWL ACCESS", 5.5, true);
  for (const e of fd.engineer) if (e.at) engineerBubble(d, e.at);

  // ---------- Notes column ----------
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Footing schedule");
  col.table(
    [
      { title: "Mark", width: 0.5 },
      { title: "Where", width: 1.7 },
      { title: "Floors on it", width: 0.8 },
      { title: "Footing", width: 1.3 },
      { title: "Wall", width: 1.3 },
    ],
    marks.map((m) => [m.mark, m.zone === "crawlspace" ? "Crawlspace stem wall" : m.zone === "basement" ? "Basement wall" : m.zone === "garage" ? "Garage edge" : "Slab edge", String(m.stories), m.footing ? `${m.footing.widthIn}" wide x ${m.footing.thicknessIn}" thick` : ENGINEER, m.zone === "basement" ? `${wallT}" concrete, ${m.wallNote === "PC" || !m.wallNote ? "plain" : m.wallNote}` : `${wallT}" concrete stem wall`]),
  );
  col.notes([`Footing widths from Idaho's footing table (${codeRef("struct.footingsLightFrame")}, ${codeEntry("struct.footingsLightFrame").amendment ?? "IDAPA 24.39.30"}) for ${project.plans.structure.soilPsf.toLocaleString()} psf soil.`]);
  if (fd.piers.length) {
    col.heading("Piers");
    const sizes = [...new Set(fd.piers.map((p) => `${p.sizeIn}|${p.thicknessIn}`))].map((k) => k.split("|").map(Number));
    col.notes([
      `Pier pads ${sizes.map(([w, t]) => `${w}" x ${w}" x ${t}"`).join(", ")}, sized for the floor loads (${codeRef("struct.liveLoads")}: ${codeTable<number>("struct.liveLoads").floorLiving} psf live plus ${codeNum("struct.floorDeadLoad")} psf dead) on ${project.plans.structure.soilPsf.toLocaleString()} psf soil, largest load ${Math.max(...fd.piers.map((p) => p.loadLb)).toLocaleString()} lb.`,
      s.basement ? `Posts: ${codeText("struct.columnSteel")} or ${codeText("struct.columnMinWood")} wood, restrained top and bottom (${codeRef("struct.columnSteel")}).` : `Posts or piers: ${codeText("struct.columnMinWood")} min. treated wood or concrete piers, restrained top and bottom (${codeRef("struct.columnMinWood")}).`,
    ]);
  }
  col.heading("Foundation notes");
  const cs = codeTable<number>("struct.concreteStrength");
  const notes = [
    `Bottom of every footing at least ${codeNum("design.frostDepth")}" below finished grade (Boise frost depth, ${codeRef("footing.minDepthFrost")}), on undisturbed soil.`,
    `Soil assumed ${project.plans.structure.soilPsf.toLocaleString()} psf (${codeRef("struct.soilBearing")}). The building inspector or a soils report confirms it; change it in Plan details.`,
    `Concrete: ${cs.foundationsNotExposed.toLocaleString()} psi for footings and walls, ${cs.foundationsExposed.toLocaleString()} psi where exposed to weather, ${cs.garageSlab.toLocaleString()} psi for the garage slab (${codeRef("struct.concreteStrength")}, severe weathering).`,
    `Anchor bolts: ${codeNum("struct.anchorBoltDiameter")}" diameter, ${codeNum("struct.anchorBoltEmbed")}" into the concrete, ${codeNum("struct.anchorBoltSpacing")}'-0" apart and within ${codeNum("struct.anchorBoltFromEnd")}" of each end of every plate, at least ${codeNum("struct.anchorBoltMinPerPiece")} per plate piece (${codeRef("struct.anchorBoltSpacing")}). Sill plates preservative-treated.`,
    `Footings ${codeNum("struct.footingMinThickness")}" thick at least and ${codeNum("struct.footingProjectionMin")}" past the wall each side, no more than their thickness (${codeRef("struct.footingProjectionMin")}).`,
  ];
  if (fd.crawlSqft > 0) {
    notes.push(`Crawlspace: ${Math.round(fd.crawlSqft).toLocaleString()} sq ft, so at least ${(Math.ceil((fd.crawlSqft / codeNum("crawl.ventAreaPer")) * 10) / 10).toLocaleString()} sq ft of net vent area (1 per ${codeNum("crawl.ventAreaPer")} sq ft, ${codeRef("crawl.ventAreaPer")}), with a vent (V) within ${codeNum("crawl.ventWithinCorner")}" of each corner; add vents evenly to reach the area. Or build it as a conditioned crawlspace (R408.3).`);
    notes.push(`Crawl access ${codeNum("crawl.accessWallWidth")}" x ${codeNum("crawl.accessWallLength")}" through the wall (${codeRef("crawl.accessWallWidth")}). Wood joists closer than ${codeNum("struct.woodClearanceJoists")}" and girders closer than ${codeNum("struct.woodClearanceGirders")}" to the ground are treated (${codeRef("struct.woodClearanceJoists")}).`);
  }
  if (s.basement) notes.push(`Basement walls ${wallT}" concrete, braced by the floor framing before backfilling, with foundation drainage and dampproofing (R405, R406). Soil assumed the weakest class in the wall table.`);
  if (wells.length) notes.push(wellNote(wells));
  if (fd.hillside) notes.push(`${ENGINEER}: this lot is steep. Boise asks for an Idaho-licensed engineer to design hillside foundations. The layout here is for the engineer to start from.`);
  for (const e of fd.engineer.filter((x) => !x.text.startsWith("The lot is steep"))) notes.push(`${ENGINEER}: ${e.text}`);
  col.notes(notes);
  d.items.push(...col.items);
  d.items.push(...viewTitle(f.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: "Foundation plan", scaleLabel: f.scaleLabel, inPerFt: f.inPerFt, north: true }));
  return { items: d.items, scaleLabel: f.scaleLabel };
}

// ---------- S-201 Floor framing ----------

export function floorFramingSheet(project: Project, levelId: string): StructSheet {
  const s = structureOf(project);
  const h = houseFacts(project);
  const fr = s.floors.find((x) => x.levelId === levelId)!;
  const level = h.levels.find((l) => l.id === levelId)!;
  const f = structFrame(project);
  const d = new Draw(f);
  const below = belowLevel(s, level);
  if (below) ghostWalls(d, project, below, "hair", DASH.hidden);
  for (const r of fr.regions) {
    d.poly(r.outline, "medium");
    for (const hole of r.holes) d.poly(hole, "fine");
  }
  for (const o of fr.openings) {
    d.poly(o, "medium");
    const b = boundsOf(o)!;
    d.line([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }], "hair");
    d.line([{ x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }], "hair");
    d.tag(polygonCenter(o), "STAIR OPENING: DOUBLE TRIMMERS AND HEADERS", 5.5);
  }
  drawJoists(d, fr);
  for (const b of fr.bearingWalls) {
    d.line([b.a, b.b], "heavy", DASH.hidden);
    d.tag(lerp(b.a, b.b, 0.5), "BEARING WALL BELOW", 5.5, true, Math.abs(b.a.x - b.b.x) < 1 ? 90 : 0);
  }
  for (const g of fr.girders) {
    d.line([g.a, g.b], "heavy", DASH.center);
    d.tag(lerp(g.a, g.b, 0.5), g.pick ? `${g.pick.size.replace(/^(\d)-/, "($1) ")} GIRDER` : `GIRDER: ${ENGINEER}`, 6, true, Math.abs(g.a.x - g.b.x) < 1 ? 90 : 0);
    for (const p of g.piers) d.poly([add(p.at, { x: -4, y: -4 }), add(p.at, { x: 4, y: -4 }), add(p.at, { x: 4, y: 4 }), add(p.at, { x: -4, y: 4 })], "fine", "#000000");
  }
  for (const c of fr.cantilevers) d.tag(c.at, `CANTILEVER ${ft(c.depthIn).toUpperCase()}: ${c.pick.size} @ ${c.pick.spacing}"`, 5.5);
  for (const p of fr.unsupported) engineerBubble(d, p);
  for (const e of fr.engineer) if (e.at && !fr.unsupported.includes(e.at)) engineerBubble(d, e.at);

  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Floor framing");
  const lumber = LUMBER_NAME[project.plans.structure.lumber];
  const j = fr.joist;
  col.notes([
    j
      ? `Joists: ${j.size} at ${j.spacing}" on center, ${lumber}. Longest span ${ft(fr.maxSpanIn)}, allowed ${ft(j.allowIn)} (${codeRef("struct.joistSpans40")}, ${codeTable<number>("struct.liveLoads").floorLiving} psf live, ${codeNum("struct.floorDeadLoad")} psf dead, L/360).`
      : `Joists: ${ENGINEER}. The spans here are past the IRC span table; engineered joists (by their maker) or a beam designed by an engineer.`,
    `Subfloor: ${codeTable<string>("struct.floorSheathing")[String(j?.spacing ?? 16)] ?? "per the span rating"} glued and nailed (${codeRef("struct.floorSheathing")}).`,
    `Joist ends bear at least ${codeNum("struct.joistBearingWood")}" on wood or ${codeNum("struct.joistBearingConcrete")}" on concrete (${codeRef("struct.joistBearingWood")}); joists lapped over a support lap at least ${codeNum("struct.joistLapOverSupport")}" (${codeRef("struct.joistLapOverSupport")}).`,
    "Double the joists under walls that run along the joists, and at the sides of floor openings, with hangers at headers.",
    fr.over === "floor" ? "Bearing walls below (dashed, heavy) carry this floor: keep them, and the walls under them, in place." : `Girders on piers or posts at the spacing shown; girders sized from ${codeRef("struct.headersInterior")} (building width taken as twice the floor width each girder carries).`,
  ]);
  if (fr.girders.length) {
    col.heading("Girders");
    col.table(
      [
        { title: "Girder", width: 1.4 },
        { title: "Carries", width: 1.5 },
        { title: "Length", width: 0.8 },
        { title: "Supports at", width: 1.0 },
        { title: "Jacks", width: 0.6 },
      ],
      fr.girders.map((g) => [g.pick ? g.pick.size.replace(/^(\d)-/, "($1) ") : ENGINEER, `${g.condition === "two-floors" ? "Floor and wall above" : "Floor"}, ${ft(g.widthIn)} wide`, ft(dist(g.a, g.b)), ft(g.bayIn), g.pick ? String(g.pick.jacks) : "-"]),
    );
  }
  if (fr.cantilevers.length) {
    col.heading("Cantilevers");
    col.notes(
      fr.cantilevers.map(
        (c) =>
          `${c.name}: joists ${c.pick.size} at ${c.pick.spacing}" on center run out ${ft(c.depthIn)} past the wall below (allowed ${c.pick.allowIn}" for a ${c.pick.roofWidthFt} ft roof width, ${codeRef("struct.cantilevers")}). Back span inside at least 3 times the cantilever (${ft(c.backspanIn)} here), full-depth rim joist at the end, solid blocking and an uplift connection at the wall below.`,
      ),
    );
  }
  if (fr.engineer.length) {
    col.heading(ENGINEER);
    col.notes(fr.engineer.map((e) => e.text));
  }
  d.items.push(...col.items);
  d.items.push(...viewTitle(f.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: `${level.name} floor framing`, scaleLabel: f.scaleLabel, inPerFt: f.inPerFt, north: true }));
  return { items: d.items, scaleLabel: f.scaleLabel };
}

function belowLevel(s: Structure, level: Level): Level | null {
  const order = [...(s.basement ? [s.basement] : []), ...(s.main ? [s.main] : []), ...s.upper];
  const i = order.findIndex((l) => l.id === level.id);
  return i > 0 ? order[i - 1] : null;
}

/** Every joist as a hair line, with a size callout and arrow in each bay. */
function drawJoists(d: Draw, fr: FloorFraming) {
  const spacing = fr.joist?.spacing ?? 16;
  const axis = fr.axis;
  const b = regionBounds(fr.regions);
  if (!b) return;
  const cross = other(axis);
  const w0 = cross === "x" ? b.x0 : b.y0;
  const w1 = cross === "x" ? b.x1 : b.y1;
  for (let w = w0 + spacing / 2; w < w1; w += spacing) {
    for (const [s0, s1] of lineIntervals(fr.regions, axis, w)) {
      // Joists stop at the floor openings.
      d.line([pt(axis, s0, w), pt(axis, s1, w)], "hair", undefined, "#555555");
    }
  }
  // One callout per region, along the joists, in the widest strip.
  const label = fr.joist ? `${fr.joist.size} @ ${fr.joist.spacing}" O.C.` : `JOISTS: ${ENGINEER}`;
  for (const r of fr.regions) {
    const ws = stripPositions([r], axis, 24);
    let best: { w: number; s0: number; s1: number } | null = null;
    for (const w of ws) for (const [s0, s1] of lineIntervals([r], axis, w)) if (!best || s1 - s0 > best.s1 - best.s0) best = { w, s0, s1 };
    if (!best) continue;
    const a = pt(axis, best.s0 + 18, best.w);
    const e = pt(axis, best.s1 - 18, best.w);
    d.line([a, e], "fine");
    for (const [p, q] of [
      [a, e],
      [e, a],
    ] as const) {
      const u = unit(sub(q, p));
      const n = leftNormal(u);
      d.line([add(p, add(scale(u, 8), scale(n, 4))), p, add(p, add(scale(u, 8), scale(n, -4)))], "fine");
    }
    d.tag(lerp(a, e, 0.5), label, 6.5, true, axis === "y" ? 90 : 0);
  }
}

// ---------- S-301 Roof framing ----------

export function roofFramingSheet(project: Project): StructSheet {
  const s = structureOf(project);
  const sc = houseScene(project);
  const f = structFrame(project);
  const d = new Draw(f);
  const top = [...(s.main ? [s.main] : []), ...s.upper];
  for (const l of top) ghostWalls(d, project, l, "hair", DASH.hidden);
  for (const r of sc.roofs) d.poly(r.eave, "medium");
  for (const p of s.roof.planes) for (const [a, b] of p.trusses) d.line([a, b], "hair", undefined, "#555555");
  const label = s.roof.planes.some((p) => !p.flat) ? `PRE-ENGINEERED TRUSSES @ 24" O.C.` : `FLAT ROOF TRUSSES @ 24" O.C.`;
  const big = [...s.roof.planes].sort((a, b) => b.trusses.length - a.trusses.length).slice(0, 4);
  for (const p of big) {
    const t = p.trusses[Math.floor(p.trusses.length / 2)];
    if (!t) continue;
    const dir = unit(sub(t[1], t[0]));
    d.tag(lerp(t[0], t[1], 0.5), label, 6, true, Math.abs(dir.x) < 0.5 ? 90 : 0);
  }
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Roof framing");
  const sheath = codeTable<string>("struct.roofSheathing");
  col.notes([
    `Trusses designed by the truss supplier's engineer to ANSI/TPI 1, with truss design drawings at the site for the inspector (${codeRef("struct.trussDesign")}). The layout here gives the supplier the roof shape, ${s.roof.pitch} in 12 pitch, ${ft(s.roof.overhangIn)} overhangs and the bearing walls.`,
    `Design loads for the supplier: roof snow ${codeNum("design.roofSnowLoadMin")} psf (Boise), ground snow ${codeNum("design.groundSnowLoad")} psf, wind ${codeNum("struct.windSpeedBasis")} mph (ultimate, exposure ${project.plans.structure.windExposure}), ceiling ${codeTable<number>("struct.liveLoads").atticNoStorage} psf attic live load where there's no storage.`,
    `Trusses bear on the outside walls under the eaves; inside walls on the top floor carry no roof load. Gable-end walls get a gable-end truss. Hips, valleys and girder trusses are laid out by the supplier.`,
    `Truss bracing per the truss drawings and BCSI (${codeRef("struct.trussBracing")}).`,
    `Uplift: ${codeText("struct.roofUplift").split(";")[0]}. Use connectors rated for the uplift on the truss drawings (${codeRef("struct.roofUplift")}).`,
    `Roof sheathing: ${sheath["24"] ?? "per its span rating"} at 24" on center (${codeRef("struct.roofSheathing")}).`,
    `Attic ventilation and access: see the roof plan (A-111).`,
  ]);
  d.items.push(...col.items);
  d.items.push(...viewTitle(f.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: "Roof framing plan", scaleLabel: f.scaleLabel, inPerFt: f.inPerFt, north: true }));
  return { items: d.items, scaleLabel: f.scaleLabel };
}

// ---------- S-401 Wall bracing ----------

export function bracingSheet(project: Project, levelId: string): StructSheet {
  const s = structureOf(project);
  const h = houseFacts(project);
  const level = h.levels.find((l) => l.id === levelId)!;
  const f = structFrame(project);
  const d = new Draw(f);
  ghostWalls(d, project, level, "fine");
  const lines = s.bracing.filter((b) => b.levelId === levelId);
  for (const b of lines) {
    const u = unit(sub(b.b, b.a));
    const a = add(b.a, scale(u, -30));
    const e = add(b.b, scale(u, 30));
    d.line([a, e], "fine", DASH.center);
    const bubble = (p: Point) => {
      const c = f.T(p);
      d.items.push({ t: "circle", c, r: 0.16, stroke: "fine", fill: "#ffffff" });
      d.items.push({ t: "text", at: c, text: b.label, size: 7, bold: true, align: "center", valign: "middle" });
    };
    bubble(add(a, scale(u, -12)));
    for (const p of b.panels) d.band(p.a, p.b, h.exteriorIn + 2, "fine", b.problems.length ? "#bdbdbd" : "#3a3a3a");
  }
  const col = new NotesColumn(DRAW_AREA.x1 - NOTES_W, DRAW_AREA.y0, NOTES_W, DRAW_AREA.y1);
  col.heading("Braced wall lines");
  col.table(
    [
      { title: "Line", width: 0.45 },
      { title: "Spacing", width: 0.7 },
      { title: "Needs", width: 0.7 },
      { title: "Has", width: 0.6 },
      { title: "Result", width: 2.75 },
    ],
    lines.map((b) => [b.label, `${b.spacingFt} ft`, b.requiredFt === null ? "-" : `${b.requiredFt} ft`, `${b.providedFt} ft`, b.problems.length ? b.problems.join(" ") : "OK"]),
  );
  col.heading("Wall bracing notes");
  const exposure = project.plans.structure.windExposure;
  col.notes([
    `Method: continuous sheathing, wood structural panels (CS-WSP), ${codeRef("struct.bracingWind")}. Sheath every outside wall surface, above and below windows and at gable ends (${codeRef("struct.csRequiresFullSheathing")}). Dark bars are the full-height panels counted.`,
    `Bracing for wind: ${codeNum("struct.windSpeedBasis")} mph ultimate, exposure ${exposure}. Detached houses in seismic category ${codeText("design.seismicCategory")} use the wind bracing (${codeRef("struct.seismicBracingExempt")}). Required lengths include the ${codeRef("struct.bracingAdjust")} adjustments for exposure, roof height, wall height and number of lines.`,
    `Braced wall lines no more than ${codeNum("struct.bwlMaxSpacing")} ft apart; panels within ${codeNum("struct.bwlOffset")} ft of their line, the first within ${codeNum("struct.panelFromEnd")} ft of each end, and no more than ${codeNum("struct.panelMaxSpacing")} ft apart (${codeRef("struct.panelFromEnd")}).`,
    `Corners: a ${codeNum("struct.csCornerReturn")}" full-height return panel at each end of a continuously sheathed line (${codeRef("struct.csCornerReturn")}).`,
    `Beside a garage door, narrow panels count as portal frames (CS-PF, ${codeRef("struct.portalFrameNote")}) with the straps and hold-downs that method needs.`,
    "Short jogs in a wall count with the braced wall line they step from.",
    "A line that doesn't have enough bracing: narrow or move the windows and doors on it, or an engineer must design the bracing.",
  ]);
  d.items.push(...col.items);
  d.items.push(...viewTitle(f.area.x0 + 0.1, DRAW_AREA.y1 - 0.45, { number: 1, title: `${level.name} wall bracing`, scaleLabel: f.scaleLabel, inPerFt: f.inPerFt, north: true }));
  return { items: d.items, scaleLabel: f.scaleLabel };
}

// ---------- S-001 Structural notes and header schedule ----------

export function headerRows(project: Project): string[][] {
  const s = structureOf(project);
  const h = houseFacts(project);
  const levelName = (id: string) => h.levels.find((l) => l.id === id)?.name ?? "";
  return s.headers
    .filter((x) => x.bearing || x.widthIn > 36)
    .map((x) => {
      const tag = h.tags.get(x.openingId) ?? "Opening";
      const header = x.pick ? x.pick.size.replace(/^(\d)-/, "($1) ") : x.bearing ? ENGINEER : x.widthIn <= 96 ? "Flat 2x4" : "Nonbearing: no header needed";
      const jacks = x.pick ? `${x.pick.jacks} jack, ${x.kings} king` : "-";
      return [tag, levelName(x.levelId), ft(x.widthIn), x.carries, x.bearing ? ft(x.buildingWidthIn) : "-", header, jacks];
    });
}

export function structuralNotesSheets(project: Project): Item[][] {
  const s = structureOf(project);
  const live = codeTable<number>("struct.liveLoads");
  const loads = [
    ["Floors (living)", `${live.floorLiving} psf live, ${codeNum("struct.floorDeadLoad")} psf dead`, codeRef("struct.liveLoads")],
    ["Floors (sleeping rooms)", `${live.floorSleeping} psf live (floors here are sized for ${live.floorLiving})`, codeRef("struct.liveLoads")],
    ["Attic without storage", `${live.atticNoStorage} psf`, codeRef("struct.liveLoads")],
    ["Roof snow", `${codeNum("design.roofSnowLoadMin")} psf (ground snow ${codeNum("design.groundSnowLoad")} psf)`, "Boise design criteria"],
    ["Wind", `${codeNum("struct.windSpeedBasis")} mph ultimate (Boise lists ${codeNum("design.windSpeed")} mph), exposure ${project.plans.structure.windExposure}`, codeRef("struct.windSpeedBasis")],
    ["Seismic", `Category ${codeText("design.seismicCategory")}`, "Boise design criteria"],
    ["Soil", `${project.plans.structure.soilPsf.toLocaleString()} psf (presumptive)`, codeRef("struct.soilBearing")],
    ["Frost depth", `${codeNum("design.frostDepth")}"`, "Boise design criteria"],
  ];
  const lumber = LUMBER_NAME[project.plans.structure.lumber];
  const studs = codeTable<Record<string, number | null>>("struct.studSpacing");
  const wall = project.plan.basics?.exteriorWall ?? "2x6";
  const notes = [
    "These sheets size the structure from the IRC's prescriptive (ready-made) tables in force here. Anything past those tables is marked ENGINEER REQUIRED and is left for a licensed engineer; nothing is guessed.",
    `Framing lumber: ${lumber} or better for joists; headers and girders per ${codeRef("struct.headersExterior")} (${codeText("struct.headerTableSpecies")}).`,
    `Studs: ${wall} at ${studs[wall]?.oneFloorRoofCeiling ?? 16}" on center where a floor is above, ${studs[wall]?.roofCeilingOnly ?? 24}" under the roof only, no taller than ${codeNum("struct.studMaxHeight")} ft (${codeRef("struct.studSpacing")}).`,
    `Headers: from the schedule. Nonbearing walls need no structural header (${codeRef("struct.headerNonBearing")}).`,
    "Nailing and fasteners per IRC Table R602.3(1); sheathing nailing per the bracing method.",
    ...(anyCurvedWalls(project) ? [`${CURVED_FRAMING_NOTE} Each curved wall is built as short straight pieces on a curved plate; the radius is on the floor plans. Bracing does not count a curved wall as a braced wall line unless an engineer says so.`] : []),
    "Trusses: by the truss supplier, see S-301. Floor joists: see the floor framing plans. Foundation: see S-101. Wall bracing: see S-401.",
    "Decks and porch framing (ledgers, joists, posts, guards) are built per IRC R507 and checked by the inspector; they aren't drawn here.",
    "Verify all dimensions and code requirements with the City of Boise before construction.",
  ];
  const sections = [
    { title: "Design loads", cols: [{ title: "Load", width: 2 }, { title: "Value", width: 4 }, { title: "Code", width: 2 }], rows: loads },
    {
      title: "Header schedule",
      cols: [
        { title: "Tag", width: 0.7 },
        { title: "Floor", width: 1.2 },
        { title: "Opening", width: 0.9 },
        { title: "Wall carries", width: 2.2 },
        { title: "House width", width: 1 },
        { title: "Header", width: 1.8 },
        { title: "Studs each side", width: 1.3 },
      ],
      rows: headerRows(project),
    },
    { title: ENGINEER, cols: [{ title: "What and why", width: 8 }], rows: s.engineer.length ? s.engineer.map((e) => [e.text]) : [["Nothing: every part of this house is within the IRC tables."]] },
  ];
  return flowTables("Structural notes", sections, notes);
}
