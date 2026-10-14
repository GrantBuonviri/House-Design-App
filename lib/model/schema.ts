import { z } from "zod";

/**
 * The project data model. One Project object is the single source of truth:
 * every screen renders from it, and saving/loading/export all go through
 * these schemas.
 *
 * Lengths are stored in inches (numbers) and shown as feet and inches.
 * Angles are degrees clockwise from north (0 = N, 90 = E).
 */

export const SCHEMA_VERSION = 5;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const STAGES = [
  "setup",
  "land",
  "brief",
  "bubbles",
  "plan",
  "interior",
  "exterior",
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

// ---------- 1. Project setup ----------

export const Profile = z.object({
  /** The person designing the house. The setup page only asks for this and the house name. */
  ownerName: z.string().max(120).optional(),
  // The fields below aren't asked on the setup page; later stages may fill them in.
  adults: z.number().int().min(0).max(20).optional(),
  kids: z.number().int().min(0).max(20).optional(),
  pets: z.string().max(200).optional(),
  olderRelatives: z.boolean().optional(),
  workFromHome: z.number().int().min(0).max(20).optional(),
  budget: z
    .object({
      low: z.number().min(0).optional(),
      high: z.number().min(0).optional(),
    })
    .optional(),
  mustHaves: z.array(z.string().max(200)).default([]),
  dislikes: z.array(z.string().max(200)).default([]),
  notes: z.string().max(2000).optional(),
});
export type Profile = z.infer<typeof Profile>;

// ---------- 2. Land ----------

export const WaterFeature = z.object({
  kind: z.enum(["creek", "pond", "lake", "wash"]),
  /** Polyline (creek, wash, lake shore) or polygon (pond), in inches, plot-local. */
  points: z.array(Point),
});

/**
 * A made-up piece of land. Everything here can be rebuilt from `seed` (and
 * `isFlat`) with generatePlot, so terrain heights are never stored.
 * Plot-local coordinates are inches with x pointing east and y pointing
 * south, origin at the north-west corner of the bounding box.
 */
export const Plot = z.object({
  seed: z.number().int(),
  isFlat: z.boolean(),
  name: z.string().optional(),
  shape: z.enum(["rectangle", "wide", "deep", "corner", "irregular"]).optional(),
  widthIn: z.number().positive(),
  depthIn: z.number().positive(),
  outline: z.array(Point),
  slope: z.object({
    percent: z.number().min(0),
    downhillDeg: z.number(),
  }),
  /** The way the land faces (its downhill direction), degrees clockwise from north. */
  facingDeg: z.number(),
  drainage: z.object({
    rating: z.enum(["good", "fair", "poor"]),
    reason: z.string(),
  }),
  soilNote: z.string(),
  waterFeatures: z.array(WaterFeature).default([]),
  roadSide: z.enum(["N", "E", "S", "W"]),
});
export type Plot = z.infer<typeof Plot>;

// ---------- 3. Rooms ----------

export const Adjacency = z.object({
  a: z.string(),
  b: z.string(),
  strength: z.enum(["must", "nice", "avoid"]),
});
export type Adjacency = z.infer<typeof Adjacency>;

/** A room the user picked on the rooms page. */
export const ChosenRoom = z.object({
  id: z.string(),
  /** A room type id from lib/brief/rooms.ts ("other" for the user's own rooms). */
  type: z.string(),
  name: z.string(),
  /** Ideas for how the room is used or laid out. Becomes the room's notes in the brief. */
  description: z.string().max(1000).default(""),
  /** Optional size, in inches. */
  lengthIn: z.number().positive().optional(),
  widthIn: z.number().positive().optional(),
  /** Which floor. Empty means "let Claude decide". */
  levelId: z.string().optional(),
});
export type ChosenRoom = z.infer<typeof ChosenRoom>;

/** Answers on the rooms page. */
export const DiscoveryAnswers = z.object({
  floorsAbove: z.number().int().min(1).max(5).default(1),
  floorsBelow: z.number().int().min(0).max(3).default(0),
  rooms: z.array(ChosenRoom).default([]),
  garageCars: z.number().int().min(0).max(4).default(2),
  connections: z.array(Adjacency).default([]),
  /** "Describe how the house should feel", plus anything else. */
  feel: z.string().max(3000).default(""),
});
export type DiscoveryAnswers = z.infer<typeof DiscoveryAnswers>;

export const Discovery = z.object({
  answers: DiscoveryAnswers.prefault({}),
});
export type Discovery = z.infer<typeof Discovery>;

// ---------- Design brief ----------

export const BriefRoom = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  targetSqFt: z.number().positive(),
  /** Optional size, in inches. When both are set, targetSqFt comes from them. */
  lengthIn: z.number().positive().optional(),
  widthIn: z.number().positive().optional(),
  levelId: z.string().optional(),
  notes: z.string().optional(),
});

