import { describe, expect, it } from "vitest";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { rectangle } from "@/lib/plan/geometry";
import type { Project } from "@/lib/model/schema";
import { describeChange } from "@/lib/store/describe";
import { estimate } from "@/lib/cost/estimate";
import { buildSet } from "@/lib/plans/build";
import { sheetText } from "@/lib/plans/draw";
import { levelHeights } from "@/lib/house3d/levels";
import { riseFromHeights } from "@/lib/house3d/railings";
import { aimAt } from "@/lib/interior/surfaces";
import { addRailingIn, changeRailingIn, railingTarget, stageRailings } from "@/lib/furnish/railings";
import { bareSlots, describeRailingEdit, editRailing, railingLengths, railingsFor } from "@/lib/plan/railings";
import { house, TWO_STORY } from "./samples";

const FLOOR1 = "floor-1";

/** The sample two-story with each floor made one big room, so the stairs stand in the open and have guards on every open side. */
const twoStory = (): Project => {
  const p = house(TWO_STORY, 2);
  const floorPlans = Object.fromEntries(
    Object.entries(p.floorPlans).map(([id, pl]) => [id, { ...pl, openings: [], walls: [], rooms: [{ ...makeRoom(rectangle(0, 0, 900, 900), "Open plan", { type: "living" }), id: `big-${id}` }] }]),
  );
  return { ...p, floorPlans };
};
const stairsOf = (p: Project) => p.floorPlans[FLOOR1].stairs[0];
const found = (p: Project, levelId = FLOOR1) => stageRailings(p.floorPlans, p.levels, p.plan.basics, levelId);
const apply = (p: Project, edge: string, change: Parameters<typeof changeRailingIn>[2]): Project => {
  const t = { stairsId: stairsOf(p).id, stairsLevelId: FLOOR1, edge };
  const pl = changeRailingIn(p.floorPlans, t, change)!;
  return { ...p, floorPlans: { ...p.floorPlans, [FLOOR1]: pl } };
};
const lines = (p: Project, id: string) => estimate(p)!.categories.flatMap((c) => c.lines).filter((l) => l.id === id);

describe("editing railings in Furnish", () => {
  it("lists a removed side as bare, and Add railing here brings a guard back", () => {
    const p = twoStory();
    const before = found(p);
    expect(before.railings.map((r) => r.edge)).toContain("f1-left");
    expect(before.bare).toHaveLength(0);

    const gone = apply(p, "f1-left", "remove");
    const after = found(gone);
    expect(after.railings.map((r) => r.edge)).not.toContain("f1-left");
    expect(after.bare.map((x) => x.edge)).toEqual(["f1-left"]);
    expect(railingTarget(after, after.bare[0].key)?.slot).toBeTruthy();

    const back = addRailingIn(gone.floorPlans, { stairsId: stairsOf(p).id, stairsLevelId: FLOOR1, edge: "f1-left" })!;
    const again = found({ ...gone, floorPlans: { ...gone.floorPlans, [FLOOR1]: back } });
    expect(again.bare).toHaveLength(0);
    expect(again.railings.find((r) => r.edge === "f1-left")).toMatchObject({ kind: "guard", style: "wood", auto: false });
  });

  it("changes the kind and look of one side, and Back to automatic undoes it", () => {
    const p = twoStory();
    const half = apply(p, "f1-left", { kind: "half-wall" });
    expect(found(half).railings.find((r) => r.edge === "f1-left")).toMatchObject({ kind: "half-wall", auto: false });
    const glass = apply(half, "f1-left", { style: "glass" });
    expect(found(glass).railings.find((r) => r.edge === "f1-left")).toMatchObject({ kind: "half-wall", style: "glass" });
    const auto = apply(glass, "f1-left", "auto");
    expect(stairsOf(auto).railings).toBeUndefined();
    expect(found(auto).railings.find((r) => r.edge === "f1-left")).toMatchObject({ kind: "guard", auto: true });
  });

  it("edits the stairwell guards on the floor above, saved on the stairs below", () => {
    const p = twoStory();
    const up = found(p, "floor-2");
    const well = up.railings.find((r) => r.edge === "well-1")!;
    expect(well.stairsLevelId).toBe(FLOOR1);
    expect(well.levelId).toBe("floor-2");
    const t = railingTarget(up, well.key)!;
    const pl = changeRailingIn(p.floorPlans, t, "remove")!;
    const gone = { ...p, floorPlans: { ...p.floorPlans, [FLOOR1]: pl } };
    expect(found(gone, "floor-2").railings.map((r) => r.edge)).not.toContain("well-1");
    expect(found(gone, "floor-2").bare.map((x) => x.edge)).toContain("well-1");
  });

  it("gives every bare side the key the canvas picks it by", () => {
    const p = apply(twoStory(), "f1-right", "remove");
    const rail = bareSlots(p.floorPlans, FLOOR1, riseFromHeights(levelHeights(p.levels, p.plan.basics)));
    expect(rail.bare[0].key).toBe(`${stairsOf(p).id}:f1-right`);
  });

  it("returns null when the stairs are gone", () => {
    const p = twoStory();
    expect(changeRailingIn(p.floorPlans, { stairsId: "nope", stairsLevelId: FLOOR1, edge: "f1-left" }, "remove")).toBeNull();
  });

  it("names the change in the undo label", () => {
    const p = twoStory();
    const label = (a: Project, b: Project) => describeChange(a, b);
    expect(label(p, apply(p, "f1-left", "remove"))).toBe("remove a railing");
    expect(label(p, apply(p, "f1-left", { kind: "half-wall" }))).toBe("change a railing to a half wall");
    expect(label(p, apply(p, "f1-left", { style: "metal" }))).toBe("change a railing to black metal");
    const gone = apply(p, "f1-left", "remove");
    const added = { ...gone, floorPlans: { ...gone.floorPlans, [FLOOR1]: addRailingIn(gone.floorPlans, { stairsId: stairsOf(p).id, stairsLevelId: FLOOR1, edge: "f1-left" })! } };
    expect(label(gone, added)).toBe("add a railing");
    expect(label(gone, p)).toBe("put a railing back to automatic");
    const s = stairsOf(p);
    expect(describeRailingEdit(s, editRailing(editRailing(s, "f1-left", { removed: true }), "f1-right", { removed: true }))).toBeNull();
  });
});

