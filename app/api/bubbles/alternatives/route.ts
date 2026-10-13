import { AlternativesRequest, readJson } from "@/lib/bubbles/request";
import { suggestAlternatives } from "@/lib/bubbles/service";

export async function POST(req: Request) {
  const body = await readJson(req, AlternativesRequest);
  if (!body.success) return Response.json({ error: "The sketch couldn't be read." }, { status: 400 });
  const { fresh, current, ...ctx } = body.data;
  return Response.json(await suggestAlternatives(ctx, current, { fresh }));
}
