"use client";

import { useState } from "react";
import type { DesignBrief, DiscoveryAnswers } from "@/lib/model/schema";
import { syncLevels } from "@/lib/brief/levels";
import { plotFacts } from "@/components/land/plotText";
import { useProjectStore } from "@/lib/store/projectStore";
import BriefEditor from "./BriefEditor";
import RoomsPage from "./RoomsPage";
import { Note, SourceBadge, Working } from "./bits";

type View = "rooms" | "brief";
type Source = "ai" | "rules";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The app's server answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** Stage 3: choose the rooms on one page, then the Design Brief, which the user can edit. */
export default function BriefStage({ onContinue, onPickLand }: { onContinue: () => void; onPickLand: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { answers } = project.discovery;

  const [view, setView] = useState<View>(project.brief ? "brief" : "rooms");
  const [busy, setBusy] = useState(false);
  const [briefNote, setBriefNote] = useState<string>();
  const [error, setError] = useState<string>();

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

  const buildBrief = async () => {
    if (project.brief && !window.confirm("Replace your current brief, including any edits you made to it?")) return;
    setBusy(true);
    setError(undefined);
    try {
      const p = useProjectStore.getState().project!;
      const res = await post<{
        brief: DesignBrief;
        source: Source;
        note?: string;
      }>("/api/brief/generate", {
        answers: p.discovery.answers,
        profile: p.profile,
        plot: p.plot,
      });
      update((p) => ({
        ...p,
        brief: res.brief,
        levels: syncLevels(p.levels, res.brief),
      }));
      setBriefNote(res.note);
      setView("brief");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the brief.");
    } finally {
      setBusy(false);
    }
  };

  const editBrief = (brief: DesignBrief, key: string) =>
    update((p) => ({ ...p, brief, levels: syncLevels(p.levels, brief) }), {
      coalesce: `brief.${key}`,
    });

  if (view === "brief" && project.brief) {
    return (
      <div className="space-y-6 pb-10">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">Your design brief</h2>
              <SourceBadge source={project.brief.source} />
            </div>
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
        <Note text={briefNote} />
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
        <BriefEditor brief={project.brief} onChange={editBrief} />
      </div>
    );
  }

  const facts = project.plot ? plotFacts(project.plot) : null;
  const ready = answers.rooms.length > 0;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 pb-10">
      <div className="min-w-0 space-y-5">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Choose your rooms</h2>
            <p className="mt-1 text-sm text-muted">
              Pick the floors and rooms you want. Claude fills in the rest when it builds your brief.
            </p>
          </div>
          {project.brief && (
            <button className="shrink-0 text-sm text-accent hover:underline" onClick={() => setView("brief")}>
              Back to my brief
            </button>
          )}
        </div>

        <RoomsPage answers={answers} setAnswers={setAnswers} plot={project.plot} />

        {busy && <Working text="Writing your brief. With Claude this can take up to a minute…" />}
        {error && <Note text={error} />}

        <div className="flex items-center justify-end gap-4">
          {!ready && <span className="text-sm text-muted">Check at least one room to continue.</span>}
          <button className="btn-primary" disabled={busy || !ready} onClick={() => void buildBrief()}>
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
