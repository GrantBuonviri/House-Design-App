"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Plot } from "@/lib/model/schema";
import { FLAT_PLOT_SEED, feedPlotSeed, generatePlot } from "@/lib/land/generate";
import { useProjectStore } from "@/lib/store/projectStore";
import PlotCard from "./PlotCard";
import PlotDetails from "./PlotDetails";
import { LandViewModeContext, ViewModeSwitch, type LandViewMode } from "./PlotView";
import { readStorage, writeStorage } from "@/lib/browserStorage";

const PER_PAGE = 3;

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Where the browser is in the plot feed. Kept for the tab's lifetime so
 * leaving the stage and coming back shows the same plots.
 */
function useFeed(projectId: string) {
  const key = `land-feed:${projectId}`;
  const [state, setState] = useState(() => {
    const saved = readStorage(() => sessionStorage, key);
    if (saved) {
      const [seed, page] = saved.split(":").map(Number);
      if (Number.isFinite(seed) && Number.isFinite(page)) return { seed, page };
    }
    return { seed: randomSeed(), page: 0 };
  });
  useEffect(() => writeStorage(() => sessionStorage, key, `${state.seed}:${state.page}`), [key, state]);
  return {
    ...state,
    next: () => setState((s) => ({ ...s, page: s.page + 1 })),
    prev: () => setState((s) => ({ ...s, page: Math.max(0, s.page - 1) })),
    reshuffle: () => setState({ seed: randomSeed(), page: 0 }),
  };
}

function useViewMode(): [LandViewMode, (m: LandViewMode) => void] {
  const [mode, setMode] = useState<LandViewMode>(() =>
    readStorage(() => localStorage, "land-view-mode") === "2d" ? "2d" : "3d",
  );
  return [
    mode,
    (m) => {
      setMode(m);
      writeStorage(() => localStorage, "land-view-mode", m);
    },
  ];
}

/**
 * The feed is endless: slot 0 is always the perfectly flat plot, and every
 * slot after it is a new made-up plot from the feed seed.
 */
function plotAt(feedSeed: number, slot: number, flat: Plot): Plot {
  return slot === 0 ? flat : generatePlot(feedPlotSeed(feedSeed, slot - 1));
}

export default function LandStage({ onContinue }: { onContinue: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [browsing, setBrowsing] = useState(project.plot === null);
  const [open, setOpen] = useState<Plot | null>(null);
  const [mode, setMode] = useViewMode();
  const feed = useFeed(project.id);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  const flat = useMemo(() => generatePlot(FLAT_PLOT_SEED, { flat: true }), []);
  const plots = useMemo(
    () => Array.from({ length: PER_PAGE }, (_, i) => plotAt(feed.seed, feed.page * PER_PAGE + i, flat)),
    [feed.seed, feed.page, flat],
  );

  const goNext = useCallback(() => {
    setDirection("next");
    feed.next();
  }, [feed]);
  const goPrev = useCallback(() => {
    if (feed.page === 0) return;
    setDirection("prev");
    feed.prev();
  }, [feed]);

  // Arrow keys move the carousel; Escape closes the details.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) {
        if (e.key === "Escape") setOpen(null);
        return;
      }
      if (!browsing || (e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, browsing, goNext, goPrev]);

  const choose = useCallback(
    (plot: Plot) => {
      // A different lot puts the house back in the middle of it on the flow sketch.
      update((p) => ({ ...p, plot, sketch: p.plot?.seed === plot.seed ? p.sketch : { ...p.sketch, lotOffset: null } }));
      setOpen(null);
      setBrowsing(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [update],
  );

  const openPlot = useCallback((p: Plot) => setOpen(p), []);
  const first = feed.page * PER_PAGE + 1;

  return (
    <LandViewModeContext.Provider value={mode}>
      {project.plot && !browsing && (
        <section className="card mb-8 p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium tracking-wide text-accent uppercase">Your land</p>
              <p className="text-sm text-muted">Everything from here on is designed for this plot.</p>
            </div>
            <div className="flex items-center gap-2">
              <ViewModeSwitch mode={mode} onChange={setMode} />
              <button className="btn" onClick={() => setBrowsing(true)}>
                Choose different land
              </button>
              <button className="btn-primary" onClick={onContinue}>
                Next: rooms →
              </button>
            </div>
          </div>
          <PlotDetails plot={project.plot} />
        </section>
      )}

      {browsing && (
        <section>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Pick your land</h2>
              <p className="text-sm text-muted">
                Use the arrows to see more. Every plot is made up, and the land is free.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ViewModeSwitch mode={mode} onChange={setMode} />
              {project.plot && (
                <button className="btn" onClick={() => setBrowsing(false)}>
                  Keep my current land
                </button>
              )}
              <button className="btn" onClick={feed.reshuffle}>
                Shuffle
              </button>
              <button className="btn-primary" onClick={() => setOpen(flat)}>
                Perfectly flat plot
              </button>
            </div>
          </div>

          <div className="relative">
            <CarouselArrow side="left" disabled={feed.page === 0} onClick={goPrev} />
            <div
              key={`${feed.seed}:${feed.page}`}
              className={`grid grid-cols-3 gap-5 ${direction === "next" ? "slide-from-right" : "slide-from-left"}`}
            >
              {plots.map((p) => (
                <PlotCard key={`${p.seed}:${p.isFlat}`} plot={p} pinned={p.isFlat} onOpen={openPlot} />
              ))}
            </div>
            <CarouselArrow side="right" onClick={goNext} />
          </div>
          <p className="mt-4 text-center text-xs text-muted">
            Plots {first}–{first + PER_PAGE - 1} · use ← → on your keyboard too
          </p>
        </section>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={open.name}
            className="max-h-full w-full max-w-5xl overflow-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <PlotDetails plot={open} />
            <div className="mt-6 flex items-center justify-end gap-2 border-t border-line pt-4">
              <div className="mr-auto">
                <ViewModeSwitch mode={mode} onChange={setMode} />
              </div>
              <button className="btn" onClick={() => setOpen(null)}>
                Back to plots
              </button>
              <button className="btn-primary" onClick={() => choose(open)}>
                {project.plot?.seed === open.seed && project.plot.isFlat === open.isFlat
                  ? "This is your land"
                  : "Choose this plot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </LandViewModeContext.Provider>
  );
}

function CarouselArrow({
  side,
  disabled = false,
  onClick,
}: {
  side: "left" | "right";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous plots" : "More plots"}
      className={`absolute top-[170px] z-10 flex size-11 items-center justify-center rounded-full border border-line bg-white text-xl shadow-md hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-line disabled:hover:text-ink ${
        side === "left" ? "-left-5" : "-right-5"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
