import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/model/schema";
import { structureOf } from "@/lib/structure";
import { footingSize, pickHeader, pickJoist, bracingBase, bracingFactors, csPanelMin } from "@/lib/structure/tables";
import { readiness } from "@/lib/plans/catalog";
import { buildSet } from "@/lib/plans/build";
import { sectionCuts } from "@/lib/plans/sheets/sections";
import { house, RANCH } from "./samples";

/** A two-story house whose second floor sits exactly on the first: the first floor copied up, garage made a bonus room. */
function stacked(): Project {
  const p = house([...RANCH.slice(0, 6), ["bedroom", "floor-2"], ["bathroom", "floor-2"]], 2, 0, 6);
  const main = p.floorPlans["floor-1"];
  const up = {
    ...main,
    stairs: [],
    fixtures: [],
    furniture: [],
    cabinets: undefined,
    devices: undefined,
    rooms: main.rooms.map((r) => (r.type === "garage" ? { ...r, type: "bonus", name: "Bonus room" } : r)),
    openings: main.openings.filter((o) => o.kind === "window"),
  };
  return { ...p, floorPlans: { ...p.floorPlans, "floor-2": up } };
}

const ranch = () => house(RANCH, 1, 0, 6);
const withProject = (p: Project, patch: Partial<Project["plans"]["structure"]>): Project => ({ ...p, plans: { ...p.plans, structure: { ...p.plans.structure, ...patch } } });

describe("structural tables", () => {
  it("picks the lightest joist that spans, and nothing past the table", () => {
    expect(pickJoist("df-l", 12 * 12)).toMatchObject({ size: "2x8", spacing: 16 });
    expect(pickJoist("df-l", 15 * 12)).toMatchObject({ size: "2x10", spacing: 16 });
    expect(pickJoist("df-l", 30 * 12)).toBeNull();
  });
  it("sizes headers from the IRC tables and refuses a span past them", () => {
    const h = pickHeader("exterior", "roof-ceiling", 28 * 12, 36);
    expect(h?.size).toBeTruthy();
    expect(pickHeader("exterior", "roof-ceiling-2-center-bearing-floors", 36 * 12, 20 * 12)).toBeNull();
  });
  it("reads Idaho's footing widths", () => {
    expect(footingSize(1500, 1, "crawl")).toEqual({ widthIn: 12, thicknessIn: 6 });
    expect(footingSize(1500, 2, "crawl")?.widthIn).toBe(15);
    expect(footingSize(1500, 3, "slab")?.widthIn).toBe(23);
    expect(footingSize(3000, 3, "slab")?.widthIn).toBe(12);
  });
  it("needs more bracing on the first of two floors and in exposure C", () => {
    const top = bracingBase("one-story-or-top", 30, "CS-WSP")!;
    const first = bracingBase("first-of-two", 30, "CS-WSP")!;
    expect(first).toBeGreaterThan(top);
    const b = bracingFactors({ exposure: "B", stories: 1, above: 0, eaveToRidgeFt: 10, wallHeightFt: 9, lines: 2 })!;
    const c = bracingFactors({ exposure: "C", stories: 1, above: 0, eaveToRidgeFt: 10, wallHeightFt: 9, lines: 2 })!;
    expect(c.total).toBeGreaterThan(b.total);
    expect(csPanelMin(48, 8)).toBeGreaterThan(0);
  });
});

