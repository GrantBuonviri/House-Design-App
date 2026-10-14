import { add, scale } from "@/lib/plan/geometry";
import { sunPosition } from "@/lib/land/sun";
import type { Part } from "./build";
import { IN_PER_UNIT, toScene, type Frame, type Vec3 } from "./mesh";
import type { Site } from "./site";
import { SEASONS, clockTime, daylight, type Season, type SeasonId } from "./sun";
import type { WindowViews } from "./windowView";

/**
 * When the sun shines straight in through a window: for each season, step
 * through the day every 15 minutes and check that the sun is up, in front
 * of the window, and not blocked by the house (other wings, the roof's
 * overhang) or the hillside.
 */

/** Spans of direct sun, in local solar hours (12 = solar noon). */
export type SunSpans = { season: Season; spans: [number, number][]; brief: boolean };

const STEP_H = 0.25;

/** Triangles of the house, grouped with a box around each group so most can be skipped quickly. */
export type Blockers = { boxes: { min: Vec3; max: Vec3; tris: Float32Array }[] };

export function blockersOf(parts: Part[]): Blockers {
  const boxes: Blockers["boxes"] = [];
  for (const p of parts) {
    if (p.glass || p.layer === "footprints" || p.mesh.count === 0) continue;
    const t = p.mesh.positions;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (t[i + k] < min[k]) min[k] = t[i + k];
        if (t[i + k] > max[k]) max[k] = t[i + k];
      }
    }
    boxes.push({ min, max, tris: t });
  }
  return { boxes };
}

function hitsBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): boolean {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return false;
      continue;
    }
    let a = (min[k] - o[k]) / d[k];
    let b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** Möller–Trumbore: does the ray hit any triangle in the list? */
function hitsTriangles(o: Vec3, d: Vec3, t: Float32Array): boolean {
  for (let i = 0; i < t.length; i += 9) {
    const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
    const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-10) continue;
    const inv = 1 / det;
    const sx = o[0] - t[i], sy = o[1] - t[i + 1], sz = o[2] - t[i + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 1e-4) return true;
  }
  return false;
}

/** Whether the ground rises above the ray within a few hundred feet. */
function hillInTheWay(o: Vec3, d: Vec3, site: Site, f: Frame): boolean {
  if (!site.plot) return false;
  for (let t = 2; t < 400; t += 3) {
    const y = o[1] + d[1] * t;
    if (y > 250) return false;
    const p = { x: (o[0] + d[0] * t) * IN_PER_UNIT + f.ox, y: (o[2] + d[2] * t) * IN_PER_UNIT + f.oy };
    if (site.groundAt(p) / IN_PER_UNIT > y) return true;
  }
  return false;
}

/** Unit direction toward the sun in the scene (x east, y up, z south), or null while it's down. */
function sunToward(day: number, hour: number): Vec3 | null {
  const s = sunPosition(day, hour);
  if (s.altitudeDeg < 1) return null;
  const az = (s.azimuthDeg * Math.PI) / 180;
  const alt = (s.altitudeDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
}

/** Points on the glass to test from: across it, low and high (an overhang can shade the top but not the bottom). */
function samplePoints(v: WindowViews, f: Frame): Vec3[] {
  const { og, opening } = v;
  const w = opening.widthIn;
  const out: Vec3[] = [];
  for (const k of [-0.3, 0, 0.3]) {
    const p = add(add(og.center, scale(og.u, k * w)), scale(v.out, v.wallIn / 2 + 3));
    for (const up of [0.2, 0.6]) out.push(toScene(f, p, v.z0 + (v.z1 - v.z0) * up));
  }
  return out;
}

export function sunThroughWindow(v: WindowViews, blockers: Blockers, site: Site, f: Frame, seasons: readonly Season[] = SEASONS): SunSpans[] {
  const origins = samplePoints(v, f);
  const lit = (day: number, hour: number) => {
    const d = sunToward(day, hour);
    // Facing the glass at all (a sun grazing along the wall doesn't come in).
    if (!d || d[0] * v.out.x + d[2] * v.out.y < 0.05) return false;
    return origins.some((o) => !hillInTheWay(o, d, site, f) && !blockers.boxes.some((b) => hitsBox(o, d, b.min, b.max) && hitsTriangles(o, d, b.tris)));
  };
  return seasons.map((season) => {
    const { sunrise, sunset } = daylight(season.day);
    const spans: [number, number][] = [];
    let start: number | null = null;
    let last = sunrise;
    let any = false;
    for (let h = sunrise; h <= sunset + 1e-9; h += STEP_H) {
      if (lit(season.day, h)) {
        any = true;
        if (start === null) start = h;
        last = h;
      } else if (start !== null) {
        if (last > start) spans.push([start, last]);
        start = null;
      }
    }
    if (start !== null && last > start) spans.push([start, last]);
    return { season, spans, brief: any && spans.length === 0 };
  });
}

/** "7 to 11 am", "10 am to 2:30 pm". */
export function timeSpan(a: number, b: number, daylightSaving: boolean): string {
  const short = (s: string) => s.replace(":00", "");
  const [sa, sb] = [short(clockTime(a, daylightSaving)), short(clockTime(b, daylightSaving))];
  const [ta, pa] = sa.split(" ");
  const pb = sb.split(" ")[1];
  return pa === pb ? `${ta} to ${sb}` : `${sa} to ${sb}`;
}

function seasonText(s: SunSpans): string {
  const dst = s.season.daylightSaving;
  const name = s.season.name;
  if (s.brief) return `only briefly in ${name}`;
  if (!s.spans.length) return `none in ${name}`;
  if (s.spans.length > 2) return `on and off from ${timeSpan(s.spans[0][0], s.spans[s.spans.length - 1][1], dst)} in ${name}`;
  return `about ${s.spans.map(([a, b]) => timeSpan(a, b, dst)).join(" and ")} in ${name}`;
}

/** One line for the preview: when the sun comes straight in, season by season. */
export function sunNote(all: SunSpans[]): string {
  if (all.every((s) => !s.spans.length && !s.brief)) return "No direct sun comes in through this window in any season.";
  return `Direct sun through this window: ${all.map(seasonText).join(", ")}.`;
}

export function seasonSpans(all: SunSpans[], id: SeasonId): SunSpans | undefined {
  return all.find((s) => s.season.id === id);
}
