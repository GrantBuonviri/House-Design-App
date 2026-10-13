import type { DesignBrief, FollowUp } from "@/lib/model/schema";
import { runStructured, type StructuredRequest } from "@/lib/ai/run";
import { AiBrief, AiFollowUps, briefFromAi, briefToAiShape, followUpsFromAi } from "./ai";
import { describeAnswers, describeHousehold, describePlot } from "./describe";
import { ruleFollowUps } from "./followups";
import { buildRuleBrief, type BriefContext } from "./rules";

/**
 * The server side of the "Rooms & vibe" stage: Claude when a key is set,
 * the built-in rules otherwise or when Claude can't help.
 */

export type Source = "ai" | "rules";
type Options = { fresh?: boolean; client?: StructuredRequest<never>["client"] };

const FOLLOW_UP_SYSTEM = `You are a friendly residential architect in Boise, Idaho, interviewing a client about the new house they want to build. You have their answers to a questionnaire and a description of their land.

Ask up to 4 short follow-up questions whose answers would most change the design: gaps, things that pull against each other, or what the land suggests (slope, sun, views, the road side). Never ask about something they already answered. Use plain words a first-time home builder understands. When a question has obvious answers, give 2 to 4 short quick answers; otherwise give none.`;

const BRIEF_SYSTEM = `You are an experienced residential architect in Boise, Idaho. You turn a client's interview into a design brief for a new house.

A draft brief made by simple rules is included. Keep what fits and fix what doesn't. Use the client's own words (their typical day, notes and follow-up answers) to adjust rooms, sizes, notes and priorities.

Guidelines:
- Sizes are realistic targets in square feet for a 2026 new build in Boise.
- Every room's level must exist: "basement" only if basement is true, "upper" only if floors is 2 or more, "upper-2" only if floors is 3.
- Adjacency names must match room names exactly. "must" means the rooms share a wall or opening, "nice" means close by, "avoid" means keep them apart.
- Use the land: living spaces toward the sunny side, entry and garage toward the road, a walkout on the downhill side, views toward water.
- Room notes are short and specific. Vibe words are short. List 3 to 8 priorities, most important first.
- The summary is two or three plain sentences a first-time home builder would enjoy reading.`;

function interview(ctx: BriefContext): string {
  const answered = ctx.followUps.filter((f) => f.answer.trim());
  return [
    `Household:\n${describeHousehold(ctx.profile)}`,
    `Questionnaire answers:\n${describeAnswers(ctx)}`,
    answered.length ? `Follow-up answers:\n${answered.map((f) => `Q: ${f.question}\nA: ${f.answer.trim()}`).join("\n")}` : "",
    `The land:\n${describePlot(ctx.plot)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function suggestFollowUps(
  ctx: Omit<BriefContext, "followUps">,
  opts: Options = {},
): Promise<{ followUps: FollowUp[]; source: Source; note?: string }> {
  const result = await runStructured({
    task: "follow-up questions",
    tier: "fast",
    effort: "low",
    system: FOLLOW_UP_SYSTEM,
    prompt: interview({ ...ctx, followUps: [] }),
    schema: AiFollowUps,
    maxTokens: 4000,
    ...opts,
  });
  if (result.ok) {
    const followUps = followUpsFromAi(result.data);
    if (followUps.length) return { followUps, source: "ai" };
  }
  return {
    followUps: ruleFollowUps(ctx),
    source: "rules",
    note: result.ok ? "Claude had no follow-up questions, so here are a few built-in ones." : result.message,
  };
}

export async function generateBrief(
  ctx: BriefContext,
  opts: Options = {},
): Promise<{ brief: DesignBrief; source: Source; note?: string }> {
  const draft = buildRuleBrief(ctx);
  const result = await runStructured({
    task: "design brief",
    tier: "fast",
    effort: "medium",
    system: BRIEF_SYSTEM,
    prompt: `${interview(ctx)}\n\nDraft brief from the rules (JSON):\n${JSON.stringify(briefToAiShape(draft))}`,
    schema: AiBrief,
    maxTokens: 16000,
    ...opts,
  });
  if (!result.ok) return { brief: draft, source: "rules", note: result.message };
  const brief = briefFromAi(result.data, draft);
  if (brief.source !== "ai") {
    return { brief, source: "rules", note: "Claude's brief was missing key rooms, so this one comes from the built-in rules." };
  }
  return { brief, source: "ai" };
}
