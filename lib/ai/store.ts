import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Small files the server keeps next to the app (in .app-data, which git
 * ignores): saved Claude answers, so the same question never costs twice,
 * and the running tally of API spend.
 */

function dataDir(): string {
  return process.env.APP_DATA_DIR || path.join(process.cwd(), ".app-data");
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

type CacheEntry = { savedAt: string; task: string; data: unknown };

export async function cacheGet(key: string): Promise<CacheEntry | null> {
  return readJson<CacheEntry | null>(path.join(dataDir(), "ai-cache", `${key}.json`), null);
}

export async function cacheSet(key: string, task: string, data: unknown) {
  const entry: CacheEntry = { savedAt: new Date().toISOString(), task, data };
  await writeJson(path.join(dataDir(), "ai-cache", `${key}.json`), entry);
}

export type SpendTally = {
  since: string;
  totalUsd: number;
  calls: number;
  cacheHits: number;
  lastCallAt?: string;
  byTask: Record<string, { calls: number; usd: number }>;
  byModel: Record<string, { calls: number; usd: number; inputTokens: number; outputTokens: number }>;
};

function emptyTally(): SpendTally {
  return { since: new Date().toISOString(), totalUsd: 0, calls: 0, cacheHits: 0, byTask: {}, byModel: {} };
}

const spendFile = () => path.join(dataDir(), "ai-spend.json");

export async function readSpend(): Promise<SpendTally> {
  return { ...emptyTally(), ...(await readJson<Partial<SpendTally>>(spendFile(), {})) };
}

// Writes are queued so two calls finishing together don't lose an update.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export function recordSpend(task: string, model: string, usd: number, inputTokens: number, outputTokens: number) {
  return serial(async () => {
    const t = await readSpend();
    t.totalUsd += usd;
    t.calls += 1;
    t.lastCallAt = new Date().toISOString();
    const bt = (t.byTask[task] ??= { calls: 0, usd: 0 });
    bt.calls += 1;
    bt.usd += usd;
    const bm = (t.byModel[model] ??= { calls: 0, usd: 0, inputTokens: 0, outputTokens: 0 });
    bm.calls += 1;
    bm.usd += usd;
    bm.inputTokens += inputTokens;
    bm.outputTokens += outputTokens;
    await writeJson(spendFile(), t);
  });
}

export function recordCacheHit() {
  return serial(async () => {
    const t = await readSpend();
    t.cacheHits += 1;
    await writeJson(spendFile(), t);
  });
}

export function resetSpend() {
  return serial(() => writeJson(spendFile(), emptyTally()));
}
