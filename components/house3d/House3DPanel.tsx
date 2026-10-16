"use client";

import type { Roof } from "@/lib/model/schema";
import type { DoorMode } from "@/lib/house3d/doors";
import DoorsPicker from "./DoorsPicker";
import type { WallsShown } from "./House3DView";

const STYLES: { id: Roof["style"]; label: string; note: string }[] = [
  { id: "gable", label: "Gable", note: "Two slopes, with upright gable ends" },
  { id: "hip", label: "Hip", note: "Slopes on every side" },
  { id: "shed", label: "Shed", note: "One slope, high on one side" },
  { id: "flat", label: "Flat", note: "Nearly flat, with a thin edge" },
];

const WALLS: { id: WallsShown; label: string }[] = [
  { id: "all", label: "All walls" },
  { id: "outside", label: "Outside walls only" },
  { id: "none", label: "No walls" },
];

const PITCHES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const OVERHANGS = [0, 12, 16, 24];
const SIDES: { id: Roof["shedDown"]; label: string }[] = [
  { id: "S", label: "South" },
  { id: "E", label: "East" },
  { id: "W", label: "West" },
  { id: "N", label: "North" },
];

/** Settings for the 3D view: what to show and the roof's shape. */
export default function House3DPanel({
  editing,
  roof,
  levelName,
  canCutAway,
  cutAway,
  showRoof,
  walls,
  doors,
  onDoors,
  onCutAway,
  onShowRoof,
  onWalls,
  onRoof,
}: {
  editing: boolean;
  roof: Roof;
  levelName: string;
  canCutAway: boolean;
  cutAway: boolean;
  showRoof: boolean;
  walls: WallsShown;
  doors: DoorMode;
  onDoors: (m: DoorMode) => void;
  onCutAway: (on: boolean) => void;
  onShowRoof: (on: boolean) => void;
  onWalls: (w: WallsShown) => void;
  onRoof: (patch: Partial<Roof>) => void;
}) {
  return (
    <div className="card space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold">{editing ? "3D view: editing" : "3D view"}</h3>
        <p className="mt-1 text-xs text-muted" data-testid="help-3d">
          {editing ? (
            <>
              Click a room&apos;s floor, a door, a window, stairs or a fixture to select it, then drag it to move it. Doors and windows slide along walls. Shift-click to
              pick more than one. Delete removes what&apos;s selected and the arrow keys nudge it. Drag empty ground to turn the view. Press Done editing when you&apos;re
              finished.
            </>
          ) : (
            <>
              Drag to turn the house, right-drag (or two-finger drag) to slide, scroll to zoom. Tilt all the way down, or press Top view, to see the{" "}
              {levelName.toLowerCase()} from above with its room names. The ⚙ Labels button changes what they say, and L hides or shows them all. Press Edit to select and move things.
            </>
          )}
        </p>
      </div>

      <div className="space-y-2">
        <p className="field-label">Show</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showRoof} onChange={(e) => onShowRoof(e.target.checked)} />
          Roof
        </label>
        <div className="grid gap-1" role="radiogroup" aria-label="Walls">
          {WALLS.map((w) => (
            <button
              key={w.id}
              role="radio"
              aria-checked={walls === w.id}
              onClick={() => onWalls(w.id)}
              className={`rounded-md border px-2 py-1 text-left text-sm ${walls === w.id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-stone-50"}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <p className="field-label pt-1">Doors</p>
        <DoorsPicker value={doors} onChange={onDoors} />
        {doors === "none" && <p className="text-xs text-muted">Frames and trim stay; the doors themselves are taken off.</p>}
        {walls !== "all" && <p className="text-xs text-muted">Hidden walls leave a strip on the floor where they stand, without their doors and windows.</p>}
      </div>

      {canCutAway && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={cutAway} onChange={(e) => onCutAway(e.target.checked)} />
          <span>
            Look inside the {levelName.toLowerCase()}
            <span className="block text-xs text-muted">Takes off the roof and the floors above it. Pick the floor with the tabs above.</span>
          </span>
        </label>
      )}

      <div>
        <p className="field-label">Roof shape</p>
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