export const DesignBrief = z.object({
  rooms: z.array(BriefRoom),
  adjacencies: z.array(Adjacency),
  /** Floors above ground, 1 to 5. */
  floors: z.number().int().min(1).max(5),
  /** Floors below ground, 0 to 3. */
  floorsBelow: z.number().int().min(0).max(3),
  garageBays: z.number().int().min(0).max(6),
  openKitchen: z.boolean(),
  primarySuiteLevel: z.string().optional(),
  vibe: z.array(z.string()),
  priorities: z.array(z.string()),
  accessibility: z.array(z.string()),
  freeText: z.string().optional(),
  /** A short paragraph describing the house in plain words. */
  summary: z.string().optional(),
  /** Who wrote the first draft: Claude or the built-in rules. */
  source: z.enum(["ai", "rules"]).optional(),
});
export type DesignBrief = z.infer<typeof DesignBrief>;

// ---------- Levels ----------

export const Level = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["basement", "main", "upper", "loft", "split"]),
  /** Floor elevation relative to the main floor, inches. */
  elevationIn: z.number(),
});
export type Level = z.infer<typeof Level>;

// ---------- 4. Bubble diagrams ----------

/**
 * The flow sketch for one level. Positions and sizes are in inches at real
 * scale, x pointing east and y pointing south, so a bubble's area matches
 * its room's area.
 */
export const BubbleDiagram = z.object({
  bubbles: z.array(
    z.object({
      id: z.string(),
      /** The brief room this bubble stands for. Bubbles the user adds may have none. */
      roomId: z.string().optional(),
      label: z.string(),
      /** "free" is a room drawn in any shape, with its `outline`. */
      shape: z.enum(["circle", "oval", "free"]),
      x: z.number(),
      y: z.number(),
      /** Half the width and height. For a drawn room, of its outline (before rotation). */
      rx: z.number().positive(),
      ry: z.number().positive(),
      /** A drawn room's outline, relative to (x, y) and before rotation. */
      outline: z.array(Point).optional(),
      /** Degrees clockwise. */
      rotation: z.number().default(0),
      color: z.string().optional(),
      /** The stairs, kept in the same spot on every floor. */
      stairs: z.boolean().optional(),
    }),
  ),
  flows: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })),
  strokes: z.array(
    z.object({ id: z.string(), points: z.array(z.number()), width: z.number() }),
  ),
  notes: z.array(
    z.object({ id: z.string(), x: z.number(), y: z.number(), text: z.string() }),
  ),
});
export type BubbleDiagram = z.infer<typeof BubbleDiagram>;

