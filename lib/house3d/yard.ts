import type { Point } from "@/lib/model/schema";
import { add, dist, scale, sub, unit } from "@/lib/plan/geometry";
import { yardLayout, type Strip, type Yard } from "@/lib/exterior/yard";
import type { Plans } from "@/lib/plan/edit";
import { lookOutside, type HouseContext, type Part } from "./build";
import { YARD_COLORS, type Finish } from "./exterior";
import type { LevelHeights } from "./levels";
import type { Site } from "./site";
import { MeshBuilder, toScene, type Frame, type RGB, type Vec3 } from "./mesh";
import { flatPlans } from "@/lib/plan/flatten";

/**
 * The yard in 3D (laid out in lib/exterior/yard.ts): paving and beds laid on
 * the ground, lawn, simple shrubs and trees, and lights by the doors. Each
 * piece can be aimed at in the walkthrough to pick its finish.
 */

/** How far paving, beds and lawn sit above the ground, so the ground doesn't poke through. */
const LIFT = { lawn: 2, beds: 3, walk: 3.5, driveway: 3.5 };
const STEP_IN = 24;

type GroundAt = (p: Point) => number;

function drapeStrip(mb: MeshBuilder, f: Frame, s: Strip, groundAt: GroundAt, lift: number, color: RGB) {
  const len = dist(s.a, s.b);
  if (len < 1) return;
  const u = unit(sub(s.b, s.a));
  const n = { x: u.y, y: -u.x };
  const steps = Math.max(1, Math.ceil(len / STEP_IN));
  const across = Math.max(1, Math.ceil(s.width / STEP_IN));
  const pt = (i: number, j: number): Vec3 => {
    const p = add(add(s.a, scale(u, (len * i) / steps)), scale(n, -s.width / 2 + (s.width * j) / across));
    return toScene(f, p, groundAt(p) + lift);
  };
  for (let i = 0; i < steps; i++) for (let j = 0; j < across; j++) mb.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), color, [0, 1, 0]);
}

/** A rounded low-poly shape: a ring at its widest, narrowing to a point on top and a smaller ring at the base. */
function blob(mb: MeshBuilder, f: Frame, c: Point, z0: number, height: number, r: number, color: RGB, sides = 7, widestAt = 0.4) {
  const ring = (z: number, rr: number, turn: number) =>
    Array.from({ length: sides }, (_, i) => {
      const a = ((i + turn) / sides) * Math.PI * 2;
      return toScene(f, { x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr }, z);
    });
  const base = ring(z0, r * 0.65, 0);
  const mid = ring(z0 + height * widestAt, r, 0.5);
  const top = toScene(f, c, z0 + height);
  const cs = toScene(f, c, z0 + height * widestAt);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const out = (v: Vec3): Vec3 => [v[0] - cs[0], 0, v[2] - cs[2]];
    mb.tri(base[i], base[j], mid[i], color, out(mid[i]));
    mb.tri(base[j], mid[j], mid[i], color, out(mid[j]));
    const o = out(mid[i]);
    mb.tri(mid[i], mid[j], top, color, [o[0], 1, o[2]]);
  }
}

function cone(mb: MeshBuilder, f: Frame, c: Point, z0: number, height: number, r: number, color: RGB, sides = 9) {
  const top = toScene(f, c, z0 + height);
  const ring = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return toScene(f, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, z0);
  });
  const cs = toScene(f, c, z0);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    mb.tri(ring[i], ring[j], top, color, [ring[i][0] - cs[0], 0.5, ring[i][2] - cs[2]]);
    mb.tri(ring[i], ring[j], cs, color, [0, -1, 0]);
  }
}

/** A little lighter or darker, so a row of shrubs or trees isn't one flat color. */
const vary = (c: RGB, k: number): RGB => {
  const f = 0.88 + ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.24;
  return [c[0] * f, c[1] * f, c[2] * f];
};

function flatPart(key: string, levelId: string, id: string, mb: MeshBuilder): Part[] {
  return mb.empty ? [] : [{ key, levelId, layer: "yard", pick: { kind: "yard", id, levelId }, mesh: mb.build() }];
}

