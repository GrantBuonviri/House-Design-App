import type { BubbleDiagram } from "@/lib/model/schema";
import { MAX_SQFT, MIN_SQFT, bubbleSqft, emptyDiagram, outlineShape, resized, type Bubble } from "./shapes";
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
  for (const raw of d.bubbles) {
    if (seen.has(raw.id) || !finite(raw.x, raw.y, raw.rx, raw.ry) || raw.rx <= 0 || raw.ry <= 0) continue;
    seen.add(raw.id);
    const b = cleanShape(raw);
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

/**
 * A drawn room needs an outline of at least three real points, centered on
 * the room, with rx and ry matching it. Without one it becomes an oval.
 * Circles and ovals carry no outline.
 */
function cleanShape(b: Bubble): Bubble {
  if (b.shape !== "free") {
    if (!b.outline) return b;
    const { outline: _drop, ...rest } = b;
    void _drop;
    return rest;
  }
  const points = (b.outline ?? []).filter((p) => finite(p.x, p.y));
  if (points.length < 3) {
    const { outline: _drop, ...rest } = b;
    void _drop;
    return { ...rest, shape: "oval" };
  }
  // Re-center on the outline's bounding box, turning the shift by the room's rotation.
  const shape = outlineShape(points);
  const t = ((b.rotation ?? 0) * Math.PI) / 180;
  const dx = shape.x * Math.cos(t) - shape.y * Math.sin(t);
  const dy = shape.x * Math.sin(t) + shape.y * Math.cos(t);
  return { ...b, x: b.x + dx, y: b.y + dy, rx: shape.rx, ry: shape.ry, outline: shape.outline };
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

/**
 * Move bubbles to another floor, at the same spots. Flow lines between two
 * moved bubbles go with them; lines to bubbles that stay are removed.
 */
export function moveBubblesToLevel(ds: Diagrams, ids: string[], from: string, to: string): Diagrams {
  if (from === to) return ds;
  const src = diagramOf(ds, from);
  const moving = new Set(ids.filter((id) => src.bubbles.some((b) => b.id === id)));
  if (moving.size === 0) return ds;
  const dst = diagramOf(ds, to);
  const taken = new Set(dst.bubbles.map((b) => b.id));
  const bubbles = src.bubbles.filter((b) => moving.has(b.id) && !taken.has(b.id));
  const flows = src.flows.filter((f) => moving.has(f.from) && moving.has(f.to));
  return {
    ...ds,
    [from]: removeMany(src, [...moving]),
    [to]: { ...dst, bubbles: [...dst.bubbles, ...bubbles], flows: [...dst.flows, ...flows] },
  };
}

/** Move one bubble to another floor, at the same spot. Its flow lines stay behind. */
export function moveBubbleToLevel(ds: Diagrams, id: string, from: string, to: string): Diagrams {
  return moveBubblesToLevel(ds, [id], from, to);
}

/** Remove several things at once (bubbles, lines, pen marks, notes), plus lines to removed bubbles. */
export function removeMany(d: BubbleDiagram, ids: string[]): BubbleDiagram {
  const gone = new Set(ids);
  return {
    bubbles: d.bubbles.filter((b) => !gone.has(b.id)),
    flows: d.flows.filter((f) => !gone.has(f.id) && !gone.has(f.from) && !gone.has(f.to)),
    strokes: d.strokes.filter((s) => !gone.has(s.id)),
    notes: d.notes.filter((n) => !gone.has(n.id)),
  };
}

/** Slide bubbles, notes and pen marks by (dx, dy). Flow lines follow their bubbles. */
export function moveMany(d: BubbleDiagram, ids: string[], dx: number, dy: number): BubbleDiagram {
  const on = new Set(ids);
  return {
    ...d,
    bubbles: d.bubbles.map((b) => (on.has(b.id) ? { ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) } : b)),
    notes: d.notes.map((n) => (on.has(n.id) ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : n)),
    strokes: d.strokes.map((s) =>
      on.has(s.id) ? { ...s, points: s.points.map((v, i) => Math.round((v + (i % 2 ? dy : dx)) * 2) / 2) } : s,
    ),
  };
}

/** Whether two bubbles have a flow line between them. */
export function connected(d: BubbleDiagram, a: string, b: string): boolean {
  return d.flows.some((f) => samePair(f, a, b));
}

/** Connect two bubbles, or disconnect them if they already are. */
export function toggleFlow(d: BubbleDiagram, a: string, b: string): BubbleDiagram {
  if (a === b) return d;
  return connected(d, a, b) ? { ...d, flows: d.flows.filter((f) => !samePair(f, a, b)) } : addFlow(d, a, b);
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
