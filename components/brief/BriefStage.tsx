"use client";

import { useState } from "react";
import type { DesignBrief, DiscoveryAnswers, Profile } from "@/lib/model/schema";
import { houseSpot } from "@/lib/house3d/site";
import { dropLevelRooms, removeRoomsQuestion, removedLevelIds, roomsOnLevels } from "@/lib/brief/levels";
import { briefTips, sizingNote } from "@/lib/brief/rules";
import { applyBriefEdit } from "@/lib/brief/live";
import { plotFacts } from "@/components/land/plotText";
import { useProjectStore } from "@/lib/store/projectStore";
import { locationOf } from "@/lib/location/current";
import BriefEditor from "./BriefEditor";
import RoomsPage from "./RoomsPage";

type View = "rooms" | "brief";

/** Stage 3: choose the rooms on one page, then the Design Brief. Both edit the same answers; the brief is worked out from them. */
export default function BriefStage({ onContinue, onPickLand }: { onContinue: () => void; onPickLand: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { answers } = project.discovery;

  const [view, setView] = useState<View>(project.brief?.rooms.length ? "brief" : "rooms");

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

  /** An edit on the Design Brief page, written back to the answers. */
  const editBrief = (brief: DesignBrief, key: string) => {
    if (project.brief) setAnswers(applyBriefEdit(answers, project.brief, brief), `brief.${key}`);
  };

  const seeBrief = () => {
    setView("brief");
    window.scrollTo({ top: 0 });
  };

  if (view === "brief" && project.brief?.rooms.length) {
    return (
      <div className="space-y-6 pb-10">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">Your design brief</h2>
            <p className="mt-1 text-sm text-muted">Change anything. It keeps up with your rooms, and every later step reads from it.</p>
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
          <p className="field-label">In a nutshell</p>
          <p className="text-base">{project.brief.summary}</p>
        </section>
        <BriefEditor
          brief={project.brief}
          onChange={editBrief}
          answers={answers}
          setAnswers={setAnswers}
          tips={briefTips({ answers, profile: project.profile, plot: project.plot, spot: houseSpot(project) })}
          sizing={sizingNote(answers, project.profile, locationOf(project).costIndex)}
        />
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
              Pick the floors and rooms you want. The app fills in the rest, and your brief keeps up as you go.
            </p>
          </div>
        </div>

        <RoomsPage answers={answers} setAnswers={setAnswers} plot={project.plot} spot={houseSpot(project)} profile={project.profile} setProfile={setProfile} />


        <div className="flex items-center justify-end gap-4">
          {!ready && <span className="text-sm text-muted">Check at least one room to continue.</span>}
          <button className="btn-primary" disabled={!ready} onClick={seeBrief}>
            See my brief →
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
