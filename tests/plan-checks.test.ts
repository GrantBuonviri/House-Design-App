import { describe, expect, it } from "vitest";
import type { FloorPlan, PlanRoom } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { newOpening } from "@/lib/plan/connect";
import { openingProblems, planWarnings, tagOf } from "@/lib/plan/checks";
import { rectangle } from "@/lib/plan/geometry";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { house, RANCH, TWO_STORY } from "./samples";

const FT = 12;
const room = (id: string, x: number, y: number, w: number, h: number, extra: Partial<PlanRoom> = {}): PlanRoom => ({ ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id, ...extra });
const plan = (rooms: PlanRoom[], openings: FloorPlan["openings"] = []): FloorPlan => ({ ...emptyPlan(), rooms, openings });
const keys = (p: FloorPlan, ceiling = 96) => openingProblems(p, ceiling).map((x) => x.key.split(":")[0]);

describe("door and window checks", () => {
  it("flags two openings that overlap on the same wall, from either side of a shared wall", () => {
    const a = newOpening("window", { roomId: "a", edge: 0 }, 5 * FT, 1, 36);
    const b = newOpening("door-hinged", { roomId: "a", edge: 0 }, 7 * FT, 1, 32);
    expect(keys(plan([room("a", 0, 0, 12, 12)], [a, b]))).toEqual(["opening-overlap"]);
    // Far enough apart: nothing.
    const c = newOpening("door-hinged", { roomId: "a", edge: 0 }, 10 * FT, 1, 24);
    expect(keys(plan([room("a", 0, 0, 12, 12)], [a, c]))).toEqual([]);
    // Room b sits east of a: a's east edge (edge 1) and b's west edge (edge 3) are the same wall, run the other way.
    const d = newOpening("door-hinged", { roomId: "a", edge: 1 }, 6 * FT, 1, 32);
    const e = newOpening("door-hinged", { roomId: "b", edge: 3 }, 6 * FT, 1, 32);
    const ws = openingProblems(plan([room("a", 0, 0, 12, 12), room("b", 12, 0, 12, 12)], [d, e]), 96);
    expect(ws.map((w) => w.key)).toEqual([`opening-overlap:${d.id}:${e.id}`]);
    expect(ws[0].text).toMatch(/Door and door overlap on the same wall by 2' 8"/);
  });

  it("flags an opening wider than its wall or running past its end", () => {
    const wide = newOpening("door-slider", { roomId: "a", edge: 0 }, 3 * FT, 1, 96);
    const ws = openingProblems(plan([room("a", 0, 0, 6, 6)], [wide]), 96);
    expect(ws.map((w) => w.key.split(":")[0])).toEqual(["opening-wide"]);
    expect(ws[0].text).toMatch(/8' wide, but its wall is only 6' long/);
    const off = newOpening("window", { roomId: "a", edge: 0 }, 1 * FT, 1, 36);
    expect(openingProblems(plan([room("a", 0, 0, 12, 12)], [off]), 96)[0].text).toMatch(/runs past the end of its wall/);
  });

  it("flags a door or window taller than the ceiling", () => {
    const door = { ...newOpening("door-hinged", { roomId: "a", edge: 0 }, 6 * FT, 1, 32), heightIn: 100 };
    const win = { ...newOpening("window", { roomId: "a", edge: 2 }, 6 * FT, 1, 36), heightIn: 60, sillIn: 40 };
    const ws = openingProblems(plan([room("a", 0, 0, 12, 12)], [door, win]), 96);
    expect(ws.map((w) => w.key.split(":")[0])).toEqual(["opening-tall", "opening-tall"]);
    expect(ws[0].text).toMatch(/Door is 8' 4" tall, above the 8' ceiling/);
    expect(ws[1].text).toMatch(/top is 8' 4" up.*lower its sill/);
    // Same window with a 9' ceiling is fine.
    expect(openingProblems(plan([room("a", 0, 0, 12, 12)], [win]), 108)).toEqual([]);
  });

  it("finds none of these in the sample houses", () => {
    for (const p of [house(RANCH), house(TWO_STORY, 2), house(RANCH, 1, 1)]) {
      const ws = planWarnings(p.floorPlans, { levels: p.levels, brief: p.brief, basics: p.plan.basics });
      expect(ws.filter((w) => /:opening-/.test(w.id)).map((w) => w.text)).toEqual([]);
    }
  });
});

describe("Code and Comfort tags", () => {
  it("tags what an inspector checks as code, the rest as comfort", () => {
    for (const k of ["egress:b", "egress-basement", "setback:r", "light:r", "code-area:r", "code-width:r", "headroom:a:b", "stairwidth:s", "narrow:h", "overhang:r", "nofront", "land:lot"]) expect(tagOf(k)).toBe("code");
    for (const k of ["overlap:a:b", "gap:a:b", "nodoor:r", "cutoff:r", "through:r", "swing:d", "too-small:r", "too-big:r", "opening-overlap:a:b", "opening-wide:a", "opening-tall:a", "land:rock:1", "missing:x"]) expect(tagOf(k)).toBe("comfort");
  });

  it("gives every warning a tag and splits too small from too big", () => {
    const levels = levelsFor(1, 0);
    const brief = { rooms: [{ id: "x", name: "Den", targetSqFt: 400 }, { id: "y", name: "Office", targetSqFt: 50 }] } as never;
    const p = plan([room("a", 0, 0, 10, 10, { briefRoomId: "x", name: "Den" }), room("b", 20, 0, 12, 12, { briefRoomId: "y", name: "Office" })]);
    const ws = planWarnings({ [levels[0].id]: p }, { levels, brief, basics: defaultBasics() });
    expect(ws.every((w) => w.tag === "code" || w.tag === "comfort")).toBe(true);
    expect(ws.some((w) => w.id === `${levels[0].id}:too-small:a`)).toBe(true);
    expect(ws.some((w) => w.id === `${levels[0].id}:too-big:b`)).toBe(true);
    expect(ws.find((w) => w.id.endsWith(":nofront"))?.tag).toBe("code");
  });
});
