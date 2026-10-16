import { WHOLE_HOUSE, type FloorPlan, type Level, type Opening, type PlanRoom, type Product, type Project } from "@/lib/model/schema";
import { openingGeometries } from "@/lib/plan/walls";
import { openingRooms } from "@/lib/plan/connect";
import { openingType, fixtureType } from "@/lib/plan/catalog";
import { areaKind } from "@/lib/plan/measure";
import { polygonArea, SQ_IN_PER_SQ_FT } from "@/lib/plan/geometry";
import { ceilingFor } from "@/lib/plan/basics";
import { roomType } from "@/lib/brief/rooms";
import { categoriesFor, effectivePick, productTitle, roomFinishes } from "@/lib/interior/picks";
import { exteriorPick } from "@/lib/exterior/picks";
import { BATHS, FULL_BATHS, TILE_ROOMS } from "@/lib/catalog/categories";
import { clearOpening, escapeCheck, glassSqft, operationOf, OPERATION_LABEL } from "@/lib/codes/openings";
import { codeNum, codeRef } from "@/lib/codes/data";
import { inchText, isSleeping } from "@/lib/codes/rules";
import { DRAW_AREA } from "../frame";
import { archFeet, capHeight, heading, HEADING_H, table, textBlock, type Item } from "../draw";
import { houseFacts, type HouseFacts } from "../house";
import { curveBehind, doorWindowOnCurve, radiusLabel } from "../curves";

/**
 * The schedules: doors and windows (A-601), room finishes (I-601), and
 * appliances and plumbing fixtures (P-601). Each is a set of tables that
 * flows onto more sheets when a big house needs them, with notes giving the
 * code numbers that apply.
 */

type Col = { title: string; width: number };
type Section = { title: string; cols: Col[]; rows: string[][] };

const SIZE = 8;
const W = DRAW_AREA.x1 - DRAW_AREA.x0;
const NOTES_W = 7.5;

/** Lay tables down the sheet, notes in a column on the right, and carry on to more sheets when they don't fit. */
export function flowTables(title: string, sections: Section[], notes: string[]): Item[][] {
  const pages: Item[][] = [];
  const tableW = W - NOTES_W - 0.4;
  let items: Item[] = [];
  let y = 0;
  const start = () => {
    items = [];
    pages.push(items);
    items.push(...heading(pages.length > 1 ? `${title} (continued)` : title, DRAW_AREA.x0, DRAW_AREA.y0, tableW, 11));
    y = DRAW_AREA.y0 + HEADING_H + 0.2;
    // Notes on the first sheet only.
    if (pages.length === 1 && notes.length) {
      const nx = DRAW_AREA.x1 - NOTES_W;
      let ny = DRAW_AREA.y0;
      items.push(...heading("Notes", nx, ny, NOTES_W, 10));
      ny += HEADING_H + 0.1;
      notes.forEach((n, i) => {
        items.push({ t: "text", at: { x: nx, y: ny + capHeight(SIZE) }, text: `${i + 1}.`, size: SIZE });
        const b = textBlock(n, nx + 0.28, ny, NOTES_W - 0.28, SIZE);
        items.push(...b.items);
        ny += b.height + 0.1;
      });
    }
  };
  start();
  for (const s of sections) {
    // Scale the columns to the table width.
    const total = s.cols.reduce((a, c) => a + c.width, 0);
    const cols = s.cols.map((c) => ({ ...c, width: (c.width / total) * tableW }));
    let rows = s.rows;
    let first = true;
    while (first || rows.length) {
      if (DRAW_AREA.y1 - y < 1.2) start();
      items.push(...heading(first ? s.title : `${s.title} (continued)`, DRAW_AREA.x0, y, tableW, 9));
      y += HEADING_H + 0.06;
      if (!rows.length) {
        items.push({ t: "text", at: { x: DRAW_AREA.x0, y: y + capHeight(SIZE) }, text: "None on this house.", size: SIZE });
        y += 0.4;
        break;
      }
      const tb = table(DRAW_AREA.x0, y, cols, rows, { size: SIZE, boldFirst: true, maxHeight: DRAW_AREA.y1 - y });
      items.push(...tb.items);
      y += tb.height + 0.35;
      rows = rows.slice(Math.max(1, tb.fitted));
      first = false;
      if (rows.length) start();
    }
  }
  return pages;
}

