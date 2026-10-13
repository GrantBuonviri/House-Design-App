import { z } from "zod";
import { DiscoveryAnswers, FollowUp, Plot, Profile } from "@/lib/model/schema";

/** What the browser sends to the brief routes. */
export const BriefRequest = z.object({
  answers: DiscoveryAnswers,
  profile: Profile,
  plot: Plot.nullable(),
  followUps: z.array(FollowUp).default([]),
  fresh: z.boolean().optional(),
});

export async function readBriefRequest(req: Request) {
  try {
    return BriefRequest.safeParse(await req.json());
  } catch {
    return BriefRequest.safeParse(null);
  }
}
