import type { FloorPlan, Level, Point } from "@/lib/model/schema";
import { openingSpan } from "@/lib/house3d/openings";
import { openingGeometries, solidWalls, wallPieces, type SolidWall, type WallPiece } from "@/lib/plan/walls";
import { dist, lerp } from "@/lib/plan/geometry";
import { codeNum } from "@/lib/codes/data";
import { along, other, pt, runsAcross, type Axis } from "./geometry";
import { bracingBase, bracingFactors, csPanelMin, portalMin, wspPanelMin, type StoryLocation } from "./tables";

/**
 * Wall bracing (IRC R602.10): the outside walls of each floor grouped into
 * braced wall lines, how much bracing each line needs for Boise's wind, and
 * how much it has, counting continuously sheathed wall (CS-WSP) between the
 * doors and windows, and portal frames beside garage doors.
 */

export type BracePanel = { a: Point; b: Point; lengthIn: number; kind: "CS-WSP" | "WSP" | "CS-PF" };

export type BracedLine = {
  levelId: string;
  /** "N-S 1": the walls along that direction, numbered west to east or north to south. */
  label: string;
  /** The line runs along this axis. */
  axis: Axis;
  /** Its position across the axis, plan inches. */
  pos: number;
  a: Point;
  b: Point;
  interior: boolean;
  spacingFt: number;
  location: StoryLocation;
  requiredFt: number | null;
  providedFt: number;
  panels: BracePanel[];
  problems: string[];
};

export type BracingInput = {
  level: Level;
  plan: FloorPlan;
  exteriorIn: number;
  ceilingIn: number;
  /** Floors above this one at a point. */
  above: (p: Point) => number;
  exposure: "B" | "C";
  eaveToRidgeIn: number;
};

const feet = (inches: number) => Math.round((inches / 12) * 10) / 10;

