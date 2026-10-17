import type { Level, Project } from "@/lib/model/schema";
import { add, dist, leftNormal, pointInPolygon, scale, sub, unit } from "@/lib/plan/geometry";
import { roleOf, openingRooms } from "@/lib/plan/connect";
import { ceilingFor, FLOOR_STRUCTURE_IN } from "@/lib/plan/basics";
import { openingGeometries } from "@/lib/plan/walls";
import { joinRooms, regionArea, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { changedBy, codeName, codeNum, codeRef, codeText } from "@/lib/codes/data";
import { archFeet, type Item } from "../draw";
import { houseFacts } from "../house";
import { flowTables } from "./schedules";

/**
 * Energy sheet (G-003): the energy code's insulation and window values for
 * the place's climate zone (with any state changes), what this house uses, and the
 * numbers REScheck asks for: wall, window and door areas by direction,
 * ceiling and floor areas, and a rough heat loss (not a Manual J).
 */

export type Direction = "N" | "E" | "S" | "W";
export const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];
const DIR_NAME: Record<Direction, string> = { N: "North", E: "East", S: "South", W: "West" };

export type Envelope = {
  /** Above-grade walls to outside, sq ft, by the way they face. */
  walls: Record<Direction, { gross: number; windows: number; doors: number; glassDoors: number }>;
  /** Walls between heated rooms and the garage, sq ft. */
  garageWalls: number;
  ceiling: number;
  /** Floor over a crawlspace, the slab, or over the garage, sq ft. */
  floorOverCrawl: number;
  slabArea: number;
  slabPerimeterFt: number;
  basementWalls: number;
  /** Windows and doors in the basement walls, sq ft (kept out of the above-ground walls by direction). */
  basementOpenings: { windows: number; glassDoors: number; doors: number };
  floorOverGarage: number;
  conditionedSqft: number;
  volumeCuFt: number;
  windows: { tag: string; dir: Direction; size: string; sqft: number; belowGrade?: boolean }[];
  foundation: "crawlspace" | "slab" | "basement";
};

const heated = (r: { type?: string }) => roleOf(r) !== "garage" && roleOf(r) !== "outdoor";

/** Which way a wall faces, from its outside direction (x east, y south). */
export function facing(out: { x: number; y: number }): Direction {
  const deg = ((Math.atan2(out.x, -out.y) * 180) / Math.PI + 360) % 360;
  return deg < 45 || deg >= 315 ? "N" : deg < 135 ? "E" : deg < 225 ? "S" : "W";
}

const sq = (inches2: number) => inches2 / 144;

