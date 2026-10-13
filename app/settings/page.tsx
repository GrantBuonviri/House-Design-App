import { readSpend } from "@/lib/ai/store";
import { MODELS, MODEL_LABEL, PRICES } from "@/lib/ai/models";
import ResetSpend from "@/components/settings/ResetSpend";

// Read the environment on every request so a newly added key shows up after a restart.
export const dynamic = "force-dynamic";

function usd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "under 1¢";
  return `$${n.toFixed(2)}`;
}

export default async function SettingsPage() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const spend = await readSpend();
  const tasks = Object.entries(spend.byTask).sort((a, b) => b[1].usd - a[1].usd);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="card space-y-3 p-6">
        <h2 className="font-medium">Claude API key</h2>
        {hasKey ? (
          <p className="text-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-accent" />
            A key is set. AI features will use your Anthropic account.
          </p>
        ) : (
          <p className="text-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-stone-400" />
            No key set. The app works without one, using simpler built-in suggestions.
          </p>
        )}
        <p className="text-xs text-muted">
          To add a key, put it in the <code>.env.local</code> file in the app folder (see the README),
          then stop and restart the app. The key never leaves your computer&apos;s server process.
        </p>
      </section>

      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">AI spending</h2>
          <ResetSpend />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted">Spent so far</p>
            <p className="text-2xl font-semibold tabular-nums">{usd(spend.totalUsd)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Calls to Claude</p>
            <p className="text-2xl font-semibold tabular-nums">{spend.calls}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Answers reused for free</p>
            <p className="text-2xl font-semibold tabular-nums">{spend.cacheHits}</p>
          </div>
        </div>
        {tasks.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-1 font-normal">What for</th>
                <th className="pb-1 font-normal">Calls</th>
                <th className="pb-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(([task, t]) => (
                <tr key={task} className="border-t border-line">
                  <td className="py-1.5">{task.charAt(0).toUpperCase() + task.slice(1)}</td>
                  <td className="py-1.5 tabular-nums">{t.calls}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(t.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted">
          Counted since {new Date(spend.since).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
          Estimated from token counts and list prices; your Anthropic console has the exact bill.
        </p>
      </section>

      <section className="card space-y-2 p-6">
        <h2 className="font-medium">Models</h2>
        <ul className="space-y-1 text-sm">
          <li>
            Questions and the brief: <strong>{MODEL_LABEL[MODELS.fast]}</strong>{" "}
            <span className="text-muted">
              ({usd(PRICES[MODELS.fast].input)} in / {usd(PRICES[MODELS.fast].output)} out per million tokens)
            </span>
          </li>
          <li>
            Floor plans and alternatives (later milestones): <strong>{MODEL_LABEL[MODELS.best]}</strong>{" "}
            <span className="text-muted">
              ({usd(PRICES[MODELS.best].input)} in / {usd(PRICES[MODELS.best].output)} out per million tokens)
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}
