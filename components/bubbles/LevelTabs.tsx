"use client";

import { useState } from "react";
import type { Level } from "@/lib/model/schema";
import { EXTRA_LEVEL_LABEL, isExtraLevel, newExtraLevel, type ExtraLevelKind } from "@/lib/brief/levels";

/** One tab per level, lowest first, with a way to add a loft or split level. */
export default function LevelTabs({
  levels,
  current,
  counts,
  onSelect,
  onAdd,
  onRemove,
}: {
  levels: Level[];
  current: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd?: (level: Level) => void;
  onRemove?: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Floors">
      {levels.map((l) => (
        <div key={l.id} className="flex items-center">
          <button
            role="tab"
            aria-selected={l.id === current}
            onClick={() => onSelect(l.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${l.id === current ? "bg-accent text-white" : "text-muted hover:bg-stone-100 hover:text-ink"}`}
          >
            {l.name}
            <span className={`ml-1.5 text-xs ${l.id === current ? "text-white/75" : "text-muted"}`}>{counts[l.id] ?? 0}</span>
          </button>
          {onRemove && isExtraLevel(l.id) && (
            <button className="px-1 text-muted hover:text-red-700" aria-label={`Remove ${l.name}`} title={`Remove ${l.name}`} onClick={() => onRemove(l.id)}>
              ×
            </button>
          )}
        </div>
      ))}
      {onAdd && (
        <div className="relative">
          <button className="rounded-md px-2.5 py-1.5 text-sm text-accent hover:bg-stone-100" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            + Add a level
          </button>
          {menu && (
            <div className="absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-line bg-white p-1 shadow-lg" role="menu">
              {(Object.keys(EXTRA_LEVEL_LABEL) as ExtraLevelKind[]).map((kind) => {
                const level = newExtraLevel(kind, levels);
                return (
                  <button
                    key={kind}
                    role="menuitem"
                    disabled={!level}
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-stone-100 disabled:opacity-40"
                    onClick={() => {
                      setMenu(false);
                      if (level) onAdd(level);
                    }}
                  >
                    {EXTRA_LEVEL_LABEL[kind]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
