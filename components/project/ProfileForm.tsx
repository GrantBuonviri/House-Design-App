"use client";

import { useState } from "react";
import type { Profile } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";

function NumberField({
  id,
  label,
  value,
  onChange,
  max = 20,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  max?: number;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={max}
        className="input"
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.value === "" ? undefined : Math.max(0, Math.min(max, Math.round(Number(e.target.value))));
          onChange(Number.isNaN(n) ? undefined : n);
        }}
      />
    </div>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
        <input
          id={id}
          inputMode="numeric"
          className="input pl-6"
          value={value === undefined ? "" : value.toLocaleString("en-US")}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(digits === "" ? undefined : Number(digits));
          }}
        />
      </div>
    </div>
  );
}

function TagField({
  id,
  label,
  hint,
  placeholder,
  values,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState("");
  function add() {
    const t = text.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setText("");
  }
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="flex flex-wrap gap-2 rounded-md border border-line bg-white p-2 focus-within:border-accent">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="ml-1 opacity-60 hover:opacity-100"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="min-w-40 flex-1 px-1 text-sm outline-none"
          placeholder={values.length ? "Add another…" : placeholder}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={add}
        />
      </div>
      <p className="field-hint">{hint}</p>
    </div>
  );
}

export default function ProfileForm({ onContinue }: { onContinue: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const profile = project.profile;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    update((p) => ({ ...p, profile: { ...p.profile, [key]: value } }), { coalesce: `profile.${key}` });
  }

  const budget = profile.budget ?? {};
  const budgetBackwards = budget.low !== undefined && budget.high !== undefined && budget.low > budget.high;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Tell us about the household</h2>
        <p className="mt-1 text-sm text-muted">
          Everything here is optional. It helps the app suggest rooms and layouts later, and you can
          change it any time.
        </p>
      </div>

      <section className="card space-y-4 p-6">
        <h3 className="font-medium">Project name</h3>
        <input
          className="input"
          value={nameDraft ?? project.name}
          maxLength={120}
          onChange={(e) => {
            const name = e.target.value;
            setNameDraft(name);
            if (name.trim()) update((p) => ({ ...p, name: name.trim() }), { coalesce: "name" });
          }}
          onBlur={() => setNameDraft(null)}
        />
      </section>

      <section className="card space-y-4 p-6">
        <h3 className="font-medium">Who will live here?</h3>
        <div className="grid grid-cols-3 gap-4">
          <NumberField id="adults" label="Adults" value={profile.adults} onChange={(v) => set("adults", v)} />
          <NumberField id="kids" label="Kids" value={profile.kids} onChange={(v) => set("kids", v)} />
          <NumberField
            id="wfh"
            label="People working from home"
            value={profile.workFromHome}
            onChange={(v) => set("workFromHome", v)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="pets">
            Pets
          </label>
          <input
            id="pets"
            className="input"
            placeholder="e.g. two big dogs, one cat"
            maxLength={200}
            value={profile.pets ?? ""}
            onChange={(e) => set("pets", e.target.value || undefined)}
          />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={profile.olderRelatives ?? false}
            onChange={(e) => set("olderRelatives", e.target.checked)}
          />
          Older relatives live here or visit often
        </label>
      </section>

      <section className="card space-y-4 p-6">
        <div>
          <h3 className="font-medium">Budget for building</h3>
          <p className="field-hint">The land is free, so this is just the house and site work.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <MoneyField id="budget-low" label="From" value={budget.low} onChange={(v) => set("budget", { ...budget, low: v })} />
          <MoneyField id="budget-high" label="Up to" value={budget.high} onChange={(v) => set("budget", { ...budget, high: v })} />
        </div>
        {budgetBackwards && <p className="text-xs text-amber-700">The &ldquo;from&rdquo; amount is higher than &ldquo;up to&rdquo;.</p>}
      </section>

      <section className="card space-y-4 p-6">
        <h3 className="font-medium">Must-haves and dislikes</h3>
        <TagField
          id="must-haves"
          label="Must-haves"
          hint="Press Enter after each one."
          placeholder="e.g. big pantry, mudroom, shop space"
          values={profile.mustHaves}
          onChange={(v) => set("mustHaves", v)}
        />
        <TagField
          id="dislikes"
          label="Dislikes"
          hint="Press Enter after each one."
          placeholder="e.g. carpet, formal dining room"
          values={profile.dislikes}
          onChange={(v) => set("dislikes", v)}
        />
        <div>
          <label className="field-label" htmlFor="notes">
            Anything else?
          </label>
          <textarea
            id="notes"
            rows={3}
            className="input"
            maxLength={2000}
            value={profile.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || undefined)}
          />
        </div>
      </section>

      <div className="flex justify-end pb-10">
        <button className="btn-primary" onClick={onContinue}>
          Next: pick your land →
        </button>
      </div>
    </div>
  );
}
