/**
 * Which Claude models the app uses, and what they cost. A cheap, fast model
 * handles simple steps (questions, the brief); the most capable one is saved
 * for floor plans and alternatives in later milestones.
 */
export const MODELS = {
  fast: "claude-haiku-5-5",
  best: "claude-opus-5-5",
} as const;
export type ModelTier = keyof typeof MODELS;

export const MODEL_LABEL: Record<string, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
};

/**
 * US dollars per million tokens, from Anthropic's price list (checked
 * October 2026). Haiku's price applies to prompts under 100K tokens, which
 * covers everything this app sends.
 */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** What one API call cost, in dollars. Output includes Claude's thinking. */
export function costUsd(model: string, usage: TokenUsage): number {
  const p = PRICES[model] ?? PRICES[MODELS.best];
  const perToken = (n: number | null | undefined, rate: number) => ((n ?? 0) * rate) / 1_000_000;
  return (
    perToken(usage.input_tokens, p.input) +
    perToken(usage.cache_creation_input_tokens, p.input * 1.25) +
    perToken(usage.cache_read_input_tokens, p.cacheRead) +
    perToken(usage.output_tokens, p.output)
  );
}