// ---------- Doors and windows ----------

type Where = "outside" | "garage" | "inside";

function roomName(plan: FloorPlan, id: string | null): string {
  if (!id) return "Outside";
  return plan.rooms.find((r) => r.id === id)?.name ?? "";
}

function sideOf(plan: FloorPlan, o: Opening): Where {
  const ids = openingRooms(plan, o);
  const rooms = ids.map((id) => (id ? plan.rooms.find((r) => r.id === id) : undefined));
  if (rooms.some((r) => !r || areaKind(r) === "outdoor")) return "outside";
  const garage = rooms.map((r) => r?.type === "garage");
  if (garage[0] !== garage[1]) return "garage";
  return "inside";
}

const productText = (p: Product | undefined) => (p ? `${productTitle(p)}${p.sku ? ` (${p.sku})` : ""}` : "Owner's pick");

/** Rows for the door and window schedules, in tag order. */
export function doorWindowRows(project: Project): { doors: string[][]; windows: string[][]; exteriorDoorCount: number } {
  const h = houseFacts(project);
  const doors: { tag: string; row: string[] }[] = [];
  const windows: { tag: string; row: string[] }[] = [];
  const sel = project.exterior.selections;
  const interiorDoor = effectivePick(project.interior.selections, WHOLE_HOUSE, "interior-doors")?.pick.product;
  const fall = codeNum("windowFall.heightAboveGrade");
  const fallSill = codeNum("windowFall.minSillHeight");
  let exteriorDoorCount = 0;
  for (const level of h.levels) {
    const plan = h.plan(level.id);
    for (const g of openingGeometries(plan)) {
      const o = g.opening;
      const tag = h.tags.get(o.id);
      if (!tag) continue;
      const [a, b] = openingRooms(plan, o);
      const rooms = [a, b].map((id) => roomName(plan, id)).filter(Boolean);
      const where = sideOf(plan, o);
      const size = `${archFeet(o.widthIn)} x ${archFeet(o.heightIn)}`;
      const safety = h.safety.get(o.id);
      const curved = curveBehind(project, level.id, o.id);
      if (o.kind === "door") {
        const t = openingType(o.style);
        let product: Product | undefined;
        let construction = "Hollow or solid core, owner's pick";
        let rating = "";
        let energy = "";
        if (o.style === "door-garage") {
          product = exteriorPick(sel, "garage-doors")?.product;
          construction = "Overhead sectional, insulated";
        } else if (o.style === "door-slider") {
          product = exteriorPick(sel, "patio-doors")?.product;
          construction = "Sliding glass, tempered";
        } else if (where === "outside") {
          product = exteriorPick(sel, "entry-doors")?.product;
          construction = "Insulated, weatherstripped, solid core";
        } else if (where === "garage") {
          construction = `Solid wood or solid core ${inchText(codeNum("garage.doorSolidWoodThickness"))}, solid or honeycomb steel, or ${codeNum("garage.doorFireRatingMinutes")}-minute rated`;
          rating = codeRef("garage.doorFireRatingMinutes");
        } else product = interiorDoor;
        if (where === "outside" && o.style !== "door-garage") {
          exteriorDoorCount++;
          energy = o.style === "door-slider" ? `U-${codeNum("energy.fenestrationU")} max` : `U-${codeNum("energy.fenestrationU")} max*`;
        }
        if (where === "garage") energy = "";
        const swing = t.swings ? (t.double ? "Pair, hinged" : "Hinged") : o.style === "door-garage" ? "Overhead" : o.style === "door-pocket" ? "Pocket" : o.style === "door-barn" ? "Barn slider" : "Sliding";
        doors.push({
          tag,
          row: [tag, level.name, rooms.join(" / "), t.label, size, swing, curved ? `${construction}. Set in a curved wall (${radiusLabel(curved)})` : construction, safety ? "Tempered" : "", [rating, energy].filter(Boolean).join("; "), productText(product)],
        });
      } else if (o.kind === "window") {
        const op = operationOf(o);
        const sill = o.sillIn ?? 30;
        const clear = clearOpening(o);
        const bedroom = [a, b].some((id) => {
          const r = id ? plan.rooms.find((x) => x.id === id) : undefined;
          return r ? isSleeping(r) : false;
        });
        const basement = level.kind === "basement";
        const esc = escapeCheck(o, basement);
        const escape = bedroom || basement ? (esc.ok ? "Yes, meets" : `Too small: ${esc.problems[0] ?? ""}`) : "";
        const notes: string[] = [];
        if (curved) notes.push(`Set in a curved wall (${radiusLabel(curved)})`);
        if (safety) notes.push(`Tempered: ${safety.join("; ")}`);
        if (!basement && level.kind !== "main" && level.elevationIn + sill > fall && sill < fallSill) notes.push(`Opening limit device or sill at ${inchText(fallSill)} (${codeRef("windowFall.minSillHeight")})`);
        windows.push({
          tag,
          row: [
            tag,
            level.name,
            rooms.filter((r) => r !== "Outside").join(" / "),
            OPERATION_LABEL[op],
            size,
            archFeet(sill),
            archFeet(sill + o.heightIn),
            op === "fixed" ? "Doesn't open" : `${archFeet(clear.widthIn)} x ${archFeet(clear.heightIn)}, ${clear.sqft.toFixed(1)} sq ft`,
            escape,
            `${glassSqft(o).toFixed(1)} sq ft`,
            notes.join(". "),
          ],
        });
      }
    }
  }
  const order = (t: string) => Number(t.slice(1));
  return { doors: doors.sort((a, b) => order(a.tag) - order(b.tag)).map((d) => d.row), windows: windows.sort((a, b) => order(a.tag) - order(b.tag)).map((w) => w.row), exteriorDoorCount };
}

