import { DiscoveryAnswers, RealLot, type ChosenRoom, type Fixture, type FloorPlan, type Point, type Project } from "@/lib/model/schema";
import { createProject } from "@/lib/model/project";
import { generatePlot } from "@/lib/land/generate";
import { buildRuleBrief } from "@/lib/brief/rules";
import { levelsFor } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";
import { suggestDiagrams } from "@/lib/bubbles/arrange";
import { defaultBasics } from "@/lib/plan/basics";
import { suggestPlans } from "@/lib/plan/suggest";
import { add, angleOf, dist, leftNormal, scale, sub, unit } from "@/lib/plan/geometry";
import { openingGeometries } from "@/lib/plan/walls";

/** Sample houses for the plans tests, made the way the app makes them. */

let n = 0;
const chosen = (type: string, levelId?: string): ChosenRoom => ({ id: `c${++n}`, type, name: `${roomType(type).label}`, description: "", ...(levelId ? { levelId } : {}) });

/** A whole house from the rules: brief, flow sketch, and Suggest a plan. */
export function house(types: [string, string?][], floorsAbove = 1, floorsBelow = 0, seed = 7): Project {
  const plot = generatePlot(seed);
  const brief = buildRuleBrief({ answers: DiscoveryAnswers.parse({ rooms: types.map(([t, l]) => chosen(t, l)), floorsAbove, floorsBelow }), profile: { mustHaves: [], dislikes: [] }, plot });
  const levels = levelsFor(brief.floors, brief.floorsBelow);
  const basics = defaultBasics();
  const bubbles = suggestDiagrams({ brief, plot, levels });
  const plans = suggestPlans(bubbles, { brief, plot, levels, basics }).plans;
  const p = createProject("Sagebrush House", { ownerName: "Grant" });
  return { ...p, plot, brief, levels, bubbles, floorPlans: plans, plan: { ...p.plan, basics } };
}

export const RANCH: [string, string?][] = [["entry"], ["kitchen"], ["dining"], ["living"], ["primary-bedroom"], ["primary-bath"], ["bedroom"], ["bedroom"], ["bathroom"], ["garage"], ["laundry"]];
export const TWO_STORY: [string, string?][] = [["entry"], ["kitchen"], ["family"], ["half-bath"], ["garage"], ["mudroom"], ["primary-bedroom", "floor-2"], ["primary-bath", "floor-2"], ["bedroom", "floor-2"], ["bedroom", "floor-2"], ["bathroom", "floor-2"]];

/** The ranch on a real lot: 100 ft along the street, 150 ft deep, with zoning setbacks and a rear easement. */
export function onRealLot(p: Project, lot: Partial<RealLot> = {}): Project {
  const real = RealLot.parse({ frontFt: 100, leftFt: 150, streetSide: p.plot!.roadSide, setbacks: { front: 20, side: 5, rear: 15 }, easements: [{ id: "e", side: "rear", widthFt: 10 }], ...lot });
  return { ...p, plans: { ...p.plans, address: "1234 W Example St", parcel: "R1234567890", lot: real } };
}

export function withKitchen(p: Project): Project {
  const plan = p.floorPlans["floor-1"];
  const fixtures: Fixture[] = [...plan.fixtures];
  const along = (roomType: string, items: [string, number, number][], minLen: number) => {
    const room = plan.rooms.find((r) => r.type === roomType);
    if (!room) return;
    const doors = openingGeometries(plan).filter((g) => g.opening.kind !== "window");
    const onEdge = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(dist(a, p) + dist(p, b) - dist(a, b)) < 1;
    // The longest stretch of wall with no door or opening in it.
    let best: { a: Point; u: Point; t0: number; len: number } | null = null;
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % room.polygon.length];
      const L = dist(a, b);
      const cuts = doors.filter((g) => onEdge(g.center, a, b)).map((g) => [Math.min(dist(a, g.a), dist(a, g.b)) - 4, Math.max(dist(a, g.a), dist(a, g.b)) + 4] as [number, number]);
      let at = 0;
      for (const [c0, c1] of [...cuts.sort((x, y) => x[0] - y[0]), [L, L] as [number, number]]) {
        if (c0 - at > (best?.len ?? 0)) best = { a, u: unit(sub(b, a)), t0: at, len: c0 - at };
        at = Math.max(at, c1);
      }
    }
    if (!best || best.len < minLen) return;
    const e = best;
    const u = e.u;
    const inward = scale(leftNormal(u), -1);
    let t = e.t0 + 6;
    for (const [kind, w, d] of items) {
      const at = add(add(e.a, scale(u, t + w / 2)), scale(inward, d / 2 + 2.5));
      fixtures.push({ id: `${roomType}-${kind}-${t}`, kind, x: at.x, y: at.y, rotation: Math.round(angleOf(inward) - 90), widthIn: w, depthIn: d, roomId: room.id });
      t += w;
    }
  };
  along("kitchen", [["fridge", 36, 30], ["counter", 15, 25], ["range", 30, 26], ["counter", 12, 25], ["sink", 33, 22], ["dishwasher", 24, 24]], 160);
  along("primary-bath", [["vanity", 60, 21], ["toilet", 20, 28]], 90);
  along("bathroom", [["vanity", 36, 21], ["toilet", 20, 28]], 60);
  along("laundry", [["washer", 27, 30], ["dryer", 27, 30]], 60);
  along("garage", [["water-heater", 24, 24], ["furnace", 30, 30]], 60);
  const next: FloorPlan = { ...plan, fixtures };
  return { ...p, floorPlans: { ...p.floorPlans, "floor-1": next } };
}
