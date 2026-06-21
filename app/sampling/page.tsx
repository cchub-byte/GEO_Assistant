import { Empty } from "@/components/ui";
import { getDashboard } from "@/lib/services/read";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { getSamplingFullWorkflowStatuses } from "@/lib/services/sampling-full-workflow";
import { primaryBrandName, splitCsv } from "@/lib/utils";
import { SamplingStatusRefresher } from "./status-refresher";
import { SamplingWorkbench } from "./sampling-workbench";
import type { AnswerRunView, BrandAnalysisView, QueryClusterView, SamplingPlanView, SamplingWorkflowStatusView } from "./sampling-workbench";

export const dynamic = "force-dynamic";

export default async function SamplingPage({
  searchParams
}: {
  searchParams?: Promise<{ batchId?: string | string[] }>;
}) {
  const data = await getDashboard();
  if (!data) return <Empty title="没有采样项目" body="请先运行 seed。" />;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialBatchIds = normalizeParamList(resolvedSearchParams.batchId);

  const activePlanSource = data.project.samplingPlans.find((plan) => plan.status === "active") || data.project.samplingPlans[0] || null;
  const activePlan: SamplingPlanView | null = activePlanSource
    ? {
        id: activePlanSource.id,
        name: activePlanSource.name,
        repeatCount: activePlanSource.repeatCount,
        engines: data.project.engineConfigs.filter((engine) => engine.status === "active").map((engine) => ({
          id: engine.id,
          displayName: engine.displayName,
          engineType: engine.engineType,
          baseUrl: engine.baseUrl
        }))
      }
    : null;
  const clusters: QueryClusterView[] = data.project.queryClusters.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    status: cluster.status,
    defaultEngineIds: parseDefaultEngineIds(cluster.defaultEngineIds),
    queries: cluster.queries.map((query) => ({
      id: query.id,
      queryText: query.queryText,
      region: query.region,
      status: query.status
    }))
  }));
  const brandName = primaryBrandName(data.project.brandProfile);
  const currentBrandTerms = buildCurrentBrandTerms(data.project.brandProfile);
  const competitorNames = data.project.brandProfile?.competitors
    .map((competitor) => competitor.name.trim())
    .filter(Boolean) || [];
  const competitorTerms = data.project.brandProfile?.competitors
    .flatMap((competitor) => [competitor.name, ...splitCsv(competitor.aliases)])
    .map((term) => term.trim())
    .filter(Boolean) || [];
  const batchNameById = new Map(
    data.project.samplingBatches.map((batch) => [batch.id, batch.name?.trim() || batch.id])
  );
  const fullWorkflowStatuses = await getSamplingFullWorkflowStatuses(data.project.id);
  const workflowStatuses: SamplingWorkflowStatusView[] = fullWorkflowStatuses.map((status) => ({
    id: status.id,
    jobId: status.jobId,
    batchIds: status.batchIds,
    batchLabel: status.batchIds.map((batchId) => batchNameById.get(batchId) || batchId).join("、") || "未关联批次",
    retryableRunCount: status.retryableRunCount,
    canContinue: canContinueWorkflow(status.status, status.retryableRunCount),
    status: status.status,
    currentStep: status.currentStep,
    message: status.message,
    error: status.error,
    startedAt: status.startedAt.toISOString(),
    updatedAt: status.updatedAt.toISOString(),
    finishedAt: status.finishedAt?.toISOString() || ""
  }));
  const runs: AnswerRunView[] = data.project.answerRuns.map((run) => ({
    id: run.id,
    samplingBatchId: run.samplingBatchId || "",
    samplingBatchName: run.samplingBatchId ? batchNameById.get(run.samplingBatchId) || run.samplingBatchId : "",
    queryId: run.queryId,
    queryClusterId: run.query.clusterId,
    runAt: run.runAt.toISOString(),
    platform: run.engineConfig.displayName,
    queryText: run.query.queryText,
    status: run.status,
    failureReason: run.failureReason || "",
    answerText: run.answerText || "",
    brandAnalysis: buildBrandAnalysis(run.answerText || "", brandName, currentBrandTerms, competitorNames),
    answerAnalysis: run.answerAnalysis || "",
    answerAnalysisAt: run.answerAnalysisAt?.toISOString() || "",
    answerAnalysisError: run.answerAnalysisError || "",
    answerReferenceAnalysis: run.answerReferenceAnalysis || "",
    answerReferenceAnalysisAt: run.answerReferenceAnalysisAt?.toISOString() || "",
    answerReferenceAnalysisError: run.answerReferenceAnalysisError || "",
    referenceFeatureAnalysis: run.referenceFeatureAnalysis || "",
    referenceFeatureAnalysisAt: run.referenceFeatureAnalysisAt?.toISOString() || "",
    referenceFeatureAnalysisError: run.referenceFeatureAnalysisError || "",
    competitorReferenceFeatureAnalysis: run.competitorReferenceFeatureAnalysis || "",
    competitorReferenceFeatureAnalysisAt: run.competitorReferenceFeatureAnalysisAt?.toISOString() || "",
    competitorReferenceFeatureAnalysisError: run.competitorReferenceFeatureAnalysisError || "",
    searchKeywords: parseSearchKeywords(run.engineMetadata),
    brandTerms: currentBrandTerms,
    competitorTerms,
    sources: run.sources.map((source) => ({
      id: source.id,
      position: source.position,
      title: source.title,
      summary: source.summary || "",
      url: normalizeStoredReferenceUrl(source.url),
      siteName: source.siteName || "",
      domain: source.domain || "",
      fetchedUrl: source.fetchedUrl ? normalizeStoredReferenceUrl(source.fetchedUrl) : "",
      bodyText: source.bodyText || "",
      author: source.author || "",
      publishedAt: source.publishedAt || "",
      content: source.content || "",
      fetchMode: source.fetchMode || "",
      fetchError: source.fetchError || "",
      fetchedAt: source.fetchedAt?.toISOString() || "",
      referenceFeatureAnalysis: source.referenceFeatureAnalysis || "",
      referenceFeatureAnalysisAt: source.referenceFeatureAnalysisAt?.toISOString() || "",
      referenceFeatureAnalysisError: source.referenceFeatureAnalysisError || "",
      competitorReferenceFeatureAnalysis: source.competitorReferenceFeatureAnalysis || "",
      competitorReferenceFeatureAnalysisAt: source.competitorReferenceFeatureAnalysisAt?.toISOString() || "",
      competitorReferenceFeatureAnalysisError: source.competitorReferenceFeatureAnalysisError || ""
    }))
  }));
  const shouldRefresh = data.project.answerRuns.some((run) => run.status === "queued" || run.status === "running")
    || data.project.samplingPlans.some((plan) => plan.jobs.some((job) => job.status === "queued" || job.status === "running"))
    || workflowStatuses.some((status) => status.status === "running");

  return (
    <div suppressHydrationWarning>
      <SamplingStatusRefresher enabled={shouldRefresh} />
      <SamplingWorkbench
        activePlan={activePlan}
        clusters={clusters}
        runs={runs}
        initialBatchIds={initialBatchIds}
        workflowStatuses={workflowStatuses}
      />
    </div>
  );
}