export function doorWindowSheets(project: Project): Item[][] {
  const { doors, windows } = doorWindowRows(project);
  const win = exteriorPick(project.exterior.selections, "windows")?.product;
  const notes = [
    "Sizes are the unit's nominal size, width by height. Rough openings and exact clear openings come from the maker's data for the picked product; check each escape window against it before ordering.",
    `Windows: ${win ? productText(win) : "the owner's window pick"}, or equal. Every window and glass door: U-factor ${codeNum("energy.fenestrationU")} or lower (${codeRef("energy.fenestrationU")}), labeled by NFRC.`,
    `*One side-hinged outside door up to ${codeNum("energy.opaqueDoorExemptArea")} sq ft is exempt from the U-factor (${codeRef("energy.opaqueDoorExemptArea")}); up to ${codeNum("energy.glazedExemptArea")} sq ft of glass is exempt too (${codeRef("energy.glazedExemptArea")}).`,
    `Emergency escape windows (bedrooms and basements): at least ${codeNum("egress.netClearOpening")} sq ft clear (${codeNum("egress.netClearOpeningGradeFloor")} sq ft at grade floor), ${inchText(codeNum("egress.minClearHeight"))} clear high, ${inchText(codeNum("egress.minClearWidth"))} clear wide, sill no higher than ${inchText(codeNum("egress.maxSillHeight"))} (${codeRef("egress.netClearOpening")}).`,
    `Safety glass (tempered or laminated, with its mark showing) where the schedule says Tempered: in doors, beside doors, large low panes, near tubs and showers, and beside stairs (${codeRef("glazing.doorAdjacentArc")}).`,
    `Window sills less than ${inchText(codeNum("windowFall.minSillHeight"))} above the floor and more than ${inchText(codeNum("windowFall.heightAboveGrade"))} above the ground outside need an opening limit device (${codeRef("windowFall.minSillHeight")}).`,
    `At least one outside door: ${inchText(codeNum("exit.doorClearWidth"))} clear wide and ${inchText(codeNum("exit.doorClearHeight"))} clear high, side-hinged (${codeRef("exit.doorClearWidth")}).`,
    "Flash every outside door and window (IRC R703.4). Install to the maker's instructions.",
    ...(project.levels.some((l) => doorWindowOnCurve(project, l.id))
      ? ["Units marked as set in a curved wall are flat: each sits on the chord of the curve and the framer cuts the wall around it. Frames and trim are not bent."]
      : []),
  ];
  return flowTables(
    "Door and window schedules",
    [
      {
        title: "Door schedule",
        cols: [
          { title: "Tag", width: 0.5 },
          { title: "Floor", width: 1.1 },
          { title: "Between", width: 2.6 },
          { title: "Type", width: 1.6 },
          { title: "Size (W x H)", width: 1.3 },
          { title: "Swing", width: 1.2 },
          { title: "Construction", width: 3.4 },
          { title: "Glass", width: 0.9 },
          { title: "Rating, energy", width: 1.9 },
          { title: "Product", width: 4 },
        ],
        rows: doors,
      },
      {
        title: "Window schedule",
        cols: [
          { title: "Tag", width: 0.5 },
          { title: "Floor", width: 1.1 },
          { title: "Room", width: 1.9 },
          { title: "Opens as", width: 1.1 },
          { title: "Size (W x H)", width: 1.3 },
          { title: "Sill", width: 0.8 },
          { title: "Head", width: 0.8 },
          { title: "Clear opening (about)", width: 2.3 },
          { title: "Escape window", width: 2 },
          { title: "Glass", width: 0.9 },
          { title: "Notes", width: 4.8 },
        ],
        rows: windows,
      },
    ],
    notes,
  );
}

