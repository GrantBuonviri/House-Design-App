import { isHeated, roomType } from "@/lib/brief/rooms";
import { FLOOR_STRUCTURE_IN } from "@/lib/plan/basics";
import { type Quantities, OPEN_ROOMS, type Ctx, empty, siteFacts, roomFixtures } from "./quantityBasics";

/**
 * A rough measure from the Rooms page (or the Design Brief), before any
 * floor plan is drawn: the rooms' sizes plus space for halls and walls,
 * stacked as simple boxes, with typical windows and doors.
 */
export function measureRough(p: Ctx): Quantities | null {
  const answers = p.discovery.answers;
  const rooms = p.brief
    ? p.brief.rooms.map((r) => ({ name: r.name, type: r.type, sqft: r.targetSqFt, levelId: r.levelId }))
    : answers.rooms.map((r) => ({ name: r.name, type: r.type, sqft: (r.lengthIn && r.widthIn ? (r.lengthIn * r.widthIn) / 144 : 0) || roomType(r.type).sqft, levelId: r.levelId }));
  if (!rooms.length) return null;
  const q = empty("rough");
  siteFacts(p, q);
  const above = p.brief?.floors ?? answers.floorsAbove;
  const belowN = p.brief?.floorsBelow ?? answers.floorsBelow;
  q.floorsAbove = above;
  q.floorsBelow = belowN;

  // Halls, closets and walls add about 15% to the room sizes.
  const heated = rooms.filter((r) => isHeated(r.type)).reduce((s, r) => s + r.sqft, 0) * 1.15;
  const garage = rooms.filter((r) => roomType(r.type).category === "garage").reduce((s, r) => s + r.sqft, 0);
  const outdoor = rooms.filter((r) => roomType(r.type).category === "outdoor");
  q.livingSqft = heated;
  q.garageSqft = garage;
  q.deckSqft = outdoor.filter((r) => r.type === "deck").reduce((s, r) => s + r.sqft, 0);
  q.porchSqft = outdoor.filter((r) => r.type !== "deck").reduce((s, r) => s + r.sqft, 0);

  const floors = above + belowN;
  const perFloor = heated / floors;
  const ceiling = 9;
  const story = ceiling + FLOOR_STRUCTURE_IN / 12;
  const perimeter = (area: number) => 4 * Math.sqrt(area) * 1.15;
  const mainArea = perFloor + garage;
  const basementArea = belowN ? perFloor : 0;

  q.groundSqft = mainArea;
  q.garageSlabSqft = garage;
  if (q.foundation === "slab") q.slabSqft = perFloor;
  else q.floorFramingSqft += perFloor;
  q.footingLf = perimeter(mainArea) + (belowN ? perimeter(basementArea) : 0);
  const stemH = (q.foundation === "slab" ? 2.5 : 3) + Math.min(4, q.slopePercent / 4);
  q.stemWallSqft = perimeter(mainArea) * stemH;
  q.excavationCuyd = (mainArea * 1) / 27;
  if (belowN) {
    q.basementSlabSqft = basementArea * belowN;
    q.basementWallSqft = perimeter(basementArea) * 9.5 * belowN;
    q.waterproofSqft = q.basementWallSqft * 0.8;
    q.excavationCuyd += ((basementArea + perimeter(basementArea) * 2) * 9 * belowN) / 27;
    q.floorFramingSqft += perFloor; // the main floor over the basement
  }
  if (q.foundation === "stepped") q.retainingWallSqft = Math.sqrt(mainArea) * 0.5 * 5;
  q.floorFramingSqft += perFloor * Math.max(0, above - 1);

  const extWallGross = perimeter(perFloor) * story * above + perimeter(garage || 1) * 0.5 * story;
  q.windowSqft = heated * 0.12;
  q.windows = Math.round(q.windowSqft / 15);
  q.patioDoors = 1;
  q.entryDoors = garage ? 2 : 1;
  q.garageDoorLf = garage ? Math.max(9, (answers.garageCars || 2) * 8) : 0;
  q.extWallSqft = Math.max(0, extWallGross - q.windowSqft - 60);
  const heatedRooms = rooms.filter((r) => isHeated(r.type));
  q.interiorDoors = heatedRooms.filter((r) => !OPEN_ROOMS.has(r.type)).length + rooms.filter((r) => /bedroom|guest/.test(r.type)).length;
  q.intWallLf = (heated / 10) * 1.0;
  q.intWallSqft = q.intWallLf * ceiling;
  q.stairs = Math.max(0, floors - 1);

  const top = perFloor + (above === 1 ? garage : 0);
  const roof = p.house3d.roof;
  const slope = roof.style === "flat" ? 0 : roof.pitch / 12;
  const roofPlan = (top + (above > 1 ? garage : 0) + q.porchSqft * 0.6) * 1.12;
  q.roofSqft = roofPlan * Math.sqrt(1 + slope * slope);
  q.flatRoofSqft = roof.style === "flat" ? q.roofSqft : 0;
  q.eaveLf = perimeter(roofPlan);
  q.gutterLf = q.eaveLf * (roof.style === "hip" ? 1 : roof.style === "gable" ? 0.6 : 0.3);
  q.hipValleyLf = roof.style === "hip" ? 4 * Math.sqrt(roofPlan) * 0.6 : roof.style === "gable" ? Math.sqrt(roofPlan) * 0.4 : 0;
  q.gableSqft = roof.style === "gable" ? 2 * 0.5 * Math.sqrt(top) * (Math.sqrt(top) / 2) * slope : 0;
  q.atticSqft = perFloor;

  roomFixtures(
    q,
    rooms.map((r, i) => ({ id: `rough-${i}`, name: r.name, type: r.type, sqft: r.sqft, fixtures: [] })),
  );
  q.drywallSqft = q.extWallSqft + q.intWallSqft * 2 + heated + garage;
  q.driveSqft = 40 * (garage ? 20 : 12);
  q.trenchLf = 60;
  q.patioSqft = outdoor.filter((r) => r.type === "patio").reduce((s, r) => s + r.sqft, 0);
  q.baseWallLf = perimeter(mainArea);
  // A typical yard: a front walk, beds along the front and sides, lawn around the house, a few trees.
  q.walkSqft = 30 * 4;
  q.bedSqft = perimeter(mainArea) * 0.6 * 4;
  q.shrubs = Math.round((perimeter(mainArea) * 0.6) / 6);
  q.lawnSqft = Math.max(0, (Math.sqrt(mainArea) + 60) ** 2 - mainArea - q.driveSqft - q.bedSqft - q.walkSqft - q.porchSqft - q.deckSqft) * 0.8;
  q.trees = 4;
  q.extLights = q.entryDoors + (garage ? 2 : 0) + q.patioDoors;
  return q;
}
