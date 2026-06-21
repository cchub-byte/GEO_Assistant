import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { parseAnswerAnalysisOutput } from "@/lib/services/answer-analysis";
import {
  buildBasicAnalytics,
  buildBrandWebTargets,
} from "@/lib/services/dashboard-analytics";
import { buildEvidenceSubmodules } from "@/lib/services/evidence-submodules";
import { normalizeQueryIntentType } from "@/lib/query-intents";
import { brandTerms, percentage, primaryBrandName } from "@/lib/utils";

type WorkflowStatusRow = {
  jobId: string;
  batchIds: string;
  status: string;
  currentStep: string;
  message: string;
  error: string | null;
  updatedAt: Date | string;
  finishedAt: Date | string | null;
};

export type GeoAnalysisReportExport = {
  filename: string;
  markdown: string;
  batchIds: string[];
};

const workflowReportTypes = ["batch_brand_profile", "batch_competitor_brand_profile", "batch_full_workflow_status"];
const reportIntentOrder = ["场景模糊", "场景明确", "意图明确"];
const geoReportQuestionClusterInclude = {
  queries: { orderBy: { createdAt: "asc" as const } }
} satisfies Prisma.QueryClusterInclude;
const geoReportRunInclude = {
  query: { include: { cluster: true } },
  engineConfig: true,
  sources: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  metrics: true,
  answerEvidenceHits: true
} satisfies Prisma.AnswerRunInclude;

type GeoReportRun = Prisma.AnswerRunGetPayload<{ include: typeof geoReportRunInclude }>;
type GeoReportQuestionCluster = Prisma.QueryClusterGetPayload<{ include: typeof geoReportQuestionClusterInclude }>;
type GeoReportEvidenceSubmodule = {
  assetTitle: string;
  parentTitle: string;
  moduleType: string;
  title: string;
  locationPath: string;
  body: string;
};
type GeoReportQuestion = {
  clusterName: string;
  queryText: string;
  intentType: string;
};
type GeoAnalysisReportRenderInput = {
  projectName: string;
  brandName: string;
  batchLabel: string;
  batchIds: string[];
  workflow: Awaited<ReturnType<typeof getLatestWorkflowStatusForBatchIds>>;
  exportedAt: Date;
  questionSet: GeoReportQuestion[];
  successfulRuns: GeoReportRun[];
  platformAnalytics: ReturnType<typeof buildBasicAnalytics>;
  intentAnalytics: Array<{ intentType: string; platformAnalytics: ReturnType<typeof buildBasicAnalytics> }>;
  relatedReports: Array<{ type: string; title: string; markdown: string }>;
  evidenceSubmodules: GeoReportEvidenceSubmodule[];
};

export async function buildLatestGeoAnalysisReport(projectId: string): Promise<GeoAnalysisReportExport> {
  const latestBatchIds = await getLatestSamplingBatchIds(projectId);
  if (latestBatchIds.length === 0) {
    throw new Error("当前项目没有可导出的采样批次。");
  }
  const latestWorkflow = await getLatestWorkflowStatusForBatchIds(projectId, latestBatchIds);

  const [project, batches, runs, reports] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        brandProfile: { include: { competitors: true } },
        llmConfig: true,
        queryClusters: {
          include: geoReportQuestionClusterInclude,
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
        },
        engineConfigs: { orderBy: { createdAt: "asc" } },
        contentAssets: {
          include: {
            snapshots: {
              include: { evidenceModules: true },
              orderBy: { snapshotAt: "desc" },
              take: 1
            }
          }
        }
      }
    }),
    prisma.samplingBatch.findMany({
      where: { id: { in: latestBatchIds } },
      include: { cluster: true },
      orderBy: [{ batchDate: "desc" }, { sequence: "desc" }, { id: "asc" }]
    }),
    prisma.answerRun.findMany({
      where: { projectId, samplingBatchId: { in: latestBatchIds } },
      include: geoReportRunInclude,
      orderBy: [{ runAt: "asc" }, { id: "asc" }]
    }),
    prisma.report.findMany({
      where: {
        projectId,
        type: { in: workflowReportTypes }
      },
      orderBy: { createdAt: "desc" },
      take: 24
    })
  ]);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const batchLabels = batches.map((batch) => batch.name?.trim() || batch.id);
  const batchLabel = batchLabels.length > 0 ? batchLabels.join("、") : latestBatchIds.join("、");
  const successfulRuns = runs.filter((run) => run.status === "succeeded" && run.answerText.trim());
  const normalizedQueryIntentById = buildNormalizedQueryIntentById(project.queryClusters);
  const platformAnalytics = buildBasicAnalytics(
    project.engineConfigs,
    successfulRuns,
    brandTerms(project.brandProfile),
    project.brandProfile?.competitors || [],
    buildBrandWebTargets(project.brandProfile)
  );
  const intentAnalytics = buildIntentAnalytics(
    project.engineConfigs,
    successfulRuns,
    normalizedQueryIntentById,
    brandTerms(project.brandProfile),
    project.brandProfile?.competitors || [],
    buildBrandWebTargets(project.brandProfile)
  );
  const relatedReports = selectRelatedWorkflowReports(reports, [...batchLabels, ...latestBatchIds]);
  const evidenceSubmodules = project.contentAssets.flatMap((asset) =>
    (asset.snapshots[0]?.evidenceModules || []).flatMap((module) =>
      buildEvidenceSubmodules(module).map((submodule) => ({
        assetTitle: asset.title,
        parentTitle: submodule.parentTitle,
        moduleType: submodule.moduleType,
        title: submodule.title,
        locationPath: submodule.locationPath,
        body: submodule.body
      }))
    )
  );

  const markdown = renderGeoAnalysisReport({
    projectName: project.name,
    brandName: primaryBrandName(project.brandProfile) || "未配置品牌",
    batchLabel,
    batchIds: latestBatchIds,
    workflow: latestWorkflow,
    exportedAt: new Date(),
    questionSet: buildQuestionSet(runs, project.queryClusters),
    successfulRuns,
    platformAnalytics,
    intentAnalytics,
    relatedReports,
    evidenceSubmodules
  });

  return {
    filename: `${sanitizeFilename(project.name)}-GEO分析报告-${sanitizeFilename(batchLabels[0] || latestBatchIds[0])}.md`,
    markdown,
    batchIds: latestBatchIds
  };
}

