import type { BubbleDiagram } from "@/lib/model/schema";
import { MAX_SQFT, MIN_SQFT, bubbleSqft, emptyDiagram, resized, type Bubble } from "./shapes";
import type { Diagrams } from "./arrange";

/**
 * Small, pure edits to a flow sketch. The editor calls these and the store
 * keeps the history, so every edit can be undone.
 */

type Flow = BubbleDiagram["flows"][number];
type Note = BubbleDiagram["notes"][number];
type Stroke = BubbleDiagram["strokes"][number];

export function newElementId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const finite = (...ns: number[]) => ns.every((n) => Number.isFinite(n));
const samePair = (f: Flow, a: string, b: string) => (f.from === a && f.to === b) || (f.from === b && f.to === a);

/** Fix anything that would break the drawing: bad numbers, sizes out of range, lines to nowhere, repeats. */
export function cleanDiagram(d: BubbleDiagram): BubbleDiagram {
  const seen = new Set<string>();
  const bubbles: Bubble[] = [];
  for (const b of d.bubbles) {
    if (seen.has(b.id) || !finite(b.x, b.y, b.rx, b.ry) || b.rx <= 0 || b.ry <= 0) continue;
    seen.add(b.id);
    const sqft = bubbleSqft(b);
    const sized = sqft < MIN_SQFT ? resized(b, MIN_SQFT) : sqft > MAX_SQFT ? resized(b, MAX_SQFT) : b;
    bubbles.push({ ...sized, rotation: finite(b.rotation) ? b.rotation % 360 : 0 });
  }
  const flows: Flow[] = [];
  for (const f of d.flows) {
    if (f.from === f.to || !seen.has(f.from) || !seen.has(f.to)) continue;
    if (flows.some((x) => samePair(x, f.from, f.to))) continue;
    flows.push(f);
  }
  const strokes = d.strokes.filter((s) => s.points.length >= 4 && s.points.length % 2 === 0 && finite(...s.points, s.width));
  const notes = d.notes.filter((n) => finite(n.x, n.y)).map((n) => ({ ...n, text: n.text.slice(0, 500) }));
  return { bubbles, flows, strokes, notes };
}

export function cleanDiagrams(ds: Diagrams): Diagrams {
  return Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, cleanDiagram(d)]));
}

export function diagramOf(ds: Diagrams, levelId: string): BubbleDiagram {
  return ds[levelId] ?? emptyDiagram();
}

export function addBubble(d: BubbleDiagram, b: Bubble): BubbleDiagram {
  return { ...d, bubbles: [...d.bubbles, b] };
}

export function updateBubble(d: BubbleDiagram, id: string, patch: Partial<Bubble>): BubbleDiagram {
  return { ...d, bubbles: d.bubbles.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/** Remove a bubble and any flow lines to it. */
export function removeBubble(d: BubbleDiagram, id: string): BubbleDiagram {
  return { ...d, bubbles: d.bubbles.filter((b) => b.id !== id), flows: d.flows.filter((f) => f.from !== id && f.to !== id) };
}

/** Connect two bubbles. Does nothing if they're already connected. */
export function addFlow(d: BubbleDiagram, from: string, to: string): BubbleDiagram {
  if (from === to || d.flows.some((f) => samePair(f, from, to))) return d;
  return { ...d, flows: [...d.flows, { id: newElementId("f"), from, to }] };
}

export function removeFlow(d: BubbleDiagram, id: string): BubbleDiagram {
  return { ...d, flows: d.flows.filter((f) => f.id !== id) };
}

export function addStroke(d: BubbleDiagram, s: Stroke): BubbleDiagram {
  return { ...d, strokes: [...d.strokes, s] };
}

export function removeStroke(d: BubbleDiagram, id: string): BubbleDiagram {
  return { ...d, strokes: d.strokes.filter((s) => s.id !== id) };
}

export function addNote(d: BubbleDiagram, n: Note): BubbleDiagram {
  return { ...d, notes: [...d.notes, n] };
}

export function updateNote(d: BubbleDiagram, id: string, patch: Partial<Note>): BubbleDiagram {
  return { ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function removeNote(d: BubbleDiagram, id: string): BubbleDiagram {
  return { ...d, notes: d.notes.filter((n) => n.id !== id) };
}

/** Remove whatever has this id: a bubble, flow line, pen stroke or note. */
export function removeAny(d: BubbleDiagram, id: string): BubbleDiagram {
  return removeNote(removeStroke(removeFlow(removeBubble(d, id), id), id), id);
}

/** Move a bubble to another floor, at the same spot. Its flow lines stay behind. */
export function moveBubbleToLevel(ds: Diagrams, id: string, from: string, to: string): Diagrams {
  if (from === to) return ds;
  const b = diagramOf(ds, from).bubbles.find((x) => x.id === id);
  if (!b) return ds;
  return { ...ds, [from]: removeBubble(diagramOf(ds, from), id), [to]: addBubble(diagramOf(ds, to), b) };
}

/** Find a bubble on any floor. */
export function findBubble(ds: Diagrams, id: string): { levelId: string; bubble: Bubble } | null {
  for (const [levelId, d] of Object.entries(ds)) {
    const bubble = d.bubbles.find((b) => b.id === id);
    if (bubble) return { levelId, bubble };
  }
  return null;
}

/**
 * Copy one room's spot (position, size and floor) from an alternative into
 * the user's sketch. Used to merge ideas one room at a time.
 */
export function copyBubbleFrom(mine: Diagrams, alt: Diagrams, id: string): Diagrams {
  const theirs = findBubble(alt, id);
  if (!theirs) return mine;
  const ours = findBubble(mine, id);
  if (ours && ours.levelId === theirs.levelId) {
    return { ...mine, [ours.levelId]: updateBubble(mine[ours.levelId], id, { ...theirs.bubble, label: ours.bubble.label }) };
  }
  const without = ours ? { ...mine, [ours.levelId]: removeBubble(mine[ours.levelId], id) } : mine;
  const bubble = ours ? { ...theirs.bubble, label: ours.bubble.label } : theirs.bubble;
  return { ...without, [theirs.levelId]: addBubble(diagramOf(without, theirs.levelId), bubble) };
}

/**
 * Take an alternative's bubbles and flow lines, for all floors or just
 * some. The user's own pen strokes and notes are kept.
 */
export function takeAlternative(mine: Diagrams, alt: Diagrams, levelIds?: string[]): Diagrams {
  const levels = levelIds ?? [...new Set([...Object.keys(mine), ...Object.keys(alt)])];
  const out: Diagrams = { ...mine };
  for (const levelId of levels) {
    const theirs = diagramOf(alt, levelId);
    const ours = diagramOf(mine, levelId);
    out[levelId] = { ...ours, bubbles: theirs.bubbles, flows: theirs.flows };
    // A room is only ever on one floor.
    const ids = new Set(theirs.bubbles.map((b) => b.id));
    for (const other of Object.keys(out)) {
      if (other === levelId || levels.includes(other)) continue;
      const d = out[other];
      if (d.bubbles.some((b) => ids.has(b.id))) out[other] = [...ids].reduce(removeBubble, d);
    }
  }
  return out;
}
