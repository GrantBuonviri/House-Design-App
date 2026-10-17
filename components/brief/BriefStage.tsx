"use client";

import { useState } from "react";
import type { DesignBrief, DiscoveryAnswers, Profile } from "@/lib/model/schema";
import { houseSpot } from "@/lib/house3d/site";
import { dropLevelRooms, removeRoomsQuestion, removedLevelIds, roomsOnLevels, syncLevels } from "@/lib/brief/levels";
import type { Project } from "@/lib/model/schema";
import { buildRuleBrief, sizingNote } from "@/lib/brief/rules";
import { plotFacts } from "@/components/land/plotText";
import { useProjectStore } from "@/lib/store/projectStore";
import { locationOf } from "@/lib/location/current";
import BriefEditor from "./BriefEditor";
import RoomsPage from "./RoomsPage";

type View = "rooms" | "brief";

/** Stage 3: choose the rooms on one page, then the Design Brief, which the user can edit. */
export default function BriefStage({ onContinue, onPickLand }: { onContinue: () => void; onPickLand: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { answers } = project.discovery;

  const [view, setView] = useState<View>(project.brief ? "brief" : "rooms");

  const setAnswers = (patch: Partial<DiscoveryAnswers>, key: string) =>
    update(
      (p) => ({
        ...p,
        discovery: {
          ...p.discovery,
          answers: { ...p.discovery.answers, ...patch },
        },
      }),
      {
        coalesce: `answers.${key}`,
      },
    );

  const setProfile = (patch: Partial<Profile>, key: string) => update((p) => ({ ...p, profile: { ...p.profile, ...patch } }), { coalesce: `profile.${key}` });

  /** Asks about the rooms on floors this brief drops. Returns the floors to clear, or null if the change is cancelled. */
  const askDropped = (p: Project, brief: DesignBrief): string[] | null => {
    const gone = removedLevelIds(p, brief);
    const n = roomsOnLevels(p, gone);
    if (n === 0) return gone;
    return window.confirm(removeRoomsQuestion(n, gone.map((id) => p.levels.find((l) => l.id === id)?.name ?? "floor"))) ? gone : null;
  };

  const withBrief = (p: Project, brief: DesignBrief, gone: string[]): Project => dropLevelRooms({ ...p, brief, levels: syncLevels(p.levels, brief) }, gone);

  const buildBrief = () => {
    if (project.brief && !window.confirm("Replace your current brief, including any edits you made to it?")) return;
    const next = buildRuleBrief({ answers: project.discovery.answers, profile: project.profile, costIndex: locationOf(project).costIndex, plot: project.plot, spot: houseSpot(project) });
    const gone = askDropped(project, next);
    if (!gone) return;
    update((p) => {
      const brief = buildRuleBrief({ answers: p.discovery.answers, profile: p.profile, costIndex: locationOf(p).costIndex, plot: p.plot, spot: houseSpot(p) });
      return withBrief(p, brief, gone);
    });
    setView("brief");
    window.scrollTo({ top: 0 });
  };

  const editBrief = (brief: DesignBrief, key: string) => {
    const gone = askDropped(project, brief);
    if (!gone) return;
    update((p) => withBrief(p, brief, gone), gone.length ? undefined : { coalesce: `brief.${key}` });
  };

  if (view === "brief" && project.brief) {
    return (
      <div className="space-y-6 pb-10">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">Your design brief</h2>
            <p className="mt-1 text-sm text-muted">Change anything. Every later step reads from this brief.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="btn"
              onClick={() => {
                setView("rooms");
                window.scrollTo({ top: 0 });
              }}
            >
              Change my rooms
            </button>
            <button className="btn-primary" onClick={onContinue}>
              Next: flow sketch →
            </button>
          </div>
        </div>
        <section className="card p-6">
          <label className="field-label" htmlFor="brief-summary">
            In a nutshell
          </label>
          <textarea
            id="brief-summary"
            className="input min-h-20 text-base"
            maxLength={1500}
            value={project.brief.summary ?? ""}
            onChange={(e) => editBrief({ ...project.brief!, summary: e.target.value || undefined }, "summary")}
          />
        </section>
        <BriefEditor brief={project.brief} onChange={editBrief} sizing={sizingNote(answers, project.profile, locationOf(project).costIndex)} />
      </div>
    );
  }

  const facts = project.plot ? plotFacts(project.plot, houseSpot(project)) : null;
  const ready = answers.rooms.length > 0;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 pb-10">
      <div className="min-w-0 space-y-5">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Choose your rooms</h2>
            <p className="mt-1 text-sm text-muted">
              Pick the floors and rooms you want. The app fills in the rest when it builds your brief.
            </p>
          </div>
          {project.brief && (
            <button className="shrink-0 text-sm text-accent hover:underline" onClick={() => setView("brief")}>
              Back to my brief
            </button>
          )}
        </div>

        <RoomsPage answers={answers} setAnswers={setAnswers} plot={project.plot} spot={houseSpot(project)} profile={project.profile} setProfile={setProfile} />


        <div className="flex items-center justify-end gap-4">
          {!ready && <span className="text-sm text-muted">Check at least one room to continue.</span>}
          <button className="btn-primary" disabled={!ready} onClick={buildBrief}>
            {project.brief ? "Rebuild my brief" : "Build my brief"} →
          </button>
        </div>
      </div>

      <aside className="text-sm">
        <div className="sticky top-4 space-y-3">
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
                <p className="text-muted">
                  No land picked yet. The rooms page works without it, but the brief is better with it.
                </p>
                <button className="text-accent hover:underline" onClick={onPickLand}>
                  Pick your land
                </button>
              </div>
            )}
          </div>
          <p className="px-1 text-xs text-muted">Your answers save as you go. You can come back and change them any time.</p>
        </div>
      </aside>
    </div>
  );
}
