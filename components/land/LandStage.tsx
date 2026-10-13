"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Plot } from "@/lib/model/schema";
import { FLAT_PLOT_SEED, feedPlotSeed, generatePlot } from "@/lib/land/generate";
import { useProjectStore } from "@/lib/store/projectStore";
import PlotCard from "./PlotCard";
import PlotDetails from "./PlotDetails";

const FIRST_PAGE = 11; // plus the flat plot = 12 cards, four rows of three
const PAGE = 9;

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

/** Keep the same feed while the tab is open, so leaving and coming back doesn't reshuffle. */
function useFeedSeed(projectId: string): [number, () => void] {
  const key = `land-feed:${projectId}`;
  const [seed, setSeed] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return Number(saved);
    } catch {}
    return randomSeed();
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, String(seed));
    } catch {}
  }, [key, seed]);
  return [seed, () => setSeed(randomSeed())];
}

export default function LandStage({ onContinue }: { onContinue: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [browsing, setBrowsing] = useState(project.plot === null);
  const [open, setOpen] = useState<Plot | null>(null);
  const [feedSeed, reshuffle] = useFeedSeed(project.id);
  const [count, setCount] = useState(FIRST_PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  const flat = useMemo(() => generatePlot(FLAT_PLOT_SEED, { flat: true }), []);
  const plots = useMemo(
    () => Array.from({ length: count }, (_, i) => generatePlot(feedPlotSeed(feedSeed, i))),
    [feedSeed, count],
  );

  // Infinite scroll: load another page whenever the bottom comes into view.
  useEffect(() => {
    if (!browsing) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => c + PAGE);
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [browsing, feedSeed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const choose = useCallback(
    (plot: Plot) => {
      update((p) => ({ ...p, plot }));
      setOpen(null);
      setBrowsing(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [update],
  );

  const openPlot = useCallback((p: Plot) => setOpen(p), []);

  return (
    <div ref={top}>
      {project.plot && !browsing && (
        <section className="card mb-8 p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium tracking-wide text-accent uppercase">Your land</p>
              <p className="text-sm text-muted">Everything from here on is designed for this plot.</p>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setBrowsing(true)}>
                Choose different land
              </button>
              <button className="btn-primary" onClick={onContinue}>
                Next: rooms &amp; vibe →
              </button>
            </div>
          </div>
          <PlotDetails plot={project.plot} />
        </section>
      )}

      {browsing && (
        <>
          <div className="sticky top-0 z-10 -mx-6 mb-6 flex items-center justify-between border-b border-line bg-paper px-6 py-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Pick your land</h2>
              <p className="text-sm text-muted">
                Keep scrolling for more. Every plot is made up, and the land is free.
              </p>
            </div>
            <div className="flex gap-2">
              {project.plot && (
                <button className="btn" onClick={() => setBrowsing(false)}>
                  Keep my current land
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  reshuffle();
                  setCount(FIRST_PAGE);
                }}
              >
                Shuffle
              </button>
              <button className="btn-primary" onClick={() => setOpen(flat)}>
                Perfectly flat plot
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-5">
            <PlotCard plot={flat} pinned onOpen={openPlot} />
            {plots.map((p) => (
              <PlotCard key={p.seed} plot={p} onOpen={openPlot} />
            ))}
          </div>
          <div ref={sentinel} className="py-10 text-center text-sm text-muted">
            Finding more land…
          </div>
        </>
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
            <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
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
    </div>
  );
}
