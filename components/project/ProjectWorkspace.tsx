"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Stage } from "@/lib/model/schema";
import { useProjectStore, type SaveState } from "@/lib/store/projectStore";
import { downloadProject } from "@/lib/download";
import { nextStep, shownStage, stagesDone } from "@/lib/stages";
import StageBar from "./StageBar";
import NeedsFirst from "./NeedsFirst";
import GraphicsToggle from "./GraphicsToggle";
import Tour from "@/components/tour/Tour";
import { TOUR_SEEN_KEY, type TourStep } from "@/lib/tour/steps";
import { tourStartFor, type MiniTour } from "@/lib/tour/help";
import PageHelp from "./PageHelp";
import { readStorage, writeStorage } from "@/lib/browserStorage";
import UndoButtons, { UndoNotice } from "./UndoButtons";
import SetupForm from "./SetupForm";
import CantOpen from "./CantOpen";
import OtherTabBar from "./OtherTabBar";
import type { RepairResult } from "@/lib/model/repair";
import LandStage from "@/components/land/LandStage";
import BriefStage from "@/components/brief/BriefStage";
import BubbleStage from "@/components/bubbles/BubbleStage";
import PlanStage from "@/components/plan/PlanStage";
import FurnishStage from "@/components/furnish/FurnishStage";
import CostPanel, { CostBadge } from "@/components/cost/CostPanel";
import { estimate as estimateCost } from "@/lib/cost/estimate";
import { locationOf } from "@/lib/location/current";
import { placeLabel } from "@/lib/location/cities";
import { keyIsForPage } from "@/lib/keys";

const Walkthrough = dynamic(() => import("@/components/walk/Walkthrough"), { ssr: false });
const PlansPage = dynamic(() => import("@/components/plans/PlansPage"), { ssr: false });

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  unsaved: "Saving…",
  error: "Couldn't save. Export a backup.",
};

