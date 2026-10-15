"use client";

import { useEffect, useMemo, useState } from "react";
import type { HouseSystems, PlansSettings, Project, Stage } from "@/lib/model/schema";
import { useProjectStore } from "@/lib/store/projectStore";
import { canDraw, LABEL_REVIEW, readiness, SHEET_GROUPS, STATUS_LABEL, type Reason, type SheetEntry, type SheetStatus } from "@/lib/plans/catalog";
import { buildSet, selectedIds } from "@/lib/plans/build";
import { downloadPdf, pdfFileName, sheetsToPdf } from "@/lib/plans/pdf";
import { codeReportPages } from "@/lib/plans/report";
import { reportCounts, type RuleReport, type RuleStatus } from "@/lib/codes/rules";
import SheetSvg from "./SheetSvg";
import RealLotForm from "./RealLotForm";
import CabinetEditor from "./CabinetEditor";
import DeviceEditor from "./DeviceEditor";
import { hasCabinetRuns } from "@/lib/plans/sheets/cabinets";

/**
 * The Plans page: every sheet a Boise permit asks for, with its status and
 * what it still needs, a preview, and PDF export of the chosen sheets or the
 * code check on its own.
 */

const CHIP: Record<SheetStatus, string> = {
  ready: "bg-accent-soft text-accent",
  notes: "bg-amber-50 text-amber-800",
  needs: "bg-red-50 text-red-700",
  "not-needed": "bg-stone-100 text-muted",
  outside: "bg-sky-50 text-sky-800",
  soon: "bg-stone-100 text-muted",
};

const RESULT_CHIP: Record<RuleStatus, string> = {
  pass: "bg-accent-soft text-accent",
  fail: "bg-red-50 text-red-700",
  manual: "bg-stone-100 text-ink",
};
const RESULT_LABEL: Record<RuleStatus, string> = { pass: "Pass", fail: "Fail", manual: "Check by hand" };

