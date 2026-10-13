"use client";

import type { Stage } from "@/lib/model/schema";
import { STAGE_INFO, stageAvailable } from "@/lib/stages";

export default function StageBar({ current, onSelect }: { current: Stage; onSelect: (s: Stage) => void }) {
  return (
    <ol className="flex gap-1 overflow-x-auto">
      {STAGE_INFO.map((s, i) => {
        const active = s.id === current;
        const available = stageAvailable(s.id);
        return (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              title={available ? undefined : `Coming in milestone ${s.milestone}`}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                active
                  ? "bg-accent text-white"
                  : available
                    ? "text-ink hover:bg-stone-100"
                    : "text-muted hover:bg-stone-100"
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
            </button>
          </li>
        );
      })}
    </ol>
  );
}
