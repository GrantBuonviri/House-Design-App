import type { Project } from "@/lib/model/schema";
import { estimate, type Estimate } from "./estimate";
import type { RatesFile } from "./rates";

/**
 * Side-by-side cost of a few big choices: what goes under the house, the
 * roof shape, and 2x4 or 2x6 outside walls. Each option is the whole
 * estimate worked out again with just that one choice changed, so it shows
 * everything the choice touches (digging, walls, insulation, gutters...).
 * Worked out when asked, never saved.
 */

export type ChoiceGroupId = "foundation" | "roof" | "walls";

export type ChoiceOption = {
  value: string;
  label: string;
  /** Likely total with this option. */
  total: number;
  /** Against the house as it is now: above zero costs more. */
  diff: number;
  current: boolean;
};

export type ChoiceGroup = { id: ChoiceGroupId; label: string; note?: string; options: ChoiceOption[] };

const GROUPS: { id: ChoiceGroupId; label: string; options: [string, string][]; note?: string }[] = [
  {
    id: "foundation",
    label: "Under the house",
    options: [
      ["slab", "Slab"],
      ["crawlspace", "Crawlspace"],
      ["basement", "Basement"],
    ],
    note: "A basement here is unfinished space under the main floor; finishing it costs more.",
  },
  {
    id: "roof",
    label: "Roof shape",
    options: [
      ["gable", "Gable"],
      ["hip", "Hip"],
      ["shed", "Shed"],
      ["flat", "Flat"],
    ],
  },
  {
    id: "walls",
    label: "Outside walls",
    options: [
      ["2x4", "2x4 + foam"],
      ["2x6", "2x6"],
    ],
    note: "2x4 walls need an inch of foam board outside to meet the energy code, so they don't save as much as the lumber suggests.",
  },
];

/** The choice as the project has it now. */
export function currentChoice(p: Project, group: ChoiceGroupId): string {
  if (group === "foundation") return p.plans.systems.foundation;
  if (group === "roof") return p.house3d.roof.style;
  return p.plan.basics?.exteriorWall ?? "2x6";
}

/** The project with one choice changed: the same edit the "Use this" button saves. */
export function withChoice(p: Project, group: ChoiceGroupId, value: string): Project {
  if (group === "foundation") return { ...p, plans: { ...p.plans, systems: { ...p.plans.systems, foundation: value as Project["plans"]["systems"]["foundation"] } } };
  if (group === "roof") return { ...p, house3d: { ...p.house3d, roof: { ...p.house3d.roof, style: value as Project["house3d"]["roof"]["style"] } } };
  if (!p.plan.basics) return p;
  return { ...p, plan: { ...p.plan, basics: { ...p.plan.basics, exteriorWall: value as "2x4" | "2x6" } } };
}

/** Which choices can be compared: the walls only once there are plan basics; the roof and walls only matter with something to put them on. */
function groupsFor(p: Project): typeof GROUPS {
  return GROUPS.filter((g) => g.id !== "walls" || !!p.plan.basics);
}

/** Every option in every group, priced. `base` is the estimate already showing, so it isn't worked out twice. */
export function compareChoices(p: Project, base: Estimate | null = estimate(p), file?: RatesFile): ChoiceGroup[] {
  if (!base) return [];
  const now = base.total.likely;
  return groupsFor(p).map((g) => {
    const cur = currentChoice(p, g.id);
    const options = g.options.map(([value, label]) => {
      const total = value === cur ? now : (estimate(withChoice(p, g.id, value), file)?.total.likely ?? now);
      return { value, label, total, diff: total - now, current: value === cur };
    });
    return { id: g.id, label: g.label, note: g.note, options };
  });
}
