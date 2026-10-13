/** Shared by the flow sketch editor and its canvas (which loads separately, in the browser only). */

export type Tool = "select" | "circle" | "oval" | "flow" | "pen" | "eraser" | "note" | "pan";

export type Selection = { kind: "bubble" | "flow" | "note" | "stroke"; id: string } | null;

export type Side = "N" | "E" | "S" | "W";

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Select and move", key: "V", hint: "Click to select, drag to move. Drag empty space to pan." },
  { id: "circle", label: "Circle", key: "C", hint: "Click to place a round room." },
  { id: "oval", label: "Oval", key: "O", hint: "Click to place a long room." },
  { id: "flow", label: "Flow line", key: "L", hint: "Click one room, then another, to show you can walk between them." },
  { id: "pen", label: "Pen", key: "P", hint: "Drag to draw freehand." },
  { id: "eraser", label: "Eraser", key: "E", hint: "Drag over pen marks, lines and notes to erase them. Click a room to erase it." },
  { id: "note", label: "Note", key: "N", hint: "Click to place a note anywhere." },
  { id: "pan", label: "Pan", key: "H", hint: "Drag to move around the drawing." },
];
