"use client";

import { useDeferredValue, useMemo } from "react";
import type { Adjacency, DiscoveryAnswers, Profile } from "@/lib/model/schema";
import { houseSpot } from "@/lib/house3d/site";
import { dropLevelRooms, removeRoomsQuestion, removedLevelIds, roomsOnLevels } from "@/lib/brief/levels";
import { briefTips, briefTotals, sizingNote } from "@/lib/brief/rules";
import { applyBriefEdit } from "@/lib/brief/live";
import { estimate, fullMoney } from "@/lib/cost/estimate";
import { budgetCheck, budgetOf } from "@/lib/cost/breakdown";
import { plotFacts } from "@/components/land/plotText";
import { useProjectStore } from "@/lib/store/projectStore";
import { locationOf } from "@/lib/location/current";
import RoomsPage from "./RoomsPage";

const sqft = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;

/** Stage 3, "Your rooms and brief": one page of picks. The Design Brief every later stage reads is worked out from them as you go. */
export default function BriefStage({ onContinue, onPickLand }: { onContinue: () => void; onPickLand: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { answers } = project.discovery;

  /** Asks about the rooms on floors these answers drop. Returns the floors to clear, or null if the change is cancelled. */
  const askDropped = (next: DiscoveryAnswers): string[] | null => {
    const gone = removedLevelIds(project, { floors: next.floorsAbove, floorsBelow: next.floorsBelow });
    const n = roomsOnLevels(project, gone);
    if (n === 0) return gone;
    return window.confirm(removeRoomsQuestion(n, gone.map((id) => project.levels.find((l) => l.id === id)?.name ?? "floor"))) ? gone : null;
  };

  /** Every edit on this step goes to the answers; the store works the brief out again from them. */
  const setAnswers = (patch: Partial<DiscoveryAnswers>, key: string) => {
    const next = { ...answers, ...patch };
    const gone = askDropped(next);
    if (!gone) return;
    update(
      (p) => dropLevelRooms({ ...p, discovery: { ...p.discovery, answers: { ...p.discovery.answers, ...patch } } }, gone),
      gone.length ? undefined : { coalesce: `answers.${key}` },
    );
  };

  const setProfile = (patch: Partial<Profile>, key: string) => update((p) => ({ ...p, profile: { ...p.profile, ...patch } }), { coalesce: `profile.${key}` });

  /** An edit to the brief's whole connection list, written back to the answers (the app's obvious ones taken out are remembered). */
  const editConnections = (adjacencies: Adjacency[], key: string) => {
    if (project.brief) setAnswers(applyBriefEdit(answers, project.brief, { ...project.brief, adjacencies }), `brief.${key}`);
    else setAnswers({ connections: adjacencies }, key);
  };

  const spot = houseSpot(project);
  const ready = answers.rooms.length > 0;

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Your rooms and brief</h2>
          <p className="mt-1 text-sm text-muted">Pick the floors and rooms you want. The app fills in the rest, and your brief on the right keeps up as you go.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!ready && <span className="text-sm text-muted">Check at least one room to continue.</span>}
          <button className="btn-primary" disabled={!ready} onClick={onContinue}>
            Next: flow sketch →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-8">
        <div className="min-w-0">
          <RoomsPage
            answers={answers}
            brief={project.brief}
            setAnswers={setAnswers}
            editConnections={editConnections}
            plot={project.plot}
            spot={spot}
            profile={project.profile}
            setProfile={setProfile}
            tips={briefTips({ answers, profile: project.profile, plot: project.plot, spot })}
          />
          <div className="mt-6 flex justify-end">
            <button className="btn-primary" disabled={!ready} onClick={onContinue}>
              Next: flow sketch →
            </button>
          </div>
        </div>
        <BriefPanel onPickLand={onPickLand} />
      </div>
    </div>
  );
}

/** The sticky side panel: the brief in a nutshell, sizes, the likely cost against the budget, and the land. */
function BriefPanel({ onPickLand }: { onPickLand: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  // Worked out a moment behind typing, as in the top bar.
  const deferred = useDeferredValue(project);
  const cost = useMemo(() => {
    try {
      return estimate(deferred);
    } catch {
      return null;
    }
  }, [deferred]);
  const brief = project.brief?.rooms.length ? project.brief : null;
  const totals = brief ? briefTotals(brief) : null;
  const budget = cost ? budgetCheck(project.profile, cost) : null;
  const setBudget = budgetOf(project.profile);
  const sizing = sizingNote(project.discovery.answers, project.profile, locationOf(project).costIndex);
  const facts = project.plot ? plotFacts(project.plot, houseSpot(project)) : null;

  return (
    <aside className="text-sm">
      <div className="sticky top-4 space-y-3" data-testid="brief-panel">
        <div className="card space-y-3 p-4">
          <p className="text-xs font-medium tracking-wide text-accent uppercase">Your brief</p>
          {brief && totals ? (
            <>
              <p data-testid="brief-summary">{brief.summary}</p>
              <dl className="space-y-1.5 border-t border-line pt-3">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Living space</dt>
                  <dd className="font-medium">about {sqft(totals.heated)}</dd>
                </div>
                <p className="-mt-1 text-xs text-muted">Rooms plus ~15% for halls, stairs and walls</p>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Garage</dt>
                  <dd className="font-medium">{totals.garage ? sqft(totals.garage) : "None"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Outdoor living</dt>
                  <dd className="font-medium">{totals.outdoor ? sqft(totals.outdoor) : "None"}</dd>
                </div>
              </dl>
              {cost && (
                <div className="border-t border-line pt-3" data-testid="brief-cost">
                  <p>
                    Materials: about <span className="font-semibold">{fullMoney(cost.total.likely)}</span>
                    {setBudget ? ` of your ${fullMoney(setBudget)} budget` : ""}
                  </p>
                  {budget && (
                    <>
                      <div className="mt-1.5 h-2 rounded-full bg-paper">
                        <div
                          className={`h-2 rounded-full ${budget.status === "over" ? "bg-red-600" : budget.status === "close" ? "bg-amber-500" : "bg-emerald-600"}`}
                          style={{ width: `${Math.min(100, budget.used * 100)}%` }}
                        />
                      </div>
                      {budget.status === "over" && <p className="mt-1 text-xs text-red-800">{fullMoney(budget.diff)} over budget.</p>}
                    </>
                  )}
                  <p className="mt-1 text-xs text-muted">{cost.source === "plan" ? "From your floor plan." : "A rough guess from the room sizes."} The cost panel at the top has the breakdown.</p>
                </div>
              )}
              {sizing && <p className="border-t border-line pt-3 text-xs text-muted">{sizing}</p>}
            </>
          ) : (
            <p className="text-muted">Check a room and your brief shows up here.</p>
          )}
        </div>

        <div className="card p-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-accent uppercase">Your land</p>
          {facts ? (
            <ul className="space-y-1.5">
              <li>
                {facts.size}, {facts.slope.toLowerCase()}
              </li>
              <li>{facts.road}</li>
              {facts.water.length > 0 && <li>{facts.water.join(", ")}</li>}
              <li className="text-muted">{facts.implications.sun.note}</li>
              <li className="text-muted">{facts.implications.foundation.label}</li>
            </ul>
          ) : (
            <div className="space-y-2">
              <p className="text-muted">No land picked yet. This page works without it, but the brief is better with it.</p>
              <button className="text-accent hover:underline" onClick={onPickLand}>
                Pick your land
              </button>
            </div>
          )}
        </div>
        <p className="px-1 text-xs text-muted">Your answers save as you go. You can come back and change them any time.</p>
      </div>
    </aside>
  );
}
