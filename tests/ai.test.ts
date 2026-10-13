import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { costUsd, MODELS } from "@/lib/ai/models";
import { runStructured } from "@/lib/ai/run";
import { readSpend } from "@/lib/ai/store";
import { generateBrief, suggestFollowUps } from "@/lib/brief/service";
import { briefToAiShape } from "@/lib/brief/ai";
import { buildRuleBrief } from "@/lib/brief/rules";
import { DiscoveryAnswers } from "@/lib/model/schema";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";

const Answer = z.object({ word: z.string() });

function fakeMessage(text: string, stop: Anthropic.Message["stop_reason"] = "end_turn"): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: MODELS.fast,
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 2000 },
  } as unknown as Anthropic.Message;
}

function fakeClient(...replies: (Anthropic.Message | Error)[]) {
  const create = vi.fn(async () => {
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return r;
  });
  return { create } as unknown as Pick<Anthropic["messages"], "create"> & { create: typeof create };
}

const base = { task: "test", tier: "fast" as const, effort: "low" as const, system: "s", schema: Answer, maxTokens: 100 };

beforeEach(() => {
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), "house-ai-"));
  delete process.env.ANTHROPIC_API_KEY;
});

describe("costs", () => {
  it("prices tokens per million", () => {
    expect(costUsd(MODELS.fast, { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6);
    expect(costUsd(MODELS.best, { input_tokens: 1000, output_tokens: 1000 })).toBeCloseTo(0.024);
  });
});

describe("calling Claude", () => {
  it("does nothing without a key", async () => {
    const r = await runStructured({ ...base, prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-key");
  });

  it("checks the answer, records the cost and reuses saved answers", async () => {
    const client = fakeClient(fakeMessage('{"word":"cozy"}'));
    const first = await runStructured({ ...base, prompt: "same", client });
    expect(first).toMatchObject({ ok: true, data: { word: "cozy" }, cached: false });
    const again = await runStructured({ ...base, prompt: "same", client });
    expect(again).toMatchObject({ ok: true, data: { word: "cozy" }, cached: true });
    expect(client.create).toHaveBeenCalledTimes(1);

    const spend = await readSpend();
    expect(spend.calls).toBe(1);
    expect(spend.cacheHits).toBe(1);
    expect(spend.totalUsd).toBeCloseTo(costUsd(MODELS.fast, { input_tokens: 1000, output_tokens: 2000 }));
    expect(spend.byTask.test.calls).toBe(1);
  });

  it("asks again when told to, even with a saved answer", async () => {
    const client = fakeClient(fakeMessage('{"word":"a"}'), fakeMessage('{"word":"b"}'));
    await runStructured({ ...base, prompt: "p", client });
    const r = await runStructured({ ...base, prompt: "p", client, fresh: true });
    expect(r).toMatchObject({ ok: true, data: { word: "b" } });
  });

  it("rejects answers that don't match the schema, refusals and cut-off answers", async () => {
    const bad = await runStructured({ ...base, prompt: "1", client: fakeClient(fakeMessage('{"nope":1}')) });
    expect(bad).toMatchObject({ ok: false, reason: "bad-output" });
    const refused = await runStructured({ ...base, prompt: "2", client: fakeClient(fakeMessage("", "refusal")) });
    expect(refused).toMatchObject({ ok: false, reason: "refused" });
    const cut = await runStructured({ ...base, prompt: "3", client: fakeClient(fakeMessage('{"wo', "max_tokens")) });
    expect(cut).toMatchObject({ ok: false, reason: "bad-output" });
    // Each of those still cost money and is counted.
    expect((await readSpend()).calls).toBe(3);
  });

  it("turns errors into a friendly message", async () => {
    const r = await runStructured({ ...base, prompt: "x", client: fakeClient(new Error("boom")) });
    expect(r).toMatchObject({ ok: false, reason: "error" });
    if (!r.ok) expect(r.message).toMatch(/built-in suggestions/);
  });
});

describe("the brief service", () => {
  const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });
  const ctx = { answers: DiscoveryAnswers.parse({}), profile: { mustHaves: [], dislikes: [] }, plot: flat, followUps: [] };

  it("uses the built-in rules without a key", async () => {
    const f = await suggestFollowUps(ctx);
    expect(f.source).toBe("rules");
    expect(f.followUps.length).toBeGreaterThan(0);
    const b = await generateBrief(ctx);
    expect(b.source).toBe("rules");
    expect(b.note).toMatch(/No API key/);
  });

  it("uses Claude's brief when it's good", async () => {
    const shape = { ...briefToAiShape(buildRuleBrief(ctx)), summary: "From Claude." };
    const b = await generateBrief(ctx, { client: fakeClient(fakeMessage(JSON.stringify(shape))) });
    expect(b.source).toBe("ai");
    expect(b.brief.summary).toBe("From Claude.");
  });

  it("uses Claude's follow-up questions, at most four", async () => {
    const qs = Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}?`, why: "", options: ["a", "b"] }));
    const f = await suggestFollowUps(ctx, { client: fakeClient(fakeMessage(JSON.stringify({ questions: qs }))) });
    expect(f.source).toBe("ai");
    expect(f.followUps).toHaveLength(4);
    expect(f.followUps[0]).toMatchObject({ id: "ai-1", question: "Q0?", answer: "" });
  });
});
