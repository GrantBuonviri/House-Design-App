import { suggestFollowUps } from "@/lib/brief/service";
import { readBriefRequest } from "@/lib/brief/request";

export async function POST(req: Request) {
  const body = await readBriefRequest(req);
  if (!body.success) return Response.json({ error: "Those answers couldn't be read." }, { status: 400 });
  const { answers, profile, plot, fresh } = body.data;
  return Response.json(await suggestFollowUps({ answers, profile, plot }, { fresh }));
}