export function envelope(project: Project): Envelope {
  const h = houseFacts(project);
  const walls = Object.fromEntries(DIRECTIONS.map((d) => [d, { gross: 0, windows: 0, doors: 0, glassDoors: 0 }])) as Envelope["walls"];
  const env: Envelope = { walls, garageWalls: 0, ceiling: 0, floorOverCrawl: 0, slabArea: 0, slabPerimeterFt: 0, basementWalls: 0, basementOpenings: { windows: 0, glassDoors: 0, doors: 0 }, floorOverGarage: 0, conditionedSqft: 0, volumeCuFt: 0, windows: [], foundation: project.plans.systems.foundation };
  const levels = h.drawn;
  const cond = (l: Level): Region[] => joinRooms(h.plan(l.id).rooms.filter(heated).map((r) => r.polygon));
  const garage = (l: Level): Region[] => joinRooms(h.plan(l.id).rooms.filter((r) => roleOf(r) === "garage").map((r) => r.polygon));
  const lowest = levels[0];
  if (lowest?.kind === "basement") env.foundation = "basement";

  levels.forEach((level, i) => {
    const plan = h.plan(level.id);
    const regions = cond(level);
    const area = regions.reduce((s, r) => s + sq(regionArea(r)), 0);
    const ceiling = ceilingFor(h.basics, level);
    env.conditionedSqft += area;
    env.volumeCuFt += (area * ceiling) / 12;
    const wallH = ceiling + FLOOR_STRUCTURE_IN;
    const basement = level.kind === "basement";
    const garages = plan.rooms.filter((r) => roleOf(r) === "garage");

    // Walls: each outline edge of the heated rooms.
    for (const reg of regions) {
      const ring = reg.outline;
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % ring.length];
        const L = dist(a, b);
        if (L < 1) return;
        const u = unit(sub(b, a));
        let out = leftNormal(u);
        const mid = add(a, scale(u, L / 2));
        if (pointInPolygon(add(mid, scale(out, 3)), ring)) out = scale(out, -1);
        const area2 = sq(L * wallH);
        if (basement) env.basementWalls += sq(L * ceiling);
        else if (garages.some((g) => pointInPolygon(add(mid, scale(out, 10)), g.polygon))) env.garageWalls += area2;
        else walls[facing(out)].gross += area2;
      });
    }
    // Windows and outside doors.
    for (const g of openingGeometries(plan)) {
      const o = g.opening;
      if (o.kind === "opening") continue;
      const [left, right] = openingRooms(plan, o).map((id) => plan.rooms.find((r) => r.id === id));
      const inL = left && heated(left);
      const inR = right && heated(right);
      if (inL === inR) continue;
      const otherSide = inL ? right : left;
      if (otherSide && roleOf(otherSide) === "garage") continue;
      const dir = facing(inL ? scale(g.n, -1) : g.n);
      const a = sq(o.widthIn * o.heightIn);
      // Basement windows and doors are in the basement walls, not the framed walls by direction.
      const into = basement ? env.basementOpenings : walls[dir];
      if (o.kind === "window") {
        into.windows += a;
        env.windows.push({ tag: h.tags.get(o.id) ?? "", dir, size: `${archFeet(o.widthIn)} x ${archFeet(o.heightIn)}`, sqft: a, ...(basement ? { belowGrade: true } : {}) });
      } else if (o.style === "door-slider" || o.style === "door-double") into.glassDoors += a;
      else if (o.style !== "door-garage") into.doors += a;
    }
    // Ceilings: heated rooms with no heated floor above.
    const above = levels[i + 1];
    const open = above ? subtractRegions(regions, cond(above)) : regions;
    env.ceiling += open.reduce((s, r) => s + sq(regionArea(r)), 0);
    // Floors over the garage below.
    const below = levels[i - 1];
    if (below) {
      const g = garage(below);
      const over = subtractRegions(regions, subtractRegions(regions, g));
      env.floorOverGarage += over.reduce((s, r) => s + sq(regionArea(r)), 0);
    }
    if (i === 0 && !basement) {
      if (env.foundation === "slab") {
        env.slabArea += area;
        env.slabPerimeterFt += regions.reduce((s, r) => s + r.outline.reduce((p, a, k) => p + dist(a, r.outline[(k + 1) % r.outline.length]), 0), 0) / 12;
      } else env.floorOverCrawl += area;
    }
  });
  env.windows.sort((a, b) => Number(a.tag.slice(1)) - Number(b.tag.slice(1)));
  return env;
}

const r0 = (n: number) => Math.round(n).toLocaleString("en-US");

/** A rough heat loss at the place's winter design temperature: areas over R-values plus air leakage. Not a Manual J. */
export function roughHeatLoss(project: Project, env = envelope(project)): { btuh: number; dt: number } {
  const wallR = (project.plan.basics?.exteriorWall ?? "2x6") === "2x6" ? 21 : 18;
  const u = codeNum("energy.fenestrationU");
  const dt = 70 - codeNum("design.manualJWinter");
  const wallNet = DIRECTIONS.reduce((s, d) => s + env.walls[d].gross - env.walls[d].windows - env.walls[d].doors - env.walls[d].glassDoors, 0) + env.garageWalls;
  const b = env.basementOpenings;
  const bOpen = b.windows + b.glassDoors + b.doors;
  const glass = DIRECTIONS.reduce((s, d) => s + env.walls[d].windows + env.walls[d].glassDoors + env.walls[d].doors, 0) + bOpen;
  const ua = wallNet / wallR + glass * u + env.ceiling / codeNum("energy.ceilingR") + (env.floorOverCrawl + env.floorOverGarage) / codeNum("energy.floorR") + Math.max(0, env.basementWalls - bOpen) / 15;
  const air = 0.018 * env.volumeCuFt * (codeNum("energy.airLeakageACH50") / 20);
  return { btuh: Math.round(((ua + air) * dt) / 100) * 100, dt };
}

