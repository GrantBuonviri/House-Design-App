import type { Point, Project } from "@/lib/model/schema";
import { DRAW_AREA } from "../frame";
import type { Item } from "../draw";
import { frontSide, type Compass } from "../lot";
import { cornerView, drawView, houseScene, viewExtent, type View } from "../scene";
import { viewTitle } from "../view";

/**
 * 3D views: the house from above each corner, in its picked colors, drawn
 * from the same model as the elevations. For showing what the house looks
 * like; sizes come from the plans and elevations.
 */

const DIR: Record<Compass, Point> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };
const NAME = (d: Point) => `${d.y < 0 ? "north" : "south"}${d.x > 0 ? "east" : "west"}`;
const SCALE_NOTE = "Illustration; take sizes from the plans";

/** The four corners, starting with the front and the side to its right (as seen from the street). */
function corners(project: Project): { view: View; name: string }[] {
  const f = DIR[frontSide(project)];
  const r = { x: f.y, y: -f.x };
  const list = [
    { x: f.x + r.x, y: f.y + r.y },
    { x: f.x - r.x, y: f.y - r.y },
    { x: -f.x - r.x, y: -f.y - r.y },
    { x: -f.x + r.x, y: -f.y + r.y },
  ];
  return list.map((d) => ({ view: cornerView(Math.sign(d.x), Math.sign(d.y)), name: NAME(d) }));
}

/** One 3D view fitted into a box, sheet inches. */
export function fittedView(project: Project, box: { x: number; y: number; w: number; h: number }, which = 0): Item[] {
  const sc = houseScene(project);
  const { view } = corners(project)[which];
  const e = viewExtent(sc.faces, view);
  if (!Number.isFinite(e.r0)) return [];
  const s = Math.min(box.w / (e.r1 - e.r0), box.h / (e.u1 - e.u0));
  const origin = { x: box.x + (box.w - (e.r1 - e.r0) * s) / 2 - e.r0 * s, y: box.y + (box.h - (e.u1 - e.u0) * s) / 2 + e.u1 * s };
  return drawView(sc.faces, view, s, origin, { colored: true });
}

export function viewsSheet(project: Project): { items: Item[]; scaleLabel: string } {
  const sc = houseScene(project);
  const items: Item[] = [];
  const W = DRAW_AREA.x1 - DRAW_AREA.x0;
  const H = DRAW_AREA.y1 - DRAW_AREA.y0;
  const cw = (W - 0.5) / 2;
  const ch = (H - 0.5) / 2;
  const views = corners(project);
  // One scale for all four, so they compare.
  const s = Math.min(...views.map(({ view }) => {
    const e = viewExtent(sc.faces, view);
    return Math.min((cw - 0.4) / (e.r1 - e.r0), (ch - 1.2) / (e.u1 - e.u0));
  }));
  views.forEach(({ view, name }, i) => {
    const x = DRAW_AREA.x0 + (i % 2) * (cw + 0.5);
    const y = DRAW_AREA.y0 + Math.floor(i / 2) * (ch + 0.5);
    const e = viewExtent(sc.faces, view);
    const origin = { x: x + (cw - (e.r1 - e.r0) * s) / 2 - e.r0 * s, y: y + 0.2 + (ch - 1.2 - (e.u1 - e.u0) * s) / 2 + e.u1 * s };
    items.push(...drawView(sc.faces, view, s, origin, { colored: true }));
    items.push(...viewTitle(x + 0.1, y + ch - 0.45, { number: i + 1, title: `View from the ${name}`, scaleLabel: SCALE_NOTE }));
  });
  return { items, scaleLabel: "As shown" };
}
