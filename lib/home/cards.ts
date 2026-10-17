import type { Project } from "@/lib/model/schema";
import { roomOutline } from "@/lib/plan/flatten";

/** A small floor plan picture for a house card: closed outlines in inches, plus the box they fit in. */
export type HouseThumb = {
  /** SVG viewBox "x y w h", with a little margin. */
  box: [number, number, number, number];
  /** One `points` string per room, ready for an SVG polygon. */
  rooms: string[];
  /** Straight lines for walls drawn on their own. */
  walls: [number, number, number, number][];
};

/** The first floor that has rooms drawn, main floor first. Null when no floor plan is drawn yet. */
export function houseThumb(project: Pick<Project, "levels" | "floorPlans">): HouseThumb | null {
  const ids = project.levels.map((l) => l.id);
  const order = ids.includes("floor-1") ? ["floor-1", ...ids.filter((i) => i !== "floor-1")] : ids;
  const plan = order.map((id) => project.floorPlans[id]).find((p) => p && p.rooms.length > 0);
  if (!plan) return null;
  const rooms = plan.rooms.map((r) => roomOutline(r));
  const xs = rooms.flat().map((p) => p.x);
  const ys = rooms.flat().map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const m = Math.max(w, h, 1) * 0.04;
  return {
    box: [minX - m, minY - m, w + 2 * m, h + 2 * m],
    rooms: rooms.map((pts) => pts.map((p) => `${p.x},${p.y}`).join(" ")),
    walls: plan.walls.map((wl) => [wl.a.x, wl.a.y, wl.b.x, wl.b.y]),
  };
}

export type HouseSort = "edited" | "name";

type Named = { name: string; updatedAt: string };

/** Houses whose name contains every word typed (any case), in the chosen order: newest edit first, or A to Z. */
export function shownHouses<T extends Named>(houses: T[], query: string, sort: HouseSort): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = houses.filter((h) => words.every((w) => h.name.toLowerCase().includes(w)));
  return list.sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      : b.updatedAt.localeCompare(a.updatedAt),
  );
}
