import type { WalkView } from "@/lib/model/schema";
import type { Walker } from "./walk";

/**
 * Saved camera spots in the walkthrough ("Kitchen view"): where you stand and
 * which way you look, kept with the house so you can come back to the same
 * view after changing things. And the file name for a screenshot.
 */

/** A name not used yet: "Kitchen view", then "Kitchen view 2", "Kitchen view 3"... */
export function viewName(roomName: string, views: Pick<WalkView, "name">[]): string {
  const base = `${roomName || "Outside"} view`;
  const used = new Set(views.map((v) => v.name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Where you are now, as a spot to save. */
export function viewHere(w: Walker, name: string, id: string): WalkView {
  const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  return { id, name, x: r(w.p.x), y: r(w.p.y), feet: r(w.feet), yaw: r(w.yaw, 4), pitch: r(w.pitch, 4) };
}

/** Back to a saved spot: standing there, looking the same way. */
export function walkerAt(v: WalkView, w: Walker): Walker {
  return { ...w, p: { x: v.x, y: v.y }, feet: v.feet, yaw: v.yaw, pitch: v.pitch, vz: 0 };
}

export const addView = (views: WalkView[], v: WalkView) => [...views, v];
export const removeView = (views: WalkView[], id: string) => views.filter((v) => v.id !== id);
/** Rename a spot; a blank name keeps the old one. */
export const renameView = (views: WalkView[], id: string, name: string) => (name.trim() ? views.map((v) => (v.id === id ? { ...v, name: name.trim() } : v)) : views);

/** A screenshot's file name: the house, the room, the date and time ("Our house - Kitchen - 2026-10-17 14.05.png"). */
export function screenshotName(house: string, room: string, at: Date = new Date()): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  return `${[clean(house) || "House", clean(room)].filter(Boolean).join(" - ")} - ${when}.png`;
}
