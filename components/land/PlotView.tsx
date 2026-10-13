"use client";

import dynamic from "next/dynamic";
import { createContext, useContext } from "react";
import type { Plot } from "@/lib/model/schema";
import PlotPreview from "./PlotPreview";

export type LandViewMode = "3d" | "2d";

/** Which way every plot on the Land stage is drawn, set by the 2D/3D switch. */
export const LandViewModeContext = createContext<LandViewMode>("3d");

const PlotTerrain3D = dynamic(() => import("./PlotTerrain3D"), {
  ssr: false,
  loading: () => <div className="animate-pulse rounded-lg bg-stone-200" style={{ width: "100%", height: "100%" }} />,
});

/** A plot drawn in 3D or as a 2D map, following the 2D/3D switch. */
export default function PlotView({ plot, size, detailed = false }: { plot: Plot; size: number; detailed?: boolean }) {
  const mode = useContext(LandViewModeContext);
  if (mode === "2d") return <PlotPreview plot={plot} size={size} detailed={detailed} />;
  return (
    <div style={{ width: size, height: size }}>
      <PlotTerrain3D plot={plot} size={size} />
    </div>
  );
}

export function ViewModeSwitch({ mode, onChange }: { mode: LandViewMode; onChange: (m: LandViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Land view" className="inline-flex rounded-md border border-line bg-white p-0.5">
      {(["3d", "2d"] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            mode === m ? "bg-accent text-white" : "text-muted hover:text-ink"
          }`}
        >
          {m.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
