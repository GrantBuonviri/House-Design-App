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
import { RealLot } from "@/lib/model/schema";
import { lotCorners, siteLayout } from "@/lib/plans/lot";
import { houseScene } from "@/lib/plans/scene";
import { roofSheet } from "@/lib/plans/sheets/roof";
import { elevationSheets } from "@/lib/plans/sheets/elevations";
import { exteriorProductsFor } from "@/lib/catalog/exterior";

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
    for (const r of RULES) {
      expect(CODE_DATA.values[r.ref], r.id).toBeDefined();
      expect(CODE_DATA.values[r.ref].unverified, r.id).toBeFalsy();
    }
    // Every number was checked a second time.
    for (const [key, e] of Object.entries(CODE_DATA.values)) expect(e.secondCheck?.verdict, key).toBeTruthy();
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
      writeFileSync(`${process.env.PLANS_PDF_OUT}/ranch-real-lot.house.json`, exportProjectJson(onRealLot(house(RANCH))));
    }
  });

  it("opens older projects with default plan details", () => {
    const old = { ...createProject("Old"), schemaVersion: 9 } as Record<string, unknown>;
    delete old.plans;
    const p = migrateProject(old);
    expect(p.plans).toEqual({ address: "", parcel: "", designer: "", sheetSize: "full", excluded: [], lot: null });
    const v10 = { ...createProject("Old"), schemaVersion: 10 } as Record<string, unknown>;
    v10.plans = { address: "1 Main", parcel: "", designer: "", sheetSize: "half", excluded: [] };
    expect(migrateProject(v10).plans.lot).toBeNull();
    expect(migrateProject(v10).plans.sheetSize).toBe("half");
  });
});

/** The ranch on a real lot: 100 ft along the street, 150 ft deep, with zoning setbacks and a rear easement. */
function onRealLot(p: Project, lot: Partial<RealLot> = {}): Project {
  const real = RealLot.parse({ frontFt: 100, leftFt: 150, streetSide: p.plot!.roadSide, setbacks: { front: 20, side: 5, rear: 15 }, easements: [{ id: "e", side: "rear", widthFt: 10 }], ...lot });
  return { ...p, plans: { ...p.plans, address: "1234 W Example St", parcel: "R1234567890", lot: real } };
}

