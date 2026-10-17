import type { Cabinet } from "@/lib/model/schema";
import { BASE_KINDS } from "@/lib/plan/cabinets";
import { hex, type Frame, type MeshBuilder, type RGB } from "./mesh";
import { ItemFrame, shade } from "./detail";
import { PATTERN } from "./finishes";

/**
 * Detailed cabinets for Pretty graphics: shaker doors and drawers split by
 * width, knobs and pulls, a toe kick under base cabinets, crown molding on
 * tall uppers, open shelves and wine cubbies. Fast keeps its plain boxes.
 */

/** Brushed nickel knobs and pulls. */
export const HARDWARE = hex("#a9a59c");
/** The toe kick's recess under base cabinets: height and how far back. */
export const TOE_KICK_IN = 4;
const TOE_BACK_IN = 3;
/** How thick doors and drawer fronts are, standing out from the box. */
export const FRONT_IN = 0.75;
/** The widest one door gets; wider openings take a pair. */
export const MAX_DOOR_IN = 24;
const GAP = 0.125;
const TOP_DRAWER_IN = 6;

export type Front = {
  /** Across the cabinet from its middle, and up from its bottom (inches). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** A door, a drawer, a plain panel (a false front or filler), shelves or wine cubbies. */
  kind: "door" | "drawer" | "panel" | "shelves" | "cubbies";
  /** Where the knob or pull goes (doors: near the opening edge), when it has one. */
  handle?: { x: number; z: number; pull: boolean };
};

/** Doors side by side across x0..x1 from z0 to z1, each no wider than MAX_DOOR_IN, knobs at `knobZ` ("top" for base doors, "bottom" for uppers). */
function doors(x0: number, x1: number, z0: number, z1: number, knob: "top" | "bottom" | "middle"): Front[] {
  const n = Math.max(1, Math.ceil((x1 - x0 - 0.01) / MAX_DOOR_IN));
  const w = (x1 - x0) / n;
  const kz = knob === "top" ? z1 - 2.5 : knob === "bottom" ? z0 + 2.5 : (z0 + z1) / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = x0 + i * w + GAP / 2;
    const b = x0 + (i + 1) * w - GAP / 2;
    // Pairs open from the middle; a single door, or the outer ones, from the right.
    const left = n > 1 && i >= n / 2;
    return { x0: a, x1: b, z0: z0 + GAP / 2, z1: z1 - GAP / 2, kind: "door" as const, handle: { x: left ? a + 1.5 : b - 1.5, z: kz, pull: false } };
  });
}

/** Drawers stacked from z0 to z1 (heights given bottom to top), as wide as x0..x1, a pull in each middle. */
function drawers(x0: number, x1: number, heights: number[], z0: number): Front[] {
  let z = z0;
  return heights.map((h) => {
    const d: Front = { x0: x0 + GAP / 2, x1: x1 - GAP / 2, z0: z + GAP / 2, z1: z + h - GAP / 2, kind: "drawer", handle: { x: (x0 + x1) / 2, z: z + h - Math.min(3, h / 2), pull: true } };
    z += h;
    return d;
  });
}

/** Drawers splitting z0..z1 evenly in `n`, the top one smaller. */
const drawerBank = (x0: number, x1: number, z0: number, z1: number, n: number) => {
  const top = Math.min(TOP_DRAWER_IN, (z1 - z0) / n);
  const rest = (z1 - z0 - top) / (n - 1);
  return drawers(x0, x1, [...Array(n - 1).fill(rest), top], z0);
};

/**
 * The fronts on a cabinet of this kind and size. Base cabinets get a drawer
 * over each door and a toe kick; uppers get doors with knobs near the
 * bottom; wide vanities get drawer banks at each end.
 */
