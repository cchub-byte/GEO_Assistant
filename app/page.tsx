import Link from "next/link";
import { AnswerEvidenceHitAnalysisAction } from "./answer-evidence-hit-analysis-action";
import { BasicAnalyticsTable } from "./basic-analytics-table";
import { BrandProfileAnalysisAction } from "./references/brand-profile-analysis-action";
import { Bar, Badge, Empty, Section, StatCard } from "@/components/ui";
import { answerEvidenceHitKey, getAnswerEvidenceHitResultMap, type AnswerEvidenceHitResult } from "@/lib/services/answer-evidence-hit-analysis";
import { parseAnswerAnalysisOutput, type AnswerAnalysisLabel } from "@/lib/services/answer-analysis";
import { buildEvidenceSubmodules } from "@/lib/services/evidence-submodules";
import {
  type BrandProfileAnalysisResult,
  type BrandProfileAnalysisSource
} from "@/lib/services/brand-profile-analysis";
import {
  buildProfileAnalysisContextKey,
  getProfileAnalysisArchive
} from "@/lib/services/profile-analysis-archive";
import {
  buildBasicAnalytics,
  buildBrandWebTargets,
  buildClusterOverviewAnalytics,
  calculateLatestBatchAverageBrandFirstPosition,
  calculateLatestBatchBrandAssetHitRate,
  calculateLatestBatchCompetitorSubstitutionRate,
  calculateLatestBatchSourceSelectionRate,
  normalizeSelectedIds,
  summarizeSelectedClusters
} from "@/lib/services/dashboard-analytics";
import { getDashboard } from "@/lib/services/read";
import { brandTerms, percentage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DashboardAnswerAnalysisItem = {
  id: string;
  label: AnswerAnalysisLabel;
  displayLabel: string;
  tone: "good" | "warn" | "info" | "bad";
  platformName: string;
  queryText: string;
  runAt: Date;
  content: string;
  evidenceHit: AnswerEvidenceHitResult | null;
};

type DashboardAnswerAnalysisPlatformTab = {
  platformName: string;
  items: DashboardAnswerAnalysisItem[];
  href: string;
};

type DashboardAnswerEvidencePlatformRate = {
  platformName: string;
  matchedEvidenceCount: number;
  totalEvidenceCount: number;
  rate: number;
};

const dashboardAnswerAnalysisLabels = new Set<AnswerAnalysisLabel>(["提及品牌优点", "提及品牌缺点"]);

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{
    clusterIds?: string | string[];
    batchIds?: string | string[];
    batchId?: string | string[];
    queryIntentTypes?: string | string[];
    queryIntentType?: string | string[];
    answerAnalysisPlatform?: string | string[];
  }>;
}) {
  const data = await getDashboard();
  if (!data) return <Empty title="没有项目" body="请先运行 npm run seed 创建示例项目。" />;
  const { project } = data;
  const resolvedSearchParams = await Promise.resolve(searchParams || {});
  const selectedClusterIds = normalizeSelectedIds(resolvedSearchParams.clusterIds, new Set(project.queryClusters.map((cluster) => cluster.id)));
  const clusterNameById = new Map(project.queryClusters.map((cluster) => [cluster.id, cluster.name]));
  const batchOptions = project.samplingBatches.map((batch) => ({
    id: batch.id,
    label: batch.name?.trim() || batch.id,
    clusterName: summarizeBatchClusterNames(
      project.answerRuns.filter((run) => run.samplingBatchId === batch.id).map((run) => clusterNameById.get(run.query.clusterId) || "未知 Query集"),
      clusterNameById.get(batch.clusterId) || "未知 Query集"
    ),
    runCount: project.answerRuns.filter((run) => run.samplingBatchId === batch.id).length
  }));
  const selectedBatchIds = normalizeSelectedIds(
    mergeSearchParamValues(resolvedSearchParams.batchIds, resolvedSearchParams.batchId),
    new Set(batchOptions.map((batch) => batch.id))
  );
  const queryIntentOptions = buildQueryIntentFilterOptions(project.queryClusters, project.answerRuns);
  const selectedQueryIntentTypes = normalizeSelectedIds(
    mergeSearchParamValues(resolvedSearchParams.queryIntentTypes, resolvedSearchParams.queryIntentType),
    new Set(queryIntentOptions.map((intent) => intent.value))
  );
  const selectedQueryIntentSummary = summarizeSelectedQueryIntents(queryIntentOptions, selectedQueryIntentTypes);
  const filteredAnswerRuns = project.answerRuns.filter((run) => {
    if (selectedClusterIds.length > 0 && !selectedClusterIds.includes(run.query.clusterId)) return false;
    if (selectedBatchIds.length > 0 && !selectedBatchIds.includes(run.samplingBatchId || "")) return false;
    if (selectedQueryIntentTypes.length > 0 && !selectedQueryIntentTypes.includes(normalizeQueryIntentType(run.query.intentType))) return false;
    return true;
  });
  const currentBrandAndProductTerms = brandTerms(project.brandProfile);
  const brandWebTargets = buildBrandWebTargets(project.brandProfile);
  const answerEvidenceHitResultMap = await getAnswerEvidenceHitResultMap(project.id);
  const answerEvidenceHitResults = [...answerEvidenceHitResultMap.values()];
  const totalBrandAssetEvidenceCount = countProjectEvidenceSubmodules(project.contentAssets);
  const latestBatchClusterAverageBrandFirstPosition = calculateLatestBatchAverageBrandFirstPosition(
    project.engineConfigs,
    project.answerRuns,
    project.samplingBatches,
    currentBrandAndProductTerms
  );
  const latestBatchSourceSelectionRate = calculateLatestBatchSourceSelectionRate(
    project.engineConfigs,
    project.answerRuns,
    project.samplingBatches,
    brandWebTargets
  );
  const latestBatchBrandAssetHitRate = calculateLatestBatchBrandAssetHitRate(
    project.engineConfigs,
    project.answerRuns,
    project.samplingBatches,
    answerEvidenceHitResults,
    totalBrandAssetEvidenceCount
  );
  const latestBatchCompetitorSubstitutionRate = calculateLatestBatchCompetitorSubstitutionRate(
    project.engineConfigs,
    project.answerRuns,
    project.samplingBatches,
    currentBrandAndProductTerms
  );
  const clusterOverviewById = new Map(
    buildClusterOverviewAnalytics(
      project.queryClusters,
      project.engineConfigs,
      project.answerRuns,
      project.samplingBatches,
      currentBrandAndProductTerms,
      answerEvidenceHitResults,
      totalBrandAssetEvidenceCount
    ).map((item) => [item.clusterId, item])
  );
  const basicAnalytics = buildBasicAnalytics(
    project.engineConfigs,
    filteredAnswerRuns,
    currentBrandAndProductTerms,
    project.brandProfile?.competitors || [],
    brandWebTargets
  );
  const selectedClusterSummary = summarizeSelectedClusters(project.queryClusters, selectedClusterIds);
  const selectedBatchSummary = summarizeSelectedBatches(batchOptions, selectedBatchIds);
  const profileAnalysisSources = buildDashboardProfileAnalysisSources(filteredAnswerRuns);
  const profileAnalysisFilters = {
    clusterIds: selectedClusterIds,
    batchIds: selectedBatchIds,
    queryIntentTypes: selectedQueryIntentTypes
  };
  const profileAnalysisContextKey = buildProfileAnalysisContextKey({
    scope: "dashboard",
    projectId: project.id,
    filters: profileAnalysisFilters,
    sourceIds: profileAnalysisSources.map((source) => source.id)
  });
  const [archivedBrandProfileAnalysis, archivedCompetitorBrandAnalysis] = await Promise.all([
    getProfileAnalysisArchive({
      projectId: project.id,
      scope: "dashboard",
      target: "brand",
      contextKey: profileAnalysisContextKey
    }),
    getProfileAnalysisArchive({
      projectId: project.id,
      scope: "dashboard",
      target: "competitor",
      contextKey: profileAnalysisContextKey
    })
  ]);
  const brandProfileAnalysis =
    archivedBrandProfileAnalysis ||
    buildIdleProfileAnalysisResult("点击“启动分析”后生成品牌画像分析报告。");
  const competitorBrandAnalysis =
    archivedCompetitorBrandAnalysis ||
    buildIdleProfileAnalysisResult("点击“启动分析”后生成竞品画像分析报告。");
  const brandProfileAnalysisCompleted = Boolean(archivedBrandProfileAnalysis);
  const competitorBrandAnalysisCompleted = Boolean(archivedCompetitorBrandAnalysis);
  const answerAnalysisItems = buildDashboardAnswerAnalysisItems(filteredAnswerRuns, answerEvidenceHitResultMap);
  const answerAnalysisPlatformTabs = buildDashboardAnswerAnalysisPlatformTabs(answerAnalysisItems).map((tab) => ({
    ...tab,
    href: buildDashboardHref({
      clusterIds: selectedClusterIds,
      batchIds: selectedBatchIds,
      queryIntentTypes: selectedQueryIntentTypes,
      answerAnalysisPlatform: tab.platformName
    })
  }));
  const activeAnswerAnalysisPlatform = resolveAnswerAnalysisPlatform(
    answerAnalysisPlatformTabs,
    normalizeSingleSearchParam(resolvedSearchParams.answerAnalysisPlatform)
  );
  const analyzedAnswerRunCount = filteredAnswerRuns.filter((run) => Boolean(run.answerAnalysis?.trim())).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          <p className="muted">数据总览</p>
        </div>
        <div className="actions">
          <form action="/api/reports/latest-batch/export" method="get">
            <button className="secondary" type="submit" disabled={project.samplingBatches.length === 0}>
              导出最新报告
            </button>
          </form>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="当前品牌平均位置" value={formatBasicAveragePositionValue(latestBatchClusterAverageBrandFirstPosition)} hint="最新批次中，所有 Query集平均位置的均值" />
        <StatCard label="自有来源选择率" value={percentage(latestBatchSourceSelectionRate)} hint="全部 Query集最新批次的平台品牌域名/地址命中率均值" />
        <StatCard label="品牌资产命中率" value={percentage(latestBatchBrandAssetHitRate)} hint="全部 Query集最新批次，各平台品牌资产命中率均值" />
        <StatCard label="竞品替代率" value={percentage(latestBatchCompetitorSubstitutionRate)} hint="1 - 全部 Query集最新批次的平台品牌名出现比例均值" />
      </div>

        <Section title="Query集表现">
        <table className="table">
          <thead>
            <tr>
              <th>Query集</th>
              <th>Query 数量</th>
              <th>当前品牌平均位置</th>
              <th>品牌资产命中率</th>
              <th>稳定性</th>
            </tr>
          </thead>
          <tbody>
            {project.queryClusters.map((cluster) => {
              const overview = clusterOverviewById.get(cluster.id);
              return (
                <tr key={cluster.id}>
                  <td>{cluster.name}</td>
                  <td>{cluster.queries.length}</td>
                  <td>{formatBasicAveragePositionValue(overview?.averageBrandFirstPosition || 0)}</td>
                  <td>
                    <Bar value={overview?.brandAssetHitRate || 0} />
                  </td>
                  <td>
                    <Bar value={overview?.stabilityScore || 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </Section>

      <Section title="基础数据分析">
        <form method="get" className="filter-bar">
          <details className="filter-dropdown">
            <summary>
              <span>Query集筛选</span>
              <strong>{selectedClusterSummary}</strong>
            </summary>
            <div className="filter-dropdown-panel">
              <div className="filter-dropdown-summary">可多选，默认展示全部 Query集数据。</div>
              <div className="filter-dropdown-list">
                {project.queryClusters.length === 0 ? (
                  <div className="hint">暂无 Query集</div>
                ) : (
                  project.queryClusters.map((cluster) => (
                    <label key={cluster.id} className="check-row">
                      <input
                        type="checkbox"
                        name="clusterIds"
                        value={cluster.id}
                        defaultChecked={selectedClusterIds.includes(cluster.id)}
                      />
                      <span>
                        <strong>{cluster.name}</strong>
                        <span className="hint">{cluster.intentType}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>
              <span>批次筛选</span>
              <strong>{selectedBatchIds.length > 0 ? `${selectedBatchIds.length} 项` : "全部批次"}</strong>
            </summary>
            <div className="filter-dropdown-panel">
              <div className="filter-dropdown-summary">{selectedBatchSummary}</div>
              <div className="filter-dropdown-list">
                {batchOptions.length === 0 ? (
                  <div className="hint">暂无采样批次</div>
                ) : (
                  batchOptions.map((batch) => (
                    <label key={batch.id} className="check-row">
                      <input
                        type="checkbox"
                        name="batchIds"
                        value={batch.id}
                        defaultChecked={selectedBatchIds.includes(batch.id)}
                      />
                      <span>
                        <strong>{batch.label}</strong>
                        <span className="hint">{batch.clusterName} / {batch.runCount} 条采样</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>
              <span>问题意图筛选</span>
              <strong>{selectedQueryIntentTypes.length > 0 ? `${selectedQueryIntentTypes.length} 项` : "全部问题意图"}</strong>
            </summary>
            <div className="filter-dropdown-panel">
              <div className="filter-dropdown-summary">{selectedQueryIntentSummary}</div>
              <div className="filter-dropdown-list">
                {queryIntentOptions.length === 0 ? (
                  <div className="hint">暂无问题意图</div>
                ) : (
                  queryIntentOptions.map((intent) => (
                    <label key={intent.value} className="check-row">
                      <input
                        type="checkbox"
                        name="queryIntentTypes"
                        value={intent.value}
                        defaultChecked={selectedQueryIntentTypes.includes(intent.value)}
                      />
                      <span>
                        <strong>{intent.value}</strong>
                        <span className="hint">{intent.queryCount} 条 Query / {intent.runCount} 条采样</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </details>
          <button type="submit">应用筛选</button>
          {selectedClusterIds.length > 0 || selectedBatchIds.length > 0 || selectedQueryIntentTypes.length > 0 ? (
            <Link className="button secondary" href="/">
              清除筛选
            </Link>
          ) : null}
          <div className="hint">当前显示 {filteredAnswerRuns.length} 条采样数据</div>
        </form>

        <BasicAnalyticsTable items={basicAnalytics} />
      </Section>

      <div className="grid grid-2">
        <ProfileAnalysisModule
          title="品牌画像分析"
          analysis={brandProfileAnalysis}
          description={
            brandProfileAnalysisCompleted
              ? `基于当前基础数据分析筛选范围内，各平台命中当前品牌名或别名的引用量 TOP20 链接上下文生成，共 ${brandProfileAnalysis.reportCount} 份平台-品牌报告。`
              : "基于当前基础数据分析筛选范围内，各平台命中当前品牌名或别名的引用量 TOP20 链接上下文生成。"
          }
          action={
            <BrandProfileAnalysisAction
              requestPayload={{
                scope: "dashboard",
                target: "brand",
                filters: profileAnalysisFilters
              }}
              completed={brandProfileAnalysisCompleted}
              label="启动分析"
              loadingStatus="正在基于当前基础数据分析筛选范围生成品牌画像..."
            />
          }
        />
        <ProfileAnalysisModule
          title="竞品画像分析"
          analysis={competitorBrandAnalysis}
          description={
            competitorBrandAnalysisCompleted
              ? `基于当前基础数据分析筛选范围内，各平台命中竞品名或别名的引用量 TOP20 链接上下文生成，共 ${competitorBrandAnalysis.reportCount} 份平台-竞品画像报告。`
              : "基于当前基础数据分析筛选范围内，各平台命中竞品名或别名的引用量 TOP20 链接上下文生成。"
          }
          action={
            <BrandProfileAnalysisAction
              requestPayload={{
                scope: "dashboard",
                target: "competitor",
                filters: profileAnalysisFilters
              }}
              completed={competitorBrandAnalysisCompleted}
              label="启动分析"
              loadingStatus="正在基于当前基础数据分析筛选范围生成竞品画像..."
            />
          }
        />
      </div>

      <AnswerAnalysisModule
        platformTabs={answerAnalysisPlatformTabs}
        activePlatformName={activeAnswerAnalysisPlatform}
        totalItemCount={answerAnalysisItems.length}
        totalBrandAssetEvidenceCount={totalBrandAssetEvidenceCount}
        analyzedRunCount={analyzedAnswerRunCount}
        totalRunCount={filteredAnswerRuns.length}
        projectId={project.id}
        selectedClusterIds={selectedClusterIds}
        selectedBatchIds={selectedBatchIds}
        selectedQueryIntentTypes={selectedQueryIntentTypes}
      />
    </>
  );
}

function AnswerAnalysisModule({
  platformTabs,
  activePlatformName,
  totalItemCount,
  totalBrandAssetEvidenceCount,
  analyzedRunCount,
  totalRunCount,
  projectId,
  selectedClusterIds,
  selectedBatchIds,
  selectedQueryIntentTypes
}: {
  platformTabs: DashboardAnswerAnalysisPlatformTab[];
  activePlatformName: string;
  totalItemCount: number;
  totalBrandAssetEvidenceCount: number;
  analyzedRunCount: number;
  totalRunCount: number;
  projectId: string;
  selectedClusterIds: string[];
  selectedBatchIds: string[];
  selectedQueryIntentTypes: string[];
}) {
  const activeTab = platformTabs.find((tab) => tab.platformName === activePlatformName) || platformTabs[0];
  const activeItems = activeTab?.items || [];
  const platformRates = buildAnswerEvidencePlatformRates(platformTabs, totalBrandAssetEvidenceCount);
  const action = (
    <div className="answer-analysis-head-actions">
      <div className="answer-analysis-platform-rates" aria-label="各平台答案命中品牌资产率">
        <div className="answer-analysis-rate-title">品牌资产命中率</div>
        <div className="answer-analysis-rate-list">
          {platformRates.length === 0 ? (
            <span className="hint">暂无平台数据</span>
          ) : (
            platformRates.map((rate) => (
              <div className="answer-analysis-rate-item" key={rate.platformName}>
                <span>{rate.platformName}</span>
                <strong>{rate.matchedEvidenceCount}/{rate.totalEvidenceCount}</strong>
                <span>{rate.totalEvidenceCount > 0 ? percentage(rate.rate) : "-"}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <AnswerEvidenceHitAnalysisAction
        projectId={projectId}
        selectedClusterIds={selectedClusterIds}
        selectedBatchIds={selectedBatchIds}
        selectedQueryIntentTypes={selectedQueryIntentTypes}
      />
    </div>
  );
  return (
    <Section title="答案分析" action={action}>
      <div className="hint">
        基于当前基础数据分析筛选范围内已完成回答分析的采样，提取品牌优点与品牌缺点解析。已分析 {analyzedRunCount} / {totalRunCount} 条答案，共 {totalItemCount} 条品牌优缺点解析。
      </div>
      {platformTabs.length === 0 ? (
        <div className="empty">
          <strong>暂无品牌优缺点解析</strong>
          <p>请先在采样页对采样执行回答分析，或调整当前筛选范围。</p>
        </div>
      ) : (
        <>
          <div className="tab-list answer-analysis-platform-tabs" role="tablist" aria-label="答案分析平台">
            {platformTabs.map((tab) => {
              const active = tab.platformName === activeTab.platformName;
              return (
                <Link
                  className={`tab-button ${active ? "tab-button-active" : ""}`}
                  href={tab.href}
                  key={tab.platformName}
                  role="tab"
                  aria-selected={active}
                  scroll={false}
                >
                  {tab.platformName}
                  <span className="answer-analysis-tab-count">{tab.items.length}</span>
                </Link>
              );
            })}
          </div>
          <div className="hint answer-analysis-platform-summary">
            当前平台：{activeTab.platformName}，{activeItems.length} 条品牌优缺点解析。
          </div>
          <table className="table answer-analysis-dashboard-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>Query</th>
                <th>优缺点解析</th>
                <th>是否命中内容资产的证据</th>
                <th>回答时间</th>
              </tr>
            </thead>
            <tbody>
              {activeItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Badge tone={item.tone}>{item.displayLabel}</Badge>
                  </td>
                  <td>{item.queryText}</td>
                  <td className="answer-analysis-dashboard-content">{item.content}</td>
                  <td className="answer-analysis-evidence-hit-cell">
                    <AnswerEvidenceHitDisplay item={item} />
                  </td>
                  <td>{new Date(item.runAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

function AnswerEvidenceHitDisplay({ item }: { item: DashboardAnswerAnalysisItem }) {
  if (item.label !== "提及品牌优点") {
    return (
      <div className="answer-analysis-evidence-hit">
        <div className="answer-analysis-evidence-status-row">
          <Badge tone="neutral">不处理</Badge>
          <span className="hint">仅品牌优点执行证据命中分析</span>
        </div>
      </div>
    );
  }
  if (!item.evidenceHit) {
    return (
      <div className="answer-analysis-evidence-hit">
        <div className="answer-analysis-evidence-status-row">
          <Badge tone="warn">未分析</Badge>
          <span className="hint">点击右上角“分析”后生成结果</span>
        </div>
      </div>
    );
  }
  if (!item.evidenceHit.matched) {
    return (
      <div className="answer-analysis-evidence-hit">
        <div className="answer-analysis-evidence-status-row">
          <Badge tone="info">已分析</Badge>
          <Badge tone="bad">未命中</Badge>
        </div>
        <div className="hint">分析时间：{new Date(item.evidenceHit.analyzedAt).toLocaleString("zh-CN")}</div>
        {item.evidenceHit.reason ? <div className="hint">{item.evidenceHit.reason}</div> : null}
      </div>
    );
  }
  return (
    <div className="answer-analysis-evidence-hit">
      <div className="answer-analysis-evidence-status-row">
        <Badge tone="info">已分析</Badge>
        <Badge tone="good">命中</Badge>
      </div>
      <div className="answer-analysis-evidence-title">{item.evidenceHit.evidenceTitle || "内容资产证据"}</div>
      <div className="answer-analysis-evidence-text">{item.evidenceHit.evidenceText}</div>
      {item.evidenceHit.evidenceLocationPath ? <div className="hint">{item.evidenceHit.evidenceLocationPath}</div> : null}
      <div className="hint">分析时间：{new Date(item.evidenceHit.analyzedAt).toLocaleString("zh-CN")}</div>
    </div>
  );
}

function ProfileAnalysisModule({
  title,
  analysis,
  description,
  action
}: {
  title: string;
  analysis: BrandProfileAnalysisResult;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <Section title={title} action={action}>
      {analysis.warning ? <div className="hint answer-analysis-error">{analysis.warning}</div> : null}
      <div className="hint">{description}</div>
      <pre className="report-tab-content reference-brand-profile-report">{analysis.report}</pre>
    </Section>
  );
}

function buildIdleProfileAnalysisResult(report: string): BrandProfileAnalysisResult {
  return {
    report,
    warning: "",
    reportCount: 0
  };
}

function buildDashboardAnswerAnalysisItems(
  answerRuns: Array<{
    id: string;
    runAt: Date;
    answerAnalysis?: string | null;
    engineConfig: { displayName: string };
    query: { queryText: string };
  }>,
  evidenceHitResultMap: Map<string, AnswerEvidenceHitResult>
) {
  return answerRuns.flatMap((run) => {
    const sections = parseAnswerAnalysisOutput(run.answerAnalysis || "");
    return sections.flatMap((section) => {
      if (!dashboardAnswerAnalysisLabels.has(section.label)) return [];
      if (section.status !== "是") return [];
      const config = answerAnalysisDisplayConfig(section.label);
      return section.timings.map((timing, index) => ({
        id: `${run.id}-${section.label}-${index}`,
        label: section.label,
        displayLabel: config.label,
        tone: config.tone,
        platformName: run.engineConfig.displayName,
        queryText: run.query.queryText,
        runAt: run.runAt,
        content: timing,
        evidenceHit: evidenceHitResultMap.get(answerEvidenceHitKey(run.id, section.label, timing)) || null
      }));
    });
  });
}

function buildDashboardAnswerAnalysisPlatformTabs(items: DashboardAnswerAnalysisItem[]) {
  const grouped = new Map<string, DashboardAnswerAnalysisItem[]>();
  for (const item of items) {
    const platformItems = grouped.get(item.platformName) || [];
    platformItems.push(item);
    grouped.set(item.platformName, platformItems);
  }
  return Array.from(grouped.entries()).map(([platformName, platformItems]) => ({
    platformName,
    items: platformItems,
    href: "/"
  }));
}

function buildAnswerEvidencePlatformRates(
  platformTabs: DashboardAnswerAnalysisPlatformTab[],
  totalEvidenceCount: number
): DashboardAnswerEvidencePlatformRate[] {
  return platformTabs.map((tab) => {
    const matchedEvidenceIds = new Set(
      tab.items
        .filter((item) => item.label === "提及品牌优点" && item.evidenceHit?.matched && item.evidenceHit.evidenceSubmoduleId)
        .map((item) => item.evidenceHit?.evidenceSubmoduleId || "")
        .filter(Boolean)
    );
    return {
      platformName: tab.platformName,
      matchedEvidenceCount: matchedEvidenceIds.size,
      totalEvidenceCount,
      rate: totalEvidenceCount > 0 ? matchedEvidenceIds.size / totalEvidenceCount : 0
    };
  });
}

function resolveAnswerAnalysisPlatform(tabs: Array<{ platformName: string }>, requestedPlatformName: string) {
  if (requestedPlatformName && tabs.some((tab) => tab.platformName === requestedPlatformName)) return requestedPlatformName;
  return tabs[0]?.platformName || "";
}

function countProjectEvidenceSubmodules(
  contentAssets: Array<{
    snapshots: Array<{
      evidenceModules: Array<{
        id: string;
        moduleType: string;
        title: string;
        body: string;
        locationPath: string;
        confidence: number;
      }>;
    }>;
  }>
) {
  return contentAssets.reduce(
    (sum, asset) =>
      sum +
      (asset.snapshots[0]?.evidenceModules.reduce((moduleSum, module) => moduleSum + buildEvidenceSubmodules(module).length, 0) || 0),
    0
  );
}

function answerAnalysisDisplayConfig(label: AnswerAnalysisLabel): { label: string; tone: "good" | "warn" | "info" | "bad" } {
  if (label === "提及品牌优点") return { label: "品牌优点", tone: "good" };
  if (label === "提及品牌缺点") return { label: "品牌缺点", tone: "warn" };
  if (label === "提及竞品优点") return { label: "竞品优点", tone: "info" };
  return { label: "竞品缺点", tone: "bad" };
}

function buildDashboardProfileAnalysisSources(
  answerRuns: Array<{
    runAt: Date;
    engineConfig: { displayName: string };
    sources: Array<Omit<BrandProfileAnalysisSource, "run">>;
  }>
): BrandProfileAnalysisSource[] {
  return answerRuns.flatMap((run) =>
    run.sources.map((source) => ({
      ...source,
      run: {
        runAt: run.runAt,
        engineConfig: {
          displayName: run.engineConfig.displayName
        }
      }
    }))
  );
}

function normalizeSingleSearchParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").trim();
}

function formatBasicAveragePositionValue(value: number) {
  const safe = Math.max(0, Math.min(1, value || 0));
  return `平均位于：${(safe * 100).toFixed(2)} %`;
}

function buildDashboardHref(params: {
  clusterIds?: string[];
  batchIds?: string[];
  queryIntentTypes?: string[];
  answerAnalysisPlatform?: string;
}) {
  const search = new URLSearchParams();
  for (const clusterId of params.clusterIds || []) {
    search.append("clusterIds", clusterId);
  }
  for (const batchId of params.batchIds || []) {
    search.append("batchIds", batchId);
  }
  for (const intentType of params.queryIntentTypes || []) {
    search.append("queryIntentTypes", intentType);
  }
  if (params.answerAnalysisPlatform) search.set("answerAnalysisPlatform", params.answerAnalysisPlatform);
  const query = search.toString();
  return query ? `/?${query}` : "/";
}

function mergeSearchParamValues(
  primary: string | string[] | undefined,
  secondary: string | string[] | undefined
) {
  const values: string[] = [];
  for (const value of [primary, secondary]) {
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === "string") values.push(value);
  }
  return values;
}

function summarizeSelectedBatches(batches: Array<{ id: string; label: string; clusterName: string }>, selectedIds: string[]) {
  if (selectedIds.length === 0) return "全部批次";
  const selected = new Set(selectedIds);
  return batches
    .filter((batch) => selected.has(batch.id))
    .map((batch) => `${batch.clusterName} / ${batch.label}`)
    .join("、") || selectedIds.join("、");
}

type QueryIntentFilterOption = {
  value: string;
  queryCount: number;
  runCount: number;
};

function buildQueryIntentFilterOptions(
  clusters: Array<{
    intentType: string;
    queries: Array<{ id: string; intentType: string }>;
  }>,
  answerRuns: Array<{
    query: { intentType: string };
  }>
): QueryIntentFilterOption[] {
  const optionMap = new Map<string, QueryIntentFilterOption>();
  for (const cluster of clusters) {
    ensureQueryIntentFilterOption(optionMap, cluster.intentType);
    for (const query of cluster.queries) {
      const option = ensureQueryIntentFilterOption(optionMap, query.intentType);
      option.queryCount += 1;
    }
  }
  for (const run of answerRuns) {
    const option = ensureQueryIntentFilterOption(optionMap, run.query.intentType);
    option.runCount += 1;
  }
  return [...optionMap.values()].sort((left, right) => left.value.localeCompare(right.value, "zh-CN"));
}

function ensureQueryIntentFilterOption(optionMap: Map<string, QueryIntentFilterOption>, rawIntentType: string) {
  const value = normalizeQueryIntentType(rawIntentType);
  const existing = optionMap.get(value);
  if (existing) return existing;
  const option = { value, queryCount: 0, runCount: 0 };
  optionMap.set(value, option);
  return option;
}

function normalizeQueryIntentType(value: string | null | undefined) {
  return String(value || "").trim() || "未设置意图";
}

function summarizeSelectedQueryIntents(options: QueryIntentFilterOption[], selectedValues: string[]) {
  if (selectedValues.length === 0) return "全部问题意图";
  const selected = new Set(selectedValues);
  return options
    .filter((option) => selected.has(option.value))
    .map((option) => option.value)
    .join("、") || selectedValues.join("、");
}

function summarizeBatchClusterNames(names: string[], fallback: string) {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  return uniqueNames.length > 0 ? uniqueNames.join("、") : fallback;
}
