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

export default function LabelSettingsPanel({
  settings,
  onChange,
  onHideAll,
  title = "Floor labels",
}: {
  settings: WalkLabels;
  onChange: (next: WalkLabels) => void;
  onHideAll: () => void;
  title?: string;
}) {
  const set = <K extends keyof WalkLabels>(k: K, v: WalkLabels[K]) => onChange({ ...settings, [k]: v });
  return (
    <div data-testid="label-settings">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <button className="rounded-md border border-line px-2 py-1 text-sm hover:bg-line/40" onClick={onHideAll}>
          Hide all
        </button>
      </div>
      <p className="mt-3 text-xs font-medium text-muted">Show</p>
      <ul className="mt-1 space-y-1">
        {SHOWS.map((s) => (
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
    </div>
  );
}
