"use client";

import { useEffect } from "react";
import { loadGraphics, useGraphics, type Quality } from "@/lib/graphics";

const OPTIONS: { id: Quality; label: string; title: string }[] = [
  { id: "fast", label: "Fast", title: "Simpler 3D: no shadows or edge smoothing, for older or busy computers" },
  { id: "pretty", label: "Pretty", title: "Shadows and smooth edges in the 3D views" },
];

/** The Fast / Pretty switch for every 3D view. Remembered in this browser. */
export default function GraphicsToggle({ dark = false }: { dark?: boolean }) {
  const quality = useGraphics((g) => g.quality);
  const setQuality = useGraphics((g) => g.setQuality);
  useEffect(loadGraphics, []);
  return (
    <div className={`inline-flex items-center gap-1 text-xs ${dark ? "text-white drop-shadow" : "text-muted"}`} data-tour="graphics">
      <span>3D:</span>
      <div className={`inline-flex rounded-md border border-line p-0.5 ${dark ? "bg-white/90" : "bg-white"}`}>
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            className={`rounded px-2 py-0.5 ${quality === o.id ? "bg-accent text-white" : "text-ink hover:bg-stone-100"}`}
            onClick={() => setQuality(o.id)}
            title={o.title}
            aria-pressed={quality === o.id}
            data-testid={`graphics-${o.id}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