export function cabinetFronts(kind: Cabinet["kind"], widthIn: number, heightIn: number, opts: { apronIn?: number } = {}): Front[] {
  const x0 = -widthIn / 2;
  const x1 = widthIn / 2;
  const base = BASE_KINDS.has(kind);
  const z0 = base ? TOE_KICK_IN : 0;
  const z1 = heightIn;
  switch (kind) {
    case "filler":
      return [{ x0, x1, z0, z1, kind: "panel" }];
    case "base":
    case "corner": {
      const top = Math.min(TOP_DRAWER_IN, (z1 - z0) / 3);
      const n = widthIn > 30 ? 2 : 1;
      const w = widthIn / n;
      const tops = Array.from({ length: n }, (_, i) => drawers(x0 + i * w, x0 + (i + 1) * w, [top], z1 - top)).flat();
      return [...doors(x0, x1, z0, z1 - top, "top"), ...tops];
    }
    case "drawer":
      return drawerBank(x0, x1, z0, z1, (z1 - z0) >= 24 ? 4 : 3);
    case "sink": {
      // The false front over the doors, deeper under an apron-front sink.
      const top = opts.apronIn ? Math.max(TOP_DRAWER_IN, opts.apronIn - (36 - heightIn)) : TOP_DRAWER_IN;
      return [...doors(x0, x1, z0, z1 - top, "top"), ...(opts.apronIn ? [] : [{ x0: x0 + GAP / 2, x1: x1 - GAP / 2, z0: z1 - top + GAP / 2, z1: z1 - GAP / 2, kind: "panel" as const }])];
    }
    case "vanity": {
      if (widthIn >= 48) {
        const bank = Math.min(15, widthIn / 4);
        return [
          ...drawerBank(x0, x0 + bank, z0, z1, 3),
          ...doors(x0 + bank, x1 - bank, z0, z1 - TOP_DRAWER_IN, "top"),
          { x0: x0 + bank + GAP / 2, x1: x1 - bank - GAP / 2, z0: z1 - TOP_DRAWER_IN + GAP / 2, z1: z1 - GAP / 2, kind: "panel" },
          ...drawerBank(x1 - bank, x1, z0, z1, 3),
        ];
      }
      return [...doors(x0, x1, z0, z1 - TOP_DRAWER_IN, "top"), { x0: x0 + GAP / 2, x1: x1 - GAP / 2, z0: z1 - TOP_DRAWER_IN + GAP / 2, z1: z1 - GAP / 2, kind: "panel" }];
    }
    case "wine":
      return [{ x0, x1, z0, z1, kind: "cubbies" }];
    case "open-shelf":
      return [{ x0, x1, z0, z1, kind: "shelves" }];
    case "appliance-garage":
      return [{ x0: x0 + GAP / 2, x1: x1 - GAP / 2, z0: GAP / 2, z1: z1 - GAP / 2, kind: "door", handle: { x: 0, z: 2, pull: true } }];
    case "tall":
    case "pantry": {
      // A tall cabinet: a pair of doors low, another pair above, knobs where they meet.
      const split = Math.min(z1 - 12, 50);
      return [...doors(x0, x1, 4, split, "top"), ...doors(x0, x1, split, z1, "bottom")];
    }
    case "upper":
    default:
      return doors(x0, x1, z0, z1, heightIn <= 20 ? "middle" : "bottom");
  }
}

/** A shaker front: a flat panel with a raised frame round it, its back on `y`. */
export function shakerFront(it: ItemFrame, fr: Front, y: number, color: RGB, pattern: number) {
  const { x0, x1, z0, z1 } = fr;
  it.box(x0, x1, y, y + 0.5, z0, z1, color, pattern);
  const s = Math.min(2.25, (x1 - x0) * 0.22, (z1 - z0) * 0.3);
  if (s > 0.6) {
    const yf = y + FRONT_IN;
    it.box(x0, x0 + s, y + 0.5, yf, z0, z1, color, pattern);
    it.box(x1 - s, x1, y + 0.5, yf, z0, z1, color, pattern);
    it.box(x0 + s, x1 - s, y + 0.5, yf, z0, z0 + s, color, pattern);
    it.box(x0 + s, x1 - s, y + 0.5, yf, z1 - s, z1, color, pattern);
  }
  if (fr.handle) handle(it, fr.handle, y + FRONT_IN, Math.min(6, (x1 - x0) * 0.4));
}

/** A round knob, or a bar pull `lengthIn` long on two posts, on a face at `y`. */
export function handle(it: ItemFrame, h: { x: number; z: number; pull: boolean }, y: number, lengthIn = 5) {
  if (!h.pull) {
    it.loft(
      [
        { z: y, rx: 0.3, ry: 0.3, cx: h.x, cy: h.z },
        { z: y + 0.7, rx: 0.3, ry: 0.3, cx: h.x, cy: h.z },
        { z: y + 0.8, rx: 0.6, ry: 0.6, cx: h.x, cy: h.z },
        { z: y + 1.2, rx: 0.6, ry: 0.6, cx: h.x, cy: h.z },
        { z: y + 1.25, rx: 0, ry: 0, cx: h.x, cy: h.z },
      ],
      HARDWARE,
      PATTERN.metal,
      8,
      "y",
    );
    return;
  }
  const half = lengthIn / 2;
  it.box(h.x - half, h.x + half, y + 0.9, y + 1.3, h.z - 0.22, h.z + 0.22, HARDWARE, PATTERN.metal);
  for (const px of [h.x - half + 0.4, h.x + half - 0.4]) it.box(px - 0.2, px + 0.2, y, y + 0.9, h.z - 0.2, h.z + 0.2, HARDWARE, PATTERN.metal);
}

