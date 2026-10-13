import { z } from "zod";
import { DiscoveryAnswers, Plot, Profile } from "@/lib/model/schema";

/** What the browser sends to the brief route. */
export const BriefRequest = z.object({
  answers: DiscoveryAnswers,
  profile: Profile,
  plot: Plot.nullable(),
  fresh: z.boolean().optional(),
});

export async function readBriefRequest(req: Request) {
  try {
    return BriefRequest.safeParse(await req.json());
  } catch {
    return BriefRequest.safeParse(null);
  }
}