async function getLatestWorkflowStatusForBatchIds(projectId: string, batchIds: string[]) {
  const targetBatchIds = new Set(batchIds);
  if (targetBatchIds.size === 0) return null;
  const rows = await prisma.$queryRaw<WorkflowStatusRow[]>`
    SELECT
      "jobId",
      "batchIds",
      "status",
      "currentStep",
      "message",
      "error",
      "updatedAt",
      "finishedAt"
    FROM "SamplingFullWorkflowStatus"
    WHERE "projectId" = ${projectId}
    ORDER BY datetime("updatedAt") DESC, datetime("finishedAt") DESC
    LIMIT 20
  `.catch(() => []);
  const row = rows.find((item) => parseBatchIds(item.batchIds).some((batchId) => targetBatchIds.has(batchId)));
  if (!row) return null;
  return {
    jobId: row.jobId,
    batchIds: parseBatchIds(row.batchIds),
    status: row.status,
    currentStep: row.currentStep,
    message: row.message,
    error: row.error || "",
    updatedAt: new Date(row.updatedAt),
    finishedAt: row.finishedAt ? new Date(row.finishedAt) : null
  };
}

async function getLatestSamplingBatchIds(projectId: string) {
  const batch = await prisma.samplingBatch.findFirst({
    where: { projectId },
    orderBy: [{ batchDate: "desc" }, { sequence: "desc" }, { createdAt: "desc" }],
    select: { id: true }
  });
  return batch ? [batch.id] : [];
}

function renderGeoAnalysisReport(input: GeoAnalysisReportRenderInput) {
  return [
    `# ${input.projectName} GEO 分析报告`,
    "",
    "## 报告概览",
    renderReportOverview(input),
    "",
    "## 0. 测试问题集",
    renderQuestionSetSection(input.questionSet),
    "",
    "## 1. 基础数据",
    renderBasicDataSection(input.platformAnalytics, input.intentAnalytics),
    "",
    "## 2. 品牌画像分析（基于引用来源分析）",
    renderRelatedReport(input.relatedReports, "batch_brand_profile", "品牌画像分析"),
    "",
    "## 3. 竞品画像分析（基于引用来源分析）",
    renderRelatedReport(input.relatedReports, "batch_competitor_brand_profile", "竞品画像分析"),
    "",
    "## 4. 答案分析",
    renderAnswerAnalysisSection(input.successfulRuns, input.platformAnalytics, input.evidenceSubmodules.length),
    "",
    "## 5. 品牌定义（内容资产-证据模块列表）",
    renderEvidenceModulesSection(input.evidenceSubmodules),
    ""
  ].join("\n");
}

