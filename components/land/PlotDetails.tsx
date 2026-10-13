"use client";

import type { Plot } from "@/lib/model/schema";
import PlotPreview from "./PlotPreview";
import { DRAINAGE_STYLE, SUN_LABEL, plotFacts } from "./plotText";

/** Full description of one plot: big map, every stat, and what it means for the house. */
export default function PlotDetails({ plot }: { plot: Plot }) {
  const f = plotFacts(plot);
  const imp = f.implications;
  return (
    <div className="flex gap-6">
      <div className="w-[380px] shrink-0">
        <PlotPreview plot={plot} size={380} detailed />
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li><Swatch className="border border-dashed border-ink" /> Property line</li>
          <li><Swatch className="bg-[#8d8f8c]" /> Road</li>
          <li><Swatch className="bg-[#e8892b]" /> Summer sun path</li>
          <li><Swatch className="bg-[#d8b43a]" /> Winter sun path</li>
          <li>Lines: ground contours</li>
        </ul>
      </div>
      <div className="min-w-0 flex-1 space-y-4 text-sm">
        <div>
          <h3 className="text-xl font-semibold tracking-tight">{plot.name}</h3>
          <p className="text-muted">
            {f.size} · {f.dims} · {f.road}
          </p>
        </div>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted">Slope</dt>
          <dd>{f.slope}</dd>
          <dt className="text-muted">Sun</dt>
          <dd>
            {SUN_LABEL[imp.sun.rating]}. {imp.sun.note}
          </dd>
          <dt className="text-muted">Drainage</dt>
          <dd>
            <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${DRAINAGE_STYLE[plot.drainage.rating]}`}>
              {plot.drainage.rating}
            </span>
            {plot.drainage.reason}
          </dd>
          <dt className="text-muted">Soil</dt>
          <dd>{plot.soilNote}</dd>
          <dt className="text-muted">Water</dt>
          <dd>{f.water.length ? f.water.join(", ") : "None"}</dd>
          <dt className="text-muted">Foundation</dt>
          <dd>
            <span className="font-medium">{imp.foundation.label}.</span> {imp.foundation.note}
          </dd>
        </dl>
        {imp.notes.length > 0 && (
          <div className="rounded-lg bg-stone-50 p-3">
            <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">What this means for the house</p>
            <ul className="list-disc space-y-1 pl-5">
              {imp.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted">This land is made up for design practice. Land cost is always $0.</p>
      </div>
    </div>
  );
}

function Swatch({ className }: { className: string }) {
  return <span className={`mr-1 inline-block h-2.5 w-4 rounded-sm align-middle ${className}`} />;
}
