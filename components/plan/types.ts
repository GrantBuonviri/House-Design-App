/** Shared by the floor plan editor and its canvas (which loads separately, in the browser only). */

export type PlanTool = "select" | "room" | "wall" | "curve" | "door" | "stairs" | "place" | "pan";

/**
 * Something selected on the plan. An "edge" is one side of a room, with the
 * id written as `roomId#edge`; a "wall" is a wall drawn on its own.
 */
export type PlanItem = { kind: "room" | "edge" | "wall" | "opening" | "stairs" | "fixture" | "furnish" | "railing"; id: string };
export type PlanSelection = PlanItem[];

export const PLAN_TOOLS: { id: PlanTool; label: string; key: string; hint: string }[] = [
  {
    id: "select",
    label: "Select and move",
    key: "V",
    hint: "Click a room, wall or door to change it. Drag a wall to push it, or a room's corner dots to reshape it. Drag the + on a wall to add a corner, or the diamond in the middle to bend it into a curve; Delete removes a picked corner. Hold Option to pull one room away from its neighbors (or to bend one side of a shared wall alone), Shift for any angle. Shift-click or drag a box to pick several.",
  },
  {
    id: "room",
    label: "Room",
    key: "R",
    hint: "Drag to draw a rectangle. Or click corner by corner for any shape, then click the first corner (or press Enter) to close it. Type a length like 12'6 and press Enter to set a line's exact size. Pick Fill a space on the right to click inside walls you drew and make them a room, or Round room to click a middle and drag out a circle.",
  },
  {
    id: "wall",
    label: "Wall",
    key: "W",
    hint: "Click to start a wall, click again at each turn, and double-click or press Enter to finish. Type a length like 12'6 and press Enter for an exact size. A wall from one side of a room to the other splits it in two; a shorter one (or one finished with Option held) is a divider. Pick a wall to make it a half wall.",
  },
  {
    id: "curve",
    label: "Curved wall",
    key: "C",
    hint: "Click where the curve starts and where it ends, then move the mouse to bow it and click again. Or type a radius like 8' and press Enter. A curve from one side of a room to another splits it in two; otherwise (or with Option held) it's a curved divider wall. Pick it afterwards to make it a half wall.",
  },
  { id: "door", label: "Doors and windows", key: "D", hint: "Pick a door or window on the right, then click a wall to put it there." },
  { id: "stairs", label: "Stairs", key: "S", hint: "Click to place stairs. They climb to the floor above and show there too." },
  { id: "pan", label: "Pan", key: "H", hint: "Drag to move around the drawing." },
];

export const isPicked = (sel: PlanSelection, id: string) => sel.some((s) => s.id === id);

export function edgeId(roomId: string, edge: number): string {
  return `${roomId}#${edge}`;
}

export function parseEdgeId(id: string): { roomId: string; edge: number } {
  const at = id.lastIndexOf("#");
  return { roomId: id.slice(0, at), edge: Number(id.slice(at + 1)) };
}