function buildQuestionSet(runs: GeoReportRun[], clusters: GeoReportQuestionCluster[]): GeoReportQuestion[] {
  const runQueryIds = new Set(runs.map((run) => run.queryId));
  const emittedQueryIds = new Set<string>();
  const questions: GeoReportQuestion[] = [];
  for (const cluster of clusters) {
    for (const [queryIndex, query] of cluster.queries.entries()) {
      if (!runQueryIds.has(query.id)) continue;
      emittedQueryIds.add(query.id);
      questions.push({
        clusterName: cluster.name,
        queryText: query.queryText,
        intentType: normalizeQueryIntentType(query.intentType, queryIndex)
      });
    }
  }
  for (const run of runs) {
    if (emittedQueryIds.has(run.queryId)) continue;
    emittedQueryIds.add(run.queryId);
    questions.push({
      clusterName: run.query.cluster.name,
      queryText: run.query.queryText,
      intentType: normalizeQueryIntentType(run.query.intentType)
    });
  }
  return questions;
}

function buildNormalizedQueryIntentById(clusters: GeoReportQuestionCluster[]) {
  const normalized = new Map<string, string>();
  for (const cluster of clusters) {
    for (const [queryIndex, query] of cluster.queries.entries()) {
      normalized.set(query.id, normalizeQueryIntentType(query.intentType, queryIndex));
    }
  }
  return normalized;
}

function renderReportOverview(input: GeoAnalysisReportRenderInput) {
  const workflowText = input.workflow
    ? `${input.workflow.status} / ${input.workflow.currentStep} / ${input.workflow.jobId}`
    : "未关联完整工作流记录";
  return [
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 报告批次 | ${escapeMarkdownTableCell(input.batchLabel)} |`,
    `| 批次 ID | ${escapeMarkdownTableCell(input.batchIds.join("、"))} |`,
    `| 当前品牌 | ${escapeMarkdownTableCell(input.brandName)} |`,
    `| 导出时间 | ${escapeMarkdownTableCell(formatDateTime(input.exportedAt))} |`,
    `| 工作流 | ${escapeMarkdownTableCell(workflowText)} |`
  ].join("\n");
}

function renderQuestionSetSection(questionSet: GeoReportQuestion[]) {
  if (questionSet.length === 0) return "暂无本批次测试问题。";
  return [
    "| Query集 | Query | Query 意图 |",
    "| --- | --- | --- |",
    ...questionSet.map((question) =>
      `| ${escapeMarkdownTableCell(question.clusterName)} | ${escapeMarkdownTableCell(question.queryText)} | ${escapeMarkdownTableCell(question.intentType)} |`
    )
  ].join("\n");
}

function renderBasicDataSection(
  platformAnalytics: ReturnType<typeof buildBasicAnalytics>,
  intentAnalytics: Array<{ intentType: string; platformAnalytics: ReturnType<typeof buildBasicAnalytics> }>
) {
  return [
    "### 1.1 总数据",
    "#### 1.1.1 平台核心指标",
    renderBasicAnalyticsMetricTable(platformAnalytics),
    "",
    "#### 1.1.2 各平台引用来源 TOP10",
    renderTopSourcesSection(platformAnalytics),
    "",
    "### 1.2 按意图分别呈现",
    intentAnalytics.length === 0
      ? "暂无可按意图拆分的数据。"
      : intentAnalytics.map((item, index) => renderIntentAnalyticsSection(item, index)).join("\n\n")
  ].join("\n");
}

function renderIntentAnalyticsSection(
  item: { intentType: string; platformAnalytics: ReturnType<typeof buildBasicAnalytics> },
  index: number
) {
  const sectionNumber = `1.2.${index + 1}`;
  return [
    `#### ${sectionNumber} ${item.intentType}`,
    "##### 平台核心指标",
    renderBasicAnalyticsMetricTable(item.platformAnalytics),
    "",
    "##### 各平台引用来源 TOP10",
    renderTopSourcesSection(item.platformAnalytics)
  ].join("\n");
}

