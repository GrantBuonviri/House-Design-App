import { describe, expect, it } from "vitest";
import type { FloorPlan, Opening, PlanRoom } from "@/lib/model/schema";
import { emptyPlan, makeRoom } from "@/lib/plan/edit";
import { rectangle } from "@/lib/plan/geometry";
import { INTERIOR_WALL_IN } from "@/lib/plan/basics";
import { cornerDistances, cornerGuides, nearestCorner, setCornerDistance, wallCorners } from "@/lib/plan/corners";
import { hostSegment } from "@/lib/plan/walls";

const FT = 12;
const EXT = 6.5;

function room(id: string, x: number, y: number, w: number, h: number): PlanRoom {
  return { ...makeRoom(rectangle((x + w / 2) * FT, (y + h / 2) * FT, w * FT, h * FT), id), id };
}

/** The edge of a room that runs along y = `y` inches. */
const edgeAtY = (r: PlanRoom, y: number) => r.polygon.findIndex((p, i) => p.y === y && r.polygon[(i + 1) % r.polygon.length].y === y);

/** A 20 ft by 10 ft living room with two 10 ft rooms below it, whose shared wall runs into the living room's wall at x = 10 ft. */
function tee(offsetIn: number, widthIn = 32): FloorPlan {
  const top = room("top", 0, 0, 20, 10);
  const rooms = [top, room("a", 0, 10, 10, 10), room("b", 10, 10, 10, 10)];
  const door: Opening = { id: "d", host: { roomId: "top", edge: edgeAtY(top, 120) }, offsetIn, kind: "door", style: "door-hinged", widthIn, heightIn: 80, side: 1, hinge: "start" };
  return { ...emptyPlan(), rooms, openings: [door] };
}

describe("door distance from the corner", () => {
  it("counts a wall running into the middle of a wall as a corner", () => {
    const p = tee(60);
    const seg = hostSegment(p, p.openings[0].host)!;
    const ts = wallCorners(p, seg, EXT).map((c) => Math.round(c.t));
    expect(ts).toEqual([0, 120, 240]);
  });

  it("measures from the face of the nearest wall to the edge of the door", () => {
    // Door edges 44" and 76" along the wall; the outside wall at the end is 6.5" thick, the inside wall at 120" is 4.5".
    const p = tee(60);
    const all = cornerDistances(p, p.openings[0], EXT).map((x) => x.inches).sort((x, y) => x - y);
    expect(all).toEqual([44 - EXT / 2, 120 - INTERIOR_WALL_IN / 2 - 76]);
    expect(nearestCorner(p, p.openings[0], EXT)!.inches).toBe(44 - EXT / 2);
  });

  it("slides a door so it sits a typed distance from the corner", () => {
    const p = tee(60);
    const before = nearestCorner(p, p.openings[0], EXT)!;
    const moved = setCornerDistance(p, "d", 4, EXT, before.side);
    const after = nearestCorner(moved, moved.openings[0], EXT)!;
    expect(after.side).toBe(before.side);
    expect(after.inches).toBeCloseTo(4, 1);
  });

  it("stops at the far end when the typed distance is too big", () => {
    const p = tee(60);
    const side = nearestCorner(p, p.openings[0], EXT)!.side;
    const moved = setCornerDistance(p, "d", 500, EXT, side);
    const o = moved.openings[0];
    const seg = hostSegment(moved, o.host)!;
    expect(o.offsetIn).toBeGreaterThanOrEqual(o.widthIn / 2);
    expect(o.offsetIn).toBeLessThanOrEqual(seg.length - o.widthIn / 2);
  });

  it("marks the nearest gap while dragging", () => {
    const p = tee(60);
    const guides = cornerGuides(p, p.openings[0], EXT);
    expect(guides).toHaveLength(2);
    expect(guides.filter((g) => g.note === "to corner")).toHaveLength(1);
    const near = guides.find((g) => g.note)!;
    expect(near.inches).toBe(Math.min(...guides.map((g) => g.inches)));
  });
});
