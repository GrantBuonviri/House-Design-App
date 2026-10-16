import { describe, expect, it } from "vitest";
import type { FloorPlan } from "@/lib/model/schema";
import { addRoom, centerOfMany, emptyPlan, makeRoom, rotateMany, turnableIds } from "@/lib/plan/edit";
import { rectangle } from "@/lib/plan/geometry";

function setup() {
  const a = makeRoom(rectangle(0, 0, 120, 120), "A");
  const b = makeRoom(rectangle(120, 0, 120, 120), "B");
  const plan: FloorPlan = {
    ...addRoom(addRoom(emptyPlan(), a), b),
    walls: [{ id: "w1", a: { x: 300, y: 0 }, b: { x: 400, y: 0 }, thicknessIn: 4.5 }],
    stairs: [{ id: "s1", x: 500, y: 50, rotation: 0, widthIn: 36, shape: "straight", flip: false }],
  };
  return { plan, a, b };
}

describe("Turn items in the right-click menu", () => {
  it("turns rooms, loose walls and stairs, alone or picked together", () => {
    const { plan, a, b } = setup();
    expect(turnableIds(plan, [a.id])).toEqual([a.id]);
    expect(turnableIds(plan, ["w1"])).toEqual(["w1"]);
    expect(turnableIds(plan, ["s1"])).toEqual(["s1"]);
    expect(turnableIds(plan, [a.id, b.id, "w1"])).toEqual([a.id, b.id, "w1"]);
  });

  it("offers nothing for an edge, an opening or a corner", () => {
    const { plan, a } = setup();
    expect(turnableIds(plan, [`${a.id}#0`, "o1"])).toEqual([]);
  });

  it("a 15° turn of a room leaves its neighbor unchanged", () => {
    const { plan, a, b } = setup();
    const out = rotateMany(plan, [a.id], 15, centerOfMany(plan, [a.id]));
    expect(out.rooms.find((r) => r.id === b.id)!.polygon).toEqual(b.polygon);
    expect(out.rooms.find((r) => r.id === a.id)!.polygon).not.toEqual(a.polygon);
  });

  it("turns stairs and loose walls with the same call", () => {
    const { plan } = setup();
    const out = rotateMany(plan, ["s1"], 90, centerOfMany(plan, ["s1"]));
    expect(out.stairs[0].rotation).toBe(90);
    expect(rotateMany(plan, ["w1"], -90, centerOfMany(plan, ["w1"])).walls[0].a.y).not.toBe(0);
  });
});
