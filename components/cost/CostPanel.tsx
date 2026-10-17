"use client";

import { useState } from "react";
import type { CostSettings } from "@/lib/model/schema";
import { fullMoney, shortMoney, type CostCategory, type CostLine, type Estimate } from "@/lib/cost/estimate";
import { placeLabel } from "@/lib/location/cities";

/** The top-bar total. Clicking it opens and closes the cost panel. */
export function CostBadge({ estimate, error, open, onToggle }: { estimate: Estimate | null; error?: string | null; open: boolean; onToggle: () => void }) {
  if (error) {
    return (
      <button className="btn border-red-300 text-red-700" onClick={() => alert(`The cost estimate couldn't be worked out:\n\n${error}`)} title={error}>
        Cost: problem with the rates file
      </button>
    );
  }
  if (!estimate) {
    return (
      <button className="btn" disabled title="Add rooms on the Rooms page to see a cost estimate">
        Cost
      </button>
    );
  }
  const t = estimate.total;
  return (
    <button
      className={`btn tabular-nums ${open ? "border-accent bg-accent-soft" : ""}`}
      onClick={onToggle}
      title={`Likely materials cost ${fullMoney(t.likely)}, from ${fullMoney(t.low)} to ${fullMoney(t.high)}. Click for the breakdown.`}
      data-testid="cost-badge"
    >
      <span className="text-muted">{estimate.source === "rough" ? "Rough materials" : "Materials"}</span>
      <span>about {shortMoney(t.likely)}</span>
      <span className="text-xs text-muted">
        ({shortMoney(t.low)} to {shortMoney(t.high)})
      </span>
    </button>
  );
}

const UNIT: Record<CostLine["unit"], string> = { sqft: "sq ft", linft: "ft", each: "", cuyd: "cu yd", percent: "%", value: "" };

function amount(l: CostLine): string {
  if (l.unit === "percent") return `${l.qty}%`;
  if (l.unit === "value") return `on ${fullMoney(l.qty)} building value`;
  const n = l.unit === "each" && l.qty < 20 ? (Math.round(l.qty * 10) / 10).toString() : Math.round(l.qty).toLocaleString("en-US");
  return l.unit === "each" ? `${n} ×` : `${n} ${UNIT[l.unit]}`;
}

function rate(l: CostLine): string | null {
  if (l.material === null) return null;
  const per = l.unit === "each" ? "each" : `per ${UNIT[l.unit]}`;
  const f = (n: number) => (n >= 100 ? fullMoney(n) : `$${n.toFixed(2).replace(/\.00$/, "")}`);
  return `${f(l.material)} ${per}${l.hired ? ", hired out, full price" : ""}`;
}

/** Which jobs in this estimate are priced in full, in plain words for the disclaimer. */
const HIRED_NAMES: Record<string, string> = {
  "site-prep": "site prep",
  excavation: "digging",
  "backfill-grade": "grading",
  "rock-removal": "rock removal",
  "utility-trench": "trenching",
  "drainage-some": "drainage",
  "drainage-major": "drainage",
  "water-service": "water service",
  well: "well",
  septic: "septic",
};

function hiredJobs(estimate: Estimate): string[] {
  const names = new Set<string>();
  for (const c of estimate.categories) for (const l of c.lines) if (l.hired && l.rate && l.cost.likely > 0) names.add(HIRED_NAMES[l.rate] ?? l.label.toLowerCase());
  return [...names];
}

