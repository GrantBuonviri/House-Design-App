"use client";

import { useCallback, useEffect, useState } from "react";
import type { DesignBrief, DiscoveryAnswers, FollowUp, Profile } from "@/lib/model/schema";
import { syncLevels } from "@/lib/brief/levels";
import { plotFacts } from "@/components/land/plotText";
import { useProjectStore } from "@/lib/store/projectStore";
import BriefEditor from "./BriefEditor";
import FollowUps, { Note, SourceBadge, Working } from "./FollowUps";
import { QUESTION_STEPS } from "./Questions";

type View = "questions" | "followups" | "brief";
type Source = "ai" | "rules";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The app's server answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/**
 * Stage 3: a few pages of questions, then follow-ups picked for this house,
 * then the Design Brief, which the user can edit.
 */
export default function BriefStage({ onContinue, onPickLand }: { onContinue: () => void; onPickLand: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const { answers, followUps } = project.discovery;

  const [view, setView] = useState<View>(project.brief ? "brief" : "questions");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | "followups" | "brief">(null);
  const [followSource, setFollowSource] = useState<{ source?: Source; note?: string }>({});
  const [briefNote, setBriefNote] = useState<string>();
  const [error, setError] = useState<string>();

  const setAnswers = (patch: Partial<DiscoveryAnswers>, key: string) =>
    update((p) => ({ ...p, discovery: { ...p.discovery, answers: { ...p.discovery.answers, ...patch } } }), {
      coalesce: `answers.${key}`,
    });
  const setProfile = (patch: Partial<Profile>, key: string) =>
    update((p) => ({ ...p, profile: { ...p.profile, ...patch } }), { coalesce: `profile.${key}` });

  const request = () => {
    const p = useProjectStore.getState().project!;
    return { answers: p.discovery.answers, profile: p.profile, plot: p.plot, followUps: p.discovery.followUps };
  };

  const fetchFollowUps = useCallback(
    async (fresh = false) => {
      setBusy("followups");
      setError(undefined);
      try {
        const res = await post<{ followUps: FollowUp[]; source: Source; note?: string }>("/api/brief/followups", {
          ...request(),
          fresh,
        });
        update((p) => ({ ...p, discovery: { ...p.discovery, followUps: res.followUps } }));
        setFollowSource({ source: res.source, note: res.note });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't get follow-up questions.");
      } finally {
        setBusy(null);
      }
    },
    [update],
  );

  // The first visit to the follow-ups page asks for questions.
  useEffect(() => {
    if (view === "followups" && followUps.length === 0 && busy === null && !error) void fetchFollowUps();
  }, [view, followUps.length, busy, error, fetchFollowUps]);

  const buildBrief = async (fresh = false) => {
    if (project.brief && !window.confirm("Replace your current brief, including any edits you made to it?")) return;
    setBusy("brief");
    setError(undefined);
    try {
      const res = await post<{ brief: DesignBrief; source: Source; note?: string }>("/api/brief/generate", { ...request(), fresh });
      update((p) => ({ ...p, brief: res.brief, levels: syncLevels(p.levels, res.brief) }));
      setBriefNote(res.note);
      setView("brief");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the brief.");
    } finally {
      setBusy(null);
    }
  };

  const editBrief = (brief: DesignBrief, key: string) =>
    update((p) => ({ ...p, brief, levels: syncLevels(p.levels, brief) }), { coalesce: `brief.${key}` });

  const answerFollowUp = (id: string, answer: string) =>
    update(
      (p) => ({
        ...p,
        discovery: { ...p.discovery, followUps: p.discovery.followUps.map((f) => (f.id === id ? { ...f, answer } : f)) },
      }),
      { coalesce: `followup.${id}` },
    );

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
            <button className="btn" onClick={() => setView("questions")}>
              Change my answers
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
  const total = QUESTION_STEPS.length + 1;
  const position = view === "followups" ? total : step + 1;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 pb-10">
      <div className="min-w-0 space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>
              Step {position} of {total}
            </span>
            {project.brief && (
              <button className="text-accent hover:underline" onClick={() => setView("brief")}>
                Back to my brief
              </button>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(position / total) * 100}%` }} />
          </div>
        </div>

        {view === "questions" ? (
          <section className="card p-6">
            <h2 className="text-xl font-semibold tracking-tight">{QUESTION_STEPS[step].title}</h2>
            <p className="mb-6 text-sm text-muted">{QUESTION_STEPS[step].intro}</p>
            {QUESTION_STEPS[step].body({ answers, setAnswers, profile: project.profile, setProfile, plot: project.plot })}
          </section>
        ) : (
          <section className="card p-6">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">A few more questions</h2>
              <SourceBadge source={followSource.source} />
            </div>
            <p className="mb-6 text-sm text-muted">Picked for your answers and your land. Skip any you like.</p>
            {busy === "followups" ? (
              <Working text="Thinking of good questions…" />
            ) : (
              <div className="space-y-5">
                <Note text={followSource.note} />
                <FollowUps followUps={followUps} onChange={answerFollowUp} />
                <button className="text-sm text-accent hover:underline" onClick={() => void fetchFollowUps(followUps.length > 0)}>
                  {followUps.length > 0 ? "Ask different questions" : "Try again"}
                </button>
              </div>
            )}
            {busy === "brief" && <Working text="Writing your brief. With Claude this can take up to a minute…" />}
          </section>
        )}

        {error && <Note text={error} />}

        <div className="flex justify-between">
          <button
            className="btn"
            disabled={view === "questions" && step === 0}
            onClick={() => (view === "followups" ? setView("questions") : setStep((s) => s - 1))}
          >
            ← Back
          </button>
          {view === "questions" ? (
            <button
              className="btn-primary"
              onClick={() => {
                if (step < QUESTION_STEPS.length - 1) setStep((s) => s + 1);
                else setView("followups");
                window.scrollTo({ top: 0 });
              }}
            >
              Next →
            </button>
          ) : (
            <button className="btn-primary" disabled={busy !== null} onClick={() => void buildBrief()}>
              {project.brief ? "Rebuild my brief" : "Build my brief"} →
            </button>
          )}
        </div>
      </div>

      <aside className="space-y-3 text-sm">
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
              <p className="text-muted">No land picked yet. The questions work without it, but the brief is better with it.</p>
              <button className="text-accent hover:underline" onClick={onPickLand}>
                Pick your land
              </button>
            </div>
          )}
        </div>
        <p className="px-1 text-xs text-muted">Your answers save as you go. You can come back and change them any time.</p>
      </aside>
    </div>
  );
}
