"use client";

import { useMemo, useState } from "react";
import { LOT_SIDES, RealLot, type Easement, type LotSide, type PlansSettings, type Project } from "@/lib/model/schema";
import { lotFromCustomLand, siteLayout } from "@/lib/plans/lot";
import { limitText, lotLimits, shedWarning, tallShedRise } from "@/lib/plans/lotLimits";

/**
 * "My real lot": the owner's lot from the recorded plat, so the site plan
 * and setback checks use the real property instead of the app's sample land.
 * A small sketch shows the lot and the house on it as you type.
 */

type Draft = {
  shape: RealLot["shape"];
  frontFt: string;
  rearFt: string;
  leftFt: string;
  rightFt: string;
  streetSide: RealLot["streetSide"];
  sideStreet: RealLot["sideStreet"];
  setFront: string;
  setSide: string;
  setRear: string;
  setStreet: string;
  easements: { id: string; side: LotSide; widthFt: string; kind: string }[];
  houseFrontFt: string;
  houseLeftFt: string;
  heightLimitFt: string;
  coverageLimitPct: string;
};

const str = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "" : String(n));
const num = (s: string): number | null => {
  const n = Number(s.trim());
  return s.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
};

function toDraft(lot: RealLot | null, fallbackStreet: RealLot["streetSide"]): Draft {
  return {
    shape: lot?.shape ?? "rectangle",
    frontFt: str(lot?.frontFt),
    rearFt: str(lot?.rearFt),
    leftFt: str(lot?.leftFt),
    rightFt: str(lot?.rightFt),
    streetSide: lot?.streetSide ?? fallbackStreet,
    sideStreet: lot?.sideStreet ?? "none",
    setFront: str(lot?.setbacks.front),
    setSide: str(lot?.setbacks.side),
    setRear: str(lot?.setbacks.rear),
    setStreet: str(lot?.setbacks.streetSide),
    easements: (lot?.easements ?? []).map((e) => ({ ...e, widthFt: str(e.widthFt) })),
    houseFrontFt: str(lot?.houseFrontFt),
    houseLeftFt: str(lot?.houseLeftFt),
    heightLimitFt: str(lot?.heightLimitFt),
    coverageLimitPct: str(lot?.coverageLimitPct),
  };
}

function toLot(d: Draft): RealLot {
  const rect = d.shape === "rectangle";
  const front = num(d.frontFt) ?? 0;
  const left = num(d.leftFt) ?? 0;
  return RealLot.parse({
    shape: d.shape,
    frontFt: front,
    rearFt: rect ? front : (num(d.rearFt) ?? 0),
    leftFt: left,
    rightFt: rect ? left : (num(d.rightFt) ?? 0),
    streetSide: d.streetSide,
    sideStreet: d.sideStreet,
    setbacks: { front: num(d.setFront), side: num(d.setSide), rear: num(d.setRear), streetSide: d.sideStreet === "none" ? null : num(d.setStreet) },
    easements: d.easements.map((e): Easement => ({ id: e.id, side: e.side, widthFt: num(e.widthFt) ?? 0, kind: e.kind.trim() || "Public utility easement" })),
    houseFrontFt: num(d.houseFrontFt),
    houseLeftFt: num(d.houseLeftFt),
    heightLimitFt: num(d.heightLimitFt),
    coverageLimitPct: num(d.coverageLimitPct),
  });
}

const COMPASS: { v: RealLot["streetSide"]; label: string }[] = [
  { v: "N", label: "North side" },
  { v: "E", label: "East side" },
  { v: "S", label: "South side" },
  { v: "W", label: "West side" },
];

