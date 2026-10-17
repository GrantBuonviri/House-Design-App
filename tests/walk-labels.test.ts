import { describe, expect, it } from "vitest";
import { House3D, SCHEMA_VERSION, WalkLabels, type PlanRoom, type Project, type Level } from "@/lib/model/schema";
import { migrateProject, createProject } from "@/lib/model/project";
import { rectangle } from "@/lib/plan/geometry";
import { labelInk, labelLines, costShares } from "@/lib/house3d/walkLabels";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { lockAxis, reading, showParts, snap, tapeCandidates } from "@/lib/house3d/tape";

const room = (id: string, w = 144, h = 168): PlanRoom => ({ id, name: "Kitchen", type: "kitchen", polygon: rectangle(w / 2, h / 2, w, h) });
const level: Level = levelFor(MAIN_LEVEL_ID);
const base = { room: room("k"), level, basics: null, selections: [] as Project["interior"]["selections"] };
const on = (over: Partial<WalkLabels> = {}) => WalkLabels.parse(over);

describe("floor label text", () => {
  it("shows name, size and square feet by default", () => {
    expect(labelLines(base, on()).map((l) => l.text)).toEqual(["Kitchen", `12' × 14'`, "168 sq ft"]);
  });
  it("follows each switch", () => {
    const none = on({ name: false, size: false, sqft: false });
    expect(labelLines(base, none)).toEqual([]);
    const more = labelLines(base, on({ floorName: true, ceiling: true })).map((l) => l.text);
    expect(more).toContain(level.name);
    expect(more.some((t) => t.startsWith("Ceiling"))).toBe(true);
  });
  it("uses inches only when asked", () => {
    expect(labelLines(base, on({ units: "inches" }))[1].text).toBe(`144" × 168"`);
  });
  it("lists flooring and paint picks, and the cost share", () => {
    const product = (name: string) => ({ id: name, name, brand: "B", url: "", unit: "sqft", priceSource: "estimate", lastChecked: "", color: "#222222", pattern: "", kind: "" }) as never;
    const selections = [
      { id: "1", targetId: "k", category: "flooring", product: product("Oak") },
      { id: "2", targetId: "k", category: "paint", product: product("Sage") },
    ] as Project["interior"]["selections"];
    const t = labelLines({ ...base, selections, cost: { share: 0.5, total: 200_000 } }, on({ finishes: true, costShare: true })).map((l) => l.text);
    expect(t).toContain("Floor: Oak");
    expect(t).toContain("Paint: Sage");
    expect(t).toContain("About $100k of the materials");
  });
  it("splits cost by living floor area and skips garages", () => {
    const g: PlanRoom = { ...room("g"), type: "garage" };
    const shares = costShares([[room("a", 120, 120), room("b", 120, 360), g]]);
    expect(shares.get("a")).toBeCloseTo(0.25);
    expect(shares.get("b")).toBeCloseTo(0.75);
    expect(shares.has("g")).toBe(false);
  });
  it("picks readable ink", () => {
    expect(labelInk("auto", "#111111")).toBe("light");
    expect(labelInk("auto", "#f0e0c0")).toBe("dark");
    expect(labelInk("auto")).toBe("dark");
    expect(labelInk("light", "#f0e0c0")).toBe("light");
  });
});

describe("saved label settings", () => {
  it("has defaults, and an older project opens with them", () => {
    expect(House3D.parse({}).walkLabels.name).toBe(true);
    expect(House3D.parse({}).walkLabels.costShare).toBe(false);
    const p = createProject("x");
    const old = JSON.parse(JSON.stringify({ ...p, schemaVersion: 20 }));
    delete old.house3d.walkLabels;
    const m = migrateProject(old);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.house3d.walkLabels.textSize).toBe("medium");
    expect(m.house3d.walkLabels.locked).toBe(false);
  });
  it("an older project keeps its label settings and gets locked off", () => {
    const old = JSON.parse(JSON.stringify({ ...createProject("x"), schemaVersion: 28 }));
    old.house3d.walkLabels = { name: false, textSize: "large" };
    const m = migrateProject(old);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.house3d.walkLabels).toMatchObject({ name: false, textSize: "large", locked: false });
    expect(WalkLabels.parse({ locked: true }).locked).toBe(true);
  });
});

describe("tape measure", () => {
  const a = { x: 0, y: 0, z: 0 };
  it("reads length, level and height parts", () => {
    const r = reading({ a, b: { x: 30, y: 40, z: 0 } });
    expect(r).toEqual({ length: 50, level: 50, height: 0 });
    expect(showParts(r)).toBe(false);
    const diag = reading({ a, b: { x: 30, y: 40, z: 120 } });
    expect(diag.length).toBeCloseTo(130);
    expect(showParts(diag)).toBe(true);
  });
  it("Shift locks level or upright", () => {
    expect(lockAxis(a, { x: 100, y: 0, z: 10 })).toEqual({ x: 100, y: 0, z: 0 });
    expect(lockAxis(a, { x: 5, y: 0, z: 90 })).toEqual({ x: 0, y: 0, z: 90 });
  });
  it("snaps to corners and door edges within 3 inches only", () => {
    const door = { id: "d", host: { roomId: "k", edge: 0 }, offsetIn: 24, kind: "door", style: "door-hinged", widthIn: 36, heightIn: 80, side: 1, hinge: "start" } as never;
    const plan = { rooms: [room("k")], walls: [], openings: [door], stairs: [], fixtures: [], furniture: [] };
    const heights = { [MAIN_LEVEL_ID]: { floorIn: 0, ceilingIn: 96 } };
    const cands = tapeCandidates({ [MAIN_LEVEL_ID]: plan }, heights, [MAIN_LEVEL_ID]);
    expect(snap({ x: 1, y: -2, z: 1 }, cands)).toEqual({ x: 0, y: 0, z: 0 });
    expect(snap({ x: 1, y: 1, z: 94 }, cands)).toEqual({ x: 0, y: 0, z: 96 });
    const edge = cands.find((c) => c.z === 80);
    expect(edge).toBeTruthy();
    const far = { x: 70, y: 70, z: 30 };
    expect(snap(far, cands)).toEqual(far);
  });
});