function joinList(a: string[]): string {
  return a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

function Line({ l }: { l: CostLine }) {
  const r = rate(l);
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{l.product ?? l.label}</span>
        <span className="text-sm tabular-nums">{fullMoney(l.cost.likely)}</span>
      </div>
      <div className="mt-0.5 text-xs text-muted">
        {amount(l)}
        {r ? ` at ${r}` : ""}
      </div>
      <div className="mt-0.5 text-xs text-muted" title={l.note}>
        {l.url ? (
          <a href={l.url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
            {l.source}
          </a>
        ) : (
          l.source
        )}
        {l.checked ? ` · checked ${l.checked}` : ""}
      </div>
    </li>
  );
}

function Category({ c, max, open, onToggle }: { c: CostCategory; max: number; open: boolean; onToggle: () => void }) {
  const empty = c.lines.length === 0;
  return (
    <li className="border-b border-line last:border-b-0">
      <button className="w-full py-2 text-left disabled:cursor-default" onClick={onToggle} disabled={empty} data-testid={`cost-cat-${c.id}`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm">
            <span className="mr-1 inline-block w-3 text-muted">{empty ? "" : open ? "▾" : "▸"}</span>
            {c.label}
          </span>
          <span className="text-sm tabular-nums">{empty ? "$0" : shortMoney(c.cost.likely)}</span>
        </div>
        <div className="mt-1 ml-4 h-1.5 rounded-full bg-stone-100">
          <div className="h-1.5 rounded-full bg-accent/70" style={{ width: `${max ? (c.cost.likely / max) * 100 : 0}%` }} />
        </div>
      </button>
      {open && <ul className="mb-2 ml-4 divide-y divide-line border-t border-line">{c.lines.map((l, i) => <Line key={`${l.id}-${i}`} l={l} />)}</ul>}
    </li>
  );
}

const UTILITIES: { id: CostSettings["utilities"]; label: string }[] = [
  { id: "city", label: "City hookups" },
  { id: "well-septic", label: "Well and septic" },
];

const PERMIT_BASIS = {
  typical: "A typical fee table. Type your city's real fee to replace it.",
  city: "This city's own fee schedule. Type a fee to replace it.",
  typed: "Your fee.",
} as const;

/** "City, ST", or "a house elsewhere in <state>" for a state's catch-all place. */
function placePhrase(place: Estimate["place"]): string {
  const label = placeLabel(place);
  return place.cityId.startsWith("elsewhere-") ? `a house ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
}

function PermitFeeBox({ estimate, onChange, onPickPlace }: { estimate: Estimate; onChange: (fee: number | null) => void; onPickPlace?: () => void }) {
  const line = estimate.categories.flatMap((c) => c.lines).find((l) => l.id === "building-permit");
  const typed = estimate.permitBasis === "typed";
  const saved = typed && line ? String(Math.round(line.cost.likely)) : "";
  const [text, setText] = useState(saved);
  // Follow the saved fee when it changes from outside the box (Undo, Redo).
  const [shown, setShown] = useState(saved);
  if (saved !== shown) {
    setShown(saved);
    setText(saved);
  }
  const commit = () => {
    if (text.trim() === saved) return;
    const n = Number(text.replace(/[$,\s]/g, ""));
    if (text.trim() === "") onChange(null);
    else if (Number.isFinite(n) && n >= 0) onChange(Math.round(n));
  };
  // The fee belongs to a place: typing one before a place is picked would quietly pick the default place.
  if (!estimate.place.picked)
    return (
      <div className="mt-4" data-testid="permit-fee-box">
        <div className="text-sm font-medium">Permit fee</div>
        <p className="mt-1 text-xs text-muted">
          No place is picked yet, so this uses {placeLabel(estimate.place)}&apos;s fee. To type your own fee, first pick where you&apos;ll build in Project setup.
          {onPickPlace && (
            <>
              {" "}
              <button className="text-accent underline" onClick={onPickPlace}>
                Pick a place
              </button>
            </>
          )}
        </p>
      </div>
    );
  return (
    <div className="mt-4" data-testid="permit-fee-box">
      <div className="text-sm font-medium">Permit fee</div>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="text-muted">$</span>
        <input
          className="w-28 rounded-md border border-line px-2 py-1 tabular-nums"
          inputMode="numeric"
          placeholder={line ? String(Math.round(line.cost.likely)) : "typical"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Building permit fee in dollars"
        />
        {typed && (
          <button
            className="text-xs text-accent underline"
            onClick={() => {
              setText("");
              onChange(null);
            }}
          >
            Use the usual fee
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{PERMIT_BASIS[estimate.permitBasis]}</p>
    </div>
  );
}

export default function CostPanel({
  estimate,
  onClose,
  onUtilities,
  onPermitFee,
  onPickPlace,
}: {
  estimate: Estimate;
  onClose: () => void;
  onUtilities: (u: CostSettings["utilities"]) => void;
  /** The person's own permit fee in dollars, or null to go back to the typical fee table. */
  onPermitFee: (fee: number | null) => void;
  /** Go to Project setup to pick where the house will be built. */
  onPickPlace?: () => void;
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const t = estimate.total;
  const max = Math.max(...estimate.categories.map((c) => c.cost.likely));
  const q = estimate.quantities;
  return (
    <aside className="fixed top-0 right-0 bottom-0 z-30 flex w-[380px] flex-col border-l border-line bg-white shadow-xl" data-testid="cost-panel">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-semibold">Materials estimate</h2>
        <button className="rounded px-2 py-1 text-muted hover:bg-stone-100 hover:text-ink" onClick={onClose} aria-label="Close cost panel">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="text-3xl font-semibold tabular-nums">{fullMoney(t.likely)}</div>
        <div className="mt-1 text-sm text-muted tabular-nums">
          Likely materials cost. Range {fullMoney(t.low)} to {fullMoney(t.high)}.
        </div>
        <div className="mt-1 text-sm text-muted tabular-nums">
          About {fullMoney(estimate.perSqft.likely)} per sq ft for {Math.round(q.livingSqft).toLocaleString("en-US")} sq ft of living space
          {q.garageSqft > 1 ? ` (plus ${Math.round(q.garageSqft).toLocaleString("en-US")} sq ft of garage)` : ""}.
        </div>
        <p className="mt-3 rounded-md bg-stone-100 px-3 py-2 text-sm text-ink" data-testid="cost-disclaimer">
          Materials only. Labor isn&apos;t included
          {hiredJobs(estimate).length
            ? `, except for jobs usually hired out as a whole (${joinList(hiredJobs(estimate))}), which are full price`
            : ""}
          . Permits and fees are included.
        </p>
        {estimate.source === "rough" && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Rough: based on your room list. Draw the floor plan for a closer number.
          </p>
        )}

        <div className="mt-4 flex items-baseline justify-between border-y border-line py-2 text-sm">
          <span>Land</span>
          <span className="tabular-nums">$0</span>
        </div>

        <div className="mt-4">
          <div className="text-sm font-medium">Water and sewer</div>
          <div className="mt-1 flex gap-1">
            {UTILITIES.map((u) => (
              <button
                key={u.id}
                className={`rounded-md border px-3 py-1.5 text-sm ${estimate.utilities === u.id ? "border-accent bg-accent-soft" : "border-line hover:bg-stone-50"}`}
                onClick={() => onUtilities(u.id)}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        <PermitFeeBox estimate={estimate} onChange={onPermitFee} onPickPlace={onPickPlace} />

        {estimate.drivers.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium">Biggest drivers</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
              {estimate.drivers.map((d) => (
                <li key={d.text}>{d.text}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 text-sm font-medium">By category</div>
        <ul className="mt-1">
          {estimate.categories.map((c) => (
            <Category key={c.id} c={c} max={max} open={openCat === c.id} onToggle={() => setOpenCat(openCat === c.id ? null : c.id)} />
          ))}
        </ul>

        <p className="mt-4 text-xs text-muted">
          Finishes are priced as mid-range until you pick products in the Interior and Exterior design windows (press I or X in the Walkthrough). Click a category to see what was measured, the rates, and
          where each rate came from.
        </p>
        <p className="mt-2 text-xs text-muted">
          This is a materials estimate for {placePhrase(estimate.place)} in 2026 (cost level {estimate.place.costIndex.toFixed(2)}), not a bid. Real prices vary by store and change over time.
        </p>
      </div>
    </aside>
  );
}
