import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, type ChosenRoom } from "@/lib/model/schema";
import { addRoomOfType, duplicateRoom, removeType, roomEdited, roomsByFloor, uncheckQuestion } from "@/lib/brief/checklist";
import { buildRuleBrief } from "@/lib/brief/rules";
import { applyBriefEdit } from "@/lib/brief/live";

const profile = { mustHaves: [], dislikes: [] };

function room(type: string, name: string, extra: Partial<ChosenRoom> = {}): ChosenRoom {
  return { id: `${type}-${name}`, type, name, description: "", ...extra };
}

describe("room checklist", () => {
  it("checking a type adds one room named after it, and a second gets a number", () => {
    const one = addRoomOfType([], "bedroom");
    expect(one.map((r) => r.name)).toEqual(["Bedroom"]);
    expect(addRoomOfType(one, "bedroom").map((r) => r.name)).toEqual(["Bedroom", "Bedroom 2"]);
    expect(addRoomOfType([], "other")[0].name).toBe("My room 1");
  });

  it("Duplicate copies the settings with the next number, right after the room", () => {
    const rooms = [room("kitchen", "Kitchen"), room("bedroom", "Bedroom", { lengthIn: 144, widthIn: 132, levelId: "floor-2", description: "Kid's room" }), room("office", "Office")];
    const out = duplicateRoom(rooms, "bedroom-Bedroom");
    expect(out.map((r) => r.name)).toEqual(["Kitchen", "Bedroom 1", "Bedroom 2", "Office"]);
    expect(out[2]).toMatchObject({ type: "bedroom", lengthIn: 144, widthIn: 132, levelId: "floor-2", description: "Kid's room" });
    expect(out[2].id).not.toBe(out[1].id);
    const again = duplicateRoom(out, out[2].id);
    expect(again.map((r) => r.name)).toEqual(["Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Office"]);
  });

  it("asks before unchecking only when work would be lost", () => {
    expect(uncheckQuestion([room("office", "Office")], "office")).toBeNull();
    expect(uncheckQuestion([room("office", "Office", { sqft: 150 })], "office")).toMatch(/Remove Office\?/);
    expect(uncheckQuestion([room("office", "Studio")], "office")).not.toBeNull();
    expect(uncheckQuestion([room("bedroom", "Bedroom 1"), room("bedroom", "Bedroom 2"), room("bedroom", "Bedroom 3")], "bedroom")).toBe("Remove all 3 bedrooms?");
    expect(uncheckQuestion([room("bathroom", "Bathroom 1"), room("bathroom", "Bathroom 2")], "bathroom")).toBe("Remove all 2 bathrooms?");
    expect(roomEdited(room("bedroom", "Bedroom 4"))).toBe(false);
  });

  it("unchecking takes the type's rooms and their connections out", () => {
    const answers = DiscoveryAnswers.parse({
      rooms: [room("kitchen", "Kitchen"), room("office", "Office")],
      connections: [{ a: "kitchen-Kitchen", b: "office-Office", strength: "avoid" }],
    });
    const out = removeType(answers, "office");
    expect(out.rooms.map((r) => r.type)).toEqual(["kitchen"]);
    expect(out.connections).toEqual([]);
  });

  it("groups rooms by the floor they end up on, marking typed floors", () => {
    const answers = DiscoveryAnswers.parse({
      floorsAbove: 2,
      rooms: [room("kitchen", "Kitchen"), room("bedroom", "Bedroom"), room("office", "Office", { levelId: "floor-2", sqft: 150 })],
    });
    const brief = buildRuleBrief({ answers, profile, plot: null });
    const groups = roomsByFloor(answers, brief);
    expect(groups.map((g) => g.level.id)).toEqual(["floor-2", "floor-1"]);
    const office = groups[0].rows.find((r) => r.room.type === "office")!;
    expect(office).toMatchObject({ levelTyped: true, sizeTyped: true, sqft: 150 });
    const bed = groups[0].rows.find((r) => r.room.type === "bedroom")!;
    expect(bed.levelTyped).toBe(false);
  });

  it("a Next to pick edits the same connection list", () => {
    const answers = DiscoveryAnswers.parse({ rooms: [room("kitchen", "Kitchen"), room("office", "Office")] });
    const brief = buildRuleBrief({ answers, profile, plot: null });
    const after = { ...brief, adjacencies: [...brief.adjacencies, { a: "office-Office", b: "kitchen-Kitchen", strength: "avoid" as const }] };
    const out = applyBriefEdit(answers, brief, after);
    expect(out.connections).toEqual([{ a: "office-Office", b: "kitchen-Kitchen", strength: "avoid" }]);
  });
});