function normalizeParamList(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values.map((item) => String(item || "").trim()).filter(Boolean);
}

function canContinueWorkflow(status: string, retryableRunCount: number) {
  if (status === "running") return false;
  if (retryableRunCount > 0) return true;
  return ["failed", "cancelled", "completed_with_warnings"].includes(status);
}

function normalizeStoredReferenceUrl(url: string) {
  return normalizeReferenceSourceUrl(url) || url;
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

function parseSearchKeywords(engineMetadata?: string | null) {
  if (!engineMetadata) return [];
  try {
    const parsed = JSON.parse(engineMetadata) as { searchKeywords?: unknown };
    const keywords = parsed.searchKeywords;
    if (Array.isArray(keywords)) {
      return keywords.map((keyword) => String(keyword || "").trim()).filter(Boolean);
    }
    if (typeof keywords === "string") {
      return keywords.split(/\r?\n|[、,，]/).map((keyword) => keyword.trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

function buildBrandAnalysis(answerText: string, brandName: string, currentBrandTerms: string[], competitorNames: string[]): BrandAnalysisView {
  const lines = answerText.split(/\r?\n/);
  const brandMatch = findFirstLineMatch(lines, currentBrandTerms);
  return {
    brandName,
    brandMatchedTerm: brandMatch?.term || "",
    totalLineCount: lines.length,
    brandLine: brandMatch?.line || null,
    competitors: competitorNames.map((name) => ({
      name,
      line: findFirstLineNumber(lines, name)
    }))
  };
}

function buildCurrentBrandTerms(brand?: { brandNames?: string | null; aliases?: string | null } | null) {
  return uniqueTerms([...splitCsv(brand?.brandNames), ...splitCsv(brand?.aliases)]);
}

function uniqueTerms(terms: string[]) {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const normalized = term.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function findFirstLineMatch(lines: string[], terms: string[]) {
  let earliest: { line: number; term: string } | null = null;
  for (const term of terms) {
    const line = findFirstLineNumber(lines, term);
    if (line == null) continue;
    if (!earliest || line < earliest.line) earliest = { line, term };
  }
  return earliest;
}

function findFirstLineNumber(lines: string[], term: string): number | null {
  const target = term.trim();
  if (!target) return null;
  const lowerTarget = target.toLocaleLowerCase();
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLocaleLowerCase().includes(lowerTarget)) {
      return index + 1;
    }
  }
  return null;
}
