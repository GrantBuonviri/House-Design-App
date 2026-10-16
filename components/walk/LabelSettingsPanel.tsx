"use client";

import type { WalkLabels } from "@/lib/model/schema";

/**
 * Settings for labels drawn in a 3D view: what each one says and how it looks. Used by the
 * walkthrough's floor labels; takes plain props so another 3D view can reuse it.
 */

const SHOWS: { key: keyof Pick<WalkLabels, "name" | "size" | "sqft" | "floorName" | "ceiling" | "finishes" | "costShare">; label: string }[] = [
  { key: "name", label: "Room name" },
  { key: "size", label: "Size, like 12' × 14'" },
  { key: "sqft", label: "Square feet" },
  { key: "floorName", label: "Floor name" },
  { key: "ceiling", label: "Ceiling height" },
  { key: "finishes", label: "Flooring and wall paint" },
  { key: "costShare", label: "Share of the cost estimate" },
];

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1 flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onPick(o.id)} className={`flex-1 px-2 py-1 text-sm ${value === o.id ? "bg-accent text-white" : "hover:bg-line/40"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LabelSettingsPanel<S extends WalkLabels>({
  settings,
  onChange,
  onHideAll,
  title = "Floor labels",
  allHidden = false,
  without = [],
  note,
  hiddenRooms,
  onShowRoom,
  onResetRooms,
}: {
  settings: S;
  onChange: (next: S) => void;
  onHideAll: () => void;
  title?: string;
  /** Everything is hidden, so the button brings it back. */
  allHidden?: boolean;
  /** Choices this view has no use for. */
  without?: (typeof SHOWS)[number]["key"][];
  note?: string;
  /** Top view: rooms whose label is hidden, each with a Show button, and a reset for every room. */
  hiddenRooms?: { id: string; name: string }[];
  onShowRoom?: (id: string) => void;
  onResetRooms?: () => void;
}) {
  const set = <K extends keyof WalkLabels>(k: K, v: WalkLabels[K]) => onChange({ ...settings, [k]: v });
  return (
    <div data-testid="label-settings">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <button className="rounded-md border border-line px-2 py-1 text-sm hover:bg-line/40" onClick={onHideAll}>
          {allHidden ? "Show all" : "Hide all"}
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
      <p className="mt-3 text-xs font-medium text-muted">Show</p>
      <ul className="mt-1 space-y-1">
        {SHOWS.filter((s) => !without.includes(s.key)).map((s) => (
          <li key={s.key}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings[s.key]} onChange={(e) => set(s.key, e.target.checked)} />
              {s.label}
            </label>
          </li>
        ))}
      </ul>
      <Choice label="Text size" value={settings.textSize} options={[{ id: "small", label: "Small" }, { id: "medium", label: "Medium" }, { id: "large", label: "Large" }]} onPick={(v) => set("textSize", v)} />
      <Choice label="Text color" value={settings.textColor} options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }, { id: "auto", label: "Auto" }]} onPick={(v) => set("textColor", v)} />
      <Choice label="Background" value={settings.background} options={[{ id: "none", label: "None" }, { id: "soft", label: "Soft box" }]} onPick={(v) => set("background", v)} />
      <Choice label="Units" value={settings.units} options={[{ id: "feet", label: "Feet and inches" }, { id: "inches", label: "Inches only" }]} onPick={(v) => set("units", v)} />
      {hiddenRooms && (
        <div className="mt-4 border-t border-line pt-3" data-testid="hidden-labels">
          <p className="text-xs font-medium text-muted">Hidden labels</p>
          {hiddenRooms.length === 0 ? (
            <p className="mt-1 text-xs text-muted">None. Click a label to hide, rename or reset it, or drag it to move it.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {hiddenRooms.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  {r.name}
                  <button className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-line/40" onClick={() => onShowRoom?.(r.id)}>
                    Show
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="mt-2 rounded-md border border-line px-2 py-1 text-sm hover:bg-line/40" onClick={onResetRooms}>
            Show all and reset
          </button>
        </div>
      )}
    </div>
  );
}
