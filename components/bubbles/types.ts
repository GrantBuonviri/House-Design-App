/** Shared by the flow sketch editor and its canvas (which loads separately, in the browser only). */

import type { Point } from "@/lib/model/schema";
import type { LandDrawing } from "@/lib/bubbles/land";

export type Tool = "select" | "circle" | "oval" | "room" | "pen" | "eraser" | "note" | "pan";

export type SelectedItem = { kind: "bubble" | "flow" | "note" | "stroke"; id: string };
/** Everything selected on the drawing, in the order it was picked. */
export type Selection = SelectedItem[];

export type Side = "N" | "E" | "S" | "W";

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  {
    id: "select",
    label: "Select and move",
    key: "V",
    hint: "Click to select, Shift-click to add, drag across empty space to select a group. Drag to move. Hold Space and drag to pan.",
  },
  { id: "circle", label: "Circle", key: "C", hint: "Click to place a round room." },
  { id: "oval", label: "Oval", key: "O", hint: "Click to place a long room." },
  { id: "room", label: "Draw room", key: "R", hint: "Drag to draw a room in any shape. Let go to close it." },
  { id: "pen", label: "Pen", key: "P", hint: "Drag to draw freehand." },
  { id: "eraser", label: "Eraser", key: "E", hint: "Drag over pen marks, lines and notes to erase them. Click a room to erase it." },
  { id: "note", label: "Note", key: "N", hint: "Click to place a note anywhere." },
  { id: "pan", label: "Pan", key: "H", hint: "Drag to move around the drawing." },
];

export const isSelected = (sel: Selection, id: string) => sel.some((s) => s.id === id);

/** The land under the sketch, ready to draw. */
export type LandView = {
  drawing: LandDrawing;
  /** Plot point = sketch point + offset. */
  offset: Point;
  show: { property: boolean; land: boolean; arrow: boolean; sun: boolean };
  /** The sun dial's middle and outer radius, in sketch coordinates. */
  sun: { center: Point; radius: number; latitudeDeg: number };
};