function renderBasicAnalyticsMetricTable(platformAnalytics: ReturnType<typeof buildBasicAnalytics>) {
  const activePlatformAnalytics = platformAnalytics.filter(hasPlatformData);
  if (activePlatformAnalytics.length === 0) return "暂无该范围内的平台数据。";

  return [
    "| 平台 | Query 总数 | 品牌名出现比例 | 品牌域名地址命中率 | 竞品品牌名出现比例 | 当前品牌首次出现在答案的位置 | 竞品品牌名首次出现在答案的位置 |",
    "| --- | ---: | ---: | ---: | --- | ---: | --- |",
    ...activePlatformAnalytics.map((item) => {
      const competitorRatios = item.competitorRatios
        .map((competitor) => `${competitor.name}: ${formatCountRatio(competitor.count, item.totalQueryCount)}`)
        .join("；") || "无";
      const competitorPositions = item.competitorFirstPositions
        .filter((competitor) => competitor.averagePosition > 0)
        .map((competitor) => `${competitor.name}: ${percentage(competitor.averagePosition)}`)
        .join("；") || "无";
      return [
        `| ${escapeMarkdownTableCell(item.platformName)}`,
        item.totalQueryCount,
        formatCountRatio(item.brandAppearCount, item.totalQueryCount),
        formatCountRatio(item.brandDomainHitCount, item.referenceSourceCount),
        escapeMarkdownTableCell(competitorRatios),
        escapeMarkdownTableCell(formatBrandPositionCell(item)),
        escapeMarkdownTableCell(competitorPositions)
      ].join(" | ") + " |";
    })
  ].join("\n");
}

function renderTopSourcesSection(platformAnalytics: ReturnType<typeof buildBasicAnalytics>) {
  const activePlatformAnalytics = platformAnalytics.filter(hasPlatformData);
  if (activePlatformAnalytics.length === 0) return "暂无该范围内的平台数据。";

  return activePlatformAnalytics.map((item) => [
    `**${escapeMarkdownTableCell(item.platformName)}**`,
    item.topSources.length === 0
      ? "暂无引用来源。"
      : [
          "| 排名 | 引用来源 | 引用次数 |",
          "| ---: | --- | ---: |",
          ...item.topSources.slice(0, 10).map((source, index) =>
            `| ${index + 1} | ${escapeMarkdownTableCell(source.name)} | ${source.count} |`
          )
        ].join("\n")
  ].join("\n\n")).join("\n\n");
}

function renderAnswerAnalysisSection(
  runs: GeoReportRun[],
  platformAnalytics: ReturnType<typeof buildBasicAnalytics>,
  totalEvidenceSubmoduleCount: number
) {
  const hitRates = summarizeBrandAssetHitRates(runs, platformAnalytics, totalEvidenceSubmoduleCount);
  const brandFeatures = summarizeBrandAnswerFeatures(runs);
  return [
    "### 4.1 各平台品牌资产命中率",
    "| 平台 | 命中证据模块数 | 品牌定义证据模块总数 | 品牌资产命中率 |",
    "| --- | ---: | ---: | ---: |",
    ...hitRates.map((item) => `| ${escapeMarkdownTableCell(item.platformName)} | ${item.matched} | ${item.total} | ${percentage(item.rate)} |`),
    "",
    "### 4.2 答案中提及的品牌优缺点列表",
    "#### 品牌优点",
    renderBrandFeatureList(brandFeatures.advantages),
    "",
    "#### 品牌缺点",
    renderBrandFeatureList(brandFeatures.disadvantages)
  ].join("\n");
}

function summarizeBrandAssetHitRates(
  runs: GeoReportRun[],
  platformAnalytics: ReturnType<typeof buildBasicAnalytics>,
  totalEvidenceSubmoduleCount: number
) {
  const runByPlatformId = new Map<string, GeoReportRun[]>();
  for (const run of runs) {
    const current = runByPlatformId.get(run.engineConfigId) || [];
    current.push(run);
    runByPlatformId.set(run.engineConfigId, current);
  }
  return platformAnalytics.map((platform) => {
    if (!hasPlatformData(platform)) return null;
    const platformRuns = runByPlatformId.get(platform.platformId) || [];
    const matchedEvidenceIds = new Set(
      platformRuns
        .flatMap((run) => run.answerEvidenceHits || [])
        .filter((hit) => hit.matched && hit.evidenceSubmoduleId)
        .map((hit) => hit.evidenceSubmoduleId || "")
    );
    const matched = matchedEvidenceIds.size;
    return {
      platformName: platform.platformName,
      total: totalEvidenceSubmoduleCount,
      matched,
      rate: totalEvidenceSubmoduleCount === 0 ? 0 : matched / totalEvidenceSubmoduleCount
    };
  }).filter((item): item is { platformName: string; total: number; matched: number; rate: number } => Boolean(item));
}

function summarizeBrandAnswerFeatures(runs: GeoReportRun[]) {
  const advantages: Array<{ platformName: string; queryText: string; content: string }> = [];
  const disadvantages: Array<{ platformName: string; queryText: string; content: string }> = [];
  for (const run of runs) {
    for (const section of parseAnswerAnalysisOutput(run.answerAnalysis || "")) {
      if (section.label !== "提及品牌优点" && section.label !== "提及品牌缺点") continue;
      if (section.status !== "是") continue;
      const target = section.label === "提及品牌优点" ? advantages : disadvantages;
      for (const timing of section.timings) {
        target.push({
          platformName: run.engineConfig.displayName,
          queryText: run.query.queryText,
          content: timing
        });
      }
    }
  }
  return { advantages, disadvantages };
}

