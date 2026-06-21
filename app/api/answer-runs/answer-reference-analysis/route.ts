import { analyzeAnswerReferenceRun } from "@/lib/services/answer-reference-analysis";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { runId?: unknown };
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  if (!runId) {
    return Response.json({ error: "缺少 runId" }, { status: 400 });
  }

  const run = await analyzeAnswerReferenceRun(runId);
  if (!run) {
    return Response.json({ error: "采样不存在" }, { status: 404 });
  }

  return Response.json({
    answerReferenceAnalysis: run.answerReferenceAnalysis || "",
    answerReferenceAnalysisAt: run.answerReferenceAnalysisAt?.toISOString() || "",
    answerReferenceAnalysisError: run.answerReferenceAnalysisError || ""
  });
}
