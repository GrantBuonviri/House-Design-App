import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { DiscoveryAnswers, HouseSystems, type ChosenRoom, type Opening, type Project } from "@/lib/model/schema";
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
import { type Fixture, type FloorPlan, type Point } from "@/lib/model/schema";
import { add, angleOf, dist, leftNormal, scale, sub, unit } from "@/lib/plan/geometry";
import { openingGeometries } from "@/lib/plan/walls";
import { addCabinet, autoCabinets, cabinetLayout, fillWidths, newCabinet, removeCabinet, resetCabinets, updateCabinet, UPPER_BOTTOM_IN } from "@/lib/plan/cabinets";
import { doorWindowRows, finishRows, fixtureLines } from "@/lib/plans/sheets/schedules";
import { levelCabinets } from "@/lib/plans/sheets/cabinets";
import { conditionedSqft, hasFuel, levelDevices, wholeHouseCfm } from "@/lib/plans/systems";
import { addDevice, removeDevice, resetDevices, snapToWall, updateDevice } from "@/lib/plan/devices";
import { fixtureUnits } from "@/lib/plans/sheets/plumbing";
import { DIRECTIONS, envelope, facing, roughHeatLoss } from "@/lib/plans/sheets/energy";
import { dryerRuns } from "@/lib/plans/sheets/mechanical";
import { pointInPolygon } from "@/lib/plan/geometry";

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
    const floors = r.sheets.filter((s) => s.id.startsWith("floor:"));
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
    expect(p.plans).toEqual({ address: "", parcel: "", designer: "", sheetSize: "full", excluded: [], lot: null, systems: HouseSystems.parse({}) });
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

/** Kitchen and bath fixtures put in the way the floor plan's Fixtures tool would: backs 2.5" off the wall line. */
function withKitchen(p: Project): Project {
  const plan = p.floorPlans["floor-1"];
  const fixtures: Fixture[] = [...plan.fixtures];
  const along = (roomType: string, items: [string, number, number][], minLen: number) => {
    const room = plan.rooms.find((r) => r.type === roomType);
    if (!room) return;
    const doors = openingGeometries(plan).filter((g) => g.opening.kind !== "window");
    const onEdge = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(dist(a, p) + dist(p, b) - dist(a, b)) < 1;
    // The longest stretch of wall with no door or opening in it.
    let best: { a: Point; u: Point; t0: number; len: number } | null = null;
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % room.polygon.length];
      const L = dist(a, b);
      const cuts = doors.filter((g) => onEdge(g.center, a, b)).map((g) => [Math.min(dist(a, g.a), dist(a, g.b)) - 4, Math.max(dist(a, g.a), dist(a, g.b)) + 4] as [number, number]);
      let at = 0;
      for (const [c0, c1] of [...cuts.sort((x, y) => x[0] - y[0]), [L, L] as [number, number]]) {
        if (c0 - at > (best?.len ?? 0)) best = { a, u: unit(sub(b, a)), t0: at, len: c0 - at };
        at = Math.max(at, c1);
      }
    }
    if (!best || best.len < minLen) return;
    const e = best;
    const u = e.u;
    const inward = scale(leftNormal(u), -1);
    let t = e.t0 + 6;
    for (const [kind, w, d] of items) {
      const at = add(add(e.a, scale(u, t + w / 2)), scale(inward, d / 2 + 2.5));
      fixtures.push({ id: `${roomType}-${kind}-${t}`, kind, x: at.x, y: at.y, rotation: Math.round(angleOf(inward) - 90), widthIn: w, depthIn: d, roomId: room.id });
      t += w;
    }
  };
  along("kitchen", [["fridge", 36, 30], ["counter", 15, 25], ["range", 30, 26], ["counter", 12, 25], ["sink", 33, 22], ["dishwasher", 24, 24]], 160);
  along("primary-bath", [["vanity", 60, 21], ["toilet", 20, 28]], 90);
  along("bathroom", [["vanity", 36, 21], ["toilet", 20, 28]], 60);
  along("laundry", [["washer", 27, 30], ["dryer", 27, 30]], 60);
  along("garage", [["water-heater", 24, 24], ["furnace", 30, 30]], 60);
  const next: FloorPlan = { ...plan, fixtures };
  return { ...p, floorPlans: { ...p.floorPlans, "floor-1": next } };
}

