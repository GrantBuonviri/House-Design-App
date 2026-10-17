"use client";

import { useEffect, useState } from "react";
import type { CustomLand } from "@/lib/model/schema";
import { SOIL_TYPES, climateTypeOf, soilTypesFor } from "@/lib/land/generate";
import { usePlace } from "@/lib/location/usePlace";
import { acresOf, boxFeet, resizeBox, resizeToAcres, setSideLength, sideLengthFt } from "@/lib/land/designer";
import Dial from "./Dial";

/** A number box that applies on Enter or when you click away, so typing "1.5" isn't cut off halfway. */
function NumField({ value, onCommit, step = 1, label }: { value: number; onCommit: (n: number) => void; step?: number; label: string }) {
  const shown = String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) onCommit(n);
    else setText(shown);
  };
  return (
    <input
      className="input"
      type="number"
      aria-label={label}
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

const ROLLS = [
  ["smooth", "Smooth"],
  ["gentle", "Gentle rolls"],
  ["bumpy", "Bumpy"],
] as const;

function slopeHint(p: number): string {
  if (p < 1) return "Basically flat.";
  if (p < 3) return "Gentle: a slab or crawlspace works.";
  if (p < 8) return "Moderate: a crawlspace with stepped walls.";
  if (p < 15) return "Walkout basement territory.";
  return "Steep: expect retaining walls and a split-level.";
}

export default function DesignerPanel({ land, onChange }: { land: CustomLand; onChange: (l: CustomLand) => void }) {
  const place = usePlace();
  const box = boxFeet(land.outline);
  const soil = SOIL_TYPES.find((s) => s.name === land.soil);
  return (
    <div className="space-y-5 text-sm">
      <div>
        <label className="field-label" htmlFor="land-name">Name</label>
        <input id="land-name" className="input" value={land.name} onChange={(e) => onChange({ ...land, name: e.target.value })} />
      </div>

      <section>
        <h3 className="field-label">Size and shape</h3>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <span className="field-hint">Width (ft)</span>
            <NumField label="Width in feet" value={box.widthFt} onCommit={(w) => onChange(resizeBox(land, w, box.depthFt))} />
          </div>
          <div>
            <span className="field-hint">Depth (ft)</span>
            <NumField label="Depth in feet" value={box.depthFt} onCommit={(d) => onChange(resizeBox(land, box.widthFt, d))} />
          </div>
          <div>
            <span className="field-hint">Acres</span>
            <NumField label="Acres" step={0.1} value={acresOf(land.outline)} onCommit={(a) => onChange(resizeToAcres(land, a))} />
          </div>
        </div>
        <p className="field-hint">
          Drag a corner to move it. Drag or click a + to add a corner. Double-click a corner (or press Delete) to remove it.
          Corners snap to 90° and 45°; hold Shift for any angle.
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">Type each side&apos;s length</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {land.outline.map((_, i) => (
              <label key={i} className="flex items-center gap-2 text-xs text-muted">
                Side {i + 1}
                <NumField label={`Side ${i + 1} length in feet`} value={sideLengthFt(land.outline, i)} onCommit={(ft) => onChange(setSideLength(land, i, ft))} />
              </label>
            ))}
          </div>
        </details>
      </section>

      <section>
        <h3 className="field-label">Where north is</h3>
        <div className="flex items-center gap-4">
          <Dial value={land.northDeg} onChange={(d) => onChange({ ...land, northDeg: d })} label="North direction" />
          <p className="field-hint">
            Turn the dial to match your lot, {Math.round(land.northDeg)}° from straight up. It snaps every 15° (Shift for any angle).
          </p>
        </div>
      </section>

      <section>
        <h3 className="field-label">Slope</h3>
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <input
              type="range"
              aria-label="Slope percent"
              className="w-full accent-[#2f6f4f]"
              min={0}
              max={25}
              step={0.5}
              value={land.slope.percent}
              onChange={(e) => onChange({ ...land, slope: { ...land.slope, percent: Number(e.target.value) } })}
            />
            <p className="text-sm">
              <span className="font-medium">{land.slope.percent}%</span> <span className="text-muted">{slopeHint(land.slope.percent)}</span>
            </p>
          </div>
          <div className="text-center">
            <Dial
              value={land.slope.downhillDeg}
              onChange={(d) => onChange({ ...land, slope: { ...land.slope, downhillDeg: d } })}
              label="Downhill direction"
              color="#8a6d3b"
              mark="↓"
            />
            <span className="field-hint">Downhill</span>
          </div>
        </div>
        <div role="radiogroup" aria-label="Ground" className="mt-2 inline-flex rounded-md border border-line bg-white p-0.5">
          {ROLLS.map(([id, text]) => (
            <button
              key={id}
              role="radio"
              aria-checked={land.rolls === id}
              onClick={() => onChange({ ...land, rolls: id })}
              className={`rounded px-3 py-1 text-xs font-medium ${land.rolls === id ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              {text}
            </button>
          ))}
        </div>
      </section>

      <section>
        <label className="field-label" htmlFor="land-soil">Soil</label>
        <select id="land-soil" className="input" value={land.soil} onChange={(e) => onChange({ ...land, soil: e.target.value })}>
          {soilTypesFor(climateTypeOf(place.climateZone)).map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
        {soil && <p className="field-hint">{soil.note}</p>}
      </section>
    </div>
  );
}
