"use client";

import type { FloorPlan } from "@/lib/model/schema";
import { alignMany, copyableIds, duplicateMany, mirrorMany, whyNotAlign, type Align } from "@/lib/plan/arrange";
import type { PlanSelection } from "./types";

const ALIGNS: { how: Align; label: string }[] = [
  { how: "tops", label: "Line up tops" },
  { how: "lefts", label: "Line up lefts" },
  { how: "bottoms", label: "Line up bottoms" },
  { how: "rights", label: "Line up rights" },
  { how: "same-width", label: "Same width" },
  { how: "same-depth", label: "Same depth" },
];

/** Copy, flip and (for several rooms) line up whatever is selected. */
export default function ArrangeButtons({ plan, ids, onChange, onSelect }: { plan: FloorPlan; ids: string[]; onChange: (p: FloorPlan) => void; onSelect: (s: PlanSelection) => void }) {
  const copyable = copyableIds(plan, ids);
  const rooms = ids.filter((id) => plan.rooms.some((r) => r.id === id));
  if (!copyable.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="grid grid-cols-3 gap-2">
        <button className="btn px-1 text-xs" title="Make a copy a little way over (Cmd+D)" onClick={() => duplicateAndSelect(plan, copyable, onChange, onSelect)}>
          Duplicate
        </button>
        <button className="btn px-1 text-xs" title="Flip left to right" onClick={() => onChange(mirrorMany(plan, copyable, "left-right"))}>
          Flip ⇆
        </button>
        <button className="btn px-1 text-xs" title="Flip top to bottom" onClick={() => onChange(mirrorMany(plan, copyable, "top-bottom"))}>
          Flip ⇅
        </button>
      </div>
      {rooms.length > 1 && (
        <>
          <p className="field-label mt-3">Line up</p>
          <div className="grid grid-cols-2 gap-2">
            {ALIGNS.map((a) => {
              const why = whyNotAlign(plan, rooms, a.how);
              return (
                <button key={a.how} className="btn px-1 text-xs" disabled={!!why} title={why ?? (a.how.startsWith("same") ? "Match the first room you picked" : "Move the rooms in line")} onClick={() => onChange(alignMany(plan, rooms, a.how))}>
                  {a.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Copy the ids and pick the copies. */
export function duplicateAndSelect(plan: FloorPlan, ids: string[], onChange: (p: FloorPlan) => void, onSelect: (s: PlanSelection) => void) {
  const out = duplicateMany(plan, ids);
  if (!out.ids.length) return;
  onChange(out.plan);
  onSelect(
    out.ids.map((id) => ({
      kind: out.plan.rooms.some((r) => r.id === id) ? ("room" as const) : out.plan.walls.some((w) => w.id === id) ? ("wall" as const) : out.plan.stairs.some((s) => s.id === id) ? ("stairs" as const) : ("fixture" as const),
      id,
    })),
  );
}
