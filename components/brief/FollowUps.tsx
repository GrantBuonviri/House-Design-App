"use client";

import type { FollowUp } from "@/lib/model/schema";

export function SourceBadge({ source }: { source: "ai" | "rules" | undefined }) {
  if (!source) return null;
  return source === "ai" ? (
    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">Written by Claude</span>
  ) : (
    <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">Built-in suggestions</span>
  );
}

export function Note({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{text}</p>;
}

export function Working({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {text}
    </div>
  );
}

/** A few extra questions picked for this house, each with quick answers. */
export default function FollowUps({
  followUps,
  onChange,
}: {
  followUps: FollowUp[];
  onChange: (id: string, answer: string) => void;
}) {
  return (
    <ol className="space-y-6">
      {followUps.map((f, i) => (
        <li key={f.id}>
          <label className="field-label" htmlFor={`fu-${f.id}`}>
            {i + 1}. {f.question}
          </label>
          {f.why && <p className="-mt-0.5 mb-2 text-xs text-muted">{f.why}</p>}
          {f.options.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {f.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={f.answer === o}
                  onClick={() => onChange(f.id, f.answer === o ? "" : o)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    f.answer === o ? "border-accent bg-accent text-white" : "border-line bg-white hover:border-accent"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <input
            id={`fu-${f.id}`}
            className="input"
            maxLength={500}
            placeholder={f.options.length ? "Or write your own answer" : "Your answer"}
            value={f.options.includes(f.answer) ? "" : f.answer}
            onChange={(e) => onChange(f.id, e.target.value)}
          />
        </li>
      ))}
    </ol>
  );
}
