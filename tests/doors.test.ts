import { describe, expect, it } from "vitest";
import { House3D, type FloorPlan, type Opening, type PlanRoom, type Point, SCHEMA_VERSION } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { levelFor, MAIN_LEVEL_ID } from "@/lib/brief/levels";
import { defaultBasics } from "@/lib/plan/basics";
import { rectangle } from "@/lib/plan/geometry";
import { openingGeometry } from "@/lib/plan/walls";
import { buildLevel, type HouseContext, type Part } from "@/lib/house3d/build";
import { levelHeights } from "@/lib/house3d/levels";
import { siteFor } from "@/lib/house3d/site";
import { turnAbout } from "@/lib/house3d/openings";
import { aimDoor, CLOSE_AFTER_S, inTrigger, leafPose, newDoorStates, stepDoors, toggleDoor, type DoorInfo } from "@/lib/house3d/doors";
import { describeChange } from "@/lib/store/describe";

const FT = 12;

function room(id: string, x: number, y: number, w: number, h: number): PlanRoom {
  return { id, name: id, type: "living", polygon: rectangle(x + w / 2, y + h / 2, w, h) };
}
function plan(openings: Opening[]): FloorPlan {
  return { rooms: [room("a", 0, 0, 15 * FT, 12 * FT), room("b", 15 * FT, 0, 15 * FT, 12 * FT)], walls: [], openings, stairs: [], fixtures: [], furniture: [] };
}
const door = (style = "door-hinged", extra: Partial<Opening> = {}): Opening => ({ id: "d", host: { roomId: "a", edge: 1 }, offsetIn: 6 * FT, kind: "door", style, widthIn: 36, heightIn: 80, side: 1, hinge: "start", ...extra });

function parts(o: Opening): Part[] {
  const plans = { [MAIN_LEVEL_ID]: plan([o]) };
  const levels = [levelFor(MAIN_LEVEL_ID)];
  const ctx: HouseContext = { levels, basics: defaultBasics(), house3d: House3D.parse({}), site: siteFor(null, { x: 0, y: 0 }, plans), frame: { ox: 0, oy: 0 } };
  return buildLevel(plans, levels[0], { ...ctx, heights: levelHeights(levels, ctx.basics) } as HouseContext & { heights: ReturnType<typeof levelHeights> });
}

const info = (extra: Partial<DoorInfo> = {}): DoorInfo => ({
  id: "d",
  levelId: MAIN_LEVEL_ID,
  style: "door-hinged",
  label: "Hall door",
  center: { x: 0, y: 0 },
  u: { x: 0, y: 1 },
  n: { x: 1, y: 0 },
  widthIn: 36,
  z0: 0,
  z1: 80,
  motion: "swing",
  locked: false,
  ...extra,
});
const near = { p: { x: -20, y: 0 }, feet: 0 };
const far = { p: { x: -200, y: 0 }, feet: 0 };
function run(states: ReturnType<typeof newDoorStates>, d: DoorInfo, who: { p: Point; feet: number } | null, seconds: number, mode: "normal" | "open" | "closed" | "none" = "normal") {
  let st = states;
  for (let t = 0; t < seconds; t += 1 / 60) st = stepDoors(st, [d], who, 1 / 60, mode);
  return st;
}

