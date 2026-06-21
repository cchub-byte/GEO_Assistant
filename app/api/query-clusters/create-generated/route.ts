import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { GeneratedQueryClusterCandidate } from "@/lib/services/query-ai";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const projectId = String(payload.projectId || "").trim();
    const clusters = normalizeGeneratedClusters(payload.clusters);
    const requestedEngineIds: string[] = Array.isArray(payload.defaultEngineIds)
      ? payload.defaultEngineIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];

    if (!projectId) {
      return Response.json({ error: "缺少 projectId" }, { status: 400 });
    }
    if (clusters.length !== 3 || clusters.some((cluster) => cluster.queries.length !== 10)) {
      return Response.json({ error: "确认创建需要 3 组 Query集且每组 10 条 Query" }, { status: 400 });
    }

    const activeEngines = await prisma.engineConfig.findMany({
      where: { projectId, status: "active" },
      select: { id: true }
    });
    const validEngineIds = new Set(activeEngines.map((engine) => engine.id));
    const defaultEngineIds = requestedEngineIds.length
      ? requestedEngineIds.filter((id) => validEngineIds.has(id))
      : activeEngines.map((engine) => engine.id);

    await prisma.$transaction(
      clusters.map((cluster) =>
        prisma.queryCluster.create({
          data: {
            projectId,
            name: cluster.name,
            intentType: cluster.intentType,
            funnelStage: "consideration",
            priority: 3,
            businessValueScore: 50,
            targetMetric: "VAIR",
            ownerTeam: "Product",
            defaultEngineIds: JSON.stringify(defaultEngineIds),
            status: "active",
            queries: {
              create: cluster.queries.map((query) => ({
                queryText: query.queryText,
                language: "zh-CN",
                region: "CN",
                device: "desktop",
                status: "active",
                intentType: query.intentType || cluster.intentType,
                expectedEvidenceTypes: "definition,pricing,specification,comparison,constraint,trust_signal"
              }))
            }
          }
        })
      )
    );

    revalidatePath("/sampling/query-clusters");
    revalidatePath("/sampling");
    revalidatePath("/");
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 生成 Query集创建失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

function normalizeGeneratedClusters(value: unknown): GeneratedQueryClusterCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGeneratedCluster).filter((item): item is GeneratedQueryClusterCandidate => Boolean(item));
}

function normalizeGeneratedCluster(value: unknown): GeneratedQueryClusterCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { name?: unknown; intentType?: unknown; queries?: unknown };
  const name = String(raw.name || "").trim();
  const intentType = String(raw.intentType || "").trim();
  const queries = Array.isArray(raw.queries)
    ? raw.queries
        .map((query, index) => normalizeGeneratedQuery(query, index))
        .filter((query): query is GeneratedQueryClusterCandidate["queries"][number] => Boolean(query))
        .slice(0, 10)
    : [];
  if (!name || !intentType || queries.length === 0) return null;
  return { name, intentType, queries };
}

function normalizeGeneratedQuery(value: unknown, index: number): GeneratedQueryClusterCandidate["queries"][number] | null {
  if (typeof value === "string") {
    const queryText = value.trim();
    return queryText ? { queryText, intentType: fallbackQueryIntentType(index) } : null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as { queryText?: unknown; query?: unknown; text?: unknown; question?: unknown; intentType?: unknown; intent?: unknown };
  const queryText = String(raw.queryText || raw.query || raw.text || raw.question || "").trim();
  if (!queryText) return null;
  return {
    queryText,
    intentType: String(raw.intentType || raw.intent || fallbackQueryIntentType(index)).trim()
  };
}

function fallbackQueryIntentType(index: number) {
  if (index < 3) return "场景模糊";
  if (index < 6) return "场景明确";
  return "意图明确";
}