describe("structure of a house", () => {
  it("frames a crawlspace ranch from the tables with girders and piers", () => {
    const s = structureOf(ranch());
    const f = s.floors.find((x) => x.levelId === "floor-1")!;
    expect(f.joist).not.toBeNull();
    expect(f.maxSpanIn).toBeLessThanOrEqual(f.joist!.allowIn);
    expect(f.girders.length).toBeGreaterThan(0);
    expect(f.girders.every((g) => g.pick && g.piers.length >= 2)).toBe(true);
    expect(s.foundation?.zones.crawlspace.length).toBeGreaterThan(0);
    expect(s.foundation?.vents.length).toBeGreaterThan(0);
    expect(s.foundation?.lines.every((l) => l.footing?.widthIn === 12)).toBe(true);
    expect(s.engineer).toEqual([]);
  });

  it("puts the main floor on a slab when the house is set to one, so no floor framing is needed", () => {
    const p = ranch();
    const slab = { ...p, plans: { ...p.plans, systems: { ...p.plans.systems, foundation: "slab" as const } } };
    expect(structureOf(slab).floors).toEqual([]);
    const sheet = readiness(slab).sheets.find((x) => x.id === "floor-framing");
    expect(sheet?.status).toBe("not-needed");
  });

  it("frames a stacked second floor over the walls below, with wider footings under two stories", () => {
    const s = structureOf(stacked());
    const up = s.floors.find((x) => x.levelId === "floor-2")!;
    expect(up.joist).not.toBeNull();
    expect(up.unsupported).toEqual([]);
    expect(s.foundation?.lines.some((l) => l.stories === 2 && l.footing?.widthIn === 15)).toBe(true);
    expect(s.bracing.some((b) => b.levelId === "floor-1" && b.location === "first-of-two")).toBe(true);
  });

  it("asks for an engineer, never a guess, when a floor overhangs the one below", () => {
    const p = house([...RANCH.slice(0, 6), ["bedroom", "floor-2"], ["bedroom", "floor-2"], ["bathroom", "floor-2"]], 2, 0, 6);
    const s = structureOf(p);
    expect(s.engineer.some((e) => /engineer/i.test(e.text))).toBe(true);
    const sheet = readiness(p).sheets.find((x) => x.id === "floor-framing:floor-2")!;
    expect(sheet.status).toBe("notes");
    expect(sheet.reasons[0].text).toMatch(/^Engineer required/);
  });

  it("checks basement walls against the IRC wall table", () => {
    const p = house([...RANCH.slice(0, 9), ["family", "basement-1"], ["bedroom", "basement-1"], ["garage"]], 1, 1, 6);
    const s = structureOf(p);
    const walls = s.foundation!.lines.filter((l) => l.zone === "basement" && l.outside === null);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every((l) => l.wallNote)).toBe(true);
  });

  it("follows the soil and lumber settings", () => {
    const p = stacked();
    const strong = structureOf(withProject(p, { soilPsf: 3000 }));
    expect(strong.foundation?.lines.every((l) => (l.footing?.widthIn ?? 0) === 12)).toBe(true);
    const hem = structureOf(withProject(ranch(), { lumber: "hem-fir" }));
    expect(hem.floors[0].joist).not.toBeNull();
  });

  it("cuts two sections through the house and draws every structural sheet", () => {
    const p = stacked();
    expect(sectionCuts(p).map((c) => c.axis)).toEqual(["x", "y"]);
    const ids = readiness(p).sheets.filter((x) => x.group === "Structural" || ["sections", "stair-section"].includes(x.id)).map((x) => x.id);
    const sheets = buildSet(p, { only: ids });
    const numbers = sheets.map((x) => x.number);
    for (const n of ["A-301", "A-501", "S-001", "S-101", "S-201", "S-202", "S-301", "S-401", "S-402"]) expect(numbers).toContain(n);
    const text = sheets.flatMap((x) => x.items.flatMap((i) => (i.t === "text" ? [i.text] : []))).join("\n");
    expect(text).toMatch(/HANDRAIL/);
    expect(text).toMatch(/Footing/i);
  });

  it("reports structure in the code checks: engineer items are manual, bracing shortfalls fail", () => {
    const r = readiness(house([...RANCH.slice(0, 6), ["bedroom", "floor-2"], ["bedroom", "floor-2"], ["bathroom", "floor-2"]], 2, 0, 6)).report;
    const framing = r.find((x) => x.rule.id === "floor-framing")!;
    expect(framing.status).toBe("manual");
    expect(framing.results.some((x) => x.status === "manual" && x.text.startsWith("Engineer required"))).toBe(true);
    for (const x of r.find((y) => y.rule.id === "wall-bracing")!.results) if (x.status === "fail") expect(x.fix).toBeTruthy();
    expect(r.find((x) => x.rule.id === "stairs-headroom")!.status).not.toBe("manual");
  });
});
