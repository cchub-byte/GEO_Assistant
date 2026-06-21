import { serializeReferenceSource } from "@/lib/services/reference-details";
import { analyzeCompetitorReferenceFeatureRun } from "@/lib/services/reference-feature-analysis";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { runId?: unknown };
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  if (!runId) {
    return Response.json({ error: "缺少 runId" }, { status: 400 });
  }

  const run = await analyzeCompetitorReferenceFeatureRun(runId);
  if (!run) {
    return Response.json({ error: "采样不存在" }, { status: 404 });
  }

  return Response.json({
    competitorReferenceFeatureAnalysis: run.competitorReferenceFeatureAnalysis || "",
    competitorReferenceFeatureAnalysisAt: run.competitorReferenceFeatureAnalysisAt?.toISOString() || "",
    competitorReferenceFeatureAnalysisError: run.competitorReferenceFeatureAnalysisError || "",
    sources: "sources" in run && Array.isArray(run.sources) ? run.sources.map(serializeReferenceSource) : undefined
  });
}