describe("railing cost", () => {
  it("prices guards by look and adds a half wall line", () => {
    const p = twoStory();
    const wood = lines(p, "stair-guard-wood")[0];
    expect(wood.qty).toBeGreaterThan(5);
    const all = railingsFor(p.floorPlans, FLOOR1, riseFromHeights(levelHeights(p.levels, p.plan.basics))).concat(railingsFor(p.floorPlans, "floor-2", riseFromHeights(levelHeights(p.levels, p.plan.basics))));
    expect(wood.qty).toBeCloseTo(railingLengths(all).guard.wood, 5);

    const metal = apply(p, "f1-left", { style: "metal" });
    expect(lines(metal, "stair-guard-metal")[0].qty).toBeGreaterThan(5);
    expect(lines(metal, "stair-guard-wood")[0].qty).toBeLessThan(wood.qty);

    const half = apply(p, "f1-left", { kind: "half-wall" });
    expect(lines(half, "stair-half-wall")[0].qty).toBeGreaterThan(5);
    // A full wall counts as two half walls per foot.
    const full = apply(p, "f1-left", { kind: "wall" });
    expect(lines(full, "stair-half-wall")[0].qty).toBeCloseTo(lines(half, "stair-half-wall")[0].qty * 2, 5);
  });

  it("drops the railing lines when every railing is removed, and keeps handrails inside the stairs rate", () => {
    let p = twoStory();
    for (const e of ["f1-left", "f1-right"]) p = apply(p, e, "remove");
    const wells = found(p, "floor-2").railings;
    for (const w of wells) p = { ...p, floorPlans: { ...p.floorPlans, [FLOOR1]: changeRailingIn(p.floorPlans, w, "remove")! } };
    expect(lines(p, "stair-guard-wood")).toHaveLength(0);
    expect(lines(p, "stairs")).toHaveLength(1);
    const handrail = apply(twoStory(), "f1-left", { kind: "handrail" });
    expect(lines(handrail, "stair-half-wall")).toHaveLength(0);
  });
});

describe("railings on the PDF", () => {
  const text = (p: Project) => buildSet(p).flatMap(sheetText);

  it("labels the railings on the floor plan and the stair section", () => {
    const t = text(twoStory());
    expect(t).toContain('GUARD 34"');
    expect(t).toContain('GUARD 36"');
    expect(t.some((x) => x.includes("(OPEN SIDE)"))).toBe(true);
  });

  it("follows the changes: a half wall is labeled, and a removed side loses its label", () => {
    const half = text(apply(twoStory(), "f1-left", { kind: "half-wall" }));
    expect(half).toContain("HALF WALL");
    expect(half.some((x) => x.startsWith("HALF WALL (OPEN SIDE)"))).toBe(true);
    const bare = text(apply(apply(twoStory(), "f1-left", "remove"), "f1-right", "remove"));
    expect(bare.some((x) => x.includes("(OPEN SIDE)"))).toBe(false);
  });
});

describe("aiming at railings in the walkthrough", () => {
  const plan = emptyPlan();
  const hit = { p: { x: 0, y: 0 }, heightIn: 20, normal: { x: 1, y: 0, up: 0 } };
  const part = { layer: "stairs" as const, levelId: FLOOR1, pick: { kind: "stairs" as const, id: "s1", levelId: FLOOR1, railing: "s1:f1-left" } };

  it("finds the railing in the Place tab and when nothing else is there in Finishes", () => {
    const place = aimAt(plan, part, hit, null, undefined, { tab: "place", items: [] });
    expect(place).toMatchObject({ kind: "railing", id: "s1:f1-left", levelId: FLOOR1 });
    const fin = aimAt(plan, part, hit, null, undefined, { tab: "finishes", items: [] });
    expect(fin).toMatchObject({ kind: "railing", id: "s1:f1-left" });
  });

  it("leaves plain stairs as stairs", () => {
    const aim = aimAt(plan, { ...part, pick: { ...part.pick, railing: undefined } }, hit, null, undefined, { tab: "place", items: [] });
    expect(aim.kind).toBe("none");
  });
});
