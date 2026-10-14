import { z } from "zod";
import { DesignBrief, FloorPlan, Level, PlanBasics, Plot } from "@/lib/model/schema";

/** What the browser sends for the floor plan's alternatives. */
export const PlanAlternativesRequest = z.object({
  brief: DesignBrief.nullable(),
  plot: Plot.nullable(),
  levels: z.array(Level).min(1),
  basics: PlanBasics.nullable(),
  plans: z.record(z.string(), FloorPlan),
  fresh: z.boolean().optional(),
  /** Titles of the alternatives already shown, so "Show me different ones" tries others. */
  skip: z.array(z.string()).max(12).optional(),
});