// ---------- Room finishes ----------

/** Rooms in finish-schedule order, top floor last, with their floor. */
function scheduleRooms(h: HouseFacts): { level: Level; room: PlanRoom }[] {
  return h.levels.flatMap((level) => h.plan(level.id).rooms.filter((r) => areaKind(r) !== "outdoor").map((room) => ({ level, room })));
}

export function finishRows(project: Project): string[][] {
  const h = houseFacts(project);
  const sel = project.interior.selections;
  const name = (p: Product | undefined) => (p ? productTitle(p) : "");
  const wet = codeNum("bath.nonabsorbentWallHeight");
  return scheduleRooms(h).map(({ level, room }) => {
    const type = room.type ?? "other";
    const area = polygonArea(room.polygon) / SQ_IN_PER_SQ_FT;
    const ceiling = archFeet(ceilingFor(h.basics, level));
    if (type === "garage") {
      return [room.name, level.name, `${Math.round(area)}`, "Concrete", "", `${inchText(codeNum("garage.gypsumGarageSide"))} gypsum on the house side (${codeRef("garage.gypsumGarageSide")})`, `${inchText(codeNum("garage.gypsumCeilingUnderHabitable"))} Type X gypsum under rooms above (${codeRef("garage.gypsumCeilingUnderHabitable")})`, ceiling, ""];
    }
    const cats = new Set(categoriesFor({ type }).map((c) => c.id));
    const f = roomFinishes(sel, room.id);
    const floor = TILE_ROOMS.has(type) ? name(f.get("tile")) || "Tile, owner's pick" : cats.has("flooring") ? name(f.get("flooring")) || "Owner's pick" : roomType(type).category === "outdoor" ? "" : "Owner's pick";
    const paint = f.get("paint");
    const walls = cats.has("paint") ? (paint ? `Paint: ${productTitle(paint)}` : "Paint, owner's color") : "Paint";
    const base = name(effectivePick(sel, WHOLE_HOUSE, "trim")?.pick.product) || "Owner's pick";
    const notes: string[] = [];
    if (FULL_BATHS.has(type)) notes.push(`Tub and shower walls: tile or other nonabsorbent finish to ${inchText(wet)} above the floor, on cement board or a listed backer, not plain gypsum (${codeRef("bath.nonabsorbentWallHeight")}, R702.4.2)`);
    if (BATHS.has(type) || type === "laundry") notes.push("Moisture-resistant gypsum on walls");
    if (type === "kitchen") {
      const counter = f.get("counters");
      if (counter) notes.push(`Counters: ${productTitle(counter)}`);
    }
    return [room.name, level.name, `${Math.round(area)}`, floor, base, walls, "Gypsum board, flat white paint", ceiling, notes.join(". ")];
  });
}