export default function ProjectWorkspace({ id }: { id: string }) {
  const { project, loading, notFound, loadError, damaged, saveState, open, close, update, undo, redo, setStage } = useProjectStore();
  const [walk, setWalk] = useState<null | { window?: "interior" | "exterior" }>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [furnishLevel, setFurnishLevel] = useState<string>();
  const [repaired, setRepaired] = useState<RepairResult | null>(null);
  // Worked out a moment behind edits, so dragging in the plan stays smooth.
  const deferred = useDeferredValue(project);
  const { cost, costError } = useMemo(() => {
    if (!deferred) return { cost: null, costError: null };
    try {
      return { cost: estimateCost(deferred), costError: null };
    } catch (e) {
      console.error("Cost estimate failed", e);
      return { cost: null, costError: e instanceof Error ? e.message : String(e) };
    }
  }, [deferred]);

  // The guided tour: on its own the first time a house opens in this browser, then from "Take the tour".
  const [touring, setTouring] = useState<{ from: Stage; steps?: TourStep[]; startAt?: number } | null>(null);
  const ready = !!project;
  useEffect(() => {
    if (ready && readStorage(() => localStorage, TOUR_SEEN_KEY) === null) {
      setTouring({ from: useProjectStore.getState().project!.stage });
    }
  }, [ready]);
  const startTour = () => project && setTouring({ from: project.stage, startAt: tourStartFor(project.stage) });
  const startMini = (t: MiniTour) => project && setTouring({ from: project.stage, steps: t.steps });
  const endTour = useCallback(() => {
    writeStorage(() => localStorage, TOUR_SEEN_KEY, "yes");
    // Back to the page the tour started on.
    if (touring) useProjectStore.getState().setStage(touring.from);
    setTouring(null);
  }, [touring]);

  // Save right away when the tab is hidden or closed, so the last change and undo step aren't lost (closing also keeps a backup).
  useEffect(() => {
    const flush = () => useProjectStore.getState().flush({ closing: true });
    const onHide = () => document.visibilityState === "hidden" && useProjectStore.getState().flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    void open(id);
    return () => {
      void close();
    };
  }, [id, open, close]);

  // Cmd+Z / Shift+Cmd+Z (Ctrl on other systems). Text fields keep their own undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      // Checkboxes, radios and sliders keep focus after a click, but have no undo of their own.
      // A window over the page (like the land designer) has its own undo; the walkthrough passes undo on.
      if (!keyIsForPage(e, { toggles: true, covers: '[aria-modal="true"]' })) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  if (loadError) {
    return (
      <CantOpen
        id={id}
        message={loadError}
        damaged={damaged}
        onOpen={(result) => {
          setRepaired(result ?? null);
          void open(id);
        }}
      />
    );
  }
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

  const stageShown = shownStage(project.stage);
  const canWalk = !!project.plan.basics && Object.values(project.floorPlans).some((pl) => pl.rooms.length > 0);

  return (
    <div className={costOpen && cost ? "pr-[380px]" : ""}>
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
          <span className="flex gap-2" data-tour="undo">
            <UndoButtons />
          </span>
          <button className="btn" onClick={() => downloadProject(project)}>
            Export
          </button>
          <span data-tour="cost">
          {cost || costError ? (
            <CostBadge estimate={cost} error={costError} open={costOpen} onToggle={() => setCostOpen(!costOpen)} />
          ) : (
            <NeedsFirst message={`Pick your rooms first, and a rough cost for building in ${placeLabel(locationOf(project))} shows up here.`} action="Go to Rooms" onAction={() => setStage("brief")} testId="cost-needs">
              Cost
            </NeedsFirst>
          )}
          </span>
          <span data-tour="plans">
            <button className="btn" onClick={() => setPlansOpen(true)} title="Building plans as PDF sheets, with a code check" data-testid="plans-open">
              Plans
            </button>
          </span>
          <span data-tour="walkthrough">
          {canWalk ? (
            <button className="btn btn-primary" onClick={() => setWalk({})} title="Walk through the house in first person">
              Walkthrough
            </button>
          ) : (
            <NeedsFirst
              className="btn btn-primary"
              message="Draw a floor plan first, then you can walk through your house in 3D."
              action="Go to Floor plan"
              onAction={() => setStage("plan")}
              testId="walk-needs"
            >
              Walkthrough
            </NeedsFirst>
          )}
          </span>
        </div>
      </div>

      <OtherTabBar houseId={project.id} />
      {repaired && <RepairedBar result={repaired} onDismiss={() => setRepaired(null)} />}

      <div className="mb-8 flex items-center justify-between gap-4 border-b border-line pb-3">
        <StageBar current={shownStage(project.stage)} onSelect={setStage} nudges={project.location ? {} : { setup: "Pick where you’ll build" }} done={stagesDone(project)} next={nextStep(project)} />
        <div className="flex shrink-0 items-center gap-3">
          <button className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={startTour} data-tour="tour" data-testid="tour-start">
            Take the tour
          </button>
          <PageHelp stage={stageShown} onMiniTour={startMini} />
          <GraphicsToggle />
        </div>
      </div>

      {stageShown === "setup" ? (
        <SetupForm onContinue={() => setStage("land")} />
      ) : stageShown === "land" ? (
        <LandStage onContinue={() => setStage("brief")} />
      ) : stageShown === "brief" ? (
        <BriefStage onContinue={() => setStage("bubbles")} onPickLand={() => setStage("land")} />
      ) : stageShown === "bubbles" ? (
        <BubbleStage onContinue={() => setStage("plan")} onGoToRooms={() => setStage("brief")} />
      ) : stageShown === "plan" ? (
        <PlanStage onContinue={() => setStage("furnish")} onGoToSketch={() => setStage("bubbles")} onGoToFurnish={() => setStage("furnish")} />
      ) : stageShown === "furnish" ? (
        <FurnishStage key={furnishLevel} initialLevelId={furnishLevel} onContinue={() => (canWalk ? setWalk({ window: "interior" }) : setStage("plan"))} onGoToPlan={() => setStage("plan")} />
      ) : null}

      {plansOpen && (
        <PlansPage
          project={project}
          onClose={() => setPlansOpen(false)}
          onGo={(stage) => {
            setPlansOpen(false);
            if (stage === "interior" || stage === "exterior") {
              if (canWalk) setWalk({ window: stage });
              else setStage("plan");
            } else setStage(stage);
          }}
          onEditInFurnish={(levelId) => {
            setPlansOpen(false);
            setFurnishLevel(levelId);
            setStage("furnish");
          }}
        />
      )}
      {walk && canWalk && <Walkthrough project={project} cost={cost} startWindow={walk.window} onClose={() => setWalk(null)} />}
      <UndoNotice />
      {touring && <Tour key={touring.steps ? "mini" : "tour"} onStage={setStage} onDone={endTour} steps={touring.steps} startAt={touring.startAt} />}
    </main>
      {costOpen && cost && (
        <CostPanel estimate={cost} onClose={() => setCostOpen(false)} onUtilities={(utilities) => update((p) => ({ ...p, cost: { ...p.cost, utilities } }))}
          onPermitFee={(permitFee) => update((p) => (p.location ? { ...p, location: { ...p.location, permitFee } } : p), { coalesce: "permit-fee" })}
          onPickPlace={() => {
            setCostOpen(false);
            setStage("setup");
          }}
        />
      )}
    </div>
  );
}

/** What "Try to repair" changed, shown once the repaired house opens. */
function RepairedBar({ result, onDismiss }: { result: RepairResult; onDismiss: () => void }) {
  const parts = [
    result.reset.length ? `put ${result.reset.length} ${result.reset.length === 1 ? "setting" : "settings"} back to the defaults` : "",
    result.removed.length ? `took out ${result.removed.length} broken ${result.removed.length === 1 ? "piece" : "pieces"}` : "",
  ].filter(Boolean);
  return (
    <div className="mb-4 rounded-md border border-line bg-paper px-4 py-2 text-sm" data-testid="repaired">
      <div className="flex items-start justify-between gap-3">
        <p>Repaired: {parts.length ? parts.join(" and ") : "nothing needed changing"}. Check the house over before you go on.</p>
        <button className="text-xs text-muted hover:text-ink" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      {parts.length > 0 && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer">What changed</summary>
          <ul className="mt-1 list-disc pl-5">
            {result.reset.map((r, i) => (
              <li key={`r${i}`}>Reset: {r}</li>
            ))}
            {result.removed.map((r, i) => (
              <li key={`x${i}`}>Taken out: {r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
