"use client";

import type { Level, PlanBasics, PlanLabels } from "@/lib/model/schema";
import type { PlanAlternative } from "@/lib/plan/alternatives";
import { exteriorWallIn } from "@/lib/plan/basics";
import { planOf, type Plans } from "@/lib/plan/edit";
import { boundsOf } from "@/lib/plan/geometry";
import { stairsFootprints } from "@/lib/plan/suggest";
import { Note } from "@/components/brief/bits";
import LevelTabs from "@/components/bubbles/LevelTabs";
import MiniPlan from "./MiniPlan";

const SIZE = 250;

/** "Show me alternatives" for the floor plan: the user's plan next to three others, to take one or keep their own. */
export default function PlanAlternativesView({
  mine,
  alternatives,
  note,
  levels,
  level,
  basics,
  labels,
  onLevel,
  onUse,
  onAgain,
  onClose,
}: {
  mine: Plans;
  alternatives: PlanAlternative[];
  note?: string;
  levels: Level[];
  level: Level;
  basics: PlanBasics | null;
  labels: PlanLabels;
  onLevel: (id: string) => void;
  onUse: (index: number, levelOnly: boolean) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const all = [mine, ...alternatives.map((a) => a.plans)];
  const frame = boundsOf(all.flatMap((ps) => planOf(ps, level.id).rooms.flatMap((r) => r.polygon))) ?? { x0: -240, y0: -240, x1: 240, y1: 240 };
  const exteriorIn = exteriorWallIn(basics);
  const ctx = { levels, basics };
  const multiLevel = levels.filter((l) => planOf(mine, l.id).rooms.length > 0).length > 1;
  const changedHere = (alt: PlanAlternative) => {
    const ids = new Set(planOf(alt.plans, level.id).rooms.map((r) => r.id));
    return alt.wholeHouse ? [] : alt.changed.filter((id) => ids.has(id));
  };

  /** Changes on this floor and on others, so taking just this floor means something. */
  const splitsFloors = (alt: PlanAlternative) =>
    !alt.wholeHouse && changedHere(alt).length > 0 && levels.some((l) => l.id !== level.id && planOf(alt.plans, l.id).rooms.some((r) => alt.changed.includes(r.id)));
  /** "The change is on the second floor", when nothing changed on the floor showing. */
  const elsewhere = (alt: PlanAlternative) => {
    if (alt.wholeHouse || changedHere(alt).length) return null;
    const names = levels.filter((l) => l.id !== level.id && planOf(alt.plans, l.id).rooms.some((r) => alt.changed.includes(r.id))).map((l) => l.name.toLowerCase());
    return names.length ? `The change is on the ${names.join(" and ")}.` : null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{alternatives.length === 3 ? "Three alternatives" : "Alternatives"}</h2>
          <p className="mt-1 text-sm text-muted">Each one keeps your plan and tries one change. Rooms that changed have a purple outline.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn" onClick={onAgain}>
            Show me different ones
          </button>
          <button className="btn-primary" onClick={onClose}>
            Back to my plan
          </button>
        </div>
      </div>
      <Note text={note} />
      <LevelTabs levels={levels} current={level.id} onSelect={onLevel} counts={Object.fromEntries(levels.map((l) => [l.id, planOf(mine, l.id).rooms.length]))} />

      <div className="grid grid-cols-4 gap-4">
        <figure className="card overflow-hidden ring-2 ring-accent/40">
          <div className="flex justify-center border-b border-line bg-paper">
            <MiniPlan plan={planOf(mine, level.id)} frame={frame} size={SIZE} exteriorIn={exteriorIn} labels={labels} stairs={stairsFootprints(mine, ctx, level)} />
          </div>
          <figcaption className="p-3">
            <p className="text-sm font-semibold">Yours</p>
            <p className="mt-1 text-xs text-muted">Your plan as it is now.</p>
          </figcaption>
        </figure>
        {alternatives.map((alt, i) => (
          <figure key={i} className="card flex flex-col overflow-hidden">
            <div className="flex justify-center border-b border-line bg-paper">
              <MiniPlan plan={planOf(alt.plans, level.id)} frame={frame} size={SIZE} exteriorIn={exteriorIn} labels={labels} stairs={stairsFootprints(alt.plans, ctx, level)} changed={changedHere(alt)} />
            </div>
            <figcaption className="flex flex-1 flex-col p-3">
              <p className="text-sm font-semibold">{alt.title}</p>
              <p className="mt-1 flex-1 text-xs text-muted">
                {alt.why}
                {elsewhere(alt) && <span className="mt-1 block text-violet-800">{elsewhere(alt)}</span>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn px-2.5 py-1.5" onClick={() => onUse(i, false)}>
                  Use this design
                </button>
                {multiLevel && splitsFloors(alt) && (
                  <button className="btn px-2.5 py-1.5" onClick={() => onUse(i, true)}>
                    Use this floor only
                  </button>
                )}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
