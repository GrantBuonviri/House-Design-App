import { describe, expect, it } from "vitest";
import type { Fixture, FloorPlan, PlanRoom } from "@/lib/model/schema";
import { levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { INTERIOR_WALL_IN, defaultBasics } from "@/lib/plan/basics";
import { DOOR_RETURN_IN, newOpening, openingRooms, placeDoor } from "@/lib/plan/connect";
import { accessibleRoom, connectAll, doorSize } from "@/lib/plan/doors";
import { planWarnings } from "@/lib/plan/checks";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { rectangle } from "@/lib/plan/geometry";
import { recheck } from "@/lib/plan/recheck";
import { flipSwing, swingClear, swingRoom, toPocketDoor } from "@/lib/plan/swing";
import { openingGeometry } from "@/lib/plan/walls";
import { describeChange } from "@/lib/store/describe";
import { createProject } from "@/lib/model/project";
import { house, RANCH, TWO_STORY } from "./samples";

const FT = 12;
const levels = levelsFor(1, 0);
const [main] = levels;
const ctx = { levels, brief: null, basics: defaultBasics() };
const RET = DOOR_RETURN_IN + INTERIOR_WALL_IN / 2;

function room(id: string, type: string, x: number, y: number, w: number, h: number, name = roomType(type).label): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), name), id, type };
}
const plan = (rooms: PlanRoom[], extra: Partial<FloorPlan> = {}): FloorPlan => ({ ...emptyPlan(), rooms, ...extra });
const fixture = (kind: string, x: number, y: number, w: number, d: number, rotation = 0): Fixture => ({ id: `f-${kind}-${x}-${y}`, kind, x, y, rotation, widthIn: w, depthIn: d });

/** How far a door's nearer end is from the nearer end of its wall, in inches. */
function fromEnd(p: FloorPlan, id: string, wallLength: number): number {
  const o = p.openings.find((x) => x.id === id)!;
  return Math.min(o.offsetIn - o.widthIn / 2, wallLength - (o.offsetIn + o.widthIn / 2));
}

