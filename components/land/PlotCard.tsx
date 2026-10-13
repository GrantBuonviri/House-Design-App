"use client";

import { memo, useContext } from "react";
import type { Plot } from "@/lib/model/schema";
import PlotView, { LandViewModeContext } from "./PlotView";
import { DRAINAGE_STYLE, SUN_LABEL, plotFacts } from "./plotText";

const PREVIEW = 318;

function PlotCard({ plot, pinned = false, onOpen }: { plot: Plot; pinned?: boolean; onOpen: (p: Plot) => void }) {
  const f = plotFacts(plot);
  const mode = useContext(LandViewModeContext);
  return (
    <div className={`card flex flex-col overflow-hidden ${pinned ? "ring-2 ring-accent/40" : ""}`}>
      {/* The 3D view takes drags to turn the land, so only the text below opens the details. */}
      <div className="relative flex justify-center bg-stone-100 p-3">
        <PlotView plot={plot} size={PREVIEW} />
        {pinned && (
          <span className="pointer-events-none absolute top-5 right-5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">
            Always available
          </span>
        )}
        {mode === "3d" && (
          <span className="pointer-events-none absolute bottom-5 left-5 rounded bg-white/80 px-1.5 py-0.5 text-[11px] text-muted">
            Drag to turn
          </span>
        )}
      </div>
      <button onClick={() => onOpen(plot)} className="group flex flex-1 flex-col gap-2 p-4 text-left hover:bg-stone-50">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold group-hover:text-accent">{plot.name}</h3>
          <span className="text-xs whitespace-nowrap text-muted">{f.size}</span>
        </div>
        <p className="text-xs text-muted">
          {f.dims} · {f.road}
        </p>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Slope</dt>
            <dd className="text-right">{f.slope}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Sun</dt>
            <dd className="text-right">
              {SUN_LABEL[f.sunRating]} · {f.facing.toLowerCase()}
            </dd>
          </div>
        </dl>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <span className={`rounded-full px-2 py-0.5 text-xs ${DRAINAGE_STYLE[plot.drainage.rating]}`}>
            {plot.drainage.rating[0].toUpperCase() + plot.drainage.rating.slice(1)} drainage
          </span>
          {f.water.map((w) => (
            <span key={w} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
              {w}
            </span>
          ))}
          <span className="ml-auto text-xs font-medium text-accent">Details →</span>
        </div>
      </button>
    </div>
  );
}

export default memo(PlotCard);
