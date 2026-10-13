import type { DesignBrief } from "@/lib/model/schema";
import { runStructured, type StructuredRequest } from "@/lib/ai/run";
import { AiBrief, briefFromAi } from "./ai";
import { describePlot, describeRooms } from "./describe";
import { buildRuleBrief, type BriefContext } from "./rules";

/**
 * The server side of the "Rooms" stage: Claude when a key is set, the
 * built-in rules otherwise or when Claude can't help.
 */

export type Source = "ai" | "rules";
type Options = { fresh?: boolean; client?: StructuredRequest<never>["client"] };

const BRIEF_SYSTEM = `You are an experienced residential architect in Boise, Idaho. A client has listed the rooms they want in a new house. You turn that list into a design brief.

The client's rooms are fixed: never add, remove or rename rooms, and return every room by its id. For each room:
- sqft: if sizeFromUser is given, return exactly that. A garage is sized for its number of cars, so return its typicalSqft. Otherwise give a realistic target for a 2026 new build in Boise, guided by typicalSqft, the description and the feel.
- level: if floor is a floor id, return it unchanged. If it is "decide", choose the best floor id from the list given. Use the land: living spaces toward the sunny side, entry and garage on the road level, rooms that suit a walkout (family, guest, gym, media) on a basement that opens downhill. Keep the kitchen, entry and garage on the main floor unless there's a strong reason.
- notes: one short, specific note on what matters for the room, or an empty string if the client's description already covers it.

connections: only extra suggestions between room ids, beyond the client's own (which are kept as they are). "must" means the rooms share a wall or opening, "nice" means close by, "avoid" means keep them apart. Don't repeat the client's pairs.

vibe and priorities come from how they described the feel, plus what the land suggests. List 3 to 8 priorities, most important first. accessibility lists only needs they mentioned.

summary: two or three plain sentences a first-time home builder would enjoy reading. If something essential looks missing (bedrooms but no bathroom, no kitchen), say so plainly in the summary.`;

function prompt(ctx: BriefContext): string {
  return [`The rooms page:\n${describeRooms(ctx)}`, `The land:\n${describePlot(ctx.plot)}`].join("\n\n");
}

export async function generateBrief(
  ctx: BriefContext,
  opts: Options = {},
): Promise<{ brief: DesignBrief; source: Source; note?: string }> {
  const draft = buildRuleBrief(ctx);
  if (draft.rooms.length === 0) return { brief: draft, source: "rules", note: "Pick at least one room first." };
  const result = await runStructured({
    task: "design brief",
    tier: "fast",
    effort: "medium",
    system: BRIEF_SYSTEM,
    prompt: prompt(ctx),
    schema: AiBrief,
    maxTokens: 16000,
    ...opts,
  });
  if (!result.ok) return { brief: draft, source: "rules", note: result.message };
  return { brief: briefFromAi(result.data, draft, ctx.answers.rooms), source: "ai" };
}
