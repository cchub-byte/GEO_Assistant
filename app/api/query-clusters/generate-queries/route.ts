import { generateQueryCandidates } from "@/lib/services/query-ai";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const projectId = String(payload.projectId || "").trim();
    const clusterName = String(payload.clusterName || "").trim();
    const intentType = String(payload.intentType || "").trim();

    if (!projectId) {
      return Response.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const result = await generateQueryCandidates({ projectId, clusterName, intentType });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 生成 Query 失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
