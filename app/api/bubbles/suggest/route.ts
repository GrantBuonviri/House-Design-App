import { SketchRequest, readJson } from "@/lib/bubbles/request";
import { suggestSketch } from "@/lib/bubbles/service";

export async function POST(req: Request) {
  const body = await readJson(req, SketchRequest);
  if (!body.success) return Response.json({ error: "The brief couldn't be read." }, { status: 400 });
  const { fresh, ...ctx } = body.data;
  return Response.json(await suggestSketch(ctx, { fresh }));
}
