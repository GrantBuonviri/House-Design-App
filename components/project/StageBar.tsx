"use client";

import type { Stage } from "@/lib/model/schema";
import { STAGE_INFO } from "@/lib/stages";

/** `nudges` puts a short reminder on a stage, such as "Pick where you'll build" on step one. */
export default function StageBar({ current, onSelect, nudges = {} }: { current: Stage; onSelect: (s: Stage) => void; nudges?: Partial<Record<Stage, string>> }) {
  return (
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
                  active ? "bg-white/20" : "bg-stone-200"
                }`}
              >
                {i + 1}
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
  );
}