export function finishSheets(project: Project): Item[][] {
  const rows = finishRows(project);
  const notes = [
    "Products and colors are the owner's picks on the Interior page of House Design App. A room without its own pick uses the whole-house pick. Equal products may be used.",
    "Walls and ceilings: 1/2\" gypsum board unless noted, taped, finished and painted. Ceilings flat white.",
    `Showers and walls over tubs with a shower head: a smooth, hard, nonabsorbent surface to at least ${inchText(codeNum("bath.nonabsorbentWallHeight"))} above the floor (${codeRef("bath.nonabsorbentWallHeight")}).`,
    `Garage: ${inchText(codeNum("garage.gypsumGarageSide"))} gypsum on the garage side of walls next to the house; ${inchText(codeNum("garage.gypsumCeilingUnderHabitable"))} Type X on the ceiling under rooms above (${codeRef("garage.gypsumCeilingUnderHabitable")}).`,
    "Floor finishes with their underlayment and transitions to the maker's instructions.",
  ];
  return flowTables(
    "Room finish schedule",
    [
      {
        title: "Room finishes",
        cols: [
          { title: "Room", width: 1.8 },
          { title: "Floor", width: 1 },
          { title: "Sq ft", width: 0.6 },
          { title: "Floor finish", width: 3.2 },
          { title: "Base and casing", width: 2.4 },
          { title: "Walls", width: 3 },
          { title: "Ceiling", width: 2.2 },
          { title: "Ceiling height", width: 1 },
          { title: "Notes", width: 4.5 },
        ],
        rows,
      },
    ],
    notes,
  );
}

// ---------- Appliances and plumbing fixtures ----------

/** Which interior pick goes with each fixture kind. */
const FIXTURE_PICKS: Record<string, string[]> = {
  sink: ["kitchen-sinks", "kitchen-faucets"],
  vanity: ["vanities", "bath-faucets"],
  toilet: ["toilets"],
  shower: ["showers"],
  tub: ["showers"],
  fridge: ["fridges"],
  range: ["ranges"],
  dishwasher: ["dishwashers"],
};

const PLUMBING = ["sink", "vanity", "toilet", "tub", "shower", "laundry-sink", "water-heater"];
const APPLIANCES = ["range", "hood", "fridge", "dishwasher", "washer", "dryer"];

export type FixtureLine = { tag: string; kind: string; label: string; rooms: string[]; count: number; size: string; product: string; notes: string; ids: string[] };

