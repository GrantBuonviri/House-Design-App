import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { DiscoveryAnswers, type ChosenRoom, type Opening, type Project } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { generatePlot } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { defaultBasics } from "@/lib/plan/basics";
import { suggestPlans } from "@/lib/plan/suggest";
import { CODE_DATA, codeNum } from "@/lib/codes/data";
import { clearOpening, escapeCheck, safetyGlazing } from "@/lib/codes/openings";
import { codeReport, RULES } from "@/lib/codes/rules";
import { canDraw, LABEL_PRELIMINARY, readiness } from "@/lib/plans/catalog";
import { buildSet } from "@/lib/plans/build";
import { archFeet, sheetText, textWidth, wrap } from "@/lib/plans/draw";
import { sheetsToPdf } from "@/lib/plans/pdf";
import { codeReportPages } from "@/lib/plans/report";
import { houseFacts } from "@/lib/plans/house";
import { emptyPlan } from "@/lib/plan/edit";
import { exportProjectJson } from "@/lib/storage/exchange";

let n = 0;
const chosen = (type: string, levelId?: string): ChosenRoom => ({ id: `c${++n}`, type, name: `${roomType(type).label}`, description: "", ...(levelId ? { levelId } : {}) });

/** A whole house from the rules: brief, flow sketch, and Suggest a plan. */
function house(types: [string, string?][], floorsAbove = 1, floorsBelow = 0, seed = 7): Project {
  const plot = generatePlot(seed);
  const brief = buildRuleBrief({ answers: DiscoveryAnswers.parse({ rooms: types.map(([t, l]) => chosen(t, l)), floorsAbove, floorsBelow }), profile: { mustHaves: [], dislikes: [] }, plot });
  const levels = levelsFor(brief.floors, brief.floorsBelow);
  const basics = defaultBasics();
  const bubbles = suggestDiagrams({ brief, plot, levels });
  const plans = suggestPlans(bubbles, { brief, plot, levels, basics }).plans;
  const p = createProject("Sagebrush House", { ownerName: "Grant" });
  return { ...p, plot, brief, levels, bubbles, floorPlans: plans, plan: { ...p.plan, basics } };
}

const RANCH: [string, string?][] = [["entry"], ["kitchen"], ["dining"], ["living"], ["primary-bedroom"], ["primary-bath"], ["bedroom"], ["bedroom"], ["bathroom"], ["garage"], ["laundry"]];
const TWO_STORY: [string, string?][] = [["entry"], ["kitchen"], ["family"], ["half-bath"], ["garage"], ["mudroom"], ["primary-bedroom", "floor-2"], ["primary-bath", "floor-2"], ["bedroom", "floor-2"], ["bedroom", "floor-2"], ["bathroom", "floor-2"]];

const FORBIDDEN = /\b(official|certified|stamped|approved|permit-ready|code-compliant)\b/i;
const ALLOWED = "Not reviewed or stamped by a licensed architect or engineer";

describe("code numbers", () => {
  it("has every number a rule uses, with its section, source and date", () => {
    for (const [key, e] of Object.entries(CODE_DATA.values)) {
      expect(e.section, key).toBeTruthy();
      expect(e.source, key).toMatch(/^https?:\/\//);
      expect(e.checked, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const r of RULES) expect(CODE_DATA.values[r.ref], r.id).toBeDefined();
  });

  it("works out a window's clear opening and whether you could escape through it", () => {
    const w = (style: string, widthIn: number, heightIn: number, sillIn = 30): Opening => ({ id: "w", host: { roomId: "r", edge: 0 }, offsetIn: 0, kind: "window", style, widthIn, heightIn, sillIn, side: 1, hinge: "start" });
    expect(clearOpening(w("window-picture", 72, 72)).sqft).toBe(0);
    const hung = clearOpening(w("window", 36, 60));
    expect(hung.widthIn).toBeCloseTo(32.5);
    expect(escapeCheck(w("window", 36, 60), false).ok).toBe(true);
    expect(escapeCheck(w("window", 24, 36), false).ok).toBe(false);
    expect(escapeCheck(w("window", 36, 60, 48), false).problems.join()).toMatch(/sill/);
  });
});

describe("the code check", () => {
  const p = house(RANCH);
  const report = codeReport(p);

  it("checks the drawn house and gives every rule a section", () => {
    expect(report.length).toBeGreaterThan(15);
    for (const r of report) expect(r.section).toMatch(/IRC|ISPC|NEC|IECC|Boise/);
    const egress = report.find((r) => r.rule.id === "egress-bedroom")!;
    expect(egress.results).toHaveLength(3);
  });

  it("fails a bedroom with no window and says how to fix it", () => {
    const plan = p.floorPlans["floor-1"];
    const bed = plan.rooms.find((r) => r.type === "bedroom")!;
    const openings = plan.openings.filter((o) => !(o.kind === "window" && "roomId" in o.host && o.host.roomId === bed.id));
    const q = { ...p, floorPlans: { ...p.floorPlans, "floor-1": { ...plan, openings } } };
    const egress = codeReport(q).find((r) => r.rule.id === "egress-bedroom")!;
    expect(egress.status).toBe("fail");
    expect(egress.results.find((x) => x.roomIds?.includes(bed.id))?.fix).toBeTruthy();
  });

  it("marks glass next to a door for safety glass", () => {
    const plan = { ...emptyPlan(), rooms: [{ id: "r", name: "Living", type: "living", polygon: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 240 }, { x: 0, y: 240 }] }] };
    const door: Opening = { id: "d", host: { roomId: "r", edge: 0 }, offsetIn: 60, kind: "door", style: "door-entry", widthIn: 36, heightIn: 80, side: 1, hinge: "start" };
    const win: Opening = { id: "w", host: { roomId: "r", edge: 0 }, offsetIn: 100, kind: "window", style: "window", widthIn: 24, heightIn: 60, sillIn: 24, side: 1, hinge: "start" };
    const far: Opening = { ...win, id: "f", offsetIn: 200 };
    const s = safetyGlazing({ ...plan, openings: [door, win, far] }, []);
    expect(s.has("w")).toBe(true);
    expect(s.has("f")).toBe(false);
  });
});