/** Draw the yard. `yard` can be passed in when it's already laid out. */
export function buildYard(plans: Plans, ctx: HouseContext & { heights: LevelHeights }, yard?: Yard | null): Part[] {
  plans = flatPlans(plans);
  const y = yard ?? yardLayout(plans, ctx.levels, ctx.basics, ctx.site.plot, ctx.site.offset);
  if (!y) return [];
  const { frame: f, site } = ctx;
  const ext = lookOutside(ctx);
  const main = ctx.levels.find((l) => l.kind !== "basement" && Math.abs(ctx.heights[l.id]?.floorIn ?? 99) <= 12)?.id ?? ctx.levels[0].id;
  const parts: Part[] = [];
  const paving = (id: "driveway" | "walk", strips: Strip[], look: Finish) => {
    const mb = new MeshBuilder();
    mb.pattern = look.pattern;
    for (const s of strips) drapeStrip(mb, f, s, site.groundAt, LIFT[id], look.color);
    parts.push(...flatPart(`yard:${id}`, main, id, mb));
  };
  paving("driveway", y.driveway, ext.driveway);
  paving("walk", y.walk, ext.walk);

  const beds = new MeshBuilder();
  beds.pattern = ext.beds.pattern;
  for (const s of y.beds) drapeStrip(beds, f, s, site.groundAt, LIFT.beds, ext.beds.color);
  parts.push(...flatPart("yard:beds", main, "beds", beds));

  // Lawn cells, sharing corner heights.
  const lawn = new MeshBuilder();
  lawn.pattern = ext.lawn.pattern;
  const c = y.lawn.cell;
  const hs = new Map<string, Vec3>();
  const corner = (x: number, yy: number) => {
    const k = `${x},${yy}`;
    let v = hs.get(k);
    if (!v) hs.set(k, (v = toScene(f, { x, y: yy }, site.groundAt({ x, y: yy }) + LIFT.lawn)));
    return v;
  };
  for (const p of y.lawn.cells) lawn.quad(corner(p.x, p.y), corner(p.x + c, p.y), corner(p.x + c, p.y + c), corner(p.x, p.y + c), ext.lawn.color, [0, 1, 0]);
  parts.push(...flatPart("yard:lawn", main, "lawn", lawn));

  const shrubs = new MeshBuilder();
  y.shrubs.forEach((p, i) => blob(shrubs, f, p, site.groundAt(p), 30, 17, vary(ext.shrub, i)));
  parts.push(...flatPart("yard:shrubs", main, "shrubs", shrubs));

  const trees = new MeshBuilder();
  y.trees.forEach((p, i) => {
    const g = site.groundAt(p);
    trees.block(f, p, 0, 9, 9, g - 2, g + (ext.treeCone ? 48 : 84), YARD_COLORS.trunk);
    if (ext.treeCone) cone(trees, f, p, g + 30, 190, 66, vary(ext.tree, i));
    else blob(trees, f, p, g + 66, 140, 84, vary(ext.tree, i), 9, 0.45);
  });
  parts.push(...flatPart("yard:trees", main, "trees", trees));

  const lights = new MeshBuilder();
  for (const l of y.lights) {
    const floorIn = ctx.heights[l.levelId]?.floorIn ?? 0;
    lights.block(f, l.p, (Math.atan2(l.out.y, l.out.x) * 180) / Math.PI, 7, 7, floorIn + 62, floorIn + 76, ext.light);
  }
  parts.push(...flatPart("yard:lights", main, "lights", lights));
  return parts;
}

const ROCK: RGB = [0.42, 0.4, 0.38];
const TRUNK: RGB = YARD_COLORS.trunk;
const CANOPY: RGB = [0.24, 0.42, 0.2];

/**
 * The land's own big rocks and trees (from the plot, not the yard plan), at
 * their real size on the ground. They cast shadows in the sun study and block
 * the sun in the preview window, like the house does.
 */
export function buildLandFeatures(site: Site, f: Frame): Part[] {
  const plot = site.plot;
  if (!plot?.features.length) return [];
  const toPlan = (p: Point): Point => ({ x: p.x - site.offset.x, y: p.y - site.offset.y });
  const rocks = new MeshBuilder();
  const trees = new MeshBuilder();
  plot.features.forEach((ft, i) => {
    const c = toPlan(ft.at);
    const r = (ft.sizeFt * 12) / 2;
    const g = site.groundAt(c);
    if (ft.kind === "rock") {
      // Half buried: wide and low.
      blob(rocks, f, c, g - r * 0.25, r * 1.05, r, vary(ROCK, i), 8, 0.35);
    } else {
      // A tree's height follows its canopy: about one and a half times as tall as it is wide.
      const h = Math.max(10 * 12, r * 3);
      trees.block(f, c, 0, Math.max(8, r * 0.12), Math.max(8, r * 0.12), g - 2, g + h * 0.4, TRUNK);
      blob(trees, f, c, g + h * 0.3, h * 0.7, r, vary(CANOPY, i), 9, 0.45);
    }
  });
  return [
    ...(rocks.empty ? [] : [{ key: "land:rocks", levelId: "", layer: "yard" as const, mesh: rocks.build() }]),
    ...(trees.empty ? [] : [{ key: "land:trees", levelId: "", layer: "yard" as const, mesh: trees.build() }]),
  ];
}
