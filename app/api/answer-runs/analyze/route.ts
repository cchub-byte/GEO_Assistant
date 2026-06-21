import { redirect } from "next/navigation";
import { analyzeAnswerRun } from "@/lib/services/answer-analysis";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as { runId?: unknown };
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    if (!runId) {
      return Response.json({ error: "缺少 runId" }, { status: 400 });
    }
    const run = await analyzeAnswerRun(runId);
    if (!run) {
      return Response.json({ error: "采样不存在" }, { status: 404 });
    }
    return Response.json({
      answerAnalysis: run.answerAnalysis || "",
      answerAnalysisAt: run.answerAnalysisAt?.toISOString() || "",
      answerAnalysisError: run.answerAnalysisError || ""
    });
  }

  const formData = await request.formData();
  const runId = String(formData.get("runId") || "");

  if (runId) {
    await analyzeAnswerRun(runId);
  }

  redirect("/sampling");
}
