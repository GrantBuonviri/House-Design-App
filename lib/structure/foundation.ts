import type { FloorPlan, HouseSystems, Level, Point } from "@/lib/model/schema";
import { joinRooms, subtractRegions, type Region } from "@/lib/house3d/footprint";
import { areaKind } from "@/lib/plan/measure";
import { add, dist, leftNormal, lerp, polygonArea, scale, sub, unit } from "@/lib/plan/geometry";
import { codeEntry, codeTable } from "@/lib/codes/data";
import { insideRegions } from "./geometry";
import { footingSize, type FootingSize, type FoundationKind } from "./tables";
import type { Engineer, FloorFraming, Pier } from "./framing";

/**
 * The foundation: what's under each part of the lowest floor (basement,
 * crawlspace, slab, garage slab), the walls and footings around and between
 * them sized from Idaho's footing table, and the piers under the girders.
 */

export type Zone = "basement" | "crawlspace" | "slab" | "garage";
const ZONES: Zone[] = ["basement", "crawlspace", "slab", "garage"];

export type FoundationLine = {
  a: Point;
  b: Point;
  /** The zone the wall belongs to (its inside), and what's on its other side. */
  zone: Zone;
  outside: Zone | null;
  stories: number;
  footing: FootingSize | null;
  /** Basement walls: how much soil is against it, and what the wall table says. */
  backfillIn?: number;
  wallNote?: string;
};

export type Foundation = {
  zones: Record<Zone, Region[]>;
  lines: FoundationLine[];
  /** Footings under bearing walls inside a slab or basement floor. */
  interior: { a: Point; b: Point; footing: FootingSize | null }[];
  piers: Pier[];
  /** Crawlspace vents and access, along the outside walls. */
  vents: Point[];
  access: Point | null;
  crawlSqft: number;
  hillside: boolean;
  engineer: Engineer[];
};

export type FoundationInput = {
  main: Level;
  mainPlan: FloorPlan;
  basement?: { level: Level; plan: FloorPlan; floorIn: number; wallIn: number };
  /** Floors above the main floor, lowest first, with their footprints. */
  upper: { level: Level; regions: Region[] }[];
  systems: HouseSystems;
  soilPsf: number;
  hillside: boolean;
  groundAt: (p: Point) => number;
  mainFraming?: FloorFraming;
  /** Walls on the main floor holding up the floor above. */
  bearingWalls: { a: Point; b: Point }[];
};

const KIND: Record<Zone, FoundationKind> = { basement: "basement", crawlspace: "crawl", slab: "slab", garage: "slab" };

export function zonesOf(input: Pick<FoundationInput, "mainPlan" | "basement" | "systems">): Record<Zone, Region[]> {
  const living = joinRooms(input.mainPlan.rooms.filter((r) => areaKind(r) === "living").map((r) => r.polygon));
  const garage = subtractRegions(joinRooms(input.mainPlan.rooms.filter((r) => areaKind(r) === "garage").map((r) => r.polygon)), living);
  const f = input.systems.foundation;
  const basement = input.basement ? joinRooms(input.basement.plan.rooms.filter((r) => areaKind(r) !== "outdoor").map((r) => r.polygon)) : f === "basement" ? living : [];
  const rest = subtractRegions(living, basement);
  // With a basement level, the rest of the main floor is over a crawlspace unless the house is set to a slab.
  const crawl = f === "slab" ? [] : rest;
  const slab = f === "slab" ? rest : [];
  return { basement, crawlspace: crawl, slab, garage };
}

