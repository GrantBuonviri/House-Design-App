"use client";

import type { RailingTarget, RailingChange } from "@/lib/furnish/railings";
import { RAILING_KINDS, RAILING_STYLES, railingKindLabel } from "@/lib/plan/railings";
import { Panel } from "@/components/plan/PlanSidePanel";

const SIDE: Record<string, string> = { middle: "Between the two flights", "landing-far": "Far side of the landing", "landing-left": "Left side of the landing", "landing-right": "Right side of the landing" };

/** A short name for the side of the stairs a railing is on. */
export function edgeLabel(edge: string): string {
  if (SIDE[edge]) return SIDE[edge];
  if (edge.startsWith("well-")) return "Stairwell edge";
  if (edge.startsWith("landing-outer")) return "Side of the landing";
  return `${edge.startsWith("f2") ? "Upper flight" : "Stairs"}, ${edge.endsWith("left") ? "left" : "right"} side`;
}

/**
 * The right panel for a picked stair railing (or a bare side of the stairs):
 * kind, look, Remove, Back to automatic, and Add railing here. Shared by the
 * Furnish page and the walkthrough's Place tab.
 */
export default function RailingPanel({ target, edited, onChange }: { target: RailingTarget; edited: boolean; onChange: (c: RailingChange) => void }) {
  const r = target.railing;
  return (
    <Panel title={r ? railingKindLabel(r.kind) : "No railing here"}>
      <p className="-mt-2 mb-3 text-xs text-muted" data-testid="railing-note">
        {edgeLabel(target.edge)}. {r ? (r.auto ? "Placed by the app. Changing it makes it yours." : "Changed by you.") : "Nothing stands on this side right now."}
      </p>
      {!r ? (
        <div className="space-y-2">
          <button className="btn-primary w-full justify-center" onClick={() => onChange({ kind: "guard", style: "wood" })} data-testid="railing-add">
            Add railing here
          </button>
          {edited && (
            <button className="btn w-full justify-center text-sm" onClick={() => onChange("auto")} data-testid="railing-auto">
              Back to automatic
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="field-label">Kind</p>
          <div className="space-y-1" role="radiogroup" aria-label="Kind of railing">
            {RAILING_KINDS.map((k) => (
              <button key={k.kind} role="radio" aria-checked={r.kind === k.kind} title={k.note} onClick={() => r.kind !== k.kind && onChange({ kind: k.kind })} className={`w-full rounded-md border px-2 py-1.5 text-left text-sm ${r.kind === k.kind ? "border-accent bg-stone-100 font-medium" : "border-line hover:bg-stone-50"}`} data-testid={`railing-kind-${k.kind}`}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="field-label mt-4">Look</p>
          <div className="space-y-1" role="radiogroup" aria-label="Look of the railing">
            {RAILING_STYLES.map((x) => (
              <button key={x.style} role="radio" aria-checked={r.style === x.style} onClick={() => r.style !== x.style && onChange({ style: x.style })} className={`w-full rounded-md border px-2 py-1.5 text-left text-sm ${r.style === x.style ? "border-accent bg-stone-100 font-medium" : "border-line hover:bg-stone-50"}`} data-testid={`railing-style-${x.style}`}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn text-sm" disabled={!edited} onClick={() => onChange("auto")} data-testid="railing-auto">
              Back to automatic
            </button>
            <button className="btn text-sm text-red-700" onClick={() => onChange("remove")} data-testid="railing-remove">
              Remove
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
