import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { costUsd, MODELS } from "@/lib/ai/models";
import { runStructured } from "@/lib/ai/run";
import { readSpend } from "@/lib/ai/store";
import { generateBrief } from "@/lib/brief/service";
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
  const rooms = [
    { id: "k", type: "kitchen", name: "Kitchen", description: "" },
    { id: "b", type: "bedroom", name: "Guest room", description: "Quiet", lengthIn: 144, widthIn: 132 },
    { id: "w", type: "bathroom", name: "Bathroom", description: "" },
  ];
  const ctx = {
    answers: DiscoveryAnswers.parse({ rooms, floorsAbove: 2 }),
    profile: { mustHaves: [], dislikes: [] },
    plot: flat,
  };

  it("uses the built-in rules without a key", async () => {
    const b = await generateBrief(ctx);
    expect(b.source).toBe("rules");
    expect(b.note).toMatch(/No API key/);
    expect(b.brief.rooms.map((r) => r.id)).toEqual(["k", "b", "w"]);
  });

  it("doesn't call Claude before any rooms are picked", async () => {
    const client = fakeClient();
    const b = await generateBrief({ ...ctx, answers: DiscoveryAnswers.parse({}) }, { client });
    expect(b.source).toBe("rules");
    expect(client.create).not.toHaveBeenCalled();
  });

  it("sends the rooms by id and merges Claude's answer", async () => {
    const answer = {
      summary: "From Claude.",
      rooms: [
        { id: "k", sqft: 260, level: "floor-1", notes: "Island facing the view" },
        { id: "b", sqft: 400, level: "floor-1", notes: "" },
        { id: "w", sqft: 60, level: "floor-2", notes: "" },
      ],
      connections: [{ a: "b", b: "w", strength: "nice" }],
      openKitchen: true,
      vibe: ["Calm"],
      priorities: ["Quiet guest room"],
      accessibility: [],
    };
    const client = fakeClient(fakeMessage(JSON.stringify(answer)));
    const b = await generateBrief(ctx, { client });
    expect(b.source).toBe("ai");
    expect(b.brief.summary).toBe("From Claude.");
    expect(b.brief.rooms.map((r) => [r.id, r.name, r.targetSqFt, r.levelId])).toEqual([
      ["k", "Kitchen", 260, "floor-1"],
      ["b", "Guest room", 132, "floor-1"],
      ["w", "Bathroom", 60, "floor-2"],
    ]);
    expect(b.brief.adjacencies).toContainEqual({ a: "b", b: "w", strength: "nice" });

    const sent = client.create.mock.calls[0] as unknown as [Anthropic.MessageCreateParams];
    const prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain('\\"id\\":\\"b\\"');
    expect(prompt).toContain("Guest room");
    expect(sent[0].model).toBe(MODELS.fast);
  });
});