describe("door leaves in the 3D parts", () => {
  it("come out as their own parts, drawn closed across the doorway", () => {
    const ps = parts(door());
    const leaf = ps.filter((p) => p.door && p.quality !== "pretty");
    expect(leaf).toHaveLength(1);
    expect(leaf[0].pick).toEqual({ kind: "opening", id: "d", levelId: MAIN_LEVEL_ID });
    expect(leaf[0].door!.motion.kind).toBe("swing");
    // Closed: the leaf stays within the doorway, along the wall line (x = 15 ft, scene feet).
    const xs = Array.from(leaf[0].mesh.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(15 - 3 / 12);
    expect(Math.max(...xs)).toBeLessThan(15 + 3 / 12);
    // The casing stays in the frame part, which is not a door part.
    expect(ps.some((p) => p.pick?.id === "d" && !p.door)).toBe(true);
  });

  it("swings the leaf out to the side it's hung to swing, ending against the wall", () => {
    for (const side of [1, -1] as const) {
      const o = door("door-hinged", { side });
      const m = parts(o).find((p) => p.door)!.door!.motion;
      if (m.kind !== "swing") throw new Error("expected a swing");
      const og = openingGeometry(plan([o]), o)!;
      // The far end of the closed leaf, turned all the way open, lands along the swing direction.
      const far = { x: m.hinge.x + og.u.x * 30, y: m.hinge.y + og.u.y * 30 };
      const open = turnAbout(far, m.hinge, m.angle);
      expect((open.x - m.hinge.x) * og.n.x * side + (open.y - m.hinge.y) * og.n.y * side).toBeCloseTo(30, 5);
      expect((open.x - m.hinge.x) * og.u.x + (open.y - m.hinge.y) * og.u.y).toBeCloseTo(0, 5);
    }
  });

  it("gives each kind of door its own motion", () => {
    const kinds = Object.fromEntries(["door-hinged", "door-double", "door-slider", "door-pocket", "door-barn", "door-garage"].map((s) => [s, parts(door(s)).filter((p) => p.door && p.quality !== "pretty").map((p) => p.door!.motion.kind)]));
    expect(kinds["door-hinged"]).toEqual(["swing"]);
    expect(kinds["door-double"]).toEqual(["swing", "swing"]);
    expect(new Set(kinds["door-slider"])).toEqual(new Set(["slide"]));
    expect(kinds["door-pocket"]).toEqual(["slide"]);
    expect(kinds["door-barn"]).toEqual(["slide"]);
    expect(kinds["door-garage"]).toEqual(["roll"]);
  });

  it("has no leaf for a window or a bare opening", () => {
    expect(parts(door("window", { kind: "window" })).some((p) => p.door)).toBe(false);
    expect(parts(door("opening", { kind: "opening" })).some((p) => p.door)).toBe(false);
  });

  it("moves with the door: a slider pane slides, a garage door rolls up", () => {
    const slide = { kind: "slide" as const, shift: { x: 0, y: -30 } };
    expect(leafPose(slide, 0.5).shift).toEqual({ x: 0, y: -15 });
    expect(leafPose({ kind: "roll" }, 1).stretch).toBeLessThan(0.1);
    expect(leafPose({ kind: "swing", angle: Math.PI / 2 }, 0.5).turn).toBeCloseTo(Math.PI / 4, 9);
    expect(leafPose({ kind: "swing", angle: 1 }, 0).turn).toBe(0);
  });
});

describe("the door state machine", () => {
  it("starts shut and opens when you walk up to it", () => {
    const d = info();
    let st = newDoorStates([d]);
    expect(st.d.amount).toBe(0);
    st = run(st, d, near, 0.2);
    expect(st.d.amount).toBeGreaterThan(0);
    expect(st.d.amount).toBeLessThan(1);
    st = run(st, d, near, 0.5);
    expect(st.d.amount).toBe(1);
  });

  it("doesn't open for someone far away or on another floor", () => {
    const d = info();
    expect(inTrigger(d, far.p, 0)).toBe(false);
    expect(run(newDoorStates([d]), d, far, 1).d.amount).toBe(0);
    expect(run(newDoorStates([d]), d, { p: near.p, feet: 108 }, 1).d.amount).toBe(0);
  });

  it("waits while you stand by it, then shuts about four seconds after you've gone", () => {
    const d = info();
    let st = run(newDoorStates([d]), d, near, 1);
    st = run(st, d, near, 10);
    expect(st.d.amount).toBe(1);
    st = run(st, d, far, CLOSE_AFTER_S - 1);
    expect(st.d.amount).toBe(1);
    st = run(st, d, far, 3);
    expect(st.d.amount).toBe(0);
  });

  it("takes longer to roll up a garage door than to swing a door", () => {
    const g = info({ motion: "roll" });
    expect(run(newDoorStates([g]), g, near, 0.5).d.amount).toBeLessThan(0.5);
    expect(run(newDoorStates([info()]), info(), near, 0.5).d.amount).toBe(1);
  });

  it("keeps a locked door shut until clicked, and a hand-opened door open", () => {
    const d = info({ locked: true });
    let st = run(newDoorStates([d]), d, near, 2);
    expect(st.d.amount).toBe(0);
    st = toggleDoor(st, d, near, "normal").states;
    expect(st.d.hand).toBe(true);
    st = run(st, d, far, 20);
    expect(st.d.amount).toBe(1);
    st = toggleDoor(st, d, far, "normal").states;
    st = run(st, d, far, 1);
    expect(st.d.amount).toBe(0);
  });

  it("closes a door you opened by hand only when you click it, and won't shut it on you", () => {
    const d = info();
    let st = toggleDoor(newDoorStates([d]), d, null, "normal").states;
    st = run(st, d, null, 1);
    const stuck = toggleDoor(st, d, { p: { x: 0, y: 0 }, feet: 0 }, "normal");
    expect(stuck.said).toMatch(/doorway/);
    expect(stuck.states.d.open).toBe(true);
  });

  it("follows the Doors picker: All open, All closed and No doors", () => {
    const d = info({ locked: true });
    expect(run(newDoorStates([d]), d, far, 1, "open").d.amount).toBe(1);
    expect(run(run(newDoorStates([d]), d, far, 1, "open"), d, near, 1, "closed").d.amount).toBe(0);
    expect(run(newDoorStates([d]), d, far, 1, "none").d.amount).toBe(1);
    // Clicking does nothing while a mode is forcing the doors.
    expect(toggleDoor(newDoorStates([d]), d, near, "closed").said).toBeTruthy();
    // Back to Normal: doors left open shut again once you're away.
    const back = run(run(newDoorStates([d]), d, far, 1, "open"), d, far, 6, "normal");
    expect(back.d.amount).toBe(0);
  });
});

describe("aiming at a door", () => {
  const eye = { x: -50, y: 5, z: 64 };
  it("finds the door you're looking at, within reach", () => {
    expect(aimDoor([info()], eye, { x: 1, y: 0, z: 0 }, 90)?.id).toBe("d");
    expect(aimDoor([info()], eye, { x: 1, y: 0, z: 0 }, 30)).toBeNull();
  });
  it("misses when you look past it, above it or away", () => {
    expect(aimDoor([info()], eye, { x: 1, y: 1, z: 0 }, 200)).toBeNull();
    expect(aimDoor([info()], eye, { x: 1, y: 0, z: 1 }, 200)).toBeNull();
    expect(aimDoor([info()], eye, { x: -1, y: 0, z: 0 }, 200)).toBeNull();
  });
  it("can't reach through a wall", () => {
    expect(aimDoor([info()], eye, { x: 1, y: 0, z: 0 }, 90, () => true)).toBeNull();
  });
});

describe("saved locked doors", () => {
  it("opens version 21 projects with every door unlocked", () => {
    const p = createProject("Old");
    const old = JSON.parse(JSON.stringify({ ...p, schemaVersion: 21, floorPlans: { [MAIN_LEVEL_ID]: plan([door()]) } }));
    const m = migrateProject(old);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.floorPlans[MAIN_LEVEL_ID].openings[0].locked).toBeUndefined();
  });
  it("keeps a lock through saving", () => {
    const p = createProject("Locked");
    const withLock = { ...p, floorPlans: { [MAIN_LEVEL_ID]: plan([door("door-hinged", { locked: true })]) } };
    expect(migrateProject(JSON.parse(JSON.stringify(withLock))).floorPlans[MAIN_LEVEL_ID].openings[0].locked).toBe(true);
  });
  it("labels locking for Undo", () => {
    const p = createProject("Locked");
    const a = { ...p, floorPlans: { [MAIN_LEVEL_ID]: plan([door()]) } };
    const b = { ...p, floorPlans: { [MAIN_LEVEL_ID]: plan([door("door-hinged", { locked: true })]) } };
    expect(describeChange(a, b)).toBe("lock a door");
    expect(describeChange(b, a)).toBe("unlock a door");
  });
});