describe("the outside of the house (part 2)", () => {
  const ranch = house(RANCH);

  it("works out a lot's corners from its side lengths", () => {
    const rect = lotCorners(RealLot.parse({ frontFt: 80, leftFt: 120 }));
    expect("pts" in rect && rect.pts[2]).toEqual({ x: 80, y: 120 });
    // Front 100, rear 120, sides 130 and 130.38: the rear sticks out 20 ft on the right.
    const four = lotCorners(RealLot.parse({ shape: "four-sides", frontFt: 100, rearFt: 120, leftFt: 130, rightFt: Math.hypot(20, 130) }));
    expect("pts" in four).toBe(true);
    if ("pts" in four) {
      expect(four.pts[3].x).toBeCloseTo(0);
      expect(four.pts[2].x).toBeCloseTo(120);
      expect(four.pts[2].y).toBeCloseTo(130);
    }
    expect("problem" in lotCorners(RealLot.parse({ shape: "four-sides", frontFt: 100, rearFt: 100, leftFt: 50, rightFt: 90 }))).toBe(true);
    expect("problem" in lotCorners(RealLot.parse({ frontFt: 0, leftFt: 100 }))).toBe(true);
  });

  it("puts the house on the real lot and checks the setbacks and easements", () => {
    const p = onRealLot(ranch);
    const site = siteLayout(p)!;
    expect(site.real).toBe(true);
    expect(site.areaSqft).toBeCloseTo(15000, 0);
    const front = site.checks.find((c) => c.side === "front")!;
    expect(front.providedFt).toBeCloseTo(25, 1);
    expect(front.ok).toBe(true);
    // Centered between the sides.
    const left = site.checks.find((c) => c.side === "left")!.providedFt;
    const right = site.checks.find((c) => c.side === "right")!.providedFt;
    expect(left).toBeCloseTo(right, 0);
    const rule = codeReport(p).find((r) => r.rule.id === "setbacks")!;
    expect(rule.status).toBe("pass");

    // Moved back into the rear setback and easement.
    const back = onRealLot(ranch, { houseFrontFt: 150 - 8 - houseDepthFt(ranch, p) });
    const r2 = codeReport(back).find((r) => r.rule.id === "setbacks")!;
    expect(r2.status).toBe("fail");
    expect(r2.results.some((x) => /easement/.test(x.text))).toBe(true);
    expect(readiness(back).sheets.find((s) => s.id === "site")!.reasons.some((x) => x.action === "lot")).toBe(true);
  });

  it("checks walls and eaves near the side lot lines", () => {
    const narrow = onRealLot(ranch, { houseLeftFt: 2.5 });
    const fire = codeReport(narrow).find((r) => r.rule.id === "lot-fire")!;
    expect(fire.status).toBe("fail");
    expect(codeReport(onRealLot(ranch)).find((r) => r.rule.id === "lot-fire")!.status).toBe("pass");
    expect(codeReport(ranch).find((r) => r.rule.id === "lot-fire")!.status).toBe("manual");
  });

  it("says the sample lot isn't a real property until the real lot is filled in", () => {
    const sample = buildSet(ranch).find((s) => s.number === "C-101")!;
    expect(sheetText(sample).join(" ")).toContain("SAMPLE LOT, NOT A REAL PROPERTY");
    expect(readiness(ranch).sheets.find((s) => s.id === "site")!.status).toBe("notes");
    const real = buildSet(onRealLot(ranch)).find((s) => s.number === "C-101")!;
    expect(sheetText(real).join(" ")).not.toContain("SAMPLE LOT");
    expect(sheetText(real).join(" ")).toContain("R1234567890");
  });

  it("lists the part 2 sheets and draws them", () => {
    const r = readiness(ranch);
    for (const id of ["site", "roof", "elevations", "views", "landscape"]) expect(canDraw(r.sheets.find((s) => s.id === id)!), id).toBe(true);
    // Nothing picked outside yet: the materials schedule needs a pick.
    expect(r.sheets.find((s) => s.id === "exterior-materials")!.status).toBe("needs");
    const numbers = buildSet(ranch).map((s) => s.number);
    for (const n of ["C-101", "L-101", "A-111", "A-201", "A-901"]) expect(numbers).toContain(n);
  });

  it("shows every outside door and window on an elevation, with its tag", () => {
    const p = house(TWO_STORY, 2);
    const sc = houseScene(p);
    const h = houseFacts(p);
    const text = elevationSheets(p).flatMap((e) => e.items.filter((i) => i.t === "text").map((i) => (i as { text: string }).text));
    const outside = sc.openings.filter((o) => o.tag);
    expect(outside.length).toBeGreaterThan(5);
    for (const o of outside) expect(text).toContain(o.tag);
    // Windows inside the house (none here) never show; every outside one has a tag from the plans.
    for (const o of outside) expect([...h.tags.values()]).toContain(o.tag);
  });

  it("draws gutters and downspouts on the roof plan", () => {
    const rp = roofSheet(ranch);
    expect(rp.downspouts).toBeGreaterThan(1);
    expect(rp.items.some((i) => i.t === "text" && i.text === "6:12")).toBe(true);
  });

  it("lists the outside picks in the materials schedule", () => {
    const pick = exteriorProductsFor("siding")[0];
    const p = { ...ranch, exterior: { ...ranch.exterior, selections: [{ id: "s", targetId: "house", category: "siding", product: pick }] } };
    expect(readiness(p).sheets.find((s) => s.id === "exterior-materials")!.status).toBe("notes");
    const sheet = buildSet(p).find((s) => s.number === "A-602")!;
    expect(sheetText(sheet).join(" ")).toContain(pick.brand);
  });
});

/** How deep the house is, front to back, in feet, on a real lot. */
function houseDepthFt(p: Project, onLot: Project): number {
  const site = siteLayout(onLot)!;
  const front = site.lines.find((l) => l.side === "front")!;
  const pts = site.house.flat();
  const n = { x: front.b.y - front.a.y, y: front.a.x - front.b.x };
  const len = Math.hypot(n.x, n.y);
  const d = pts.map((q) => ((q.x - front.a.x) * n.x + (q.y - front.a.y) * n.y) / len);
  void p;
  return (Math.max(...d) - Math.min(...d)) / 12;
}

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