export type CabinetBox = Pick<Cabinet, "kind" | "x" | "y" | "rotation" | "widthIn" | "depthIn" | "heightIn" | "bottomIn">;

/**
 * One cabinet in detail: its box (with a recessed toe kick when it stands on
 * the floor), its fronts, and crown molding along the top of a tall upper.
 * `apronIn` is the apron of a farmhouse sink over a sink base.
 */
export function drawCabinet(mb: MeshBuilder, f: Frame, c: CabinetBox, floorIn: number, color: RGB, opts: { crown?: boolean; apronIn?: number; shelf?: RGB } = {}) {
  const it = new ItemFrame(mb, f, { x: c.x, y: c.y }, c.rotation ?? 0, floorIn + (c.bottomIn ?? 0));
  const w = c.widthIn;
  const d = c.depthIn;
  const h = c.heightIn;
  const x0 = -w / 2 + 0.06;
  const x1 = w / 2 - 0.06;
  const back = -d / 2;
  const face = d / 2 - FRONT_IN;
  const base = BASE_KINDS.has(c.kind) && (c.bottomIn ?? 0) < 1;
  const pat = PATTERN.cabinet;
  const fronts = cabinetFronts(c.kind, w, h, opts);
  if (base) {
    it.box(x0, x1, back, face - TOE_BACK_IN, 0, TOE_KICK_IN, shade(color, 0.35), PATTERN.satin);
    it.box(x0, x1, back, face, TOE_KICK_IN, h, color, pat);
  } else if (fronts.some((x) => x.kind === "shelves" || x.kind === "cubbies")) {
    // Open: two sides, a top, a bottom and a back, with the shelves inside.
    const t = 0.75;
    it.box(x0, x0 + t, back, d / 2, 0, h, color, pat);
    it.box(x1 - t, x1, back, d / 2, 0, h, color, pat);
    it.box(x0, x1, back, d / 2, 0, t, color, pat);
    it.box(x0, x1, back, d / 2, h - t, h, color, pat);
    it.box(x0 + t, x1 - t, back, back + 0.5, t, h - t, opts.shelf ?? color, PATTERN.wood);
  } else {
    it.box(x0, x1, back, face, 0, h, color, pat);
  }
  for (const fr of fronts) {
    if (fr.kind === "shelves") {
      const wood = opts.shelf ?? color;
      const n = Math.max(1, Math.round(h / 12) - 1);
      for (let i = 1; i <= n; i++) {
        const z = (h * i) / (n + 1);
        it.box(x0 + 0.75, x1 - 0.75, back + 0.5, d / 2 - 0.25, z - 0.375, z + 0.375, wood, PATTERN.wood);
      }
      continue;
    }
    if (fr.kind === "cubbies") {
      // Wine: a grid of cubbies about 5" square.
      const n = Math.max(1, Math.round((w - 1.5) / 5));
      const m = Math.max(1, Math.round((fr.z1 - fr.z0) / 5));
      for (let i = 1; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        it.box(x - 0.25, x + 0.25, back + 0.5, d / 2, fr.z0, fr.z1, color, pat);
      }
      for (let j = 1; j < m; j++) {
        const z = fr.z0 + ((fr.z1 - fr.z0) * j) / m;
        it.box(x0 + 0.75, x1 - 0.75, back + 0.5, d / 2, z - 0.25, z + 0.25, color, pat);
      }
      continue;
    }
    shakerFront(it, fr, face, color, pat);
  }
  if (opts.crown && !base) {
    // Crown molding: a cove along the front and both ends, stepped out twice.
    for (const [out, z0, z1] of [
      [0.75, h, h + 1.5],
      [1.75, h + 1.5, h + 2.75],
    ]) {
      it.box(x0 - out, x1 + out, back, d / 2 + out, z0, z1, color, PATTERN.paint);
    }
  }
  mb.pattern = 0;
}

/** Uppers and tall cabinets that reach this close to the top get crown molding. */
export const CROWN_FROM_IN = 80;