export function bracingFor(input: BracingInput): BracedLine[] {
  const { plan } = input;
  const pieces = wallPieces(plan, input.exteriorIn).filter((p) => !p.open && !p.height);
  const geos = openingGeometries(plan);
  const solids = solidWalls(pieces, geos);
  const wallFt = input.ceilingIn / 12;
  const offset = codeNum("struct.bwlOffset") * 12;
  const maxSpacing = codeNum("struct.bwlMaxSpacing") * 12;
  const out: BracedLine[] = [];

  for (const axis of ["x", "y"] as Axis[]) {
    const cross = other(axis);
    // Outside walls running along this axis, grouped into lines: the longest walls set the lines, and walls
    // within the allowed offset join them. Short jogs (under 8 ft of wall) join the nearest line.
    const runs = pieces.filter((p) => p.exterior && runsAcross(p.a, p.b, cross)).sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
    type Line = { pos: number; s0: number; s1: number; pieces: WallPiece[]; interior: boolean };
    let groups: { pos: number; pieces: WallPiece[] }[] = [];
    for (const p of runs) {
      const g = groups.find((x) => Math.abs(x.pos - posOf(p, cross)) <= offset);
      if (g) g.pieces.push(p);
      else groups.push({ pos: posOf(p, cross), pieces: [p] });
    }
    const total = (g: { pieces: WallPiece[] }) => g.pieces.reduce((t, p) => t + dist(p.a, p.b), 0);
    const short = groups.filter((g) => total(g) < 96);
    groups = groups.filter((g) => total(g) >= 96);
    for (const g of short) {
      const near = [...groups].sort((x, y) => Math.abs(x.pos - g.pos) - Math.abs(y.pos - g.pos))[0];
      if (near) near.pieces.push(...g.pieces);
      else groups.push(g);
    }
    // A line with a long stretch of no wall at all (where the house steps back) is two lines.
    const gapMax = codeNum("struct.panelMaxSpacing") * 12;
    const lines: Line[] = [];
    for (const g of groups) {
      const spans = g.pieces.map((p) => ({ p, s0: Math.min(along(p.a, axis), along(p.b, axis)), s1: Math.max(along(p.a, axis), along(p.b, axis)) })).sort((x, y) => x.s0 - y.s0);
      let cur: Line | null = null;
      for (const sp of spans) {
        if (cur && sp.s0 - cur.s1 <= gapMax) {
          cur.pieces.push(sp.p);
          cur.s1 = Math.max(cur.s1, sp.s1);
        } else {
          cur = { pos: g.pos, s0: sp.s0, s1: sp.s1, pieces: [sp.p], interior: false };
          lines.push(cur);
        }
      }
    }
    // A short piece of line left on its own is a jog: it counts with the nearest line it steps from.
    for (const ln of [...lines]) {
      if (lines.length < 2 || total(ln) >= 96) continue;
      const gap = (o: Line) => Math.max(0, o.s0 - ln.s1, ln.s0 - o.s1);
      const near = lines.filter((o) => o !== ln && gap(o) <= gapMax).sort((x, y) => Math.abs(x.pos - ln.pos) - Math.abs(y.pos - ln.pos))[0];
      if (!near) continue;
      near.pieces.push(...ln.pieces);
      near.s0 = Math.min(near.s0, ln.s0);
      near.s1 = Math.max(near.s1, ln.s1);
      lines.splice(lines.indexOf(ln), 1);
    }
    lines.sort((x, y) => x.pos - y.pos);
    // Lines farther apart than the code allows need an inside braced wall line between them.
    const problems = new Map<Line, string[]>();
    for (let i = 0; i + 1 < lines.length; i++) {
      if (lines[i + 1].pos - lines[i].pos <= maxSpacing) continue;
      const mid = (lines[i].pos + lines[i + 1].pos) / 2;
      const inside = pieces.filter((p) => !p.exterior && runsAcross(p.a, p.b, cross)).sort((p, q) => Math.abs(posOf(p, cross) - mid) - Math.abs(posOf(q, cross) - mid))[0];
      if (inside && Math.abs(posOf(inside, cross) - mid) < maxSpacing / 2) {
        const pos = posOf(inside, cross);
        const near = pieces.filter((p) => !p.exterior && runsAcross(p.a, p.b, cross) && Math.abs(posOf(p, cross) - pos) <= offset);
        const ss = near.flatMap((p) => [along(p.a, axis), along(p.b, axis)]);
        lines.splice(i + 1, 0, { pos, s0: Math.min(...ss), s1: Math.max(...ss), pieces: near, interior: true });
      } else problems.set(lines[i], [`More than ${feet(maxSpacing)} ft to the next braced wall line, with no inside wall to brace between them.`]);
    }

    lines.forEach((ln, i) => {
      // Spacing to the nearest other line on each side (lines at the same spot, split by a gap, don't count).
      const prev = Math.min(Infinity, ...lines.filter((o) => o.pos < ln.pos - 1).map((o) => ln.pos - o.pos));
      const next = Math.min(Infinity, ...lines.filter((o) => o.pos > ln.pos + 1).map((o) => o.pos - ln.pos));
      void i;
      const spacingFt = feet(Math.max(Number.isFinite(prev) ? prev : 0, Number.isFinite(next) ? next : 0, 120));
      const midPt = pt(axis, (ln.s0 + ln.s1) / 2, ln.pos);
      // Floors above, measured just inside the middle of the line's longest wall.
      const longest = [...ln.pieces].sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b))[0];
      const inner = longest ? lerp(longest.a, longest.b, 0.5) : midPt;
      const above = Math.max(input.above(nudge(inner, cross, ln.pos, 18)), input.above(nudge(inner, cross, ln.pos, -18)));
      const location: StoryLocation = above === 0 ? "one-story-or-top" : above === 1 ? "first-of-two" : "first-of-three";
      const method = ln.interior ? "WSP" : "CS-WSP";
      const base = bracingBase(location, spacingFt, method);
      const f = bracingFactors({ exposure: input.exposure, stories: 1 + above, above, eaveToRidgeFt: input.eaveToRidgeIn / 12, wallHeightFt: wallFt, lines: lines.length });
      const requiredFt = base !== null && f ? Math.round(base * f.total * 10) / 10 : null;

      // Full-height wall between the openings, long enough to count.
      const panels: BracePanel[] = [];
      const lineSolids = solids.filter((s) => ln.pieces.includes(s.piece));
      for (const s of lineSolids) {
        const L = dist(s.a, s.b);
        const next = adjacent(s, geos);
        const tallest = Math.max(0, ...next.map((g) => openingSpan(g, input.ceilingIn).top - openingSpan(g, input.ceilingIn).bottom));
        const garage = next.some((g) => g.opening.style.startsWith("garage"));
        const min = ln.interior ? wspPanelMin(wallFt) : tallest > 0 ? csPanelMin(tallest, wallFt) : csPanelMin(0, wallFt);
        if (min !== null && L >= min - 0.25) panels.push({ a: s.a, b: s.b, lengthIn: L, kind: ln.interior ? "WSP" : "CS-WSP" });
        else if (garage && !ln.interior && L >= portalMin(above) - 0.25) panels.push({ a: s.a, b: s.b, lengthIn: L, kind: "CS-PF" });
      }
      const providedFt = feet(panels.reduce((t, p) => t + p.lengthIn, 0));
      const probs = [...(problems.get(ln) ?? [])];
      if (requiredFt === null) probs.push("Past the IRC bracing table (wall height, roof height or line spacing). An engineer must design the bracing.");
      else if (providedFt + 0.05 < requiredFt) probs.push(`Needs ${requiredFt} ft of braced wall and has ${providedFt} ft.`);
      // First panel near each end, and no long gaps between panels.
      const ends = panels.flatMap((p) => [along(p.a, axis), along(p.b, axis)]).sort((p, q) => p - q);
      const fromEnd = codeNum("struct.panelFromEnd") * 12;
      if (!panels.length) probs.push("No braced panels on this line.");
      else {
        if (ends[0] - ln.s0 > fromEnd + 1 || ln.s1 - ends[ends.length - 1] > fromEnd + 1) probs.push(`The first braced panel must start within ${feet(fromEnd)} ft of each end of the line.`);
        const spans = panels.map((p) => [Math.min(along(p.a, axis), along(p.b, axis)), Math.max(along(p.a, axis), along(p.b, axis))] as [number, number]).sort((p, q) => p[0] - q[0]);
        for (let k = 0; k + 1 < spans.length; k++) if (spans[k + 1][0] - spans[k][1] > gapMax + 1) probs.push(`More than ${feet(gapMax)} ft between braced panels.`);
      }
      out.push({
        levelId: input.level.id,
        label: "",
        axis,
        pos: ln.pos,
        a: pt(axis, ln.s0, ln.pos),
        b: pt(axis, ln.s1, ln.pos),
        interior: ln.interior,
        spacingFt,
        location,
        requiredFt,
        providedFt,
        panels,
        problems: [...new Set(probs)],
      });
    });
  }
  // Number the lines: east-west lines (along x) north to south as 1, 2, 3; north-south lines west to east as A, B, C.
  const ew = out.filter((l) => l.axis === "x").sort((a, b) => a.pos - b.pos);
  const ns = out.filter((l) => l.axis === "y").sort((a, b) => a.pos - b.pos);
  ew.forEach((l, i) => (l.label = String(i + 1)));
  ns.forEach((l, i) => (l.label = String.fromCharCode(65 + (i % 26))));
  return out;
}

function posOf(p: WallPiece, cross: Axis): number {
  return (along(p.a, cross) + along(p.b, cross)) / 2;
}

function nudge(p: Point, cross: Axis, linePos: number, d: number): Point {
  // Move across the line toward the inside of the house; `d` picks the side.
  return cross === "x" ? { x: linePos + d, y: p.y } : { x: p.x, y: linePos + d };
}

/** Openings at either end of a solid stretch of wall. */
function adjacent(s: SolidWall, geos: ReturnType<typeof openingGeometries>) {
  return geos.filter((g) => [g.a, g.b].some((e) => Math.min(dist(e, s.a), dist(e, s.b)) < Math.max(3, s.thicknessIn)));
}
