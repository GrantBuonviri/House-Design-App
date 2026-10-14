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

/**
 * Only the latest request to Claude may change the sketch. Each request gets
 * a ticket; starting another one, or cancelling (Start blank, Start over,
 * leaving the page), makes every earlier ticket stale and stops its download,
 * so a slow suggestion can't land on a sketch the user has since cleared.
 */
export function createRequestGate() {
  let current = 0;
  let controller: AbortController | null = null;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const id = ++current;
      return { signal: controller.signal, isCurrent: () => id === current };
    },
    cancel() {
      current++;
      controller?.abort();
      controller = null;
    },
  };
}
export type RequestGate = ReturnType<typeof createRequestGate>;

/**
 * Run one request through the gate. Resolves to the answer, or to null when
 * a newer request or a cancel overtook it; errors from stale requests are
 * dropped too.
 */
export async function ifCurrent<T>(gate: RequestGate, request: (signal: AbortSignal) => Promise<T>): Promise<{ value: T } | null> {
  const ticket = gate.begin();
  try {
    const value = await request(ticket.signal);
    return ticket.isCurrent() ? { value } : null;
  } catch (e) {
    if (!ticket.isCurrent()) return null;
    throw e;
  }
}
