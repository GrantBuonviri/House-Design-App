"use client";

import { DOOR_MODES, type DoorMode } from "@/lib/house3d/doors";

/** The Doors picker: Normal / All open / All closed / No doors (frames only). Used by the 3D view panel and the walkthrough bar. */
export default function DoorsPicker({ value, onChange, dark }: { value: DoorMode; onChange: (m: DoorMode) => void; dark?: boolean }) {
  return (
    <div
      className={dark ? "mt-1 flex overflow-hidden rounded-md border border-white/30" : "grid grid-cols-2 gap-1"}
      role="radiogroup"
      aria-label="Doors"
      data-testid="doors-picker"
    >
      {DOOR_MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={value === m.id}
          title={m.note}
          onClick={() => onChange(m.id)}
          className={
            dark
              ? `px-3 py-1 text-sm ${value === m.id ? "bg-white text-ink" : "hover:bg-white/15"}`
              : `rounded-md border px-2 py-1 text-left text-sm ${value === m.id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-stone-50"}`
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
