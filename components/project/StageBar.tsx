"use client";

import type { Stage } from "@/lib/model/schema";
import { STAGE_INFO } from "@/lib/stages";

/** `nudges` puts a short reminder on a stage, such as "Pick where you'll build" on step one. */
export default function StageBar({ current, onSelect, nudges = {}, done = {}, next }: { current: Stage; onSelect: (s: Stage) => void; nudges?: Partial<Record<Stage, string>>; done?: Partial<Record<Stage, boolean>>; next?: { stage: Stage; line: string } | null }) {
  return (
    <div>
    <ol className="flex gap-1 overflow-x-auto" data-tour="stages">
      {STAGE_INFO.map((s, i) => {
        const active = s.id === current;
        return (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              data-tour={`stage-${s.id}`}
              className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm whitespace-nowrap ${
                active ? "bg-accent text-white" : "text-ink hover:bg-stone-100"
              }`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-xs ${
                  active ? "bg-white/20" : done[s.id] ? "bg-green-100 text-green-800" : "bg-stone-200"
                }`}
              >
                {done[s.id] ? <span data-testid={`tick-${s.id}`} aria-label="done">✓</span> : i + 1}
              </span>
              {s.label}
              {nudges[s.id] && (
                <span className={`rounded px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-amber-100 text-amber-800"}`} data-testid={`nudge-${s.id}`}>
                  {nudges[s.id]}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
    {next && (
      <button className="mt-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => onSelect(next.stage)} data-testid="next-step">
        {next.line}
      </button>
    )}
    </div>
  );
}