export default function PlansPage({ project, onClose, onGo }: { project: Project; onClose: () => void; onGo: (stage: Stage) => void }) {
  const update = useProjectStore((s) => s.update);
  const r = readiness(project);
  const [tab, setTab] = useState<"sheets" | "code">("sheets");
  const [preview, setPreview] = useState<string>(() => r.sheets.find((s) => s.id.startsWith("floor:"))?.id ?? "cover");
  const [details, setDetails] = useState(false);
  const [lotOpen, setLotOpen] = useState(false);
  const [cabinetsOpen, setCabinetsOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const selected = useMemo(() => new Set(selectedIds(project)), [project]);
  const excluded = new Set(project.plans.excluded);
  const half = project.plans.sheetSize === "half";

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !details && !lotOpen && !cabinetsOpen && !devicesOpen && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose, details, lotOpen, cabinetsOpen, devicesOpen]);

  const previewEntry = r.sheets.find((s) => s.id === preview && canDraw(s));
  const sheets = useMemo(() => (previewEntry ? buildSet(project, { only: [...selected, previewEntry.id] }) : []), [project, selected, previewEntry]);
  const shown = sheets.filter((s) => s.id === preview || s.id.startsWith(`${preview}:`));

  const setPlans = (patch: Partial<PlansSettings>, coalesce?: string) => update((p) => ({ ...p, plans: { ...p.plans, ...patch } }), coalesce ? { coalesce } : undefined);
  const toggle = (id: string) => setPlans({ excluded: excluded.has(id) ? project.plans.excluded.filter((x) => x !== id) : [...project.plans.excluded, id] });

  async function exportSheets(ids: string[], what: string) {
    setBusy(what);
    try {
      const set = buildSet(project, { only: ids });
      const doc = await sheetsToPdf(set, half ? 0.5 : 1);
      downloadPdf(doc, pdfFileName(project.name, what));
    } finally {
      setBusy(null);
    }
  }
  async function exportReport() {
    setBusy("code check");
    try {
      downloadPdf(await sheetsToPdf(codeReportPages(project)), pdfFileName(project.name, "code check"));
    } finally {
      setBusy(null);
    }
  }

  const go = (reason: Reason) => {
    if (reason.action === "details") setDetails(true);
    else if (reason.action === "lot") setLotOpen(true);
    else if (reason.action === "cabinets") setCabinetsOpen(true);
    else if (reason.action === "devices") setDevicesOpen(true);
    else if (reason.stage) onGo(reason.stage);
  };
  const counts = reportCounts(r.report);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper" data-testid="plans-page">
      <header className="flex items-center gap-3 whitespace-nowrap border-b border-line bg-white px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Building plans</h2>
          <p className="truncate text-xs text-muted">{project.name} · 2018 IRC and IECC with Idaho amendments, 2023 NEC, 2017 Idaho State Plumbing Code</p>
        </div>
        <span
          className={`ml-2 rounded-md border px-2 py-1 text-xs font-semibold ${r.label === LABEL_REVIEW ? "border-accent text-accent" : "border-amber-400 text-amber-800"}`}
          title={r.labelReasons.join(", ")}
          data-testid="plans-label"
        >
          {r.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select className="input w-auto py-1.5" value={project.plans.sheetSize} onChange={(e) => setPlans({ sheetSize: e.target.value as PlansSettings["sheetSize"] })} aria-label="Sheet size" data-testid="sheet-size">
            <option value="full">Full size, 24&quot; x 36&quot;</option>
            <option value="half">Half size, 12&quot; x 18&quot;</option>
          </select>
          {hasCabinetRuns(project) && (
            <button className="btn" onClick={() => setCabinetsOpen(true)} data-testid="edit-cabinets">
              Cabinets
            </button>
          )}
          {houseHasRooms(project) && (
            <button className="btn" onClick={() => setDevicesOpen(true)} data-testid="edit-devices">
              Outlets and lights
            </button>
          )}
          <button className="btn" onClick={() => setLotOpen(true)} data-testid="real-lot">
            My real lot
          </button>
          <button className="btn" onClick={() => setDetails(true)} data-testid="plan-details">
            Plan details
          </button>
          <button className="btn" onClick={exportReport} disabled={!!busy} data-testid="export-code">
            {busy === "code check" ? "Making PDF…" : "Export code check"}
          </button>
          <button className="btn-primary" onClick={() => exportSheets([...selected], "plans")} disabled={!!busy || selected.size === 0} data-testid="export-selected">
            {busy === "plans" ? "Making PDF…" : `Export selected (${selected.size})`}
          </button>
          <button className="btn" onClick={onClose} aria-label="Close plans" data-testid="plans-close">
            Close
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[430px] shrink-0 flex-col border-r border-line bg-white">
          <div className="flex border-b border-line text-sm">
            <button className={`flex-1 px-4 py-2 ${tab === "sheets" ? "border-b-2 border-accent font-medium" : "text-muted"}`} onClick={() => setTab("sheets")}>
              Sheets
            </button>
            <button className={`flex-1 px-4 py-2 ${tab === "code" ? "border-b-2 border-accent font-medium" : "text-muted"}`} onClick={() => setTab("code")} data-testid="code-tab">
              Code check {counts.fail ? <span className="ml-1 rounded bg-red-50 px-1.5 text-xs text-red-700">{counts.fail} fail</span> : null}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {tab === "sheets" ? (
              <>
                {r.label !== LABEL_REVIEW && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">Every sheet says &quot;PRELIMINARY – NOT FOR CONSTRUCTION&quot; until all sheets are ready and every code check passes ({r.labelReasons.join(", ")}).</p>}
                {SHEET_GROUPS.map((g) => {
                  const list = r.sheets.filter((s) => s.group === g);
                  if (!list.length) return null;
                  return (
                    <section key={g} className="mb-4">
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g}</h3>
                      <ul className="divide-y divide-line">
                        {list.map((s) => (
                          <SheetRow key={s.id} s={s} active={s.id === preview} checked={selected.has(s.id)} onCheck={() => toggle(s.id)} onPreview={() => setPreview(s.id)} onGo={go} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </>
            ) : (
              <CodeList report={r.report} onGo={onGo} />
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {previewEntry ? (
            <>
              <div className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className="font-medium">
                  {previewEntry.number} {previewEntry.title}
                </span>
                {shown.length > 1 && <span className="text-xs text-muted">{shown.length} sheets</span>}
                <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                  Zoom
                  <select className="input w-auto py-1 text-xs" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} data-testid="zoom">
                    <option value={1}>Fit</option>
                    <option value={1.5}>150%</option>
                    <option value={2.5}>250%</option>
                    <option value={4}>400%</option>
                  </select>
                </label>
                <button className="btn py-1" onClick={() => exportSheets([previewEntry.id], `${previewEntry.number} ${previewEntry.title}`)} disabled={!!busy} data-testid="export-one">
                  Export this sheet
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 pb-5" data-testid="sheet-preview">
                {shown.map((s) => (
                  <SheetSvg key={s.id} sheet={s} className="max-w-none shadow-md" style={{ width: `${zoom * 100}%` }} />
                ))}
              </div>
            </>
          ) : (
            <div className="m-auto max-w-sm text-center text-sm text-muted">Pick a sheet that&apos;s ready to see it here.</div>
          )}
        </main>
      </div>
      {devicesOpen && <DeviceEditor project={project} onClose={() => setDevicesOpen(false)} />}
      {cabinetsOpen && <CabinetEditor project={project} onClose={() => setCabinetsOpen(false)} />}
      {lotOpen && <RealLotForm project={project} onSave={(patch) => setPlans(patch)} onClose={() => setLotOpen(false)} />}
      {details && <PlanDetails project={project} onSave={(patch) => setPlans(patch)} onClose={() => setDetails(false)} />}
    </div>
  );
}

const houseHasRooms = (p: Project) => Object.values(p.floorPlans).some((f) => f.rooms.length > 0);

function SheetRow({ s, active, checked, onCheck, onPreview, onGo }: { s: SheetEntry; active: boolean; checked: boolean; onCheck: () => void; onPreview: () => void; onGo: (r: Reason) => void }) {
  const drawable = canDraw(s);
  return (
    <li className={`py-2 ${active ? "-mx-2 rounded-md bg-accent-soft/50 px-2" : ""}`} data-testid={`sheet-${s.id}`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={checked} disabled={!drawable} onChange={onCheck} aria-label={`Include ${s.title}`} />
        <button className={`min-w-0 flex-1 text-left ${drawable ? "" : "cursor-default"}`} onClick={drawable ? onPreview : undefined}>
          <div className="flex items-center gap-2">
            {s.number && <span className="w-12 shrink-0 text-xs tabular-nums text-muted">{s.number}</span>}
            <span className="truncate text-sm font-medium">{s.title}</span>
            {s.optional && <span className="text-xs text-muted">optional</span>}
          </div>
        </button>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP[s.status]}`}>{STATUS_LABEL[s.status]}</span>
      </div>
      {s.reasons.length > 0 && (
        <ul className="ml-6 mt-1 space-y-0.5 text-xs text-muted">
          {s.reasons.slice(0, 6).map((r, i) => (
            <li key={i}>
              {r.text}
              {(r.stage || r.action) && (
                <button className="ml-1 text-accent underline" onClick={() => onGo(r)}>
                  {r.action === "details" ? "Plan details" : r.action === "lot" ? "My real lot" : r.action === "cabinets" ? "Change the cabinets" : r.action === "devices" ? "Change them" : "Take me there"}
                </button>
              )}
            </li>
          ))}
          {s.reasons.length > 6 && <li>And {s.reasons.length - 6} more in the Code check tab.</li>}
        </ul>
      )}
    </li>
  );
}

function CodeList({ report, onGo }: { report: RuleReport[]; onGo: (stage: Stage) => void }) {
  const order: RuleStatus[] = ["fail", "manual", "pass"];
  const sorted = [...report].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <ul className="space-y-3" data-testid="code-list">
      <li className="text-xs text-muted">Each rule the app checks, with its code section. These are the checks printed on sheet G-002. The friendly &quot;Things to check&quot; on the floor plan page are separate design advice.</li>
      {sorted.map((r) => (
        <li key={r.rule.id} className="rounded-lg border border-line p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.rule.title}</p>
              <p className="text-xs text-muted">{r.section}</p>
            </div>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${RESULT_CHIP[r.status]}`}>{RESULT_LABEL[r.status]}</span>
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {r.results
              .filter((x) => r.status === "pass" || x.status !== "pass")
              .slice(0, r.status === "pass" ? 3 : 20)
              .map((x, i) => (
                <li key={i} className={x.status === "fail" ? "text-red-800" : "text-muted"}>
                  {x.text}
                  {x.fix && <span className="text-ink"> {x.fix}</span>}
                  {x.status === "fail" && x.stage && (
                    <button className="ml-1 text-accent underline" onClick={() => onGo(x.stage!)}>
                      Take me there
                    </button>
                  )}
                </li>
              ))}
            {r.status === "pass" && r.results.length > 3 && <li className="text-muted">And {r.results.length - 3} more.</li>}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function PlanDetails({ project, onSave, onClose }: { project: Project; onSave: (patch: Partial<PlansSettings>) => void; onClose: () => void }) {
  const [form, setForm] = useState({ address: project.plans.address, parcel: project.plans.parcel, designer: project.plans.designer });
  const [sys, setSys] = useState<HouseSystems>(project.plans.systems);
  const pick = <K extends keyof HouseSystems>(key: K, label: string, options: [HouseSystems[K], string][]) => (
    <label className="block text-sm">
      <span className="field-label">{label}</span>
      <select className="input" value={String(sys[key])} onChange={(e) => setSys({ ...sys, [key]: options.find(([v]) => String(v) === e.target.value)![0] })} data-testid={`sys-${key}`}>
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const owner = project.profile.ownerName?.trim() || "";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" role="dialog" aria-label="Plan details" data-testid="plan-details-form">
      <form
        className="card max-h-full w-full max-w-lg overflow-y-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ address: form.address.trim(), parcel: form.parcel.trim(), designer: form.designer.trim(), systems: sys });
          onClose();
        }}
      >
        <h3 className="text-lg font-semibold">Plan details</h3>
        <p className="mb-4 text-sm text-muted">These print in the title block of every sheet. Left empty, the sheets say TBD.</p>
        <label className="field-label" htmlFor="pd-address">
          Site address
        </label>
        <input id="pd-address" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="1234 W Example St" />
        <p className="field-hint mb-3">The street address in Boise. The lot&apos;s shape and setbacks go in &quot;My real lot&quot;.</p>
        <label className="field-label" htmlFor="pd-parcel">
          Parcel number
        </label>
        <input id="pd-parcel" className="input" value={form.parcel} onChange={(e) => setForm({ ...form, parcel: e.target.value })} placeholder="R1234567890" />
        <p className="field-hint mb-3">From the Ada County Assessor&apos;s parcel search.</p>
        <label className="field-label" htmlFor="pd-designer">
          Drawn by
        </label>
        <input id="pd-designer" className="input" value={form.designer} onChange={(e) => setForm({ ...form, designer: e.target.value })} placeholder={owner || "Your name"} />
        <p className="field-hint mb-4">Left empty, it&apos;s {owner ? owner : "the owner"}.</p>
        <h4 className="mb-1 font-semibold">House systems</h4>
        <p className="field-hint mb-2">For the electrical, plumbing, mechanical and energy sheets.</p>
        <div className="mb-4 grid grid-cols-2 gap-3">
          {pick("heating", "Heating", [["gas-furnace", "Gas furnace"], ["heat-pump", "Heat pump"], ["electric-furnace", "Electric furnace"]])}
          {pick("cooling", "Air conditioning", [[true, "Central air"], [false, "None"]])}
          {pick("waterHeater", "Water heater", [["gas", "Gas tank"], ["tankless-gas", "Gas tankless"], ["electric", "Electric tank"], ["heat-pump", "Heat pump"]])}
          {pick("cooking", "Range", [["electric", "Electric"], ["gas", "Gas"]])}
          {pick("dryer", "Dryer", [["electric", "Electric"], ["gas", "Gas"]])}
          {pick("foundation", "Under the lowest floor", [["crawlspace", "Crawlspace"], ["slab", "Concrete slab"], ["basement", "Basement"]])}
          {pick("freshAir", "Fresh air", [["bath-fan", "Bath fan, always on"], ["erv", "ERV"]])}
          {pick("panelAmps", "Electrical panel", [[200, "200 amp"], [100, "100 amp"], [150, "150 amp"], [225, "225 amp"], [400, "400 amp"]])}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" data-testid="plan-details-save">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
