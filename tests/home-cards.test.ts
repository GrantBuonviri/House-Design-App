import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/model/project";
import { houseThumb, shownHouses } from "@/lib/home/cards";

const sq = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("home cards", () => {
  it("has no picture until a floor plan is drawn", () => {
    expect(houseThumb(createProject("Empty"))).toBeNull();
  });

  it("draws the main floor, fitted to its rooms", () => {
    const p = createProject("Drawn");
    const id = p.levels[0].id;
    p.floorPlans[id] = { rooms: [{ id: "a", name: "A", polygon: sq(100, 200, 120) }, { id: "b", name: "B", polygon: sq(220, 200, 120) }], walls: [], openings: [], stairs: [], fixtures: [], furniture: [] } as never;
    const t = houseThumb(p)!;
    expect(t.rooms).toHaveLength(2);
    expect(t.box[0]).toBeLessThan(100);
    expect(t.box[2]).toBeGreaterThan(240);
  });

  it("searches by every word and sorts", () => {
    const h = [
      { name: "Lake cabin", updatedAt: "2026-01-04" },
      { name: "Alpine house", updatedAt: "2026-01-03" },
      { name: "Lake house", updatedAt: "2026-01-01" },
    ];
    expect(shownHouses(h, "", "edited").map((x) => x.name)).toEqual(["Lake cabin", "Alpine house", "Lake house"]);
    expect(shownHouses(h, "", "name").map((x) => x.name)).toEqual(["Alpine house", "Lake cabin", "Lake house"]);
    expect(shownHouses(h, "LAKE hou", "edited").map((x) => x.name)).toEqual(["Lake house"]);
    expect(shownHouses(h, "zzz", "name")).toEqual([]);
  });
});
