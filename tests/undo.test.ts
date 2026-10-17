import { STAGE_INFO, shownStage } from "@/lib/stages";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "@/lib/model/project";
import type { FloorPlan, Project } from "@/lib/model/schema";
import { saveProject } from "@/lib/storage/db";
import { describeChange } from "@/lib/store/describe";
import { SAVED_HISTORY, useProjectStore } from "@/lib/store/projectStore";

const plan = (rooms: FloorPlan["rooms"]): FloorPlan => ({ rooms, walls: [], openings: [], stairs: [], fixtures: [], furniture: [] });
const square = (x: number) => [
  { x, y: 0 },
  { x: x + 100, y: 0 },
  { x: x + 100, y: 100 },
];

describe("describing a change", () => {
  const base = createProject("Test");
  const withPlan = (rooms: FloorPlan["rooms"]): Project => ({ ...base, floorPlans: { "floor-1": plan(rooms) } });

  it("names rooms that were added, moved, renamed or deleted", () => {
    const a = withPlan([{ id: "k", name: "Kitchen", polygon: square(0) }]);
    expect(describeChange(withPlan([]), a)).toBe("add Kitchen");
    expect(describeChange(a, withPlan([{ id: "k", name: "Kitchen", polygon: square(50) }]))).toBe("move Kitchen");
    expect(describeChange(a, withPlan([{ id: "k", name: "Cook", polygon: square(0) }]))).toBe("rename Kitchen");
    expect(describeChange(a, withPlan([]))).toBe("delete Kitchen");
  });

  it("names a product pick", () => {
    const pick = {
      id: "s1",
      targetId: "house",
      category: "flooring",
      product: { name: "Oak plank", brand: "X", url: "https://example.com", unit: "sqft" as const, priceSource: "listed" as const, lastChecked: "2026-10-01" },
    };
    expect(describeChange(base, { ...base, interior: { ...base.interior, selections: [pick] } })).toBe("pick Oak plank");
  });

  it("names a renamed house", () => {
    expect(describeChange(base, { ...base, name: "Other" })).toBe("rename the house");
  });
});

describe("undo and redo", () => {
  afterEach(async () => {
    await useProjectStore.getState().close();
  });

  async function openNew(): Promise<string> {
    const p = createProject("Undo house");
    await saveProject(p);
    await useProjectStore.getState().open(p.id);
    return p.id;
  }
  const rename = (name: string, coalesce?: string) => useProjectStore.getState().update((p) => ({ ...p, name }), coalesce ? { coalesce } : undefined);

  it("undoes and redoes, with labels", async () => {
    await openNew();
    rename("One");
    rename("Two");
    const s = useProjectStore.getState();
    expect(s.canUndo).toBe(true);
    expect(s.undoLabel()).toBe("rename the house");
    s.undo();
    expect(useProjectStore.getState().project!.name).toBe("One");
    expect(useProjectStore.getState().notice?.text).toBe("Undid: rename the house");
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project!.name).toBe("Two");
    expect(useProjectStore.getState().canRedo).toBe(false);
  });

  it("shows old Interior / Exterior saves on Furnish and drops them from the stage bar", () => {
    expect(shownStage("interior")).toBe("furnish");
    expect(shownStage("exterior")).toBe("furnish");
    expect(shownStage("plan")).toBe("plan");
    expect(STAGE_INFO.map((x) => x.id)).not.toContain("interior");
    expect(STAGE_INFO.map((x) => x.id)).not.toContain("exterior");
  });

  it("doesn't count switching stages as a step, and undo stays on the page", async () => {
    await openNew();
    rename("One");
    const s = useProjectStore.getState();
    s.setStage("plan");
    expect(useProjectStore.getState().project!.stage).toBe("plan");
    s.undo();
    const after = useProjectStore.getState().project!;
    expect(after.name).toBe("Undo house");
    expect(after.stage).toBe("plan");
    expect(useProjectStore.getState().canUndo).toBe(false);
  });

  it("makes typing in one field one step", async () => {
    await openNew();
    rename("A", "name");
    rename("AB", "name");
    rename("ABC", "name");
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project!.name).toBe("Undo house");
  });

  it("keeps the last steps after closing and reopening", async () => {
    const id = await openNew();
    for (let i = 1; i <= SAVED_HISTORY + 5; i++) rename(`Name ${i}`);
    useProjectStore.getState().undo();
    await useProjectStore.getState().close();

    await useProjectStore.getState().open(id);
    const s = useProjectStore.getState();
    expect(s.project!.name).toBe(`Name ${SAVED_HISTORY + 4}`);
    expect(s.canRedo).toBe(true);
    expect(s.at).toBe(SAVED_HISTORY);
    s.redo();
    expect(useProjectStore.getState().project!.name).toBe(`Name ${SAVED_HISTORY + 5}`);
  });

  it("can undo back to how the house was when first opened, after reopening", async () => {
    const id = await openNew();
    rename("Changed");
    await useProjectStore.getState().close();
    await useProjectStore.getState().open(id);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project!.name).toBe("Undo house");
  });
});

describe("dismiss labels", () => {
  const base = createProject("Test");
  const withDismissed = (d: string[]): Project => ({ ...base, plan: { ...base.plan, dismissed: d } });
  it("names dismissing and bringing back", () => {
    expect(describeChange(withDismissed([]), withDismissed(["a"]))).toBe("dismiss a thing to check");
    expect(describeChange(withDismissed(["a", "b"]), withDismissed(["b"]))).toBe("bring back a thing to check");
    expect(describeChange(withDismissed(["a", "b"]), withDismissed([]))).toBe("bring back all things to check");
  });
});