export function foundationOf(input: FoundationInput): Foundation {
  const zones = zonesOf(input);
  const zoneAt = (p: Point): Zone | null => ZONES.find((z) => insideRegions(zones[z], p)) ?? null;
  const lines: FoundationLine[] = [];
  const engineer: Engineer[] = [];
  const storiesAt = (p: Point) => 1 + input.upper.filter((u) => insideRegions(u.regions, p)).length;
  const wallTable = codeTable<Record<string, Record<string, string | null>>>("struct.plainConcreteWall");

  for (const z of ZONES) {
    for (const r of zones[z]) {
      for (const ring of [r.outline, ...r.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const L = dist(a, b);
          if (L < 1) continue;
          const u = unit(sub(b, a));
          const n = leftNormal(u);
          // Which side is out: probe both.
          const mid = lerp(a, b, 0.5);
          const out = insideRegions(zones[z], add(mid, scale(n, 6))) ? scale(n, -1) : n;
          // Split the edge where its neighbor changes.
          const steps = Math.max(1, Math.round(L / 12));
          let run: { t0: number; t1: number; outside: Zone | null } | null = null;
          const flush = () => {
            if (!run) return;
            const outside = run.outside;
            // A wall between two zones is drawn once, by the one listed first.
            if (outside && ZONES.indexOf(outside) < ZONES.indexOf(z)) return void (run = null);
            const p0 = lerp(a, b, run.t0);
            const p1 = lerp(a, b, run.t1);
            const inside = add(lerp(p0, p1, 0.5), scale(out, -12));
            const stories = storiesAt(inside);
            const line: FoundationLine = { a: p0, b: p1, zone: z, outside, stories, footing: footingSize(input.soilPsf, stories, KIND[z]) };
            if (z === "basement" && input.basement) {
              const ground = Math.max(input.groundAt(p0), input.groundAt(p1), input.groundAt(lerp(p0, p1, 0.5)));
              const backfill = outside === null ? ground - input.basement.floorIn : 0;
              line.backfillIn = Math.max(0, backfill);
              const hFt = Math.ceil(input.basement.wallIn / 12 - 1e-6);
              const bFt = Math.ceil(line.backfillIn / 12 - 1e-6);
              const row = wallTable[String(Math.max(8, hFt))];
              const cell = bFt <= 0 ? "PC" : row?.[String(Math.max(4, bFt))]?.["SC-MH-MLCL-CL"];
              line.wallNote = cell ?? undefined;
              if (!cell) engineer.push({ levelId: input.basement.level.id, text: `Basement wall with ${Math.round(line.backfillIn / 12)} ft of soil against it, ${hFt} ft tall: past the IRC foundation wall table. An engineer must design it.`, at: lerp(p0, p1, 0.5) });
            }
            lines.push(line);
            run = null;
          };
          for (let s = 0; s < steps; s++) {
            const m = lerp(a, b, (s + 0.5) / steps);
            const o = zoneAt(add(m, scale(out, 6)));
            const outside = o === z ? null : o;
            if (run && run.outside === outside) run.t1 = (s + 1) / steps;
            else {
              flush();
              run = { t0: s / steps, t1: (s + 1) / steps, outside };
            }
          }
          flush();
        }
      }
    }
  }

  // Bearing walls inside a slab or basement floor get their own footing; over a crawlspace they sit on girders.
  const interior: Foundation["interior"] = [];
  for (const w of input.bearingWalls) {
    const m = lerp(w.a, w.b, 0.5);
    const z = zoneAt(m);
    if (z === "slab" || z === "garage" || (z === "basement" && !input.mainFraming)) interior.push({ a: w.a, b: w.b, footing: footingSize(input.soilPsf, 1, "slab") });
  }

  const piers = input.mainFraming?.girders.flatMap((g) => g.piers) ?? [];

  // Crawlspace vents near every outside corner of the crawlspace, and one access door on its longest outside wall.
  const vents: Point[] = [];
  let access: Point | null = null;
  let longest = 0;
  const corner = Number(codeEntry("crawl.ventWithinCorner").value) || 36;
  for (const l of lines) {
    if (l.zone !== "crawlspace" || l.outside !== null) continue;
    const L = dist(l.a, l.b);
    if (L >= 96) {
      vents.push(add(l.a, scale(unit(sub(l.b, l.a)), corner * 0.6)), add(l.b, scale(unit(sub(l.a, l.b)), corner * 0.6)));
    }
    if (L > longest) {
      longest = L;
      access = lerp(l.a, l.b, 0.5);
    }
  }
  const crawlSqft = zones.crawlspace.reduce((s, r) => s + polygonArea(r.outline) - r.holes.reduce((h, x) => h + polygonArea(x), 0), 0) / 144;

  if (input.hillside) engineer.unshift({ levelId: input.main.id, text: "The lot is steep (a walkout or stepped foundation). Boise asks for an engineer to design hillside foundations." });
  if (lines.some((l) => !l.footing)) engineer.push({ levelId: input.main.id, text: "A footing is past the footing table (more floors, more snow or weaker soil than it covers). An engineer must size it." });
  return { zones, lines, interior, piers, vents, access: crawlSqft > 0 ? access : null, crawlSqft, hillside: input.hillside, engineer };
}
