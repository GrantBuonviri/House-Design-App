"use client";

import { useEffect, useState, type ReactNode } from "react";

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

function feetText(inches: number | undefined): string {
  return inches ? String(Math.round((inches / 12) * 100) / 100) : "";
}

/** A length in feet (decimals OK, like 12.5), stored in inches. Empty means not set. */
export function FeetInput({
  value,
  onChange,
  label,
  className = "",
}: {
  value: number | undefined;
  onChange: (inches: number | undefined) => void;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState(feetText(value));
  const [focused, setFocused] = useState(false);
  // Show outside changes (undo, another page) unless the user is typing here.
  useEffect(() => {
    if (!focused) setText(feetText(value));
  }, [value, focused]);
  return (
    <input
      className={`input px-2 py-1.5 text-right tabular-nums ${className}`}
      inputMode="decimal"
      placeholder="ft"
      aria-label={label}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.]/g, "");
        setText(t);
        const ft = Number(t);
        if (t === "" || !Number.isFinite(ft) || ft <= 0) onChange(undefined);
        else onChange(Math.round(Math.min(ft, 500) * 12 * 100) / 100);
      }}
    />
  );
}
