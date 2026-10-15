"use client";

import type { Stage } from "@/lib/model/schema";
import { STAGE_INFO } from "@/lib/stages";

export default function StageBar({ current, onSelect }: { current: Stage; onSelect: (s: Stage) => void }) {
  return (
    <ol className="flex gap-1 overflow-x-auto" data-tour="stages">
      {STAGE_INFO.map((s, i) => {
        const active = s.id === current;
        return (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              data-tour={`stage-${s.id}`}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap ${
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
            </button>
          </li>
        );
      })}
    </ol>
  );
}
