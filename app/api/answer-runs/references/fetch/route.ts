import { prisma } from "@/lib/db";
import { fetchReferenceDetailsForRun, serializeReferenceSource } from "@/lib/services/reference-details";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";

  if (!runId) {
    return Response.json({ error: "缺少 runId。" }, { status: 400 });
  }

  const run = await prisma.answerRun.findUnique({
    where: { id: runId },
    select: { id: true }
  });
  if (!run) {
    return Response.json({ error: "采样不存在。" }, { status: 404 });
  }

  const sources = await fetchReferenceDetailsForRun(runId);
  return Response.json({
    sources: sources.map(serializeReferenceSource)
  });
}
