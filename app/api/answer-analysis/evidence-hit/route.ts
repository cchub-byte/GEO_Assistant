import { redirect } from "next/navigation";
import { analyzeAnswerEvidenceHits } from "@/lib/services/answer-evidence-hit-analysis";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      clusterIds?: unknown;
      batchIds?: unknown;
      queryIntentTypes?: unknown;
    };
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    if (!projectId) return Response.json({ error: "缺少 projectId" }, { status: 400 });
    try {
      const result = await analyzeAnswerEvidenceHits({
        projectId,
        clusterIds: normalizeValues(payload.clusterIds),
        batchIds: normalizeValues(payload.batchIds),
        queryIntentTypes: normalizeValues(payload.queryIntentTypes)
      });
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "答案证据命中分析失败" }, { status: 500 });
    }
  }

  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const returnTo = String(formData.get("returnTo") || "/");
  const clusterIds = formData.getAll("clusterIds").map(String).filter(Boolean);
  const batchIds = formData.getAll("batchIds").map(String).filter(Boolean);
  const queryIntentTypes = formData.getAll("queryIntentTypes").map(String).filter(Boolean);

  if (!projectId) {
    redirect(withStatus(returnTo, "answerEvidenceHitError", "缺少项目 ID"));
  }

  let target = "";
  try {
    const result = await analyzeAnswerEvidenceHits({ projectId, clusterIds, batchIds, queryIntentTypes });
    target = withStatus(returnTo, "answerEvidenceHitStatus", `已分析 ${result.analyzedCount} 条品牌优点，命中 ${result.matchedCount} 条证据`);
  } catch (error) {
    target = withStatus(returnTo, "answerEvidenceHitError", error instanceof Error ? error.message : "答案证据命中分析失败");
  }
  redirect(target);
}

function normalizeValues(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item));
  if (typeof value === "string" && value) return [value];
  return [];
}

function withStatus(returnTo: string, key: string, value: string) {
  const url = new URL(returnTo || "/", "http://localhost");
  url.searchParams.delete("answerEvidenceHitStatus");
  url.searchParams.delete("answerEvidenceHitError");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}
