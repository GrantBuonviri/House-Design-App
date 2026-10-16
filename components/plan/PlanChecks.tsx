"use client";

import { useState } from "react";
import type { Level } from "@/lib/model/schema";
import type { PlanWarning } from "@/lib/plan/checks";

/**
 * "Things to check": the plan's friendly warnings, all floors at once.
 * Clicking one goes to its floor, selects the room and centers it.
 */
export default function PlanChecks({ warnings, levels, levelId, onPick, onFix }: { warnings: PlanWarning[]; levels: Level[]; levelId: string; onPick: (w: PlanWarning) => void; onFix?: (w: PlanWarning) => void }) {
  const [open, setOpen] = useState(true);
  const multi = new Set(warnings.map((w) => w.levelId)).size > 1 || warnings.some((w) => w.levelId !== levelId);
  const name = (id: string) => levels.find((l) => l.id === id)?.name ?? "";
  // This floor's first, then the others from the bottom up.
  const order = (id: string) => (id === levelId ? -1e9 : (levels.find((l) => l.id === id)?.elevationIn ?? 0));
  const sorted = [...warnings].sort((a, b) => order(a.levelId) - order(b.levelId));

  return (
    <div className="card p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3 className="text-sm font-semibold">
          Things to check{" "}
          <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${warnings.length ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{warnings.length}</span>
        </h3>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <>
          {sorted.length === 0 ? (
            <p className="mt-2 text-xs text-muted">Nothing to flag right now.</p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
              {sorted.map((w) => (
                <li key={w.id}>
                  <button className="w-full rounded px-2 py-1.5 text-left text-xs leading-snug hover:bg-amber-50" onClick={() => onPick(w)}>
                    {multi && <span className="font-medium text-muted">{name(w.levelId)}: </span>}
                    {w.text}
                  </button>
                  {w.pullBack && onFix && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w)}>
                      Pull back
                    </button>
                  )}
                  {w.gap && onFix && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w)}>
                      Close gap
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted">General guidelines for a comfortable house, not building code.</p>
        </>
      )}
    </div>
  );
}
