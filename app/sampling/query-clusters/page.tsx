import { Empty } from "@/components/ui";
import {
  buildAdvancedAnalytics,
  buildBasicAnalytics,
  buildBrandWebTargets,
  buildCurrentBrandTerms
} from "@/lib/services/dashboard-analytics";
import { getDashboard } from "@/lib/services/read";
import { brandTerms } from "@/lib/utils";
import { normalizeQueryIntentType } from "@/lib/query-intents";
import { QueryClusterManager } from "./query-cluster-manager";
import type { EngineManagerItem, QueryClusterManagerItem } from "./query-cluster-manager";

export const dynamic = "force-dynamic";

export default async function QueryClustersPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有采样项目" body="请先运行 seed。" />;

  const currentBrandTerms = buildCurrentBrandTerms(data.project.brandProfile);
  const brandWebTargets = buildBrandWebTargets(data.project.brandProfile);
  const basicBrandTerms = brandTerms(data.project.brandProfile);
  const competitors = data.project.brandProfile?.competitors || [];
  const clusters: QueryClusterManagerItem[] = data.project.queryClusters.map((cluster) => {
    const batches = data.project.samplingBatches
      .filter((batch) => data.project.answerRuns.some((run) => run.samplingBatchId === batch.id && run.query.clusterId === cluster.id))
      .map((batch) => {
        const batchRuns = data.project.answerRuns.filter((run) => run.samplingBatchId === batch.id && run.query.clusterId === cluster.id);
        return {
          id: batch.id,
          name: batch.name || "",
          batchDate: batch.batchDate,
          sequence: batch.sequence,
          createdAt: batch.createdAt.toISOString(),
          runCount: batchRuns.length,
          basicAnalytics: buildBasicAnalytics(data.project.engineConfigs, batchRuns, basicBrandTerms, competitors, brandWebTargets),
          advancedAnalytics: buildAdvancedAnalytics(data.project.engineConfigs, batchRuns, currentBrandTerms, competitors)
        };
      });
    const samplingRunCount = data.project.answerRuns.filter((run) => run.query.clusterId === cluster.id).length;
    return {
      id: cluster.id,
      name: cluster.name,
      defaultEngineIds: parseDefaultEngineIds(cluster.defaultEngineIds),
      status: cluster.status,
      samplingRecordCount: samplingRunCount + batches.length,
      samplingBatches: batches,
      queries: cluster.queries.map((query, queryIndex) => ({
        id: query.id,
        queryText: query.queryText,
        intentType: normalizeQueryIntentType(query.intentType, queryIndex),
        region: query.region,
        status: query.status
      }))
    };
  });
  const engines: EngineManagerItem[] = data.project.engineConfigs
    .filter((engine) => engine.status === "active")
    .map((engine) => ({
      id: engine.id,
      displayName: engine.displayName
    }));

  return <QueryClusterManager projectId={data.project.id} clusters={clusters} engines={engines} />;
}

function parseDefaultEngineIds(value?: string | null): string[] | null {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    return null;
  }
  return null;
}
