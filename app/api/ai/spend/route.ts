import { readSpend, resetSpend } from "@/lib/ai/store";

export async function GET() {
  return Response.json(await readSpend());
}

export async function DELETE() {
  await resetSpend();
  return Response.json(await readSpend());
}
