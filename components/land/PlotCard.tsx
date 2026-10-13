"use client";

import { memo } from "react";
import type { Plot } from "@/lib/model/schema";
import PlotPreview from "./PlotPreview";
import { DRAINAGE_STYLE, SUN_LABEL, plotFacts } from "./plotText";

function PlotCard({ plot, pinned = false, onOpen }: { plot: Plot; pinned?: boolean; onOpen: (p: Plot) => void }) {
  const f = plotFacts(plot);
  return (
    <button
      onClick={() => onOpen(plot)}
      className={`card group flex flex-col overflow-hidden text-left transition hover:border-accent hover:shadow-md ${
        pinned ? "ring-2 ring-accent/40" : ""
      }`}
    >
      <div className="relative bg-stone-100 p-3">
        <PlotPreview plot={plot} size={236} className="mx-auto" />
        {pinned && (
          <span className="absolute top-5 right-5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">
            Always available
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
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
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <span className={`rounded-full px-2 py-0.5 text-xs ${DRAINAGE_STYLE[plot.drainage.rating]}`}>
            {plot.drainage.rating[0].toUpperCase() + plot.drainage.rating.slice(1)} drainage
          </span>
          {f.water.map((w) => (
            <span key={w} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
              {w}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

export default memo(PlotCard);