export function fixtureLines(project: Project): { plumbing: FixtureLine[]; appliances: FixtureLine[] } {
  const h = houseFacts(project);
  const sel = project.interior.selections;
  const groups = new Map<string, FixtureLine>();
  const add = (kind: string, label: string, room: string, size: string, product: string, notes: string, id: string) => {
    const key = `${kind}|${size}|${product}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.ids.push(id);
      if (!g.rooms.includes(room)) g.rooms.push(room);
    } else groups.set(key, { tag: "", kind, label, rooms: [room], count: 1, size, product, notes, ids: [id] });
  };
  for (const level of h.levels) {
    const plan = h.plan(level.id);
    for (const f of plan.fixtures) {
      if (!PLUMBING.includes(f.kind) && !APPLIANCES.includes(f.kind)) continue;
      const room = plan.rooms.find((r) => r.id === f.roomId)?.name ?? level.name;
      const picks = (FIXTURE_PICKS[f.kind] ?? []).map((c) => (f.roomId ? effectivePick(sel, f.roomId, c) : effectivePick(sel, WHOLE_HOUSE, c))?.pick.product).filter((p): p is Product => Boolean(p));
      const product = picks.length ? picks.map((p) => productTitle(p)).join(" + ") : "Owner's pick";
      add(f.kind, fixtureType(f.kind).label, room, `${archFeet(f.widthIn)} x ${archFeet(f.depthIn)}`, product, fixtureNotes(f.kind), f.id);
      if (f.kind === "range") {
        const hood = (f.roomId ? effectivePick(sel, f.roomId, "hoods") : null)?.pick.product;
        add("hood", "Range hood", room, archFeet(f.widthIn), hood ? productTitle(hood) : "Owner's pick", fixtureNotes("hood"), `hood:${f.id}`);
      }
    }
  }
  const all = [...groups.values()];
  const tagged = (kinds: string[], prefix: string) =>
    all
      .filter((g) => kinds.includes(g.kind))
      .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))
      .map((g, i) => ({ ...g, tag: `${prefix}${i + 1}` }));
  return { plumbing: tagged(PLUMBING, "P"), appliances: tagged(APPLIANCES, "A") };
}

function fixtureNotes(kind: string): string {
  switch (kind) {
    case "toilet":
      return `${codeNum("plumbing.wcMaxFlush")} gal per flush max (${codeRef("plumbing.wcMaxFlush")}). ${inchText(codeNum("plumbing.wcSideClearance"))} to each side, ${inchText(codeNum("plumbing.wcFrontClearance"))} clear in front (${codeRef("plumbing.wcFrontClearance")}).`;
    case "vanity":
      return `Faucet ${codeNum("plumbing.lavatoryFaucetMaxFlow")} gpm max (${codeRef("plumbing.lavatoryFaucetMaxFlow")}).`;
    case "sink":
      return `Faucet ${codeNum("plumbing.kitchenFaucetMaxFlow")} gpm max (${codeRef("plumbing.kitchenFaucetMaxFlow")}).`;
    case "shower":
      return `Shower head ${codeNum("plumbing.showerheadMaxFlow")} gpm max; pressure-balance or thermostatic valve limited to ${codeNum("plumbing.showerValveMaxTemp")}°F (${codeRef("plumbing.showerValveMaxTemp")}). Safety glass in any enclosure.`;
    case "tub":
      return `With a shower head: pressure-balance or thermostatic valve limited to ${codeNum("plumbing.showerValveMaxTemp")}°F (${codeRef("plumbing.showerValveMaxTemp")}).`;
    case "water-heater":
      return `Relief valve drain piped to a safe place (${codeRef("plumbing.waterHeaterTPRDischarge")}). Gas line, venting and the relief drain on the plumbing and mechanical plans.`;
    case "range":
      return `Cooking top to cabinets above: ${inchText(codeNum("kitchen.rangeClearanceAbove"))} clear unless the range or hood listing allows less (${codeRef("kitchen.rangeClearanceAbove")}). Gas: per the gas code and listing.`;
    case "hood":
      return `Vented outside, at least ${codeNum("vent.kitchenIntermittent")} cfm (${codeRef("vent.kitchenIntermittent")}). Over ${codeNum("vent.makeupAirHoodCfm")} cfm needs makeup air (${codeRef("vent.makeupAirHoodCfm")}).`;
    case "dryer":
      return "Vented outside to the maker's instructions (IRC M1502).";
    case "dishwasher":
      return "Air gap or high loop on the drain, to the plumbing code.";
    default:
      return "";
  }
}

/** "P3" or "A2" for each fixture id (and "hood:<range id>"), matching the schedule. */
export function fixtureTags(project: Project): Map<string, string> {
  const { plumbing, appliances } = fixtureLines(project);
  return new Map([...plumbing, ...appliances].flatMap((g) => g.ids.map((id) => [id, g.tag] as [string, string])));
}

export function fixtureSheets(project: Project): Item[][] {
  const { plumbing, appliances } = fixtureLines(project);
  const row = (g: FixtureLine) => [g.tag, g.label, `${g.count}`, g.rooms.join(", "), g.size, g.product, g.notes];
  const cols = [
    { title: "Tag", width: 0.5 },
    { title: "Item", width: 1.6 },
    { title: "Qty", width: 0.5 },
    { title: "Rooms", width: 2.6 },
    { title: "Size", width: 1.4 },
    { title: "Product", width: 4.4 },
    { title: "Must meet", width: 6.4 },
  ];
  const notes = [
    "Products are the owner's picks on the Interior page of House Design App; equal products may be used. Install every fixture and appliance to its maker's instructions and listing.",
    `Water use limits come from the Idaho State Plumbing Code (${codeRef("plumbing.wcMaxFlush")}). Look for the WaterSense label.`,
    "Fixture units and hose bibs are on the plumbing plan; gas, ducts and fans on the mechanical plan.",
  ];
  return flowTables(
    "Appliance and plumbing fixture schedule",
    [
      { title: "Plumbing fixtures", cols, rows: plumbing.map(row) },
      { title: "Appliances", cols, rows: appliances.map(row) },
    ],
    notes,
  );
}
