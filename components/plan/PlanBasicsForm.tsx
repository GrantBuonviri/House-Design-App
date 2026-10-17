"use client";

import { useState } from "react";
import type { Level, PlanBasics } from "@/lib/model/schema";
import { formatFeetInches } from "@/lib/model/units";
import { DOOR_STYLE_LABEL, GARAGE_LABEL, STAIRS_LABEL, ceilingFor, defaultBasics } from "@/lib/plan/basics";
import { usePlace } from "@/lib/location/usePlace";
import { placeLabel } from "@/lib/location/cities";

const CEILINGS = [96, 108, 120, 144];

/**
 * The questions the floor plan needs before it starts: ceiling heights, wall
 * thickness, garage, stairs and doors. Every answer comes filled in.
 */
export default function PlanBasicsForm({
  basics,
  levels,
  hasGarage,
  hasStairs,
  onSave,
  onCancel,
}: {
  basics: PlanBasics | null;
  levels: Level[];
  hasGarage: boolean;
  hasStairs: boolean;
  onSave: (b: PlanBasics) => void;
  onCancel?: () => void;
}) {
  const place = usePlace();
  const [b, setB] = useState<PlanBasics>(() => {
    const start = basics ?? defaultBasics(place.climateZone);
    return { ...start, ceilings: Object.fromEntries(levels.map((l) => [l.id, ceilingFor(start, l)])) };
  });
  const set = (patch: Partial<PlanBasics>) => setB((x) => ({ ...x, ...patch }));
  const top = [...levels].sort((a, c) => c.elevationIn - a.elevationIn);

  return (
    <div className="card mx-auto max-w-2xl px-8 py-8">
      <h2 className="text-xl font-semibold tracking-tight">Plan basics</h2>
      <p className="mt-1 text-sm text-muted">A few things the floor plan needs. Each one starts with a common choice for a new house in {placeLabel(place)}, so you can just press Continue. You can change them later.</p>

      <Section title="Ceiling height">
        <div className="space-y-2">
          {top.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-4">
              <span className="text-sm">{l.name}</span>
              <Segments
                label={`${l.name} ceiling`}
                options={CEILINGS.map((c) => ({ value: c, label: formatFeetInches(c) }))}
                value={b.ceilings[l.id]}
                onChange={(v) => set({ ceilings: { ...b.ceilings, [l.id]: v } })}
              />
            </div>
          ))}
        </div>
        <p className="field-hint">Taller ceilings feel airier and make the stairs a little longer.</p>
      </Section>

      <Section title="Outside walls">
        <Radios
          name="exterior"
          value={b.exteriorWall}
          options={[
            { value: "2x6", label: "2x6 framing", note: "Thicker walls with more insulation. The usual choice in cold climates." },
            { value: "2x4", label: "2x4 framing", note: "Thinner walls and a little cheaper, with less room for insulation." },
          ]}
          onChange={(v) => set({ exteriorWall: v })}
        />
      </Section>

      {hasGarage && (
        <Section title="Garage">
          <Radios name="garage" value={b.garage} options={(Object.keys(GARAGE_LABEL) as PlanBasics["garage"][]).map((k) => ({ value: k, label: GARAGE_LABEL[k] }))} onChange={(v) => set({ garage: v })} />
        </Section>
      )}

      {hasStairs && (
        <Section title="Stairs">
          <Radios
            name="stairs"
            value={b.stairs}
            options={[
              { value: "straight", label: STAIRS_LABEL.straight, note: "Simplest and cheapest; needs one long run of floor." },
              { value: "l", label: STAIRS_LABEL.l, note: "Turns a corner partway up. Fits a squarer space." },
              { value: "u", label: STAIRS_LABEL.u, note: "Doubles back on itself. The most compact." },
            ]}
            onChange={(v) => set({ stairs: v })}
          />
        </Section>
      )}

      <Section title="Inside doors">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">Height</span>
          <Segments
            label="Door height"
            options={[
              { value: 80, label: `6' 8" (standard)` },
              { value: 96, label: `8' (taller ceilings)` },
            ]}
            value={b.doorHeightIn}
            onChange={(v) => set({ doorHeightIn: v })}
          />
        </div>
        <label className="field-label mt-3" htmlFor="door-style">
          Style
        </label>
        <select id="door-style" className="input" value={b.doorStyle} onChange={(e) => set({ doorStyle: e.target.value as PlanBasics["doorStyle"] })}>
          {(Object.keys(DOOR_STYLE_LABEL) as PlanBasics["doorStyle"][]).map((k) => (
            <option key={k} value={k}>
              {DOOR_STYLE_LABEL[k]}
            </option>
          ))}
        </select>
      </Section>

      <div className="mt-8 flex justify-end gap-3">
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn-primary" onClick={() => onSave(b)}>
          Continue
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Segments<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-white p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          className={`rounded px-3 py-1 text-sm ${value === o.value ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Radios<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string; note?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-white px-3 py-2 hover:border-accent/50">
          <input type="radio" name={name} className="mt-1 size-4 accent-[var(--color-accent)]" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <span className="text-sm font-medium">{o.label}</span>
            {o.note && <span className="block text-xs text-muted">{o.note}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