describe("schedules and cabinets (part 3)", () => {
  const ranch = house(RANCH);
  const kitchen = withKitchen(ranch);
  const level = kitchen.levels.find((l) => l.id === "floor-1")!;

  it("cuts a length into standard cabinet widths", () => {
    for (const L of [9, 30, 47, 100, 141.5]) {
      const f = fillWidths(L);
      expect(f.widths.reduce((a, b) => a + b, 0) + f.filler).toBeCloseTo(L);
      for (const w of f.widths) expect(w % 3).toBe(0);
      expect(f.filler).toBeLessThan(3);
    }
  });

  it("lays out cabinets from the counters and appliances", () => {
    expect(kitchen.floorPlans["floor-1"].fixtures.filter((f) => f.kind === "range")).toHaveLength(1);
    const lay = levelCabinets(kitchen, level);
    const run = lay.runs.find((r) => r.appliances.some((a) => a.fixture.kind === "range"))!;
    expect(run).toBeDefined();
    const cabs = lay.cabinets.filter((c) => c.runId === run.id);
    const along = (c: (typeof cabs)[number]) => (c.x - run.origin.x) * run.u.x + (c.y - run.origin.y) * run.u.y;
    // A sink base under the sink, a drawer base beside the range, and no base box under an appliance.
    const sink = run.appliances.find((a) => a.fixture.kind === "sink")!;
    const sb = cabs.find((c) => c.kind === "sink")!;
    expect(sb.widthIn).toBeGreaterThanOrEqual(33);
    expect(Math.abs(along(sb) - (sink.t0 + sink.t1) / 2)).toBeLessThan(2);
    expect(cabs.some((c) => c.kind === "drawer")).toBe(true);
    for (const a of run.appliances.filter((x) => x.fixture.kind !== "sink"))
      for (const c of cabs.filter((x) => x.bottomIn === 0)) {
        const t = along(c);
        expect(t + c.widthIn / 2 <= a.t0 + 0.5 || t - c.widthIn / 2 >= a.t1 - 0.5, c.code).toBe(true);
      }
    // Base boxes in standard widths.
    for (const c of cabs.filter((x) => x.kind === "base")) expect([9, 12, 15, 18, 21, 24, 27, 30, 33, 36]).toContain(c.widthIn);
    // Uppers: 54" up, a short one over the fridge, and the one over the range clear of the cooktop.
    const range = run.appliances.find((a) => a.fixture.kind === "range")!;
    const fridge = run.appliances.find((a) => a.fixture.kind === "fridge")!;
    const over = (a: typeof range) => cabs.find((c) => c.bottomIn > 36 && Math.abs(along(c) - (a.t0 + a.t1) / 2) < 2);
    expect(over(range)!.bottomIn).toBeGreaterThanOrEqual(36 + codeNum("kitchen.rangeClearanceAbove"));
    expect(over(fridge)!.depthIn).toBe(24);
    expect(cabs.filter((c) => c.kind === "upper" && c.depthIn === 12 && c.bottomIn === UPPER_BOTTOM_IN).length).toBeGreaterThan(0);
    // Vanities in the baths.
    expect(lay.cabinets.filter((c) => c.kind === "vanity").map((c) => c.code).sort()).toEqual(["V36", "V60"]);
  });

  it("keeps uppers off the windows", () => {
    const plan = { ...emptyPlan(), rooms: [{ id: "k", name: "Kitchen", type: "kitchen", polygon: [{ x: 0, y: 0 }, { x: 168, y: 0 }, { x: 168, y: 144 }, { x: 0, y: 144 }] }] };
    const counter: Fixture = { id: "c", kind: "counter", x: 84, y: 15, rotation: 0, widthIn: 160, depthIn: 25, roomId: "k" };
    const win: Opening = { id: "w", host: { roomId: "k", edge: 0 }, offsetIn: 84, kind: "window", style: "window", widthIn: 36, heightIn: 48, sillIn: 42, side: 1, hinge: "start" };
    const lay = autoCabinets({ ...plan, fixtures: [counter], openings: [win] }, 96);
    const uppers = lay.cabinets.filter((c) => c.bottomIn >= UPPER_BOTTOM_IN);
    expect(uppers.length).toBeGreaterThan(1);
    for (const c of uppers) expect(c.x + c.widthIn / 2 <= 66 + 0.5 || c.x - c.widthIn / 2 >= 102 - 0.5, c.code).toBe(true);
    // No wall behind an island: no uppers.
    const island: Fixture = { id: "i", kind: "island", x: 84, y: 90, rotation: 0, widthIn: 72, depthIn: 36, roomId: "k" };
    expect(autoCabinets({ ...plan, fixtures: [island] }, 96).cabinets.every((c) => c.bottomIn === 0)).toBe(true);
  });

  it("lets the owner take away, move and add back cabinets", () => {
    const plan = kitchen.floorPlans["floor-1"];
    const lay = cabinetLayout(plan, 96);
    const first = lay.cabinets.find((c) => c.kind === "upper")!;
    const gone = removeCabinet(plan, first.id);
    expect(cabinetLayout(gone, 96).cabinets.some((c) => c.id === first.id)).toBe(false);
    const moved = updateCabinet(plan, first, { x: first.x + 6 });
    const after = cabinetLayout(moved, 96).cabinets;
    expect(after.some((c) => c.id === first.id)).toBe(false);
    expect(after.find((c) => !c.auto)!.x).toBeCloseTo(first.x + 6, 0);
    expect(cabinetLayout(resetCabinets(moved), 96).cabinets).toHaveLength(lay.cabinets.length);
    // One added on a bare wall gets a run of its own, so it shows on an elevation.
    const lone = cabinetLayout(addCabinet(plan, newCabinet("upper", { x: -500, y: -500 }, 0, 30, 96)), 96);
    expect(lone.runs).toHaveLength(lay.runs.length + 1);
    expect(lone.cabinets.find((c) => !c.auto)!.runId).toBe(lone.runs[lone.runs.length - 1].id);
    // Saved changes survive a save and load.
    const saved = migrateProject(JSON.parse(exportProjectJson({ ...kitchen, floorPlans: { ...kitchen.floorPlans, "floor-1": moved } })).project);
    expect(saved.floorPlans["floor-1"].cabinets?.added).toHaveLength(1);
  });

  it("works out a casement's bigger clear opening, and keeps a window's own choice", () => {
    const w = (operation?: Opening["operation"]): Opening => ({ id: "w", host: { roomId: "r", edge: 0 }, offsetIn: 0, kind: "window", style: "window", widthIn: 24, heightIn: 48, sillIn: 30, side: 1, hinge: "start", operation });
    expect(escapeCheck(w(), false).ok).toBe(false);
    expect(clearOpening(w("casement")).sqft).toBeGreaterThan(clearOpening(w()).sqft * 1.8);
    const old = { ...createProject("Old"), schemaVersion: 11 } as Record<string, unknown>;
    expect(migrateProject(old).schemaVersion).toBeGreaterThanOrEqual(12);
  });

  it("schedules every door and window, the room finishes and the fixtures", () => {
    const h = houseFacts(kitchen);
    const { doors, windows } = doorWindowRows(kitchen);
    expect(doors.length + windows.length).toBe(h.tags.size);
    // Every bedroom window says whether it's an escape window.
    expect(windows.some((r) => r[8].startsWith("Yes"))).toBe(true);
    const finishes = finishRows(kitchen);
    expect(finishes.length).toBe(kitchen.floorPlans["floor-1"].rooms.filter((r) => r.type !== "patio" && r.type !== "porch" && r.type !== "deck").length);
    expect(finishes.find((r) => r[0] === "Garage")?.[5]).toMatch(/gypsum/);
    const { plumbing, appliances } = fixtureLines(kitchen);
    const toilets = plumbing.find((l) => l.kind === "toilet")!;
    expect(toilets.count).toBe(2);
    expect(toilets.notes).toContain(`${codeNum("plumbing.wcMaxFlush")} gal`);
    expect(appliances.map((a) => a.kind)).toEqual(expect.arrayContaining(["range", "hood", "fridge", "dishwasher"]));
  });

  it("lists the part 3 sheets and draws them", () => {
    const before = readiness(ranch).sheets;
    expect(before.find((s) => s.id === "cabinets")!.status).toBe("needs");
    const r = readiness(kitchen).sheets;
    for (const id of ["door-window", "finishes", "cabinets", "fixtures"]) expect(canDraw(r.find((s) => s.id === id)!) || id === "finishes", id).toBe(true);
    const set = buildSet(kitchen, { only: ["door-window", "cabinets", "fixtures"] });
    expect(set.length).toBeGreaterThanOrEqual(3);
    const text = set.map((s) => sheetText(s).join(" ")).join(" ");
    expect(text).toMatch(/SB3[36]/);
    expect(text).toMatch(/window schedule/i);
    expect(text.replace(/\s+/g, " ").split(ALLOWED).join(" ")).not.toMatch(FORBIDDEN);
    for (const s of set)
      for (const it of s.items) {
        const pts = it.t === "text" ? [it.at] : it.t === "circle" ? [it.c] : it.pts;
        for (const pt of pts) {
          expect(pt.x, s.number).toBeGreaterThanOrEqual(0);
          expect(pt.x, s.number).toBeLessThanOrEqual(s.w);
          expect(pt.y, s.number).toBeGreaterThanOrEqual(0);
          expect(pt.y, s.number).toBeLessThanOrEqual(s.h);
        }
      }
    if (process.env.PLANS_PDF_OUT) writeFileSync(`${process.env.PLANS_PDF_OUT}/ranch-kitchen.house.json`, exportProjectJson(onRealLot(kitchen)));
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

describe("systems (part 4)", () => {
  const p = withKitchen(house(RANCH));
  const level = p.levels.find((l) => l.id === "floor-1")!;
  const plan = p.floorPlans["floor-1"];
  const inRoom = (type: string, kinds: string[]) => {
    const r = plan.rooms.find((x) => x.type === type)!;
    return levelDevices(p, level).filter((d) => kinds.includes(d.kind) && pointInPolygon({ x: d.x, y: d.y }, r.polygon));
  };
  const rule = (proj: Project, id: string) => codeReport(proj).find((r) => r.rule.id === id)!;

  it("places outlets, switches, lights, alarms and fans by the code rules", () => {
    const ds = levelDevices(p, level);
    for (const r of plan.rooms.filter((x) => ["bedroom", "primary-bedroom"].includes(x.type ?? ""))) expect(ds.some((d) => d.kind === "smoke" && pointInPolygon({ x: d.x, y: d.y }, r.polygon)), r.name).toBe(true);
    for (const t of ["bathroom", "primary-bath"]) expect(inRoom(t, ["fan"])).toHaveLength(1);
    expect(inRoom("living", ["outlet"]).length).toBeGreaterThanOrEqual(4);
    expect(inRoom("kitchen", ["light-recessed"]).length).toBeGreaterThanOrEqual(4);
    expect(inRoom("garage", ["heat"])).toHaveLength(1);
    expect(ds.filter((d) => d.kind === "panel")).toHaveLength(1);
    expect(ds.filter((d) => d.kind === "smoke-co").length).toBeGreaterThan(0);
    expect(ds.filter((d) => d.kind === "hose-bib")).toHaveLength(2);
    expect(ds.filter((d) => d.kind === "outlet-240")).toHaveLength(2);
    expect(ds.some((d) => d.kind === "thermostat")).toBe(true);
    // Every check passes on the app's own layout.
    for (const id of ["electrical", "alarms", "mechanical", "bath-vent"]) expect(rule(p, id).status, id).toBe("pass");
  });

  it("rechecks after the owner moves, adds or takes away devices", () => {
    const living = inRoom("living", ["outlet"]);
    let next = plan;
    for (const d of living) next = removeDevice(next, d.id);
    const bare = { ...p, floorPlans: { ...p.floorPlans, "floor-1": next } };
    const elec = rule(bare, "electrical");
    expect(elec.status).toBe("fail");
    expect(elec.results.find((r) => r.status === "fail")!.text).toMatch(/Living/);
    const fan = inRoom("bathroom", ["fan"])[0];
    const noFan = { ...p, floorPlans: { ...p.floorPlans, "floor-1": removeDevice(plan, fan.id) } };
    expect(rule(noFan, "mechanical").status).toBe("fail");
    // Moving swaps an app-placed device for the owner's copy; adding and going back to automatic.
    const moved = updateDevice(plan, fan, { x: fan.x + 6 });
    expect(moved.devices!.hidden).toContain(fan.id);
    expect(moved.devices!.added[0]).toMatchObject({ kind: "fan", x: fan.x + 6 });
    const added = addDevice(moved, { kind: "outlet", x: 0, y: 0, rotation: 0 });
    expect(added.devices!.added).toHaveLength(2);
    expect(resetDevices(added).devices).toBeUndefined();
    // A wall device snaps onto the wall face.
    const r = plan.rooms.find((x) => x.type === "living")!;
    const snapped = snapToWall(plan, { x: r.polygon[0].x + 30, y: r.polygon[0].y + 20 }, 6.5)!;
    expect(snapped).not.toBeNull();
  });

  it("follows the fuel choices", () => {
    const allElectric: Project = { ...p, plans: { ...p.plans, systems: { ...p.plans.systems, heating: "heat-pump", waterHeater: "heat-pump", cooking: "electric", dryer: "electric" } } };
    expect(hasFuel(allElectric)).toBe(false);
    const gas: Project = { ...p, plans: { ...p.plans, systems: { ...p.plans.systems, cooking: "gas", dryer: "gas" } } };
    expect(levelDevices(gas, level).filter((d) => d.kind === "outlet-240")).toHaveLength(0);
    const sheets = buildSet(gas, { only: [`plumbing:floor-1`, `mechanical:floor-1`, `electrical:floor-1`] });
    const text = sheets.map((x) => sheetText(x).join(" ")).join(" ");
    expect(text).toMatch(/Gas piping sized/);
    expect(text).toMatch(/Whole-house fresh air: \d+ cfm/);
    expect(text).toMatch(/GFI/);
  });

  it("adds up fixture units and the walls by direction", () => {
    const fu = fixtureUnits(p);
    const toilets = fu.rows.find((r) => r.label.startsWith("Toilet"))!;
    expect(toilets.dfu).toBe(codeNum("plumbing.dfu.waterCloset"));
    expect(fu.dfu).toBeCloseTo(fu.rows.reduce((s, r) => s + r.count * r.dfu, 0));
    expect(facing({ x: 0, y: -1 })).toBe("N");
    expect(facing({ x: 1, y: 0 })).toBe("E");
    const env = envelope(p);
    const windows = env.windows.reduce((s, w) => s + w.sqft, 0);
    expect(windows).toBeCloseTo(DIRECTIONS.reduce((s, d) => s + env.walls[d].windows, 0));
    expect(env.conditionedSqft).toBeGreaterThan(1000);
    expect(env.ceiling).toBeCloseTo(env.conditionedSqft, 0);
    expect(roughHeatLoss(p).btuh).toBeGreaterThan(5000);
  });

  it("works out the whole-house fresh air and the dryer duct", () => {
    expect(wholeHouseCfm(p)).toBe(Math.ceil(0.01 * conditionedSqft(p) + 7.5 * (3 + 1)));
    const runs = dryerRuns(plan);
    expect(runs).toHaveLength(1);
    expect(runs[0].ok).toBe(true);
  });

  it("lists the part 4 sheets and draws them", () => {
    const r = readiness(p);
    for (const n of ["E-101", "P-101", "M-101", "G-003"]) expect(canDraw(r.sheets.find((x) => x.number === n)!), n).toBe(true);
    expect(r.sheets.some((x) => x.status === "soon" && ["E-101", "P-101", "M-101", "G-003"].includes(x.number))).toBe(false);
    // No water heater or furnace yet: plumbing and mechanical need more.
    const bare = readiness(house(RANCH));
    expect(bare.sheets.find((x) => x.id === "plumbing")!.status).toBe("needs");
    expect(bare.sheets.find((x) => x.id === "mechanical")!.status).toBe("needs");
    const set = buildSet(p);
    const e = set.find((x) => x.number === "E-101")!;
    expect(sheetText(e).join(" ")).toMatch(/ELECTRICAL LEGEND/);
    const g = set.find((x) => x.number === "G-003")!;
    expect(sheetText(g).join(" ")).toMatch(/REScheck/);
    for (const sh of set.filter((x) => /^(E|P|M)-1|G-003/.test(x.number))) expect(sheetText(sh).join(" ").replace(/\s+/g, " ").split(ALLOWED).join(" "), sh.number).not.toMatch(FORBIDDEN);
  });

  it("opens version 12 projects with default house systems", () => {
    const old = { ...createProject("Old"), schemaVersion: 12 } as Record<string, unknown>;
    old.plans = { address: "", parcel: "", designer: "", sheetSize: "full", excluded: [], lot: null };
    expect(migrateProject(old).plans.systems).toEqual(HouseSystems.parse({}));
  });
});
