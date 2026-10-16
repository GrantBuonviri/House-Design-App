import { ceilingFor } from "@/lib/plan/basics";
import { polygonsOverlap } from "@/lib/plan/geometry";
import { stackedHeadroom, stairsDrawing } from "@/lib/plan/stairs";
import { formatFeetInches } from "@/lib/model/units";
import type { HouseFacts } from "@/lib/plans/house";
import { structureOf } from "@/lib/structure";
import { LUMBER_NAME } from "@/lib/structure/tables";
import type { RuleResult } from "./rules";

/**
 * The structural checks: floors, headers, footings and wall bracing, sized
 * from the IRC's ready-made tables. Anything past those tables is listed as
 * "Engineer required" (a manual check, not a failure); bracing that falls
 * short of what the table asks is a failure with a fix.
 */

const ENGINEER = "Engineer required: ";
const levelName = (h: HouseFacts, id: string) => h.levels.find((l) => l.id === id)?.name ?? "This floor";

export function floorFramingChecks(h: HouseFacts): RuleResult[] {
  const s = structureOf(h.project);
  const lumber = LUMBER_NAME[h.project.plans.structure.lumber];
  return s.floors.flatMap((f): RuleResult[] => {
    const name = levelName(h, f.levelId);
    if (f.engineer.length) return f.engineer.map((e) => ({ status: "manual", text: `${ENGINEER}${e.text}`, levelId: e.levelId, at: e.at, stage: "plan" }));
    if (!f.joist) return [];
    const girders = f.girders.length ? `, ${f.girders.length} girder${f.girders.length === 1 ? "" : "s"} from Table R602.7(2)` : "";
    return [{ status: "pass", text: `${name}: ${f.joist.size} ${lumber} joists at ${f.joist.spacing}" on center, longest span ${formatFeetInches(f.maxSpanIn)} (S-${201 + s.floors.indexOf(f)})${girders}.`, levelId: f.levelId }];
  });
}

export function headerChecks(h: HouseFacts): RuleResult[] {
  const s = structureOf(h.project);
  const out: RuleResult[] = [];
  const sized = s.headers.filter((x) => x.pick);
  for (const x of s.headers)
    if (x.bearing && !x.pick) out.push({ status: "manual", text: `${ENGINEER}${h.tags.get(x.openingId) ?? "An opening"} (${levelName(h, x.levelId).toLowerCase()}, ${formatFeetInches(x.widthIn)} wide) carries more than the IRC header tables cover.`, levelId: x.levelId, at: x.at, stage: "plan" });
  if (sized.length) out.push({ status: "pass", text: `${sized.length} header${sized.length === 1 ? "" : "s"} sized in the header schedule (S-001).` });
  return out;
}

export function footingChecks(h: HouseFacts): RuleResult[] {
  const s = structureOf(h.project);
  const fd = s.foundation;
  if (!fd) return [];
  const out: RuleResult[] = fd.engineer.map((e) => ({ status: "manual", text: `${ENGINEER}${e.text}`, levelId: e.levelId, at: e.at }));
  const widths = [...new Set(fd.lines.flatMap((l) => (l.footing ? [l.footing.widthIn] : [])))].sort((a, b) => a - b);
  if (widths.length) out.push({ status: "pass", text: `Footings ${widths.map((w) => `${w}"`).join(", ")} wide from Idaho's footing table, for ${h.project.plans.structure.soilPsf.toLocaleString()} psf soil (S-101).` });
  return out;
}

export function bracingChecks(h: HouseFacts): RuleResult[] {
  const s = structureOf(h.project);
  const out: RuleResult[] = [];
  const byLevel = new Map<string, number>();
  for (const b of s.bracing) {
    const name = levelName(h, b.levelId);
    if (b.requiredFt === null) {
      out.push({ status: "manual", text: `${ENGINEER}${name}, braced wall line ${b.label}: past the IRC bracing table (wall height, roof height or line spacing).`, levelId: b.levelId, at: b.a, stage: "plan" });
      continue;
    }
    if (b.problems.length) {
      out.push({
        status: "fail",
        text: `${name}, braced wall line ${b.label}: ${b.problems.join(" ")}`,
        fix: "Leave more full-height wall between the windows and doors on that wall (make them narrower or move them), especially near the ends, or add an inside wall to brace.",
        levelId: b.levelId,
        at: b.a,
        stage: "plan",
      });
      continue;
    }
    byLevel.set(b.levelId, (byLevel.get(b.levelId) ?? 0) + 1);
  }
  for (const [levelId, n] of byLevel) out.push({ status: "pass", text: `${levelName(h, levelId)}: ${n} braced wall line${n === 1 ? "" : "s"} have enough braced wall.`, levelId });
  return out;
}

/** Headroom over each flight: open stairwell above unless another flight sits over it. */
export function headroomChecks(h: HouseFacts, minIn: number): RuleResult[] {
  const out: RuleResult[] = [];
  for (const level of h.drawn) {
    for (const st of h.plan(level.id).stairs) {
      const rise = h.riseFor(st, level);
      const d = stairsDrawing(st, rise);
      const above = h.levels.filter((l) => h.levels.indexOf(l) > h.levels.indexOf(level));
      const to = h.levels.find((l) => l.id === st.toLevelId);
      // Stairs on the floor they climb to, stacked over them: headroom up to that flight's underside.
      const stacked = to ? h.plan(to.id).stairs.map((s2) => ({ l: to, room: stackedHeadroom(st, rise, s2, h.riseFor(s2, to)) })).filter((x) => x.room < Infinity) : [];
      if (stacked.length) {
        const low = stacked.reduce((a, b) => (b.room < a.room ? b : a));
        out.push(
          low.room >= minIn
            ? { status: "pass", text: `${level.name} stairs run under the ${low.l.name.toLowerCase()} stairs with about ${formatFeetInches(Math.round(low.room))} of headroom.`, levelId: level.id }
            : { status: "fail", text: `${level.name} stairs run under the ${low.l.name.toLowerCase()} stairs with about ${formatFeetInches(Math.max(0, Math.round(low.room)))} of headroom.`, fix: "Make both U-shaped stairs turned the same way (Things to check on the floor plan does it).", levelId: level.id, stage: "plan" },
        );
        continue;
      }
      const over = above.flatMap((l) => h.plan(l.id).stairs.map((s2) => ({ l, fp: stairsDrawing(s2, h.riseFor(s2, l)).footprint }))).find((x) => polygonsOverlap(d.footprint, x.fp));
      if (over) {
        out.push({ status: "manual", text: `${level.name} stairs run under the ${over.l.name.toLowerCase()} stairs. Check the headroom under the upper flight on the stair section (A-501).`, levelId: level.id });
        continue;
      }
      const clear = rise + (to ? ceilingFor(h.basics, to) : 96) - d.riserIn;
      out.push(
        clear >= minIn
          ? { status: "pass", text: `${level.name} stairs: the floor above is open over the whole flight, about ${formatFeetInches(clear)} of headroom at the lowest step.`, levelId: level.id }
          : { status: "fail", text: `${level.name} stairs: about ${formatFeetInches(clear)} of headroom.`, fix: "Raise the ceiling over the stairs.", levelId: level.id, stage: "plan" },
      );
    }
  }
  return out;
}
