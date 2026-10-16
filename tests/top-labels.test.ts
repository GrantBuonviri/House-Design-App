import { describe, expect, it } from "vitest";
import { House3D, SCHEMA_VERSION, TopLabels, type PlanRoom, type Project } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { describeChange } from "@/lib/store/describe";
import { pointInPolygon, rectangle } from "@/lib/plan/geometry";
import { clampLabelOffset, pruneTopLabels, topLabelFor } from "@/lib/house3d/topLabels";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";

const level = levelFor(MAIN_LEVEL_ID);
const kitchen: PlanRoom = { id: "k", name: "Kitchen", type: "kitchen", polygon: rectangle(72, 84, 144, 168) };
const sel = [] as Project["interior"]["selections"];
const cfg = (over: Partial<TopLabels> = {}) => TopLabels.parse(over);
const texts = (s: TopLabels, room = kitchen) => topLabelFor(room, level, null, sel, s)?.lines.map((l) => l.text);

// An L shape: the notch (upper right) is outside the room.
const ell: PlanRoom = {
  id: "l",
  name: "Den",
  type: "den",
  polygon: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 200 },
    { x: 0, y: 200 },
  ],
};

describe("top view label settings", () => {
  it("migrates from the previous version to the defaults", () => {
    const old = JSON.parse(JSON.stringify(createProject("T"))) as { house3d: Record<string, unknown>; schemaVersion: number };
    delete old.house3d.topLabels;
    old.schemaVersion = SCHEMA_VERSION - 1;
    const m = migrateProject(old);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.house3d.topLabels).toMatchObject({ name: true, sqft: true, size: false, textSize: "small", background: "soft", hideAll: false, rooms: {} });
    expect(House3D.parse({}).topLabels.rooms).toEqual({});
  });
  it("says name and square feet by default, like the old labels", () => {
    expect(texts(cfg())).toEqual(["Kitchen", "168 sq ft"]);
  });
  it("follows the switches", () => {
    expect(texts(cfg({ sqft: false }))).toEqual(["Kitchen"]);
    expect(texts(cfg({ size: true, units: "inches" }))).toEqual(["Kitchen", `144" × 168"`, "168 sq ft"]);
  });
  it("lets a typed name replace the room name on the label only", () => {
    expect(texts(cfg({ rooms: { k: { text: "Cook's corner" } } }))?.[0]).toBe("Cook's corner");
    expect(kitchen.name).toBe("Kitchen");
    expect(texts(cfg({ rooms: { k: { text: "   " } } }))?.[0]).toBe("Kitchen");
  });
  it("gives no label for a hidden room", () => {
    expect(texts(cfg({ rooms: { k: { hidden: true } } }))).toBeUndefined();
  });
  it("hides everything with hideAll but keeps the per-room choices", () => {
    const s = cfg({ hideAll: true, rooms: { k: { text: "Galley" } } });
    expect(texts(s)).toBeUndefined();
    const back = { ...s, hideAll: false };
    expect(texts(back)?.[0]).toBe("Galley");
  });
  it("moves a label by its offset and keeps it inside an L-shaped room", () => {
    const home = topLabelFor(ell, level, null, sel, cfg())!.at;
    const moved = topLabelFor(ell, level, null, sel, cfg({ rooms: { l: { offset: { x: 20, y: 10 } } } }))!.at;
    expect(moved.x - home.x).toBeCloseTo(20);
    const out = clampLabelOffset(ell, { x: 250, y: -150 });
    expect(pointInPolygon(out.at, ell.polygon)).toBe(true);
    const fine = clampLabelOffset(ell, { x: 10, y: 5 });
    expect(fine.offset).toEqual({ x: 10, y: 5 });
  });
  it("drops choices for rooms that are gone", () => {
    const s = cfg({ rooms: { k: { hidden: true }, gone: { hidden: true } } });
    expect(Object.keys(pruneTopLabels(s, new Set(["k"])).rooms)).toEqual(["k"]);
    expect(pruneTopLabels(s, new Set(["k", "gone"]))).toBe(s);
  });
  it("names the label in the undo text", () => {
    const before = createProject("T");
    before.floorPlans[MAIN_LEVEL_ID] = { ...(before.floorPlans[MAIN_LEVEL_ID] ?? { walls: [], openings: [], fixtures: [], stairs: [] }), rooms: [kitchen] } as never;
    const withRoom = (r: TopLabels["rooms"]): Project => ({ ...before, house3d: { ...before.house3d, topLabels: cfg({ rooms: r }) } });
    expect(describeChange(withRoom({}), withRoom({ k: { hidden: true } }))).toBe("hide the Kitchen label");
    expect(describeChange(withRoom({ k: { hidden: true } }), withRoom({}))).toBe("show the Kitchen label");
    expect(describeChange(withRoom({}), withRoom({ k: { text: "X" } }))).toBe("rename the Kitchen label");
    expect(describeChange(withRoom({}), withRoom({ k: { offset: { x: 1, y: 2 } } }))).toBe("move the Kitchen label");
    expect(describeChange(withRoom({}), { ...withRoom({}), house3d: { ...before.house3d, topLabels: cfg({ textSize: "large" }) } })).toBe("change the 3D labels");
  });
});
