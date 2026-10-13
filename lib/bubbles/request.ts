import { z } from "zod";
import { BubbleDiagram, DesignBrief, Level, Plot } from "@/lib/model/schema";

/** What the browser sends to the flow sketch routes. */
export const SketchRequest = z.object({
  brief: DesignBrief,
  plot: Plot.nullable(),
  levels: z.array(Level).min(1),
  fresh: z.boolean().optional(),
});

export const AlternativesRequest = SketchRequest.extend({
  current: z.record(z.string(), BubbleDiagram),
});

export async function readJson<S extends z.ZodType>(req: Request, schema: S) {
  try {
    return schema.safeParse(await req.json());
  } catch {
    return schema.safeParse(null);
  }
}
