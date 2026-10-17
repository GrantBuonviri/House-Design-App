import { planWarnings, type PlanWarning } from "./checks";
import type { Plans } from "./edit";

/**
 * Re-checking after a one-click fix, Suggest a plan or an alternative. The
 * change is always kept (Undo is the way back); this says what it broke.
 * `planWarnings` already holds the code checks the floor plan can see
 * (escape windows, hallway width, the smallest rooms), so the floor plan
 * and the PDF's code check agree.
 */

export type Recheck = {
  /** Warnings in `after` that weren't in `before`, matched by id. */
  added: PlanWarning[];
  /** One line for the note or toast, or null when nothing new came up: "1 new thing to check: Bed 2 has no door." */
  summary: string | null;
};

type Ctx = Parameters<typeof planWarnings>[1];

/** How many new warnings the summary spells out before "and N more". */
const SHOW = 3;

export function recheck(before: Plans, after: Plans, ctx: Ctx): Recheck {
  const had = new Set(planWarnings(before, ctx).map((w) => w.id));
  const added = planWarnings(after, ctx).filter((w) => !had.has(w.id));
  return { added, summary: newSummary(added) };
}

/** "2 new things to check: Bed 2 has no door. Office is 6' across at the narrowest." */
export function newSummary(added: PlanWarning[]): string | null {
  if (!added.length) return null;
  const head = `${added.length} new ${added.length === 1 ? "thing" : "things"} to check: `;
  const shown = added.slice(0, SHOW).map((w) => w.text.replace(/\.?$/, "."));
  const more = added.length > SHOW ? ` And ${added.length - SHOW} more in Things to check.` : "";
  return head + shown.join(" ") + more;
}

/** A fix's message with what's new: "Closed the gap. 1 new thing to check: … Undo puts it back." */
export function fixMessage(done: string, r: Recheck): string {
  return r.summary ? `${done} ${r.summary} Undo puts it back.` : `${done} Undo puts it back.`;
}
