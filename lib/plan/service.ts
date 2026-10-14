import { runStructured, type StructuredRequest } from "@/lib/ai/run";
import { AiPlanAlternatives, PLAN_ALTERNATIVES_SYSTEM, changesFrom, planAlternativesPrompt } from "./ai";
import { pickDistinct, ruleAlternatives, tryIdea, type PlanAlternative } from "./alternatives";
import type { Plans } from "./edit";
import type { PlanContext } from "./fromSketch";

/**
 * The server side of the floor plan's "Show me alternatives": Claude's ideas
 * when a key is set, the built-in ones otherwise or when Claude can't help.
 * Either way, code makes the changes and checks them.
 */

export type Source = "ai" | "rules";
type Options = {
  fresh?: boolean;
  /** Titles already shown, to try different ideas first. */
  skip?: string[];
  client?: StructuredRequest<never>["client"];
};

export async function suggestPlanAlternatives(plans: Plans, ctx: PlanContext, opts: Options = {}): Promise<{ alternatives: PlanAlternative[]; source: Source; note?: string }> {
  const seen = new Set((opts.skip ?? []).map((t) => t.toLowerCase()));
  // Ideas not shown yet come first; shown ones only fill in.
  const fresh = (list: PlanAlternative[]) => [...list.filter((a) => !seen.has(a.title.toLowerCase())), ...list.filter((a) => seen.has(a.title.toLowerCase()))];
  const rules = () => fresh(ruleAlternatives(plans, ctx));
  if (!Object.values(plans).some((p) => p.rooms.length > 0)) {
    return { alternatives: [], source: "rules", note: "Draw some rooms first." };
  }
  const result = await runStructured({
    task: "floor plan alternatives",
    tier: "best",
    effort: "medium",
    system: PLAN_ALTERNATIVES_SYSTEM,
    prompt: planAlternativesPrompt(plans, ctx, opts.skip),
    schema: AiPlanAlternatives,
    maxTokens: 16000,
    fresh: opts.fresh,
    client: opts.client,
  });
  if (!result.ok) return { alternatives: pickDistinct(plans, rules()), source: "rules", note: result.message };

  const fromClaude: PlanAlternative[] = [];
  for (const alt of result.data.alternatives) {
    const made = tryIdea(plans, { title: alt.title.trim() || "Another idea", why: alt.why.trim(), changes: changesFrom(alt.changes) }, ctx);
    if (made) fromClaude.push(made);
  }
  // Claude's ideas first, filled out with built-in ones, skipping any that would look the same.
  const picked = pickDistinct(plans, [...fresh(fromClaude), ...rules()], 3);
  if (!picked.some((a) => fromClaude.includes(a))) {
    return { alternatives: picked, source: "rules", note: "Claude's changes didn't fit this plan, so these come from the built-in suggestions." };
  }
  return { alternatives: picked, source: "ai" };
}
