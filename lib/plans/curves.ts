import type { Opening, Project } from "@/lib/model/schema";
import { savedPlans } from "@/lib/plan/flatten";
import { roomEdgeArc, wallArc, type Arc } from "@/lib/plan/arcs";
import { archFeet } from "./draw";

/** What the PDF sheets say about curved walls. Works from the plans as saved, since the sheets draw flattened copies. */

export const CURVED_FRAMING_NOTE = `Curved wall: studs at 12" on center, kerfed or bent plates.`;

/** The curved room walls and loose walls of one floor, a wall two rooms share counted once. */
export function curvedWalls(project: Pick<Project, "floorPlans">, levelId: string): Arc[] {
  const plan = savedPlans(project.floorPlans)[levelId];
  if (!plan) return [];
  const seen = new Set<string>();
  const out: Arc[] = [];
  const take = (arc: Arc | null) => {
    if (!arc) return;
    const [p, q] = [arc.a, arc.b].map((pt) => `${Math.round(pt.x)},${Math.round(pt.y)}`).sort();
    const key = `${p}|${q}|${Math.round(Math.abs(arc.bulge))}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(arc);
  };
  for (const r of plan.rooms) r.polygon.forEach((_, i) => take(roomEdgeArc(r, i)));
  for (const w of plan.walls) take(wallArc(w));
  return out;
}

export const anyCurvedWalls = (project: Pick<Project, "floorPlans" | "levels">): boolean => project.levels.some((l) => curvedWalls(project, l.id).length > 0);

/** "R 8'-0\"", the radius label for a curved wall. */
export const radiusLabel = (arc: Pick<Arc, "radius">): string => `R ${archFeet(arc.radius)}`;
export const arcLengthLabel = (arc: Pick<Arc, "length">): string => `ARC ${archFeet(arc.length)}`;

/** The curved wall a door or window is set in, or null when its wall is straight. Looks the unit up by id, since the sheets hold flattened copies. */
export function curveBehind(project: Pick<Project, "floorPlans">, levelId: string, openingId: string): Arc | null {
  const plan = savedPlans(project.floorPlans)[levelId];
  const o: Opening | undefined = plan?.openings.find((x) => x.id === openingId);
  if (!plan || !o) return null;
  if ("roomId" in o.host) {
    const room = plan.rooms.find((r) => r.id === (o.host as { roomId: string }).roomId);
    return room ? roomEdgeArc(room, o.host.edge) : null;
  }
  const wall = plan.walls.find((w) => w.id === (o.host as { wallId: string }).wallId);
  return wall ? wallArc(wall) : null;
}

/** True when some door or window on this floor is set in a curved wall. */
export const doorWindowOnCurve = (project: Pick<Project, "floorPlans">, levelId: string): boolean =>
  (savedPlans(project.floorPlans)[levelId]?.openings ?? []).some((o) => curveBehind(project, levelId, o.id));
