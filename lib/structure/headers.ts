import type { FloorPlan, Level, Point } from "@/lib/model/schema";
import { openingGeometries, type OpeningGeometry, type WallPiece } from "@/lib/plan/walls";
import { add, dist, dot, pointInPolygon, project, scale } from "@/lib/plan/geometry";
import { codeRef } from "@/lib/codes/data";
import { along, lineIntervals, other, runsAcross } from "./geometry";
import { roofBearing, type RoofFraming } from "./roof";
import { kingStuds, pickHeader, type HeaderPick, type HeaderTable } from "./tables";
import type { Engineer, FloorFraming } from "./framing";

/**
 * Headers over doors and windows, from IRC Tables R602.7(1) (outside walls)
 * and R602.7(2) (inside bearing walls). What a wall carries is traced up the
 * house: the roof trusses on it, the floor joists on it, and any bearing
 * wall stacked on top of it.
 */

export type HeaderResult = {
  levelId: string;
  openingId: string;
  at: Point;
  widthIn: number;
  bearing: boolean;
  /** Plain words for what the wall carries. */
  carries: string;
  table: HeaderTable | null;
  condition: string | null;
  buildingWidthIn: number;
  pick: HeaderPick | null;
  kings: number;
};

export type LevelWalls = { level: Level; plan: FloorPlan; pieces: WallPiece[]; framing?: FloorFraming };

type Load = { roof: number | null; floors: number; widthIn: number; center: boolean };

export const pieceKey = (p: WallPiece) => `${"roomId" in p.host ? `${p.host.roomId}.${p.host.edge}` : p.host.wallId}:${Math.round(p.t0)}:${Math.round(p.t1)}`;

/** The wall piece an opening sits in. */
export function hostPiece(pieces: WallPiece[], g: OpeningGeometry): WallPiece | null {
  let best: { p: WallPiece; d: number } | null = null;
  for (const p of pieces) {
    if (p.open) continue;
    const pr = project(g.center, p.a, p.b);
    if (pr.t < -1 || pr.t > pr.length + 1) continue;
    if (!best || pr.d < best.d) best = { p, d: pr.d };
  }
  return best && best.d < 6 ? best.p : null;
}

/** How long the joists are where they cross a point, for the tables' building width. */
function joistLength(f: FloorFraming, p: Point): number {
  const w = along(p, other(f.axis));
  const s = along(p, f.axis);
  const ivs = [...lineIntervals(f.regions, f.axis, w + 0.37), ...lineIntervals(f.regions, f.axis, w - 6.37), ...lineIntervals(f.regions, f.axis, w + 6.37)];
  const hit = ivs.filter(([a, b]) => a - 12 <= s && s <= b + 12);
  return Math.max(0, ...hit.map(([a, b]) => b - a));
}

