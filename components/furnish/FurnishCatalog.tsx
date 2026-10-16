"use client";

import { useState } from "react";
import { catalogGroups, type CatalogEntry } from "@/lib/furnish/catalog";
import { formatFeetInches } from "@/lib/model/units";

/** The left panel of the Furnish page: everything that can be placed, by group, with a search box. */
export default function FurnishCatalog({ isPicked, onPick }: { isPicked: (e: CatalogEntry) => boolean; onPick: (e: CatalogEntry) => void }) {
  const [search, setSearch] = useState("");
  const groups = catalogGroups(search);
  return (
    <div className="card flex max-h-[640px] flex-col p-3" data-testid="furnish-catalog">
      <input className="input mb-2" placeholder="Search: toilet, outlet, bookcase…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the catalog" />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {groups.length === 0 && <p className="text-xs text-muted">Nothing matches “{search}”.</p>}
        {groups.map((g) => (
          <details key={g.group} open={Boolean(search) || g.group === "Kitchen and appliances"} className="group">
            <summary className="cursor-pointer select-none py-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.group}</summary>
            <ul className="mb-1">
              {g.entries.map((e) => {
                const on = isPicked(e);
                return (
                  <li key={e.id}>
                    <button
                      className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-sm ${on ? "bg-accent text-white" : "hover:bg-stone-100"}`}
                      aria-pressed={on}
                      data-testid={`catalog-${e.id}`}
                      onClick={() => onPick(e)}
                    >
                      <span>{e.label}</span>
                      {e.kind !== "device" && e.kind !== "hookup" && e.kind !== "wall" && <span className={`text-xs tabular-nums ${on ? "text-white/80" : "text-muted"}`}>{formatFeetInches(e.widthIn)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