describe("plan sheets", () => {
  it("lists every sheet with a status, and nothing to draw without a floor plan", () => {
    const empty = createProject("Empty");
    const r = readiness(empty);
    expect(r.sheets.find((s) => s.id === "cover")?.status).toBe("notes");
    expect(r.sheets.find((s) => s.id === "floor")?.status).toBe("needs");
    expect(r.sheets.find((s) => s.id === "floor")?.reasons[0].stage).toBe("plan");
    expect(r.sheets.some((s) => s.status === "outside")).toBe(true);
    expect(r.label).toBe(LABEL_PRELIMINARY);
    expect(buildSet(empty).map((s) => s.number)).toEqual(["G-001"]);
  });

  it("draws one floor plan per floor, numbered from the lowest", () => {
    const p = house(TWO_STORY, 2);
    const r = readiness(p);
    const floors = r.sheets.filter((s) => s.levelId);
    expect(floors.map((s) => s.number)).toEqual(["A-101", "A-102"]);
    expect(floors.every(canDraw)).toBe(true);
    const set = buildSet(p);
    expect(set.map((s) => s.number).slice(0, 2)).toEqual(["G-001", "G-002"]);
    expect(set.some((s) => s.number === "A-102")).toBe(true);
  });

  it("tags every door and window once through the house", () => {
    const p = house(TWO_STORY, 2);
    const tags = [...houseFacts(p).tags.values()];
    expect(new Set(tags).size).toBe(tags.length);
    const text = buildSet(p).flatMap(sheetText);
    for (const t of tags) expect(text).toContain(t);
  });

  it("puts the status label and the not-reviewed note on every sheet, and never claims more", () => {
    const p = house(RANCH);
    const set = buildSet(p);
    for (const s of set) {
      const text = sheetText(s);
      expect(text.join(" ")).toContain("PRELIMINARY");
      expect(text.join(" ").replace(/\s+/g, " ")).toContain(ALLOWED);
      expect(text.join(" ").replace(/\s+/g, " ").split(ALLOWED).join(" "), s.number).not.toMatch(FORBIDDEN);
    }
  });

  it("keeps everything on the paper", () => {
    const set = buildSet(house(RANCH));
    for (const s of set) {
      for (const it of s.items) {
        const pts = it.t === "text" ? [it.at] : it.t === "circle" ? [it.c] : it.pts;
        for (const pt of pts) {
          expect(pt.x, s.number).toBeGreaterThanOrEqual(0);
          expect(pt.x, s.number).toBeLessThanOrEqual(s.w);
          expect(pt.y, s.number).toBeGreaterThanOrEqual(0);
          expect(pt.y, s.number).toBeLessThanOrEqual(s.h);
        }
      }
    }
  });

  it("makes a PDF with a page per sheet, full or half size", async () => {
    const p = house(TWO_STORY, 2);
    const set = buildSet(p);
    const full = await sheetsToPdf(set);
    expect(full.getNumberOfPages()).toBe(set.length);
    expect(full.internal.pageSize.getWidth()).toBeCloseTo(36);
    const half = await sheetsToPdf(set, 0.5);
    expect(half.internal.pageSize.getWidth()).toBeCloseTo(18);
    const report = await sheetsToPdf(codeReportPages(p));
    expect(report.internal.pageSize.getWidth()).toBeCloseTo(8.5);
    if (process.env.PLANS_PDF_OUT) {
      writeFileSync(`${process.env.PLANS_PDF_OUT}/two-story.pdf`, Buffer.from(full.output("arraybuffer")));
      writeFileSync(`${process.env.PLANS_PDF_OUT}/ranch.pdf`, Buffer.from((await sheetsToPdf(buildSet(house(RANCH)))).output("arraybuffer")));
      writeFileSync(`${process.env.PLANS_PDF_OUT}/report.pdf`, Buffer.from(report.output("arraybuffer")));
      writeFileSync(`${process.env.PLANS_PDF_OUT}/half.pdf`, Buffer.from(half.output("arraybuffer")));
      writeFileSync(`${process.env.PLANS_PDF_OUT}/two-story.house.json`, exportProjectJson(p));
    }
  });

  it("opens older projects with default plan details", () => {
    const old = { ...createProject("Old"), schemaVersion: 9 } as Record<string, unknown>;
    delete old.plans;
    const p = migrateProject(old);
    expect(p.plans).toEqual({ address: "", parcel: "", designer: "", sheetSize: "full", excluded: [] });
  });
});

describe("drawing helpers", () => {
  it("writes architectural feet and inches", () => {
    expect(archFeet(150)).toBe("12'-6\"");
    expect(archFeet(8)).toBe("0'-8\"");
    expect(archFeet(40.5)).toBe("3'-4 1/2\"");
  });

  it("measures and wraps text", () => {
    expect(textWidth("MM", 72)).toBeCloseTo(1.66, 1);
    expect(wrap("one two three four", textWidth("three four", 10) + 0.01, 10)).toEqual(["one two", "three four"]);
  });

  it("uses Boise's numbers", () => {
    expect(codeNum("design.frostDepth")).toBe(24);
    expect(codeNum("stairs.maxRiser")).toBe(7.75);
  });
});
