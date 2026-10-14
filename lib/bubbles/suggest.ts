import { suggestDiagrams, type Diagrams, type SketchContext } from "./arrange";
import { ruleAlternatives, type Alternative } from "./alternatives";
import { cleanDiagrams } from "./edit";

/**
 * The flow sketch's suggestions, made by the app's own rules. Each is one
 * function with a plain input and output, so a smarter version can take its
 * place later without changing the page. Either way, code draws the bubbles
 * and checks them.
 */

/** The starting sketch: every room in the brief, placed by the land and the brief's connections. */
export function suggestSketch(ctx: SketchContext, current: Diagrams = {}): { diagrams: Diagrams; note?: string } {
  const diagrams = cleanDiagrams(suggestDiagrams(ctx, undefined, undefined, current));
  return ctx.brief.rooms.length === 0 ? { diagrams, note: "Your brief has no rooms yet." } : { diagrams };
}

/** "Show me alternatives": three variations on the sketch. Titles in `skip` were shown already, so others come first. */
export function suggestAlternatives(ctx: SketchContext, current: Diagrams, skip: string[] = []): { alternatives: Alternative[]; note?: string } {
  if (!Object.values(current).some((d) => d.bubbles.length > 0)) {
    return { alternatives: [], note: "Draw or suggest a sketch first." };
  }
  return { alternatives: ruleAlternatives(ctx, current, skip).map((a) => ({ ...a, diagrams: cleanDiagrams(a.diagrams) })) };
}