function renderBrandFeatureList(items: Array<{ platformName: string; queryText: string; content: string }>) {
  if (items.length === 0) return "暂无。";
  return [
    "| 平台 | Query | 内容 |",
    "| --- | --- | --- |",
    ...items.map((item) =>
      `| ${escapeMarkdownTableCell(item.platformName)} | ${escapeMarkdownTableCell(item.queryText)} | ${escapeMarkdownTableCell(item.content)} |`
    )
  ].join("\n");
}

function renderRelatedReport(reports: Array<{ type: string; title: string; markdown: string }>, type: string, title: string) {
  const report = reports.find((item) => item.type === type);
  if (!report) return `暂无 ${title} 结果。`;
  return [`> ${report.title}`, "", report.markdown.trim()].join("\n");
}

function renderEvidenceModulesSection(modules: GeoReportEvidenceSubmodule[]) {
  if (modules.length === 0) return "暂无内容资产证据模块。";
  return [
    "| 内容资产 | 父模块 | 模块类型 | 证据模块 | 位置 | 证据内容 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...modules.map((module) =>
      `| ${escapeMarkdownTableCell(module.assetTitle)} | ${escapeMarkdownTableCell(module.parentTitle)} | ${escapeMarkdownTableCell(module.moduleType)} | ${escapeMarkdownTableCell(module.title)} | ${escapeMarkdownTableCell(module.locationPath)} | ${escapeMarkdownTableCell(module.body)} |`
    )
  ].join("\n");
}

function buildIntentAnalytics(
  engines: Parameters<typeof buildBasicAnalytics>[0],
  runs: GeoReportRun[],
  normalizedQueryIntentById: Map<string, string>,
  brandTermList: string[],
  competitors: Parameters<typeof buildBasicAnalytics>[3],
  brandWebTargets: string[]
) {
  const intentTypes = [...new Set(runs.map((run) => normalizedQueryIntentById.get(run.queryId) || normalizeQueryIntentType(run.query.intentType)))].sort(compareIntentTypes);
  return intentTypes.map((intentType) => ({
    intentType,
    platformAnalytics: buildBasicAnalytics(
      engines,
      runs.filter((run) => (normalizedQueryIntentById.get(run.queryId) || normalizeQueryIntentType(run.query.intentType)) === intentType),
      brandTermList,
      competitors,
      brandWebTargets
    )
  }));
}

function compareIntentTypes(left: string, right: string) {
  const leftWeight = intentSortWeight(left);
  const rightWeight = intentSortWeight(right);
  return leftWeight - rightWeight || left.localeCompare(right, "zh-CN");
}

function intentSortWeight(value: string) {
  const normalized = normalizeQueryIntentType(value);
  const index = reportIntentOrder.indexOf(normalized);
  return index >= 0 ? index : reportIntentOrder.length;
}

function formatBrandPositionCell(item: ReturnType<typeof buildBasicAnalytics>[number]) {
  return [
    `平均位于：${item.totalQueryCount === 0 ? "0.00 %" : `${(item.brandFirstPosition * 100).toFixed(2)} %`}`,
    `竞争时位于：${(item.brandCompetitiveFirstPosition * 100).toFixed(2)} %`,
    `落后竞品次数：${item.brandBehindCompetitorCount}(总${item.brandCompetitorCoAppearCount}次)`,
    `落后竞品率：${formatCountRatio(item.brandBehindCompetitorCount, item.brandCompetitorCoAppearCount)}`
  ].join("；");
}

function hasPlatformData(item: ReturnType<typeof buildBasicAnalytics>[number]) {
  return item.totalQueryCount > 0;
}

function selectRelatedWorkflowReports(
  reports: Array<{ type: string; title: string; markdown: string }>,
  batchIdentifiers: string[]
) {
  const identifiers = batchIdentifiers.map((label) => label.trim()).filter(Boolean);
  return reports.filter((report) => identifiers.some((identifier) => report.title.includes(identifier)));
}

function formatCountRatio(count: number, total: number) {
  if (total === 0) return "0/0 (0%)";
  return `${count}/${total} (${percentage(count / total)})`;
}

function parseBatchIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
  return [];
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function sanitizeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80) || "GEO报告";
}