export function energySheets(project: Project): Item[][] {
  const env = envelope(project);
  const twoBy4 = project.plan.basics?.exteriorWall === "2x4";
  const reqCols = [
    { title: "Part of the house", width: 2.6 },
    { title: "Code minimum (zone 5B)", width: 2.4 },
    { title: "Section", width: 1.6 },
    { title: "This house", width: 5 },
  ];
  const req: string[][] = [
    ["Ceiling (attic)", `R-${codeText("energy.ceilingR")}`, codeRef("energy.ceilingR"), `R-${codeText("energy.ceilingR")} or more, blown-in, with baffles at the eaves`],
    ["Outside walls (wood framed)", `R-${codeText("energy.woodWallR")}`, codeRef("energy.woodWallR"), twoBy4 ? "2x4 walls: R-13 batts plus R-5 rigid foam on the outside (13+5)" : "2x6 walls: R-21 batts"],
    ["Walls next to the garage", `R-${codeText("energy.woodWallR")}`, codeRef("energy.woodWallR"), twoBy4 ? "R-13 batts plus R-5 continuous, or R-20 total" : "R-21 batts"],
  ];
  if (env.foundation === "crawlspace") req.push(["Floor over the crawlspace", `R-${codeText("energy.floorR")}`, codeRef("energy.floorR"), `R-${codeText("energy.floorR")} batts in the floor joists (vented crawlspace)`]);
  if (env.foundation === "slab") req.push(["Slab edge", codeText("energy.slabR"), codeRef("energy.slabR"), `${codeText("energy.slabR")} rigid foam at the slab edge`]);
  if (env.foundation === "basement") req.push(["Basement walls", `R-${codeText("energy.basementWallR")}`, codeRef("energy.basementWallR"), `R-15 continuous or R-19 in a framed wall`]);
  if (env.floorOverGarage > 0) req.push(["Floor over the garage", `R-${codeText("energy.floorR")}`, codeRef("energy.floorR"), `R-${codeText("energy.floorR")} batts`]);
  req.push(
    ["Windows and glass doors", `U-${codeText("energy.fenestrationU")} max`, codeRef("energy.fenestrationU"), `Every window and glass door U-${codeText("energy.fenestrationU")} or lower, NFRC label left on until inspection`],
    ["Skylights", `U-${codeText("energy.skylightU")} max`, codeRef("energy.skylightU"), "None drawn"],
    ["Glass solar heat gain (SHGC)", codeText("energy.glazedSHGC"), codeRef("energy.glazedSHGC"), codeText("energy.glazedSHGC") === "NR" ? `No requirement in zone ${codeText("design.climateZone")}` : `SHGC ${codeText("energy.glazedSHGC")} or lower on every window and glass door`],
    ["Air leakage", `${codeText("energy.airLeakageACH50")} ACH50 max`, codeRef("energy.airLeakageACH50"), changedBy("energy.airLeakageACH50") ? `Air sealed per Table R402.4.1.1; blower door test or visual inspection, chosen at the permit (${changedBy("energy.airLeakageACH50")})` : "Air sealed per Table R402.4.1.1 and tested with a blower door (R402.4.1.2)"],
    ["Ducts", `R-${codeNum("energy.ductRAttic")} attic, R-${codeNum("energy.ductROther")} elsewhere; leakage test`, codeRef("energy.ductRAttic"), "Ducts inside the heated space where possible; sealed and tested"],
    ["Hot water pipes", `R-${codeNum("energy.hotWaterPipeR")}`, codeRef("energy.hotWaterPipeR"), `R-${codeNum("energy.hotWaterPipeR")} where the code asks`],
    ["Lighting", `${codeNum("energy.highEfficacyLampsPct")}% high-efficacy`, codeRef("energy.highEfficacyLampsPct"), "LED throughout"],
    ["Thermostat", "Programmable", codeRef("energy.programmableThermostat"), "Programmable thermostat (mechanical plan)"],
  );

  const dirRows = DIRECTIONS.map((d) => {
    const w = env.walls[d];
    const net = w.gross - w.windows - w.doors - w.glassDoors;
    return [DIR_NAME[d], r0(w.gross), r0(w.windows + w.glassDoors), r0(w.doors), r0(net), w.gross ? `${Math.round(((w.windows + w.glassDoors) / w.gross) * 100)}%` : "-"];
  });
  const tot = DIRECTIONS.reduce((s, d) => ({ g: s.g + env.walls[d].gross, w: s.w + env.walls[d].windows + env.walls[d].glassDoors, o: s.o + env.walls[d].doors }), { g: 0, w: 0, o: 0 });
  dirRows.push(["Total", r0(tot.g), r0(tot.w), r0(tot.o), r0(tot.g - tot.w - tot.o), tot.g ? `${Math.round((tot.w / tot.g) * 100)}%` : "-"]);

  const other: string[][] = [
    ["Heated floor area", `${r0(env.conditionedSqft)} sq ft`],
    ["Heated volume", `${r0(env.volumeCuFt)} cu ft`],
    ["Ceiling under the attic", `${r0(env.ceiling)} sq ft`],
    ["Walls next to the garage", `${r0(env.garageWalls)} sq ft`],
  ];
  if (env.floorOverCrawl) other.push(["Floor over the crawlspace", `${r0(env.floorOverCrawl)} sq ft`]);
  if (env.slabArea) other.push(["Slab on grade", `${r0(env.slabArea)} sq ft, ${r0(env.slabPerimeterFt)} ft of edge`]);
  if (env.basementWalls) {
    const b = env.basementOpenings;
    const open = b.windows + b.glassDoors + b.doors;
    other.push(["Basement walls", `${r0(env.basementWalls)} sq ft${open ? `, ${r0(env.basementWalls - open)} sq ft net` : ""}`]);
    if (b.windows + b.glassDoors) other.push(["Basement windows and glass doors", `${r0(b.windows + b.glassDoors)} sq ft (below grade)`]);
    if (b.doors) other.push(["Basement solid doors", `${r0(b.doors)} sq ft`]);
  }
  if (env.floorOverGarage) other.push(["Floor over the garage", `${r0(env.floorOverGarage)} sq ft`]);
  const loss = roughHeatLoss(project, env);
  other.push(["Rough heat loss (not a Manual J)", `About ${r0(loss.btuh)} Btu/h at ${codeNum("design.manualJWinter")}°F outside, ${loss.dt}°F difference`]);

  const notes = [
    `Climate zone ${codeText("design.climateZone")}, ${codeName("Energy")}${changedBy("energy.ceilingR") ? ` with ${changedBy("energy.ceilingR")} amendments` : ""}. The house is designed to the prescriptive values in Table R402.1.2 (${codeRef("energy.ceilingR")}).`,
    "The energy compliance report (REScheck, free at energycodes.gov, or an energy rating) is made outside the app. Enter the areas on this sheet: walls, windows and doors by direction, the ceiling and the floor.",
    "Wall areas are floor to floor (ceiling height plus the floor framing) along the outside of the heated rooms, measured to the middle of the walls. Window and door areas are their rough opening sizes. Check them against the final drawings.",
    `Doors: one opaque door up to ${codeNum("energy.opaqueDoorExemptArea")} sq ft and ${codeNum("energy.glazedExemptArea")} sq ft of glass may skip the U-factor (${codeRef("energy.opaqueDoorExemptArea")}, ${codeRef("energy.glazedExemptArea")}).`,
    "Post the energy certificate (insulation R-values, window U-factors, equipment efficiencies) on or in the electrical panel before final inspection (IECC R401.3).",
    `The rough heat loss uses the R-values above, U-${codeText("energy.fenestrationU")} glass and the air leakage limit spread over a year; it's for a first idea of furnace size only. The HVAC contractor's Manual J sets the real size.`,
  ];

  return flowTables(
    "Energy: insulation, windows and REScheck inputs",
    [
      { title: "Insulation and windows", cols: reqCols, rows: req },
      {
        title: "Walls to the outside, by direction (sq ft)",
        cols: [
          { title: "Facing", width: 1.4 },
          { title: "Gross wall", width: 1.4 },
          { title: "Windows and glass doors", width: 2 },
          { title: "Solid doors", width: 1.3 },
          { title: "Net wall", width: 1.4 },
          { title: "Glass", width: 1 },
        ],
        rows: dirRows,
      },
      {
        title: "Other areas for REScheck",
        cols: [
          { title: "Item", width: 3 },
          { title: "Amount", width: 6 },
        ],
        rows: other,
      },
      {
        title: "Windows",
        cols: [
          { title: "Tag", width: 0.8 },
          { title: "Facing", width: 1.8 },
          { title: "Size (W x H)", width: 1.8 },
          { title: "Area", width: 1.2 },
          { title: "U-factor", width: 1.4 },
        ],
        rows: env.windows.map((w) => [w.tag, w.belowGrade ? `${DIR_NAME[w.dir]}, basement` : DIR_NAME[w.dir], w.size, `${w.sqft.toFixed(1)} sq ft`, `${codeText("energy.fenestrationU")} max`]),
      },
    ],
    notes,
  );
}
