import type { Level } from "@/lib/model/schema";
import type { Diagrams } from "./arrange";
import { emptyDiagram } from "./shapes";

/** Every floor completely empty: no rooms, lines, stairs, pen marks or notes. */
export function blankSketch(levels: Pick<Level, "id">[]): Diagrams {
  return Object.fromEntries(levels.map((l) => [l.id, emptyDiagram()]));
}

export function hasContent(ds: Diagrams): boolean {
  return Object.values(ds).some((d) => d.bubbles.length + d.flows.length + d.strokes.length + d.notes.length > 0);
}
