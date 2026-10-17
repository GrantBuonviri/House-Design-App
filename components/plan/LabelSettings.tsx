"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanLabels } from "@/lib/model/schema";
import { DEFAULT_LABELS } from "@/lib/plan/labels";

/** The "Labels" button over the floor plan and the panel it opens: what shows, and how it looks. */

const KINDS: { key: "roomNames" | "sqft" | "roomSizes" | "wallLengths" | "outsideDims" | "openingTags" | "fixtureNames"; label: string }[] = [
  { key: "roomNames", label: "Room names" },
  { key: "sqft", label: "Square feet" },
  { key: "roomSizes", label: "Room sizes" },
  { key: "wallLengths", label: "Wall lengths" },
  { key: "outsideDims", label: "Outside dimensions" },
  { key: "openingTags", label: "Door and window sizes" },
  { key: "fixtureNames", label: "Fixture and furniture names" },
];

const SIZES: { label: string; value: number }[] = [
  { label: "Small", value: 0.85 },
  { label: "Medium", value: 1 },
  { label: "Large", value: 1.25 },
];

const COLORS: { value: PlanLabels["overhangColor"]; label: string; dot: string }[] = [
  { value: "red", label: "Red", dot: "#c8322a" },
  { value: "orange", label: "Orange", dot: "#d9731a" },
  { value: "purple", label: "Purple", dot: "#8a3fb8" },
];
const STRENGTHS: { value: PlanLabels["overhangStrength"]; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "normal", label: "Normal" },
  { value: "strong", label: "Strong" },
];

export default function LabelSettings({ labels, onChange, hasAbove = false, hasBelow = false }: { labels: PlanLabels; onChange: (l: PlanLabels) => void; hasAbove?: boolean; hasBelow?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const set = (patch: Partial<PlanLabels>) => onChange({ ...labels, ...patch });
  const box = "size-4 accent-[var(--color-accent)]";
  const seg = (active: boolean) => `rounded border px-2 py-1 text-xs ${active ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-line bg-white hover:bg-stone-100"}`;
  const off = labels.hideAll;

  return (
    <div className="relative" ref={ref}>
      <button className={`flex items-center gap-1.5 rounded border px-2 py-0.5 ${open ? "border-[var(--color-accent)]" : "border-line"} bg-white hover:bg-stone-50`} onClick={() => setOpen(!open)} aria-expanded={open} title="Choose which labels show, and how they look (L hides them all)">
        <span aria-hidden>⚙</span>
        Labels{labels.hideAll ? " (hidden)" : ""}
      </button>
      {open && (
        <div role="dialog" aria-label="Label settings" className="absolute top-full left-0 z-30 mt-1 max-h-[80vh] w-72 space-y-3 overflow-y-auto rounded-lg border border-line bg-white p-3 text-sm text-ink shadow-lg">
          <label className="flex cursor-pointer items-center justify-between gap-2 font-medium">
            Hide all labels <span className="text-xs font-normal text-muted">key L</span>
            <input type="checkbox" className={box} checked={labels.hideAll} onChange={(e) => set({ hideAll: e.target.checked })} />
          </label>
          <div className={`space-y-1.5 ${off ? "opacity-50" : ""}`}>
            {KINDS.map((k) => (
              <label key={k.key} className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" className={box} checked={labels[k.key]} onChange={(e) => set({ [k.key]: e.target.checked })} />
                {k.label}
              </label>
            ))}
          </div>
          {(hasAbove || hasBelow) && (
            <div className="space-y-1.5 border-t border-line pt-3">
              <p className="text-xs font-medium text-muted">Overhangs and floor above</p>
              {hasBelow && (
                <>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className={box} checked={labels.overhangShading} onChange={(e) => set({ overhangShading: e.target.checked })} />
                    This floor: overhang stripes
                  </label>
                  <label className={`flex cursor-pointer items-center gap-2 ${off ? "opacity-50" : ""}`}>
                    <input type="checkbox" className={box} checked={labels.overhangText} onChange={(e) => set({ overhangText: e.target.checked })} />
                    This floor: &quot;hangs past&quot; notes
                  </label>
                </>
              )}
              {hasAbove && (
                <>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className={box} checked={labels.aboveOutlines} onChange={(e) => set({ aboveOutlines: e.target.checked })} />
                    Floor above: room outlines
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className={box} checked={labels.aboveShading} onChange={(e) => set({ aboveShading: e.target.checked })} />
                    Floor above: overhang stripes
                  </label>
                  <label className={`flex cursor-pointer items-center gap-2 ${off ? "opacity-50" : ""}`}>
                    <input type="checkbox" className={box} checked={labels.aboveText} onChange={(e) => set({ aboveText: e.target.checked })} />
                    Floor above: &quot;hangs past&quot; notes
                  </label>
                </>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Stripe color</p>
                <div className="flex gap-1">
                  {COLORS.map((c) => (
                    <button key={c.value} className={`${seg(labels.overhangColor === c.value)} flex items-center gap-1`} onClick={() => set({ overhangColor: c.value })}>
                      <span className="inline-block size-2 rounded-full" style={{ background: c.dot }} aria-hidden />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted">How strong</p>
                <div className="flex gap-1">
                  {STRENGTHS.map((c) => (
                    <button key={c.value} className={seg(labels.overhangStrength === c.value)} onClick={() => set({ overhangStrength: c.value })}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2 border-t border-line pt-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Text size</p>
              <div className="flex gap-1">
                {SIZES.map((z) => (
                  <button key={z.label} className={seg(labels.textSize === z.value)} onClick={() => set({ textSize: z.value })}>
                    {z.label}
                  </button>
                ))}
              </div>
              <input type="range" min={0.7} max={1.6} step={0.05} value={labels.textSize} onChange={(e) => set({ textSize: Number(e.target.value) })} className="mt-1 w-full accent-[var(--color-accent)]" aria-label="Text size" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Text color</p>
              <div className="flex gap-1">
                {([["dark", "Dark"], ["gray", "Soft gray"], ["room", "Match room"]] as const).map(([v, l]) => (
                  <button key={v} className={seg(labels.textColor === v)} onClick={() => set({ textColor: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className={box} checked={labels.boldNames} onChange={(e) => set({ boldNames: e.target.checked })} />
              Bold room names
            </label>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Behind the text</p>
              <div className="flex gap-1">
                <button className={seg(labels.background === "none")} onClick={() => set({ background: "none" })}>
                  Nothing
                </button>
                <button className={seg(labels.background === "white")} onClick={() => set({ background: "white" })}>
                  White box
                </button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Lengths</p>
              <div className="flex gap-1">
                <button className={seg(labels.units === "feet")} onClick={() => set({ units: "feet" })}>
                  Feet and inches (12&apos; 6&quot;)
                </button>
                <button className={seg(labels.units === "inches")} onClick={() => set({ units: "inches" })}>
                  Inches (150&quot;)
                </button>
              </div>
            </div>
          </div>
          <button className="btn w-full" onClick={() => onChange({ ...DEFAULT_LABELS })}>
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
