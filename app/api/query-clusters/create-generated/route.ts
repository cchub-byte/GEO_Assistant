import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { fallbackQueryIntentType, normalizeQueryIntentType } from "@/lib/query-intents";
import type { GeneratedQueryClusterCandidate } from "@/lib/services/query-ai";

const DEFAULT_QUERY_CLUSTER_INTENT_TYPE = "general";

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
            intentType: DEFAULT_QUERY_CLUSTER_INTENT_TYPE,
            defaultEngineIds: JSON.stringify(defaultEngineIds),
            status: "active",
            queries: {
              create: cluster.queries.map((query, index) => ({
                queryText: query.queryText,
                region: "CN",
                status: "active",
                intentType: normalizeQueryIntentType(query.intentType, index)
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
  const raw = value as { name?: unknown; queries?: unknown };
  const name = String(raw.name || "").trim();
  const queries = Array.isArray(raw.queries)
    ? raw.queries
        .map((query, index) => normalizeGeneratedQuery(query, index))
        .filter((query): query is GeneratedQueryClusterCandidate["queries"][number] => Boolean(query))
        .slice(0, 10)
    : [];
  if (!name || queries.length === 0) return null;
  return { name, queries };
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
    intentType: normalizeQueryIntentType(raw.intentType || raw.intent, index)
  };
}
