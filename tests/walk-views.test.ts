import { describe, expect, it } from "vitest";
import { addView, removeView, renameView, screenshotName, viewHere, viewName, walkerAt } from "@/lib/house3d/views";
import { createProject, migrateProject } from "@/lib/model/project";
import { describeChange } from "@/lib/store/describe";
import { SCHEMA_VERSION } from "@/lib/model/schema";

const w = { p: { x: 120.04, y: 240.06 }, feet: 0, vz: 3, yaw: 1.234567, pitch: -0.1 };

describe("saved camera spots", () => {
  it("names spots by room without repeating a name", () => {
    expect(viewName("Kitchen", [])).toBe("Kitchen view");
    expect(viewName("Kitchen", [{ name: "Kitchen view" }, { name: "kitchen view 2" }])).toBe("Kitchen view 3");
    expect(viewName("", [])).toBe("Outside view");
  });

  it("saves where you stand and look, and puts you back there standing still", () => {
    const v = viewHere(w, "Kitchen view", "v1");
    expect(v).toEqual({ id: "v1", name: "Kitchen view", x: 120, y: 240.1, feet: 0, yaw: 1.2346, pitch: -0.1 });
    const back = walkerAt(v, { p: { x: 0, y: 0 }, feet: 100, vz: 5, yaw: 0, pitch: 0 });
    expect(back).toEqual({ p: { x: 120, y: 240.1 }, feet: 0, vz: 0, yaw: 1.2346, pitch: -0.1 });
  });

  it("adds, renames and deletes; a blank name keeps the old one", () => {
    let views = addView([], viewHere(w, "Kitchen view", "v1"));
    views = renameView(views, "v1", "  Island  ");
    expect(views[0].name).toBe("Island");
    expect(renameView(views, "v1", " ")[0].name).toBe("Island");
    expect(removeView(views, "v1")).toEqual([]);
  });

  it("is saved with the house, old saves get none, and undo names the step", () => {
    const p = createProject("Test");
    expect(p.house3d.walkViews).toEqual([]);
    const old = { ...JSON.parse(JSON.stringify(p)), schemaVersion: 34 };
    delete old.house3d.walkViews;
    const m = migrateProject(old);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.house3d.walkViews).toEqual([]);
    const withView = { ...p, house3d: { ...p.house3d, walkViews: [viewHere(w, "Kitchen view", "v1")] } };
    expect(describeChange(p, withView)).toBe("save a camera spot");
    expect(describeChange(withView, p)).toBe("delete a camera spot");
    expect(describeChange(withView, { ...p, house3d: { ...p.house3d, walkViews: renameView(withView.house3d.walkViews, "v1", "Island") } })).toBe("rename a camera spot");
  });

  it("names a screenshot by house, room and time, without characters files can't have", () => {
    expect(screenshotName("Our house: v2", "Kitchen", new Date(2026, 9, 17, 14, 5))).toBe("Our house v2 - Kitchen - 2026-10-17 14.05.png");
    expect(screenshotName("", "", new Date(2026, 0, 2, 3, 4))).toBe("House - 2026-01-02 03.04.png");
  });
});