export function headersFor(levels: LevelWalls[], rf: RoofFraming): { headers: HeaderResult[]; engineer: Engineer[] } {
  const headers: HeaderResult[] = [];
  const engineer: Engineer[] = [];
  const bearingKeys = levels.map((_, i) => new Set((levels[i + 1]?.framing?.bearingWalls ?? []).map((b) => (b.piece ? pieceKey(b.piece) : ""))));

  /** What the wall `piece` on levels[i] carries at point `p` (n points outside, for an outside wall). */
  const loadOf = (i: number, piece: WallPiece, p: Point, n: Point, depth = 0): Load => {
    const res: Load = { roof: null, floors: 0, widthIn: 0, center: false };
    const up = levels[i + 1];
    const inside = add(p, scale(n, -12));
    const f = up?.framing;
    const covered = f ? f.regions.some((r) => pointInPolygon(inside, r.outline)) : false;
    if (f && covered) {
      const bears = piece.exterior ? runsAcross(piece.a, piece.b, f.axis) : bearingKeys[i].has(pieceKey(piece));
      if (bears) {
        res.floors += 1;
        res.widthIn = Math.max(res.widthIn, joistLength(f, p));
        res.center = f.bearingWalls.length > 0 || f.girders.length > 0;
      }
    }
    // A wall standing on top of this one passes its load down.
    if (up && depth < 4) {
      const stacked = up.pieces.find((q) => !q.open && q.exterior === piece.exterior && Math.abs(dot(unitOf(q), unitOf(piece))) > 0.98 && project(p, q.a, q.b).d < 8 && inRange(p, q));
      if (stacked) {
        const s = loadOf(i + 1, stacked, p, n, depth + 1);
        if (s.roof !== null || s.floors > 0) {
          res.roof = s.roof ?? res.roof;
          res.floors += s.floors;
          res.widthIn = Math.max(res.widthIn, s.widthIn, s.roof ?? 0);
          res.center ||= s.center;
        }
      }
    }
    if (piece.exterior && !covered) {
      const span = roofBearing(rf, levels[i].level.id, p, n);
      if (span !== null) {
        res.roof = span;
        res.widthIn = Math.max(res.widthIn, span);
      }
    }
    return res;
  };

  levels.forEach((lw, i) => {
    for (const g of openingGeometries(lw.plan)) {
      const piece = hostPiece(lw.pieces, g);
      if (!piece) continue;
      const n = g.n;
      const load = loadOf(i, piece, g.center, n);
      const widthIn = g.opening.widthIn;
      const bearing = load.roof !== null || load.floors > 0;
      let table: HeaderTable | null = null;
      let condition: string | null = null;
      let carries = "Nothing above it (a nonbearing wall)";
      if (bearing) {
        if (piece.exterior) {
          table = "exterior";
          condition = load.floors === 0 ? "roof-ceiling" : load.floors === 1 ? (load.center ? "roof-ceiling-1-center-bearing-floor" : "roof-ceiling-1-clear-span-floor") : load.floors === 2 ? "roof-ceiling-2-center-bearing-floors" : null;
          carries = load.floors === 0 ? "Roof and ceiling" : `Roof, ceiling and ${load.floors === 1 ? "one floor" : `${load.floors} floors`}`;
        } else {
          table = "interior";
          condition = load.floors === 1 ? "one-floor-only" : load.floors === 2 ? "two-floors" : null;
          carries = load.floors === 1 ? "One floor" : `${load.floors} floors`;
        }
      } else if (widthIn > 96) {
        // Past what a flat 2x4 may cover: the lightest roof header from the table, when it reaches.
        table = "exterior";
        condition = "roof-ceiling";
        carries = "Nothing but the wall above it (a nonbearing wall)";
      }
      const buildingWidthIn = bearing ? Math.max(load.widthIn, 1) : 144;
      const pick = table && condition ? pickHeader(table, condition, buildingWidthIn, widthIn) : null;
      headers.push({ levelId: lw.level.id, openingId: g.opening.id, at: g.center, widthIn, bearing, carries, table, condition, buildingWidthIn, pick, kings: kingStuds(widthIn) });
      if (bearing && !pick)
        engineer.push({
          levelId: lw.level.id,
          text: `${lw.level.name}: the ${Math.round(widthIn / 12)} ft ${g.opening.kind === "window" ? "window" : g.opening.style.startsWith("garage") ? "garage door" : "opening"} is wider than the IRC header table allows here (${codeRef(table === "interior" ? "struct.headersInterior" : "struct.headersExterior")}). An engineer must size an LVL or glulam header.`,
          at: g.center,
        });
    }
  });
  return { headers, engineer };
}

const unitOf = (p: WallPiece) => {
  const L = dist(p.a, p.b) || 1;
  return { x: (p.b.x - p.a.x) / L, y: (p.b.y - p.a.y) / L };
};
const inRange = (p: Point, q: WallPiece) => {
  const pr = project(p, q.a, q.b);
  return pr.t >= -2 && pr.t <= pr.length + 2;
};
