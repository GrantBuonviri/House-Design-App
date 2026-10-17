import type { Project } from "@/lib/model/schema";
import { fullMoney, type CategoryId, type Estimate } from "./estimate";

/**
 * Ways of looking at an estimate for the cost panel: against the Rooms
 * page's budget, room by room, by category share, and how much the last
 * edit changed it. Worked out from the estimate, never saved.
 */

export type BudgetCheck = {
  budget: number;
  likely: number;
  /** Likely minus the budget: above zero is over. */
  diff: number;
  /** Share of the budget the likely cost uses (1 = all of it). */
  used: number;
  /** "over" once the likely cost passes the budget, "close" within 5% under it, else "under". */
  status: "under" | "close" | "over";
  /** Even the low end of the range is over the budget. */
  lowOver: boolean;
};

/** The Rooms page's materials budget, in dollars, or null when none is set. */
export function budgetOf(profile: Pick<Project["profile"], "budget">): number | null {
  const { low, high } = profile.budget ?? {};
  const b = high ?? low ?? 0;
  return b > 0 ? b : null;
}

export function budgetCheck(profile: Pick<Project["profile"], "budget">, e: Pick<Estimate, "total">): BudgetCheck | null {
  const budget = budgetOf(profile);
  if (budget === null) return null;
  const likely = e.total.likely;
  const diff = likely - budget;
  const status = diff > 0 ? "over" : -diff <= budget * 0.05 ? "close" : "under";
  return { budget, likely, diff, used: likely / budget, status, lowOver: e.total.low > budget };
}

export type RoomCost = {
  id: string;
  name: string;
  type: string;
  sqft: number;
  /** The room's own finish lines (flooring, tile, fixtures, cabinets...). */
  own: number;
  /** Its share, by floor area, of the shell and systems (framing, roof, wiring...). */
  shared: number;
  total: number;
};

/** Categories that belong to the lot and the paperwork, not to any room. */
const WHOLE_HOUSE_CATS: CategoryId[] = ["site", "permits"];

/**
 * The likely cost room by room. Each room gets its share of the lines it
 * was measured for (`quantities.rooms` amounts, the same split product
 * picks use), plus a share by floor area of everything else in the house.
 * Site work and permits stay as one whole-house amount. The rooms and the
 * whole-house amount add up to the total.
 */
export function costByRoom(e: Estimate): { rooms: RoomCost[]; wholeHouse: number } {
  const rooms = e.quantities.rooms;
  const own = new Map(rooms.map((r) => [r.id, 0]));
  let wholeHouse = 0;
  let rest = 0;
  for (const c of e.categories)
    for (const l of c.lines) {
      const cost = l.cost.likely;
      if (WHOLE_HOUSE_CATS.includes(c.id)) {
        wholeHouse += cost;
        continue;
      }
      const amounts = l.rate ? rooms.map((r) => r.amounts[l.rate!] ?? 0) : [];
      const sum = amounts.reduce((s, a) => s + a, 0);
      if (!(sum > 0) || !(l.qty > 0)) {
        rest += cost;
        continue;
      }
      // Rooms measured for more than the line holds (rounding) split all of it; less leaves the remainder shared.
      const base = Math.max(sum, l.qty);
      rooms.forEach((r, i) => own.set(r.id, own.get(r.id)! + (cost * amounts[i]) / base));
      rest += cost * (1 - sum / base);
    }
  const area = rooms.reduce((s, r) => s + Math.max(0, r.sqft), 0);
  if (!rooms.length || !(area > 0)) return { rooms: [], wholeHouse: wholeHouse + rest + [...own.values()].reduce((s, x) => s + x, 0) };
  const out = rooms.map((r) => {
    const shared = (rest * Math.max(0, r.sqft)) / area;
    const o = own.get(r.id)!;
    return { id: r.id, name: r.name, type: r.type, sqft: r.sqft, own: o, shared, total: o + shared };
  });
  return { rooms: out.sort((a, b) => b.total - a.total), wholeHouse };
}

export type CategoryShare = { id: CategoryId | "other"; label: string; likely: number; share: number };

/** The biggest categories by likely cost, largest first, with the rest as "Everything else". */
export function categoryShares(e: Pick<Estimate, "categories" | "total">, top = 6): CategoryShare[] {
  const total = e.total.likely;
  if (!(total > 0)) return [];
  const sorted = e.categories.filter((c) => c.cost.likely > 0).sort((a, b) => b.cost.likely - a.cost.likely);
  const shown = sorted.slice(0, top).map((c) => ({ id: c.id as CategoryShare["id"], label: c.label, likely: c.cost.likely, share: c.cost.likely / total }));
  const other = sorted.slice(top).reduce((s, c) => s + c.cost.likely, 0);
  if (other > 0) shown.push({ id: "other", label: "Everything else", likely: other, share: other / total });
  return shown;
}

/** Changes smaller than this don't get a note. */
export const CHANGE_MIN = 50;

export type CostChange = { id: number; diff: number; label: string; text: string };

/** "+$4,200: add a bathroom", or null when the change is too small to mention. */
export function changeNote(before: number, after: number, label: string): Omit<CostChange, "id"> | null {
  const diff = Math.round((after - before) / 10) * 10;
  if (Math.abs(diff) < CHANGE_MIN) return null;
  return { diff, label, text: `${diff > 0 ? "+" : "−"}${fullMoney(Math.abs(diff))}: ${label}` };
}
