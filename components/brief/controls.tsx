"use client";

import { useId, useState, type ReactNode } from "react";

/** Small form controls shared by the question pages and the brief editor. */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 10,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-line bg-white">
      <button
        type="button"
        className="px-3 py-2 text-lg leading-none hover:bg-stone-50 disabled:opacity-30"
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="min-w-10 text-center text-sm font-medium tabular-nums" aria-live="polite" aria-label={label}>
        {value}
      </span>
      <button
        type="button"
        className="px-3 py-2 text-lg leading-none hover:bg-stone-50 disabled:opacity-30"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

/** Pick one of a few options, shown as a row of buttons. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3.5 py-1.5 text-sm ${
            value === o.value ? "border-accent bg-accent text-white" : "border-line bg-white hover:border-accent"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pick any number of options. */
export function MultiChoice({
  value,
  options,
  onChange,
  label,
}: {
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o)}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${
              on ? "border-accent bg-accent-soft text-accent" : "border-line bg-white hover:border-accent"
            }`}
          >
            {on ? "✓ " : ""}
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** A slider between two ideas, like cozy and airy. */
export function Scale({
  value,
  onChange,
  left,
  right,
}: {
  value: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
}) {
  const id = useId();
  return (
    <div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${left} to ${right}`}
        className="w-full accent-[var(--color-accent)]"
      />
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span className={value < 35 ? "font-medium text-ink" : ""}>{left}</span>
        <span className={value > 65 ? "font-medium text-ink" : ""}>{right}</span>
      </div>
    </div>
  );
}

/** A list of short words or phrases, with suggestions and a box to add your own. */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add your own",
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  label: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (word: string) => {
    const w = word.trim();
    if (!w || value.some((v) => v.toLowerCase() === w.toLowerCase())) return;
    onChange([...value, w]);
  };
  const unused = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="list" aria-label={label}>
        {value.map((v) => (
          <span key={v} role="listitem" className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
            {v}
            <button
              type="button"
              className="ml-0.5 text-accent/70 hover:text-accent"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
        <form
          className="inline-flex"
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
            setDraft("");
          }}
        >
          <input
            className="w-40 rounded-full border border-dashed border-line bg-white px-3 py-1 text-sm outline-none focus:border-accent"
            placeholder={placeholder}
            aria-label={`${label}: add`}
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
