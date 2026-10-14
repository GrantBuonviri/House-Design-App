"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Stage } from "@/lib/model/schema";
import { useProjectStore, type SaveState } from "@/lib/store/projectStore";
import { STAGE_INFO, stageAvailable } from "@/lib/stages";
import { downloadProject } from "@/lib/download";
import StageBar from "./StageBar";
import SetupForm from "./SetupForm";
import LandStage from "@/components/land/LandStage";
import BriefStage from "@/components/brief/BriefStage";
import BubbleStage from "@/components/bubbles/BubbleStage";
import PlanStage from "@/components/plan/PlanStage";

const Walkthrough = dynamic(() => import("@/components/walk/Walkthrough"), { ssr: false });

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  unsaved: "Saving…",
  error: "Couldn't save. Export a backup.",
};

function ComingSoon({ stage }: { stage: Stage }) {
  const info = STAGE_INFO.find((s) => s.id === stage)!;
  return (
    <div className="card mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
      <h2 className="text-lg font-semibold">{info.label}</h2>
      <p className="mt-2 text-sm text-muted">This stage arrives in milestone {info.milestone}.</p>
    </div>
  );
}

export default function ProjectWorkspace({ id }: { id: string }) {
  const { project, loading, notFound, saveState, past, future, open, close, update, undo, redo } =
    useProjectStore();
  const [walking, setWalking] = useState(false);

  useEffect(() => {
    void open(id);
    return () => close();
  }, [id, open, close]);

  // Cmd+Z / Shift+Cmd+Z (Ctrl on other systems). Text fields keep their own undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  if (loading || (!project && !notFound)) {
    return <main className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted">Loading…</main>;
  }
  if (notFound || !project) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm">That project wasn&apos;t found in this browser.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent underline">
          Back to your houses
        </Link>
      </main>
    );
  }

  const setStage = (stage: Stage) => update((p) => ({ ...p, stage }));
  const canWalk = !!project.plan.basics && Object.values(project.floorPlans).some((pl) => pl.rooms.length > 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-muted hover:text-ink">
            ← All houses
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className={`mr-2 text-xs ${saveState === "error" ? "text-red-700" : "text-muted"}`}>
            {SAVE_LABEL[saveState]}
          </span>
          <button className="btn" onClick={undo} disabled={past.length === 0} title="Undo (⌘Z)">
            Undo
          </button>
          <button className="btn" onClick={redo} disabled={future.length === 0} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <button className="btn" onClick={() => downloadProject(project)}>
            Export
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setWalking(true)}
            disabled={!canWalk}
            title={canWalk ? "Walk through the house in first person" : "Make a floor plan first, then you can walk through it"}
          >
            Walkthrough
          </button>
        </div>
      </div>

      <div className="mb-8 border-b border-line pb-3">
        <StageBar current={project.stage} onSelect={setStage} />
      </div>

      {project.stage === "setup" ? (
        <SetupForm onContinue={() => setStage("land")} />
      ) : project.stage === "land" ? (
        <LandStage onContinue={() => setStage("brief")} />
      ) : project.stage === "brief" ? (
        <BriefStage onContinue={() => setStage("bubbles")} onPickLand={() => setStage("land")} />
      ) : project.stage === "bubbles" ? (
        <BubbleStage onContinue={() => setStage("plan")} onGoToRooms={() => setStage("brief")} />
      ) : project.stage === "plan" ? (
        <PlanStage onContinue={() => setStage("interior")} onGoToSketch={() => setStage("bubbles")} />
      ) : stageAvailable(project.stage) ? null : (
        <ComingSoon stage={project.stage} />
      )}

      {walking && canWalk && <Walkthrough project={project} onClose={() => setWalking(false)} />}
    </main>
  );
}