describe("where Suggest a plan puts doors", () => {
  // A hall down the left, a bedroom to its right: they share a 12' wall at x = 4'.
  const hall = room("h", "hall", 0, 0, 4, 12, "Hall");
  const bed = room("b", "bedroom", 4, 0, 12, 12, "Bed 2");

  it("goes by a corner, 4\" from the wall, with the hinge on the corner side", () => {
    const placed = placeDoor(plan([hall, bed]), bed, hall, { swingInto: bed.id, widthIn: 32 })!;
    expect(placed).not.toBeNull();
    const p = plan([hall, bed], { openings: [placed.opening] });
    expect(fromEnd(p, placed.opening.id, 12 * FT)).toBeCloseTo(RET, 0);
    // Hinged at the corner end: the leaf opens flat against the side wall.
    const o = placed.opening;
    const nearStart = o.offsetIn - o.widthIn / 2 < 12 * FT - (o.offsetIn + o.widthIn / 2);
    expect(o.hinge).toBe(nearStart ? "start" : "end");
    expect(placed.reason).toMatch(/By the corner so the bed wall stays free/);
  });

  it("swings a bedroom door into the bedroom, never into the hall", () => {
    for (const [a, b] of [
      [bed, hall],
      [hall, bed],
    ] as const) {
      const o = placeDoor(plan([hall, bed]), a, b)!.opening;
      const g = openingGeometry(plan([hall, bed], { openings: [o] }), o)!;
      expect(swingRoom(plan([hall, bed]), g)?.id).toBe(bed.id);
    }
  });

  it("switches to a pocket door when a swing would hit something by both corners", () => {
    const bath = room("ba", "bathroom", 4, 0, 8, 10, "Bath");
    const h = room("h", "hall", 0, 0, 4, 10, "Hall");
    // A toilet and a vanity right inside both ends of the shared wall.
    const fixtures = [fixture("toilet", 4 * FT + 20, 16, 20, 28, 90), fixture("vanity", 4 * FT + 14, 10 * FT - 22, 21, 36, 90)];
    const p = plan([h, bath], { fixtures });
    const placed = placeDoor(p, bath, h, { swingInto: bath.id, widthIn: 30 })!;
    expect(placed.opening.style).toBe("door-pocket");
    expect(placed.reason).toMatch(/pocket door, because a swinging door here would hit the (toilet|vanity)/);
  });

  it("never makes a bedroom door narrower than 30\": a short wall gets no door", () => {
    // Only 2'8" of shared wall.
    const nook = room("n", "hall", 0, 0, 4, 12, "Hall");
    const b = { ...room("b", "bedroom", 4, 9.33, 12, 12, "Bed 2") };
    const short = plan([nook, b]);
    expect(placeDoor(short, b, nook, doorSize(b, nook, { widthIn: 32, swingInto: b.id }))).toBeNull();
    // A closet may keep a 24" door.
    const c = room("c", "closet", 4, 9.33, 4, 4, "Closet");
    expect(placeDoor(plan([nook, c]), c, nook, doorSize(c, nook, { widthIn: 24, swingInto: c.id }))?.opening.widthIn).toBe(24);
  });

  it("makes the primary bedroom door 36\", and rooms the brief lists as accessibility needs", () => {
    const primary = room("p", "primary-bedroom", 4, 0, 14, 14, "Primary bedroom");
    const s = doorSize(primary, hall, { widthIn: 32 });
    expect(s.widthIn).toBe(36);
    const placed = placeDoor(plan([hall, primary]), primary, hall, s)!;
    expect(placed.opening.widthIn).toBe(36);
    expect(placed.reason).toContain('36" wide for the primary bedroom');
    const brief = { accessibility: ["Wheelchair-friendly bathroom"] } as never;
    const bath = room("ba", "bathroom", 4, 0, 8, 10, "Bathroom");
    expect(accessibleRoom(brief, bath)).toBe(true);
    expect(doorSize(bath, hall, { widthIn: 30 }, { brief, main: true }).widthIn).toBe(36);
    // Upstairs the brief's accessibility list doesn't apply.
    expect(doorSize(bath, hall, { widthIn: 30 }, { brief, main: false }).widthIn).toBe(30);
  });

  it("gives every door a reason, and re-places doors drawn from the flow sketch", () => {
    // A sketch door in the middle of the wall, 26" wide, swinging into the hall.
    const sketched = { ...newOpening("door-hinged", { roomId: bed.id, edge: 3 }, 6 * FT, 1, 26), id: "sk" };
    const reasons = new Map<string, string>();
    const p = connectAll(plan([hall, bed], { openings: [sketched] }), [], false, { reasons });
    const o = p.openings.find((x) => x.id === "sk")!;
    expect(o.widthIn).toBeGreaterThanOrEqual(30);
    expect(fromEnd(p, "sk", 12 * FT)).toBeCloseTo(RET, 0);
    expect(swingRoom(p, openingGeometry(p, o)!)?.id).toBe(bed.id);
    expect(reasons.get("sk")).toBeTruthy();
  });
});

describe("doors on the sample houses", () => {
  for (const [name, types, up] of [
    ["ranch", RANCH, 1],
    ["two-story", TWO_STORY, 2],
  ] as const) {
    it(`${name}: no inside door under 30" except closets, a 36" front door, and no swing clashes`, () => {
      const p = house(types, up);
      for (const fp of Object.values(p.floorPlans)) {
        for (const o of fp.openings.filter((x) => x.style === "door-hinged" || x.style === "door-pocket")) {
          const rooms = openingRooms(fp, o).map((id) => fp.rooms.find((r) => r.id === id));
          if (rooms.some((r) => r?.type === "closet" || r?.type === "pantry" || r?.type === "primary-closet")) continue;
          expect(o.widthIn, `${rooms.map((r) => r?.name).join(" / ")}`).toBeGreaterThanOrEqual(30);
        }
      }
      const front = Object.values(p.floorPlans).flatMap((fp) => fp.openings.filter((o) => o.style === "door-entry"));
      expect(front.length).toBeGreaterThan(0);
      for (const o of front) expect(o.widthIn).toBe(36);
      const w = planWarnings(p.floorPlans, { levels: p.levels, brief: p.brief, basics: p.plan.basics });
      expect(w.filter((x) => x.swing)).toEqual([]);
    });
  }
});

