import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODELS, costUsd, type ModelTier } from "./models";
import { cacheGet, cacheKey, cacheSet, recordCacheHit, recordSpend } from "./store";

/**
 * Calls Claude for one structured answer. Server-side only: the API key is
 * read from the environment and never sent to the browser.
 */

export type AiFailure = "no-key" | "auth" | "rate-limit" | "network" | "refused" | "bad-output" | "error";

export type AiResult<T> =
  | { ok: true; data: T; cached: boolean; model: string }
  | { ok: false; reason: AiFailure; message: string };

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

type MessagesClient = Pick<Anthropic["messages"], "create">;

export type StructuredRequest<S extends z.ZodType> = {
  /** A short name for the spend tally, like "brief". */
  task: string;
  tier: ModelTier;
  effort: "low" | "medium" | "high";
  system: string;
  prompt: string;
  schema: S;
  maxTokens: number;
  /** Skip the saved answer and ask again. */
  fresh?: boolean;
  /** For tests: a stand-in for the API client. */
  client?: MessagesClient;
};

const FALLBACK = "Using the built-in suggestions instead.";

export async function runStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<AiResult<z.infer<S>>> {
  if (!req.client && !hasApiKey()) {
    return { ok: false, reason: "no-key", message: "No API key is set, so this comes from the built-in suggestions." };
  }
  const model = MODELS[req.tier];
  const schema = zodOutputFormat(req.schema).schema;
  const key = cacheKey({ model, effort: req.effort, system: req.system, prompt: req.prompt, schema });

  if (!req.fresh) {
    const hit = await cacheGet(key);
    const parsed = hit ? req.schema.safeParse(hit.data) : null;
    if (parsed?.success) {
      await recordCacheHit();
      return { ok: true, data: parsed.data, cached: true, model };
    }
  }

  const client = req.client ?? new Anthropic().messages;
  let message: Anthropic.Message;
  try {
    message = await client.create({
      model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: req.effort, format: { type: "json_schema", schema } },
    });
  } catch (err) {
    return { ok: false, ...describeError(err) };
  }

  const usage = message.usage;
  await recordSpend(req.task, model, costUsd(model, usage), usage.input_tokens, usage.output_tokens);

  if (message.stop_reason === "refusal") {
    return { ok: false, reason: "refused", message: `Claude declined this request. ${FALLBACK}` };
  }
  if (message.stop_reason === "max_tokens") {
    return { ok: false, reason: "bad-output", message: `Claude's answer was cut off. ${FALLBACK}` };
  }
  const text = message.content.find((b) => b.type === "text");
  let json: unknown;
  try {
    json = JSON.parse(text?.type === "text" ? text.text : "");
  } catch {
    return { ok: false, reason: "bad-output", message: `Claude's answer wasn't readable. ${FALLBACK}` };
  }
  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "bad-output", message: `Claude's answer didn't match what the app expects. ${FALLBACK}` };
  }
  await cacheSet(key, req.task, parsed.data);
  return { ok: true, data: parsed.data, cached: false, model };
}

function describeError(err: unknown): { reason: AiFailure; message: string } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { reason: "auth", message: `Claude didn't accept the API key in .env.local. ${FALLBACK}` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { reason: "rate-limit", message: `Claude is busy right now (rate limit). ${FALLBACK}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { reason: "network", message: `Couldn't reach Claude. Check your internet connection. ${FALLBACK}` };
  }
  if (err instanceof Anthropic.APIError) {
    // 400s here are usually about the account, like a low credit balance; the API's message says which.
    const detail = typeof err.message === "string" ? err.message.replace(/^\d+\s*/, "").slice(0, 200) : "";
    return { reason: "error", message: `Claude returned an error${detail ? `: ${detail}` : ""}. ${FALLBACK}` };
  }
  return { reason: "error", message: `Something went wrong calling Claude. ${FALLBACK}` };
}
