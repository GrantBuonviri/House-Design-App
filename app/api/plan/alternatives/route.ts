import { readJson } from "@/lib/bubbles/request";
import { PlanAlternativesRequest } from "@/lib/plan/request";
import { suggestPlanAlternatives } from "@/lib/plan/service";

export async function POST(req: Request) {
  const body = await readJson(req, PlanAlternativesRequest);
  if (!body.success) return Response.json({ error: "The floor plan couldn't be read." }, { status: 400 });
  const { fresh, skip, plans, ...ctx } = body.data;
  return Response.json(await suggestPlanAlternatives(plans, ctx, { fresh, skip }));
}
