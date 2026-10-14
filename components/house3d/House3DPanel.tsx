"use client";

import type { Roof } from "@/lib/model/schema";
import type { View3DMode } from "./House3DView";

const STYLES: { id: Roof["style"]; label: string; note: string }[] = [
  { id: "gable", label: "Gable", note: "Two slopes, with upright gable ends" },
  { id: "hip", label: "Hip", note: "Slopes on every side" },
  { id: "shed", label: "Shed", note: "One slope, high on one side" },
  { id: "flat", label: "Flat", note: "Nearly flat, with a thin edge" },
];

const PITCHES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const OVERHANGS = [0, 12, 16, 24];
const SIDES: { id: Roof["shedDown"]; label: string }[] = [
  { id: "S", label: "South" },
  { id: "E", label: "East" },
  { id: "W", label: "West" },
  { id: "N", label: "North" },
];

/** Settings for the 3D views: what to show and the roof's shape. */
export default function House3DPanel({
  mode,
  roof,
  levelName,
  canCutAway,
  cutAway,
  onCutAway,
  onRoof,
}: {
  mode: View3DMode;
  roof: Roof;
  levelName: string;
  canCutAway: boolean;
  cutAway: boolean;
  onCutAway: (on: boolean) => void;
  onRoof: (patch: Partial<Roof>) => void;
}) {
  return (
    <div className="card space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold">{mode === "3d" ? "3D view" : "Bird's-eye view"}</h3>
        <p className="mt-1 text-xs text-muted">
          {mode === "3d"
            ? "Drag to turn the house, right-drag (or two-finger drag) to slide, scroll to zoom."
            : `The ${levelName.toLowerCase()} from straight above, with the roof and the floors above it off. Drag empty space to slide, scroll to zoom.`}{" "}
          Click a room&apos;s floor, a door, a window, stairs or a fixture to select it, then drag it to move it. Doors and windows slide along walls.
        </p>
      </div>

      {mode === "3d" && canCutAway && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={cutAway} onChange={(e) => onCutAway(e.target.checked)} />
          <span>
            Look inside the {levelName.toLowerCase()}
            <span className="block text-xs text-muted">Takes off the roof and the floors above it. Pick the floor with the tabs above.</span>
          </span>
        </label>
      )}

      <div>
        <p className="field-label">Roof</p>
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Roof shape">
          {STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={roof.style === s.id}
              title={s.note}
              onClick={() => onRoof({ style: s.id })}
              className={`rounded-md border px-2 py-1.5 text-sm ${roof.style === s.id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-stone-50"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{STYLES.find((s) => s.id === roof.style)?.note}. Roofing materials come with the exterior design.</p>
      </div>

      {roof.style !== "flat" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            <span className="field-label">Steepness</span>
            <select className="input" value={roof.pitch} onChange={(e) => onRoof({ pitch: Number(e.target.value) })}>
              {PITCHES.map((p) => (
                <option key={p} value={p}>
                  {p} in 12{p === 6 ? " (common)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="field-label">Overhang</span>
            <select className="input" value={roof.overhangIn} onChange={(e) => onRoof({ overhangIn: Number(e.target.value) })}>
              {OVERHANGS.map((o) => (
                <option key={o} value={o}>
                  {o === 0 ? "None" : `${o}"`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {roof.style !== "flat" && <p className="-mt-2 text-xs text-muted">&ldquo;6 in 12&rdquo; means the roof rises 6 inches for every foot it runs.</p>}

      {roof.style === "shed" && (
        <label className="block text-sm">
          <span className="field-label">Slopes down toward</span>
          <select className="input" value={roof.shedDown} onChange={(e) => onRoof({ shedDown: e.target.value as Roof["shedDown"] })}>
            {SIDES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