export default function RealLotForm({ project, onSave, onClose }: { project: Project; onSave: (patch: Partial<PlansSettings>) => void; onClose: () => void }) {
  const [address, setAddress] = useState(project.plans.address);
  const [parcel, setParcel] = useState(project.plans.parcel);
  const [d, setD] = useState<Draft>(() => toDraft(project.plans.lot, project.plot?.roadSide ?? "S"));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const lot = useMemo(() => toLot(d), [d]);
  const trial = useMemo(() => ({ ...project, plans: { ...project.plans, lot } }), [project, lot]);
  const site = useMemo(() => siteLayout(trial), [trial]);
  const limits = useMemo(() => (site?.real ? lotLimits(trial) : []), [site, trial]);
  const shedRise = useMemo(() => (site?.real ? tallShedRise(trial) : null), [site, trial]);
  const rect = d.shape === "rectangle";
  const custom = project.plot?.source === "custom";
  const [copyNote, setCopyNote] = useState<string | null>(null);
  function copyFromCustom() {
    const got = lotFromCustomLand(project.plot);
    if ("problem" in got) return setCopyNote(got.problem);
    const l = got.lot;
    set({ shape: l.shape, frontFt: String(l.frontFt), rearFt: String(l.rearFt), leftFt: String(l.leftFt), rightFt: String(l.rightFt), streetSide: l.streetSide, sideStreet: l.sideStreet });
    setCopyNote("Copied the side lengths and street from your designed land. Check them against the plat.");
  }

  const field = (id: keyof Draft, label: string, hint?: string) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className="input" inputMode="decimal" value={d[id] as string} onChange={(e) => set({ [id]: e.target.value } as Partial<Draft>)} data-testid={`lot-${id}`} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" role="dialog" aria-label="My real lot" data-testid="real-lot-form">
      <form
        className="card flex max-h-full w-full max-w-4xl flex-col p-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ address: address.trim(), parcel: parcel.trim(), lot });
          onClose();
        }}
      >
        <h3 className="text-lg font-semibold">My real lot</h3>
        <p className="mb-3 text-sm text-muted">From your lot&apos;s recorded plat or survey (your county recorder or assessor has them). The site plan and setback checks use it instead of the sample land. All lengths in feet.</p>
        {custom && (
          <div className="mb-3 flex items-center gap-3 text-sm">
            <button type="button" className="btn py-1" onClick={copyFromCustom} data-testid="lot-copy-custom">
              Copy from my custom land
            </button>
            {copyNote && <span className="text-muted" data-testid="lot-copy-note">{copyNote}</span>}
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-5 overflow-y-auto">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Site address</span>
                <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1234 W Example St" />
              </label>
              <label className="block">
                <span className="field-label">Parcel number</span>
                <input className="input" value={parcel} onChange={(e) => setParcel(e.target.value)} placeholder="R1234567890" />
              </label>
            </div>
            <fieldset>
              <legend className="field-label">The street</legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-hint">Which side of the lot is on the street</span>
                  <select className="input" value={d.streetSide} onChange={(e) => set({ streetSide: e.target.value as Draft["streetSide"] })} data-testid="lot-street">
                    {COMPASS.map((c) => (
                      <option key={c.v} value={c.v}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-hint">Corner lot</span>
                  <select className="input" value={d.sideStreet} onChange={(e) => set({ sideStreet: e.target.value as Draft["sideStreet"] })}>
                    <option value="none">Not a corner lot</option>
                    <option value="left">Side street on the left</option>
                    <option value="right">Side street on the right</option>
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="field-label">Shape and sides (left and right as seen from the street)</legend>
              <div className="mb-2 flex gap-4 text-sm">
                <label className="flex items-center gap-1">
                  <input type="radio" checked={rect} onChange={() => set({ shape: "rectangle" })} /> Rectangle
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={!rect} onChange={() => set({ shape: "four-sides" })} data-testid="lot-four-sides" /> Four sides, front and rear parallel
                </label>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {field("frontFt", rect ? "Width along the street" : "Front")}
                {field("leftFt", rect ? "Depth" : "Left side")}
                {!rect && field("rearFt", "Rear")}
                {!rect && field("rightFt", "Right side")}
              </div>
            </fieldset>
            <fieldset>
              <legend className="field-label">Setbacks from zoning (leave empty if you don&apos;t know)</legend>
              <div className="grid grid-cols-4 gap-3">
                {field("setFront", "Front")}
                {field("setSide", "Each side")}
                {field("setRear", "Rear")}
                {d.sideStreet !== "none" && field("setStreet", "Street side")}
              </div>
              <p className="field-hint">Your city or county planning office gives these for your lot&apos;s zone.</p>
            </fieldset>
            <fieldset>
              <legend className="field-label">Easements on the plat</legend>
              <div className="space-y-2">
                {d.easements.map((e, i) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <select className="input w-28" value={e.side} onChange={(x) => set({ easements: d.easements.map((y, k) => (k === i ? { ...y, side: x.target.value as LotSide } : y)) })} aria-label="Side">
                      {LOT_SIDES.map((s) => (
                        <option key={s} value={s}>
                          {s[0].toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                    <input className="input w-20" inputMode="decimal" value={e.widthFt} placeholder="ft" aria-label="Width in feet" onChange={(x) => set({ easements: d.easements.map((y, k) => (k === i ? { ...y, widthFt: x.target.value } : y)) })} />
                    <input className="input flex-1" value={e.kind} aria-label="Kind of easement" onChange={(x) => set({ easements: d.easements.map((y, k) => (k === i ? { ...y, kind: x.target.value } : y)) })} />
                    <button type="button" className="btn py-1" onClick={() => set({ easements: d.easements.filter((_, k) => k !== i) })}>
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="btn py-1" onClick={() => set({ easements: [...d.easements, { id: `e${Date.now()}`, side: "rear", widthFt: "10", kind: "Public utility easement" }] })} data-testid="lot-add-easement">
                  Add an easement
                </button>
              </div>
            </fieldset>
            <fieldset>
              <legend className="field-label">Where the house sits (leave empty to center it behind the front setback)</legend>
              <div className="grid grid-cols-2 gap-3">
                {field("houseFrontFt", "From the front line")}
                {field("houseLeftFt", "From the left line")}
                {field("heightLimitFt", "Height limit", "Zoning, if known")}
                {field("coverageLimitPct", "Lot coverage limit", "Percent, if known")}
              </div>
            </fieldset>
          </div>
          <div className="space-y-3">
            <LotSketch site={site} />
            {site?.real ? (
              <table className="w-full text-xs" data-testid="lot-checks">
                <thead>
                  <tr className="text-left text-muted">
                    <th>Setback</th>
                    <th>Needed</th>
                    <th>House</th>
                  </tr>
                </thead>
                <tbody>
                  {site.checks.map((c) => (
                    <tr key={c.side} className={c.ok === false ? "text-red-700" : ""}>
                      <td>{c.name}</td>
                      <td>{c.requiredFt === null ? "–" : `${c.requiredFt} ft`}</td>
                      <td>
                        {c.providedFt < 0 ? `${(-c.providedFt).toFixed(1)} ft past the lot line` : `${c.providedFt.toFixed(1)} ft${c.ok === false ? " (too close)" : ""}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{site?.problems[0] ?? "Enter the lot's sides to see it here."}</p>
            )}
            {site?.real && (
              <table className="w-full text-xs" data-testid="lot-limits">
                <thead>
                  <tr className="text-left text-muted">
                    <th>Limit</th>
                    <th>Allowed</th>
                    <th>House</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map((c) => (
                    <tr key={c.id} className={c.ok === false ? "text-red-700" : ""} data-testid={`lot-limit-${c.id}`}>
                      <td>{c.name}</td>
                      <td>{c.limit ? limitText(c.limit, c.unit) : "–"}</td>
                      <td>
                        {limitText(c.actual, c.unit)}
                        {c.ok === false ? (c.id === "coverage" ? " (covers too much)" : " (too tall)") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {shedRise !== null && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900" data-testid="lot-shed-warning">{shedWarning(shedRise)}</p>}
            {site?.real && <p className="text-xs text-muted">Lot area {Math.round(site.areaSqft).toLocaleString("en-US")} sq ft ({(site.areaSqft / 43560).toFixed(2)} acres).</p>}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {project.plans.lot && (
            <button
              type="button"
              className="btn text-red-700"
              onClick={() => {
                onSave({ lot: null });
                onClose();
              }}
            >
              Use the sample land instead
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" data-testid="real-lot-save">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** The lot, setback line and house, north up. */
function LotSketch({ site }: { site: ReturnType<typeof siteLayout> }) {
  // Each setback line is green when the house stays inside it and red when it reaches over.
  const mid = site?.real ? { x: site.outline.reduce((t, q) => t + q.x, 0) / site.outline.length, y: site.outline.reduce((t, q) => t + q.y, 0) / site.outline.length } : null;
  const setbackLines = !site?.real || !mid
    ? []
    : site.lines.flatMap((l) => {
        if (l.setbackFt === null) return [];
        const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) || 1;
        let n = { x: -(l.b.y - l.a.y) / len, y: (l.b.x - l.a.x) / len };
        if ((mid.x - l.a.x) * n.x + (mid.y - l.a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
        const d = l.setbackFt * 12;
        const ok = site.checks.find((c) => c.side === l.side)?.ok;
        return [{ side: l.side, x1: l.a.x + n.x * d, y1: l.a.y + n.y * d, x2: l.b.x + n.x * d, y2: l.b.y + n.y * d, ok }];
      });
  if (!site?.real) return <div className="flex aspect-square items-center justify-center rounded-md border border-line text-xs text-muted">No lot yet</div>;
  const pts = [...site.outline, ...site.house.flat()];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 120;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad;
  const h = Math.max(...ys) - y0 + pad;
  const sw = Math.max(w, h) / 200;
  const path = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(" ");
  return (
    <svg viewBox={`${x0} ${y0} ${w} ${h}`} className="aspect-square w-full rounded-md border border-line bg-white" data-testid="lot-sketch">
      {site.easements.map((e, i) => (
        <polygon key={i} points={path(e.pts)} fill="#fde68a" fillOpacity={0.5} stroke="none" />
      ))}
      <polygon points={path(site.outline)} fill="none" stroke="#111" strokeWidth={sw * 1.5} strokeDasharray={`${sw * 8} ${sw * 3}`} />
      {setbackLines.map((l) => (
        <line key={l.side} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.ok === false ? "#dc2626" : "#16a34a"} strokeWidth={sw * 1.5} data-testid={`setback-${l.side}-${l.ok === false ? "red" : "green"}`} />
      ))}
      {site.house.map((r, i) => (
        <polygon key={i} points={path(r)} fill={site.checks.some((c) => c.ok === false) ? "#fecaca" : "#d6e4d0"} stroke="#111" strokeWidth={sw} />
      ))}
      {site.lines
        .filter((l) => l.street)
        .map((l, i) => (
          <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#64748b" strokeWidth={sw * 4} />
        ))}
      <text x={x0 + w - sw * 12} y={y0 + sw * 16} fontSize={sw * 12} textAnchor="end">
        N ↑
      </text>
    </svg>
  );
}