describe("the door swing check in Things to check", () => {
  const hall = room("h", "hall", 0, 0, 4, 10, "Hall");
  const bath = room("ba", "bathroom", 4, 0, 8, 10, "Bath");
  // A 30" door at the top of the shared wall, hinged at the top, swinging into the bath: right into the vanity.
  const door = { ...newOpening("door-hinged", { roomId: bath.id, edge: 3 }, 10 * FT - RET - 15, -1, 30), id: "d" };
  const vanity = fixture("vanity", 4 * FT + 17, 18, 21, 30, 90);
  const p = plan([hall, bath], { openings: [door], fixtures: [vanity] });

  it("sees what the swing hits", () => {
    const g = openingGeometry(p, door)!;
    expect(swingRoom(p, g)?.id).toBe(bath.id);
    const c = swingClear(p, door);
    // Whichever way this door hangs, its swing must be checked: a clash with the vanity, or clear.
    const flipped = swingClear(p, { ...door, hinge: "end" });
    expect([c.ok, flipped.ok]).toContain(false);
  });

  it("warns with Flip the swing and Switch to a pocket door, and the fixes re-check", () => {
    const bad = swingClear(p, door).ok ? { ...door, hinge: "end" as const } : door;
    const before = { [main.id]: plan([hall, bath], { openings: [bad], fixtures: [vanity] }) };
    const w = planWarnings(before, ctx).find((x) => x.swing);
    expect(w?.text).toMatch(/^The door into Bath hits the vanity/);
    expect(w?.swing?.openingId).toBe("d");

    const flipped = { [main.id]: flipSwing(before[main.id], "d") };
    expect(swingClear(flipped[main.id], flipped[main.id].openings[0]).ok).toBe(true);
    expect(planWarnings(flipped, ctx).some((x) => x.swing)).toBe(false);
    expect(recheck(before, flipped, ctx).added).toEqual([]);

    const pocket = { [main.id]: toPocketDoor(before[main.id], "d") };
    expect(pocket[main.id].openings[0].style).toBe("door-pocket");
    expect(planWarnings(pocket, ctx).some((x) => x.swing)).toBe(false);
  });

  it("names two doors that hit each other once", () => {
    const b2 = room("b2", "bedroom", 0, 10, 12, 10, "Bed 2");
    const h = room("h", "hall", 0, 0, 12, 10, "Hall");
    // Two doors meeting at the hall's bottom-left corner, both swinging into the hall: one into Bed 2, one outside.
    const d1 = { ...newOpening("door-hinged", { roomId: h.id, edge: 2 }, 12 * FT - 20, -1, 32), id: "d1", hinge: "end" as const };
    const d2 = { ...newOpening("door-hinged", { roomId: h.id, edge: 3 }, 20, -1, 32), id: "d2", hinge: "start" as const };
    const pl = { [main.id]: plan([h, b2], { openings: [d1, d2] }) };
    expect(swingClear(pl[main.id], d1).doors).toContain("d2");
    expect(planWarnings(pl, ctx).filter((x) => x.swing)).toHaveLength(1);
  });

  it("has undo labels for both fixes", () => {
    const bad = swingClear(p, door).ok ? { ...door, hinge: "end" as const } : door;
    const project = createProject("Test");
    const before = { ...project, levels, floorPlans: { [main.id]: plan([hall, bath], { openings: [bad], fixtures: [vanity] }) } };
    const after = (fp: FloorPlan) => ({ ...before, floorPlans: { [main.id]: fp } });
    expect(describeChange(before, after(toPocketDoor(before.floorPlans[main.id], "d")))).toMatch(/pocket door/);
    expect(describeChange(before, after(flipSwing(before.floorPlans[main.id], "d")))).toMatch(/flip the swing of the door into Bath/);
  });
});