/** Flow sketch settings that are saved with the project. */
export const SketchSettings = z.object({
  /** Land drawn under the sketch. */
  overlays: z
    .object({
      property: z.boolean().default(false),
      sun: z.boolean().default(false),
      land: z.boolean().default(false),
      /** The downhill arrow, part of the land features. */
      arrow: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * Where the house sits on the lot, one for all floors: a plot point is the
   * sketch point plus this offset. Null until it's first needed.
   */
  lotOffset: Point.nullable().default(null),
});
export type SketchSettings = z.infer<typeof SketchSettings>;

// ---------- 5. Floor plans ----------

/**
 * A floor plan is drawn room by room. Each room is a straight-walled outline
 * (any angle), in the same coordinates as the flow sketch: inches, x east,
 * y south. Walls are worked out from the room edges (an edge two rooms share
 * is one interior wall), plus any extra walls drawn on their own.
 */
export const PlanRoom = z.object({
  id: z.string(),
  name: z.string(),
  /** The brief room this stands for, if any. */
  briefRoomId: z.string().optional(),
  /** A room type id from lib/brief/rooms.ts, for colors and later suggestions. */
  type: z.string().optional(),
  /** Corners in order, at least three. The edge from corner i to corner i + 1 is "edge i". */
  polygon: z.array(Point).min(3),
});
export type PlanRoom = z.infer<typeof PlanRoom>;

/** A wall drawn on its own, not around a room. */
export const PlanWall = z.object({
  id: z.string(),
  a: Point,
  b: Point,
  thicknessIn: z.number().positive(),
});
export type PlanWall = z.infer<typeof PlanWall>;

/** The wall a door or window sits in: one edge of a room, or a wall drawn on its own. */
export const OpeningHost = z.union([
  z.object({ roomId: z.string(), edge: z.number().int().min(0) }),
  z.object({ wallId: z.string() }),
]);
export type OpeningHost = z.infer<typeof OpeningHost>;

export const Opening = z.object({
  id: z.string(),
  host: OpeningHost,
  /** From the start of the host wall to the middle of the opening, inches. */
  offsetIn: z.number(),
  kind: z.enum(["door", "window", "opening"]),
  /** A catalog id from lib/plan/catalog.ts, such as "door-hinged" or "window". */
  style: z.string(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  /** Windows: height of the bottom of the window above the floor. */
  sillIn: z.number().min(0).optional(),
  /** Which side a door swings to: 1 is the left of the host wall (walking from its start), -1 the right. */
  side: z.union([z.literal(1), z.literal(-1)]).default(1),
  /** Which end of the opening the hinges are on. */
  hinge: z.enum(["start", "end"]).default("start"),
});
export type Opening = z.infer<typeof Opening>;

export const PlanStairs = z.object({
  id: z.string(),
  /** The middle of the stairs' footprint. */
  x: z.number(),
  y: z.number(),
  /** Degrees clockwise. At 0 the stairs climb toward the north (up the page). */
  rotation: z.number().default(0),
  widthIn: z.number().positive(),
  shape: z.enum(["straight", "l", "u"]),
  /** L-shaped stairs: turn left instead of right. */
  flip: z.boolean().default(false),
  /** The floor the stairs climb to. They show, faintly, on that floor too. */
  toLevelId: z.string().optional(),
});
export type PlanStairs = z.infer<typeof PlanStairs>;

export const Fixture = z.object({
  id: z.string(),
  /** A catalog id from lib/plan/catalog.ts, such as "toilet" or "range". */
  kind: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  widthIn: z.number().positive(),
  depthIn: z.number().positive(),
  /** The room it was placed in; it moves with that room. */
  roomId: z.string().optional(),
});
export type Fixture = z.infer<typeof Fixture>;

export const FloorPlan = z.object({
  rooms: z.array(PlanRoom).default([]),
  walls: z.array(PlanWall).default([]),
  openings: z.array(Opening).default([]),
  stairs: z.array(PlanStairs).default([]),
  fixtures: z.array(Fixture).default([]),
});
export type FloorPlan = z.infer<typeof FloorPlan>;

/** The "plan basics" questions asked before the floor plan editor. */
export const PlanBasics = z.object({
  /** Ceiling height per level id, inches. Levels not listed use the default for their kind. */
  ceilings: z.record(z.string(), z.number().min(84).max(240)).default({}),
  exteriorWall: z.enum(["2x4", "2x6"]).default("2x6"),
  garage: z.enum(["front", "side", "detached", "none"]).default("front"),
  stairs: z.enum(["straight", "l", "u"]).default("straight"),
  /** Interior door height, inches: 80 (6' 8") or 96 (8'). */
  doorHeightIn: z.number().min(78).max(120).default(80),
  doorStyle: z.enum(["shaker", "flat", "panel", "glass"]).default("shaker"),
});
export type PlanBasics = z.infer<typeof PlanBasics>;

/** Floor plan settings saved with the project. */
export const PlanSettings = z.object({
  /** Null until the plan basics page has been answered. */
  basics: PlanBasics.nullable().default(null),
  /** Show the flow sketch faintly under the plan, to trace over. */
  showSketch: z.boolean().default(false),
  /** Show wall lengths. */
  showDims: z.boolean().default(true),
});
export type PlanSettings = z.infer<typeof PlanSettings>;

// ---------- The 3D house ----------

/** The roof shape for the 3D house. Roofing materials come with the exterior design. */
export const Roof = z.object({
  style: z.enum(["gable", "hip", "shed", "flat"]).default("gable"),
  /** Inches the roof rises for every foot it runs (6 means a "6 in 12" roof). */
  pitch: z.number().min(1).max(16).default(6),
  /** How far the roof reaches past the walls, inches. */
  overhangIn: z.number().min(0).max(36).default(16),
  /** Shed roofs: the side the roof slopes down to. */
  shedDown: z.enum(["N", "E", "S", "W"]).default("S"),
});
export type Roof = z.infer<typeof Roof>;

export const House3D = z.object({
  roof: Roof.prefault({}),
});
export type House3D = z.infer<typeof House3D>;

// ---------- 6 & 7. Interior / exterior selections ----------

export const Product = z.object({
  name: z.string(),
  brand: z.string(),
  line: z.string().optional(),
  sku: z.string().optional(),
  url: z.url(),
  imageUrl: z.url().optional(),
  price: z.number().min(0).optional(),
  unit: z.enum(["sqft", "each", "linft", "gallon", "set"]),
  priceSource: z.enum(["listed", "estimated"]),
  lastChecked: z.string(),
});
export type Product = z.infer<typeof Product>;

export const Selection = z.object({
  id: z.string(),
  /** A floor-plan room id, or an exterior part such as "roof" or "siding". */
  targetId: z.string(),
  category: z.string(),
  product: Product,
  quantity: z.number().min(0).optional(),
});
export type Selection = z.infer<typeof Selection>;

export const DesignChoices = z.object({
  answers: z.record(z.string(), z.string()).default({}),
  moodBoard: z.array(z.string()).default([]),
  selections: z.array(Selection).default([]),
});

// ---------- The project ----------

export const Project = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  stage: Stage,
  profile: Profile,
  plot: Plot.nullable().default(null),
  discovery: Discovery.prefault({}),
  brief: DesignBrief.nullable().default(null),
  levels: z.array(Level).min(1),
  bubbles: z.record(z.string(), BubbleDiagram).default({}),
  sketch: SketchSettings.prefault({}),
  floorPlans: z.record(z.string(), FloorPlan).default({}),
  plan: PlanSettings.prefault({}),
  house3d: House3D.prefault({}),
  interior: DesignChoices,
  exterior: DesignChoices,
});
export type Project = z.infer<typeof Project>;
