"use client";

import { useState } from "react";
import type { Level } from "@/lib/model/schema";
import type { PlanWarning, WarningTag } from "@/lib/plan/checks";

/**
 * "Things to check": the plan's friendly warnings, all floors at once.
 * Clicking one goes to its floor, selects the room and centers it.
 */
/** Which button of a warning was pressed, for warnings with more than one. */
export type FixAction = "inside" | "delete" | "plan" | "flip" | "pocket" | "faucet";

export default function PlanChecks({ warnings, fresh = [], dismissed = [], levels, levelId, onPick, onFix, onDismiss, onRestore, onRestoreAll, inFurnish = false }: { warnings: PlanWarning[]; /** Ids of warnings the last fix brought up, tagged "new". */ fresh?: string[]; dismissed?: PlanWarning[]; levels: Level[]; levelId: string; onPick: (w: PlanWarning) => void; onFix?: (w: PlanWarning, action?: FixAction) => void; inFurnish?: boolean; onDismiss?: (w: PlanWarning) => void; onRestore?: (w: PlanWarning) => void; onRestoreAll?: () => void }) {
  const [open, setOpen] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const multi = new Set(warnings.map((w) => w.levelId)).size > 1 || warnings.some((w) => w.levelId !== levelId);
  const name = (id: string) => levels.find((l) => l.id === id)?.name ?? "";
  // This floor's first, then the others from the bottom up.
  const order = (id: string) => (id === levelId ? -1e9 : (levels.find((l) => l.id === id)?.elevationIn ?? 0));
  const sorted = [...warnings].sort((a, b) => order(a.levelId) - order(b.levelId));
  const sortedDismissed = [...dismissed].sort((a, b) => order(a.levelId) - order(b.levelId));

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
                  <div className="flex items-start">
                    <button className="min-w-0 flex-1 rounded px-2 py-1.5 text-left text-xs leading-snug hover:bg-amber-50" onClick={() => onPick(w)}>
                      {fresh.includes(w.id) && (
                        <span className="mr-1 rounded bg-amber-200 px-1 py-px text-[10px] font-semibold uppercase text-amber-900" data-testid="check-new">
                          new
                        </span>
                      )}
                      <TagChip tag={w.tag} />
                      {multi && <span className="font-medium text-muted">{name(w.levelId)}: </span>}
                      {w.text}
                    </button>
                    {onDismiss && (
                      <button className="shrink-0 rounded px-1.5 py-1 text-sm leading-none text-muted hover:bg-amber-50 hover:text-ink" title="Dismiss" aria-label="Dismiss" onClick={() => onDismiss(w)}>
                        ×
                      </button>
                    )}
                  </div>
                  {w.pullBack && onFix && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w)}>
                      Pull back
                    </button>
                  )}
                  {w.stairsU && onFix && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w)}>
                      Make these U-shaped
                    </button>
                  )}
                  {w.furnish && onFix && (
                    <span className="mx-2 mb-1 flex gap-1">
                      {w.furnish.canMoveInside && (
                        <button className="btn px-2 py-0.5 text-xs" onClick={() => onFix(w, "inside")}>
                          Move inside
                        </button>
                      )}
                      <button className="btn px-2 py-0.5 text-xs" onClick={() => onFix(w, "delete")}>
                        Delete
                      </button>
                    </span>
                  )}
                  {w.noFaucet && onFix && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w, "faucet")} data-testid="faucet-put-back">
                      Put the faucet back
                    </button>
                  )}
                  {w.closetWalls && onFix && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w, inFurnish ? "plan" : undefined)} data-testid="closet-walls-fix">
                      {inFurnish ? "Remove the closet walls in the floor plan" : "Remove the closet walls"}
                    </button>
                  )}
                  {w.escape && onFix && !inFurnish && (
                    <button className="btn mx-2 mb-1 px-2 py-0.5 text-xs" onClick={() => onFix(w)} data-testid="escape-fix">
                      Make this an escape window
                    </button>
                  )}
                  {w.swing && onFix && !inFurnish && (
                    <span className="mx-2 mb-1 flex gap-1">
                      <button className="btn px-2 py-0.5 text-xs" onClick={() => onFix(w, "flip")} data-testid="swing-flip">
                        Flip the swing
                      </button>
                      <button className="btn px-2 py-0.5 text-xs" onClick={() => onFix(w, "pocket")} data-testid="swing-pocket">
                        Switch to a pocket door
                      </button>
                    </span>
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
          {dismissed.length > 0 && (
            <div className="mt-2">
              <button className="text-xs text-muted hover:underline" onClick={() => setShowDismissed(!showDismissed)} aria-expanded={showDismissed}>
                {showDismissed ? "Hide dismissed" : `Show ${dismissed.length} dismissed`}
              </button>
              {showDismissed && (
                <ul className="mt-1 space-y-1 opacity-70">
                  {sortedDismissed.map((w) => (
                    <li key={w.id} className="flex items-start">
                      <button className="min-w-0 flex-1 rounded px-2 py-1.5 text-left text-xs leading-snug text-muted hover:bg-amber-50" onClick={() => onPick(w)}>
                        <TagChip tag={w.tag} />
                        {multi && <span className="font-medium">{name(w.levelId)}: </span>}
                        {w.text}
                      </button>
                      {onRestore && (
                        <button className="btn shrink-0 px-2 py-0.5 text-xs" onClick={() => onRestore(w)}>
                          Bring back
                        </button>
                      )}
                    </li>
                  ))}
                  {dismissed.length > 1 && onRestoreAll && (
                    <li>
                      <button className="btn px-2 py-0.5 text-xs" onClick={onRestoreAll}>
                        Bring back all
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
          <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
            <b>Code</b>: something a building inspector checks. <b>Comfort</b>: a guideline for a house that works well.
          </p>
        </>
      )}
    </div>
  );
}

/** The "Code" or "Comfort" label in front of a warning. */
function TagChip({ tag }: { tag: WarningTag }) {
  return tag === "code" ? (
    <span className="mr-1 rounded bg-rose-100 px-1 py-px text-[10px] font-semibold uppercase text-rose-900" data-testid="check-tag">
      Code
    </span>
  ) : (
    <span className="mr-1 rounded bg-slate-100 px-1 py-px text-[10px] font-semibold uppercase text-slate-600" data-testid="check-tag">
      Comfort
    </span>
  );
}
