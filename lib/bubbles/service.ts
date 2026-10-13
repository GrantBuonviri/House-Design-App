import { runStructured, type StructuredRequest } from "@/lib/ai/run";
import { currentSpots, moveToSpots, suggestDiagrams, type Diagrams, type SketchContext } from "./arrange";
import { pickDistinct, ruleAlternatives, type Alternative } from "./alternatives";
import { AiAlternatives, AiSketch, ALTERNATIVES_SYSTEM, SKETCH_SYSTEM, alternativesPrompt, sketchPrompt, spotsFrom } from "./ai";
import { cleanDiagrams } from "./edit";

/**
 * The server side of the flow sketch: Claude when a key is set, the built-in
 * rules otherwise or when Claude can't help. Either way, code draws the
 * bubbles and checks them.
 */

export type Source = "ai" | "rules";
type Options = { fresh?: boolean; client?: StructuredRequest<never>["client"] };

export async function suggestSketch(
  ctx: SketchContext,
  opts: Options = {},
): Promise<{ diagrams: Diagrams; source: Source; idea?: string; note?: string }> {
  if (ctx.brief.rooms.length === 0) {
    return { diagrams: suggestDiagrams(ctx), source: "rules", note: "Your brief has no rooms yet." };
  }
  const result = await runStructured({
    task: "flow sketch",
    tier: "fast",
    effort: "medium",
    system: SKETCH_SYSTEM,
    prompt: sketchPrompt(ctx),
    schema: AiSketch,
    maxTokens: 12000,
    ...opts,
  });
  if (!result.ok) return { diagrams: cleanDiagrams(suggestDiagrams(ctx)), source: "rules", note: result.message };
  const spots = spotsFrom(result.data.rooms, new Set(ctx.brief.rooms.map((r) => r.id)));
  return { diagrams: cleanDiagrams(suggestDiagrams(ctx, spots)), source: "ai", idea: result.data.idea.trim() || undefined };
}

export async function suggestAlternatives(
  ctx: SketchContext,
  current: Diagrams,
  opts: Options = {},
): Promise<{ alternatives: Alternative[]; source: Source; note?: string }> {
  const rules = () => ruleAlternatives(ctx, current).map((a) => ({ ...a, diagrams: cleanDiagrams(a.diagrams) }));
  if (!Object.values(current).some((d) => d.bubbles.length > 0)) {
    return { alternatives: [], source: "rules", note: "Draw or suggest a sketch first." };
  }
  const result = await runStructured({
    task: "flow sketch alternatives",
    tier: "best",
    effort: "medium",
    system: ALTERNATIVES_SYSTEM,
    prompt: alternativesPrompt(ctx, current),
    schema: AiAlternatives,
    maxTokens: 16000,
    ...opts,
  });
  if (!result.ok) return { alternatives: rules(), source: "rules", note: result.message };

  const now = currentSpots(ctx, current);
  const movable = new Set([...now.keys()].filter((id) => !id.startsWith("stairs-")));
  const fromClaude: Alternative[] = [];
  for (const alt of result.data.alternatives) {
    const spots = spotsFrom(alt.moves, movable);
    // An "alternative" that moves nothing isn't one.
    if (![...spots].some(([id, s]) => now.get(id)?.spot !== s)) continue;
    fromClaude.push({
      title: alt.title.trim() || "Another idea",
      why: alt.why.trim(),
      diagrams: cleanDiagrams(moveToSpots(ctx, current, spots, 31 + fromClaude.length)),
    });
  }
  // Claude's ideas first, filled out with built-in ones, skipping any that would look the same.
  const picked = pickDistinct(current, [...fromClaude, ...rules().filter((r) => !fromClaude.some((c) => c.title === r.title))], 3);
  if (!picked.some((a) => fromClaude.includes(a))) {
    return { alternatives: picked, source: "rules", note: "Claude's ideas barely changed the sketch, so these come from the built-in suggestions." };
  }
  return { alternatives: picked, source: "ai" };
}
