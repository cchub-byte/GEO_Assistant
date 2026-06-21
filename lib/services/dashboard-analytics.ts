import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { clamp, containsAny, percentage, splitCsv } from "@/lib/utils";

export type CompetitorConfig = {
  id?: string;
  name: string;
  aliases?: string | null;
};

export type EngineConfig = {
  id: string;
  displayName: string;
};

export type AnswerTextRun = {
  id: string;
  answerText: string;
  samplingBatchId?: string | null;
  answerReferenceAnalysis?: string | null;
  referenceFeatureAnalysis?: string | null;
  competitorReferenceFeatureAnalysis?: string | null;
  engineConfig: EngineConfig;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    siteName: string | null;
    domain: string | null;
    fetchedUrl?: string | null;
    summary?: string | null;
    bodyText?: string | null;
    content?: string | null;
  }>;
  query: { clusterId: string; queryText: string };
};

export type BasicPlatformAnalytics = {
  platformId: string;
  platformName: string;
  totalQueryCount: number;
  referenceSourceCount: number;
  brandAppearCount: number;
  brandDomainHitCount: number;
  brandFirstPosition: number;
  brandCompetitiveFirstPosition: number;
  brandCompetitorCoAppearCount: number;
  brandBehindCompetitorCount: number;
  competitorRatios: Array<{ name: string; count: number }>;
  competitorFirstPositions: Array<{ name: string; averagePosition: number }>;
  topSources: Array<{ name: string; count: number }>;
};

export type SamplingBatchSummary = {
  id: string;
  clusterId: string;
  batchDate: string;
  sequence: number;
  createdAt: Date | string;
};

export type AdvancedFeatureItem = {
  id: string;
  queryText: string;
  content: string;
  targetName?: string;
};

export type AdvancedFeatureCountItem = {
  label: string;
  count: number;
  items: AdvancedFeatureItem[];
};

export type AdvancedReferenceSourceItem = {
  id: string;
  title: string;
  url: string;
  siteName: string;
};

export type AdvancedLinkedCountItem = {
  label: string;
  count: number;
  sources: AdvancedReferenceSourceItem[];
};

export type AdvancedPlatformAnalytics = {
  platformId: string;
  platformName: string;
  answerAdvantageSites: AdvancedLinkedCountItem[];
  answerDisadvantageSites: AdvancedLinkedCountItem[];
  referenceAdvantages: AdvancedFeatureItem[];
  referenceDisadvantages: AdvancedFeatureItem[];
  competitorReferenceAdvantages: AdvancedFeatureItem[];
  competitorReferenceDisadvantages: AdvancedFeatureItem[];
  competitorReferenceAdvantageCounts: AdvancedFeatureCountItem[];
  competitorReferenceDisadvantageCounts: AdvancedFeatureCountItem[];
  referenceMentionNames: AdvancedLinkedCountItem[];
};

export type BrandAssetHitSummary = {
  runId: string;
  matched: boolean;
  evidenceSubmoduleId: string | null;
};

export type ClusterOverviewAnalytics = {
  clusterId: string;
  averageBrandFirstPosition: number;
  brandAssetHitRate: number;
  stabilityScore: number;
};

export function normalizeSelectedIds(value: string | string[] | undefined, validIds: Set<string>) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw.map((item) => String(item || "").trim()).filter((item) => item && validIds.has(item));
}

export function summarizeSelectedClusters(clusters: Array<{ id: string; name: string }>, selectedIds: string[]) {
  if (selectedIds.length === 0) return "全部 Query集";
  const selected = new Set(selectedIds);
  const names = clusters.filter((cluster) => selected.has(cluster.id)).map((cluster) => cluster.name);
  return names.length === 0 ? "全部 Query集" : names.join("、");
}

export function buildCurrentBrandTerms(brand?: { brandNames?: string | null; aliases?: string | null } | null) {
  return uniqueTerms([...splitCsv(brand?.brandNames), ...splitCsv(brand?.aliases)]);
}

export function buildBrandWebTargets(brand?: { brandUrls?: string | null } | null) {
  return uniqueTerms(splitCsv(brand?.brandUrls));
}

export function buildCompetitorTerms(competitors: Array<{ name: string; aliases?: string | null }>) {
  return uniqueTerms(competitors.flatMap((competitor) => [competitor.name, ...splitCsv(competitor.aliases)]));
}

export function calculateLatestBatchSourceSelectionRate(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  batches: SamplingBatchSummary[],
  brandWebTargets: string[]
) {
  const latestRunsWithQuery = filterLatestRunsWithQuery(runs, batches);
  if (latestRunsWithQuery.length === 0) return 0;
  const platformAnalytics = buildBasicAnalytics(engines, latestRunsWithQuery, [], [], brandWebTargets);
  const platformRates = platformAnalytics
    .filter((item) => item.totalQueryCount > 0)
    .map((item) => (item.referenceSourceCount === 0 ? 0 : item.brandDomainHitCount / item.referenceSourceCount));

  if (platformRates.length === 0) return 0;
  return platformRates.reduce((sum, rate) => sum + rate, 0) / platformRates.length;
}

export function calculateLatestBatchCompetitorSubstitutionRate(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  batches: SamplingBatchSummary[],
  brandTermList: string[]
) {
  const latestRunsWithQuery = filterLatestRunsWithQuery(runs, batches);
  if (latestRunsWithQuery.length === 0) return 0;
  const platformAnalytics = buildBasicAnalytics(engines, latestRunsWithQuery, brandTermList, []);
  const platformBrandAppearRates = platformAnalytics
    .filter((item) => item.totalQueryCount > 0)
    .map((item) => item.brandAppearCount / item.totalQueryCount);

  if (platformBrandAppearRates.length === 0) return 0;
  const averageBrandAppearRate =
    platformBrandAppearRates.reduce((sum, rate) => sum + rate, 0) / platformBrandAppearRates.length;
  return Math.max(0, Math.min(1, 1 - averageBrandAppearRate));
}

export function calculateLatestBatchAverageBrandFirstPosition(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  batches: SamplingBatchSummary[],
  brandTermList: string[]
) {
  const latestRuns = filterLatestRunsWithQuery(runs, batches);
  const runsByCluster = new Map<string, AnswerTextRun[]>();
  for (const run of latestRuns) {
    const clusterRuns = runsByCluster.get(run.query.clusterId) || [];
    clusterRuns.push(run);
    runsByCluster.set(run.query.clusterId, clusterRuns);
  }

  const clusterPositions = [...runsByCluster.values()].map((clusterRuns) =>
    calculateBasicAnalyticsBrandFirstPositionByPlatform(engines, clusterRuns, brandTermList)
  );
  if (clusterPositions.length === 0) return 0;
  return clamp(clusterPositions.reduce((sum, position) => sum + position, 0) / clusterPositions.length);
}

export function calculateLatestBatchBrandAssetHitRate(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  batches: SamplingBatchSummary[],
  brandAssetHits: BrandAssetHitSummary[],
  totalEvidenceCount: number
) {
  return calculateAverageBrandAssetHitRateByPlatform(
    engines,
    filterLatestRunsWithQuery(runs, batches),
    brandAssetHits,
    totalEvidenceCount
  );
}

export function buildClusterOverviewAnalytics(
  clusters: Array<{ id: string }>,
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  batches: SamplingBatchSummary[],
  brandTermList: string[],
  brandAssetHits: BrandAssetHitSummary[],
  totalEvidenceCount: number
): ClusterOverviewAnalytics[] {
  const latestRuns = filterLatestRunsWithQuery(runs, batches);
  return clusters.map((cluster) => {
    const clusterRuns = runs.filter((run) => run.query.clusterId === cluster.id && run.query.queryText.trim().length > 0);
    const currentRuns = latestRuns.filter((run) => run.query.clusterId === cluster.id);
    return {
      clusterId: cluster.id,
      averageBrandFirstPosition: calculateBasicAnalyticsBrandFirstPositionByPlatform(engines, clusterRuns, brandTermList),
      brandAssetHitRate: calculateAverageBrandAssetHitRateByPlatform(engines, currentRuns, brandAssetHits, totalEvidenceCount),
      stabilityScore: calculateClusterOverviewStability(engines, runs, batches, cluster.id, brandTermList, brandAssetHits, totalEvidenceCount)
    };
  });
}

export function buildBasicAnalytics(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  brandTermList: string[],
  competitors: CompetitorConfig[],
  brandWebTargets: string[] = []
): BasicPlatformAnalytics[] {
  const parsedBrandWebTargets = parseBrandWebTargets(brandWebTargets);
  const platformMap = new Map(
    engines.map((engine) => [
      engine.id,
      {
        platformId: engine.id,
        platformName: engine.displayName,
        totalQueryCount: 0,
        referenceSourceCount: 0,
        brandAppearCount: 0,
        brandDomainHitCount: 0,
        brandFirstPositionSum: 0,
        brandCompetitiveFirstPositionSum: 0,
        brandCompetitiveFirstPositionCount: 0,
        brandBehindCompetitorCount: 0,
        competitorFirstPositionSums: new Map<string, number>(),
        competitorAppearCounts: new Map<string, number>(),
        sourceCounts: new Map<string, number>()
      }
    ])
  );

  for (const run of runs) {
    const current = platformMap.get(run.engineConfig.id);
    if (!current) continue;
    current.totalQueryCount += 1;
    current.referenceSourceCount += run.sources.length;

    const lines = run.answerText.split(/\r?\n/);
    const brandFirstLine = findFirstLineNumberInLines(lines, brandTermList);
    if (brandFirstLine != null && lines.length > 0) {
      current.brandFirstPositionSum += brandFirstLine / lines.length;
    }

    if (brandTermList.length > 0 && containsAny(run.answerText, brandTermList)) {
      current.brandAppearCount += 1;
    }

    const competitorFirstLines: number[] = [];
    for (const competitor of competitors) {
      const competitorTerms = [competitor.name, ...splitCsv(competitor.aliases)];
      const competitorFirstLine = findFirstLineNumberInLines(lines, competitorTerms);
      if (competitorFirstLine != null && lines.length > 0) {
        competitorFirstLines.push(competitorFirstLine);
        current.competitorFirstPositionSums.set(
          competitor.name,
          (current.competitorFirstPositionSums.get(competitor.name) || 0) + competitorFirstLine / lines.length
        );
      }

      if (competitorFirstLine != null) {
        current.competitorAppearCounts.set(competitor.name, (current.competitorAppearCounts.get(competitor.name) || 0) + 1);
      }
    }

    if (
      brandFirstLine != null &&
      competitorFirstLines.length > 0 &&
      competitorFirstLines.some((line) => line < brandFirstLine)
    ) {
      current.brandBehindCompetitorCount += 1;
    }

    if (brandFirstLine != null && competitorFirstLines.length > 0 && lines.length > 0) {
      current.brandCompetitiveFirstPositionSum += brandFirstLine / lines.length;
      current.brandCompetitiveFirstPositionCount += 1;
    }

    for (const source of run.sources) {
      if (parsedBrandWebTargets.length > 0 && isBrandWebTargetHit(source, parsedBrandWebTargets)) {
        current.brandDomainHitCount += 1;
      }

      const sourceName = (source.siteName || source.domain || "未知来源").trim();
      current.sourceCounts.set(sourceName, (current.sourceCounts.get(sourceName) || 0) + 1);
    }
  }

  return [...platformMap.values()]
    .map((item) => ({
      platformId: item.platformId,
      platformName: item.platformName,
      totalQueryCount: item.totalQueryCount,
      referenceSourceCount: item.referenceSourceCount,
      brandAppearCount: item.brandAppearCount,
      brandDomainHitCount: item.brandDomainHitCount,
      brandFirstPosition: item.totalQueryCount === 0 ? 0 : item.brandFirstPositionSum / item.totalQueryCount,
      brandCompetitiveFirstPosition: item.brandCompetitiveFirstPositionCount === 0
        ? 0
        : item.brandCompetitiveFirstPositionSum / item.brandCompetitiveFirstPositionCount,
      brandCompetitorCoAppearCount: item.brandCompetitiveFirstPositionCount,
      brandBehindCompetitorCount: item.brandBehindCompetitorCount,
      competitorRatios: competitors.map((competitor) => ({
        name: competitor.name,
        count: item.competitorAppearCounts.get(competitor.name) || 0
      })),
      competitorFirstPositions: competitors.map((competitor) => ({
        name: competitor.name,
        averagePosition: item.totalQueryCount === 0
          ? 0
          : (item.competitorFirstPositionSums.get(competitor.name) || 0) / item.totalQueryCount
      })),
      topSources: [...item.sourceCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))
    }))
    .sort((left, right) => left.platformName.localeCompare(right.platformName));
}

function selectLatestBatchIdByRunCluster(runs: AnswerTextRun[], batches: SamplingBatchSummary[]) {
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const latestByCluster = new Map<string, SamplingBatchSummary>();
  for (const run of runs) {
    if (!run.samplingBatchId) continue;
    const batch = batchById.get(run.samplingBatchId);
    if (!batch) continue;

    const current = latestByCluster.get(run.query.clusterId);
    if (!current || compareSamplingBatches(batch, current) > 0) {
      latestByCluster.set(run.query.clusterId, batch);
    }
  }
  return new Map([...latestByCluster.entries()].map(([clusterId, batch]) => [clusterId, batch.id]));
}

function filterLatestRunsWithQuery(runs: AnswerTextRun[], batches: SamplingBatchSummary[]) {
  const latestBatchIdByCluster = selectLatestBatchIdByRunCluster(runs, batches);
  if (latestBatchIdByCluster.size === 0) return [];
  return runs.filter(
    (run) =>
      run.samplingBatchId &&
      latestBatchIdByCluster.get(run.query.clusterId) === run.samplingBatchId &&
      run.query.queryText.trim().length > 0
  );
}

function compareSamplingBatches(left: SamplingBatchSummary, right: SamplingBatchSummary) {
  const dateCompare = left.batchDate.localeCompare(right.batchDate);
  if (dateCompare !== 0) return dateCompare;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function calculateBasicAnalyticsBrandFirstPositionByPlatform(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  brandTermList: string[]
) {
  const platformAnalytics = buildBasicAnalytics(engines, runs, brandTermList, []);
  const platformPositions = platformAnalytics
    .filter((item) => item.totalQueryCount > 0)
    .map((item) => item.brandFirstPosition);
  if (platformPositions.length === 0) return 0;
  return clamp(platformPositions.reduce((sum, position) => sum + position, 0) / platformPositions.length);
}

function calculateAverageBrandAssetHitRateByPlatform(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  brandAssetHits: BrandAssetHitSummary[],
  totalEvidenceCount: number
) {
  if (runs.length === 0 || totalEvidenceCount <= 0) return 0;
  const matchedEvidenceIdsByRunId = buildMatchedEvidenceIdsByRunId(brandAssetHits);
  const platformRates = engines.flatMap((engine) => {
    const platformRunIds = runs.filter((run) => run.engineConfig.id === engine.id).map((run) => run.id);
    if (platformRunIds.length === 0) return [];
    const matchedEvidenceIds = new Set<string>();
    for (const runId of platformRunIds) {
      for (const evidenceId of matchedEvidenceIdsByRunId.get(runId) || []) {
        matchedEvidenceIds.add(evidenceId);
      }
    }
    return [clamp(matchedEvidenceIds.size / totalEvidenceCount)];
  });
  if (platformRates.length === 0) return 0;
  return clamp(platformRates.reduce((sum, rate) => sum + rate, 0) / platformRates.length);
}

function buildMatchedEvidenceIdsByRunId(brandAssetHits: BrandAssetHitSummary[]) {
  const byRunId = new Map<string, Set<string>>();
  for (const hit of brandAssetHits) {
    if (!hit.matched || !hit.evidenceSubmoduleId) continue;
    const current = byRunId.get(hit.runId) || new Set<string>();
    current.add(hit.evidenceSubmoduleId);
    byRunId.set(hit.runId, current);
  }
  return byRunId;
}

function calculateClusterOverviewStability(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  batches: SamplingBatchSummary[],
  clusterId: string,
  brandTermList: string[],
  brandAssetHits: BrandAssetHitSummary[],
  totalEvidenceCount: number
) {
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const groupedRuns = new Map<string, AnswerTextRun[]>();
  for (const run of runs) {
    if (run.query.clusterId !== clusterId || !run.samplingBatchId || run.query.queryText.trim().length === 0) continue;
    if (!batchById.has(run.samplingBatchId)) continue;
    const batchRuns = groupedRuns.get(run.samplingBatchId) || [];
    batchRuns.push(run);
    groupedRuns.set(run.samplingBatchId, batchRuns);
  }

  const batchScores = [...groupedRuns.entries()]
    .sort(([leftId], [rightId]) => compareSamplingBatches(batchById.get(leftId)!, batchById.get(rightId)!))
    .map(([, batchRuns]) => {
      const position = calculateBasicAnalyticsBrandFirstPositionByPlatform(engines, batchRuns, brandTermList);
      const assetHitRate = calculateAverageBrandAssetHitRateByPlatform(engines, batchRuns, brandAssetHits, totalEvidenceCount);
      return (position + assetHitRate) / 2;
    });

  if (batchScores.length === 0) return 0;
  if (batchScores.length === 1) return 1;

  let deltaSum = 0;
  for (let index = 1; index < batchScores.length; index += 1) {
    deltaSum += Math.abs(batchScores[index] - batchScores[index - 1]);
  }
  return clamp(1 - deltaSum / (batchScores.length - 1));
}

export function buildAdvancedAnalytics(
  engines: EngineConfig[],
  runs: AnswerTextRun[],
  brandTermList: string[],
  competitors: CompetitorConfig[]
): AdvancedPlatformAnalytics[] {
  const competitorTermList = buildCompetitorTerms(competitors);
  const platformMap = new Map(
    engines.map((engine) => [
      engine.id,
      {
        platformId: engine.id,
        platformName: engine.displayName,
        answerAdvantageSites: new Map<string, { sources: Map<string, AdvancedReferenceSourceItem> }>(),
        answerDisadvantageSites: new Map<string, { sources: Map<string, AdvancedReferenceSourceItem> }>(),
        referenceAdvantages: [] as AdvancedFeatureItem[],
        referenceDisadvantages: [] as AdvancedFeatureItem[],
        competitorReferenceAdvantages: [] as AdvancedFeatureItem[],
        competitorReferenceDisadvantages: [] as AdvancedFeatureItem[],
        referenceMentionNameCounts: new Map<string, { sources: Map<string, AdvancedReferenceSourceItem> }>()
      }
    ])
  );

  for (const run of runs) {
    const current = platformMap.get(run.engineConfig.id);
    if (!current) continue;

    const answerSources = parseAnswerReferenceAnalysis(run.answerReferenceAnalysis || "");
    for (const site of answerSources.advantages) {
      incrementAnswerReferenceSiteCount(current.answerAdvantageSites, site, collectSourcesForSite(run, site));
    }
    for (const site of answerSources.disadvantages) {
      incrementAnswerReferenceSiteCount(current.answerDisadvantageSites, site, collectSourcesForSite(run, site));
    }

    const referenceFeatures = parseReferenceFeatureAnalysis(run.referenceFeatureAnalysis || "", run);
    current.referenceAdvantages.push(...referenceFeatures.advantages);
    current.referenceDisadvantages.push(...referenceFeatures.disadvantages);

    const competitorReferenceFeatures = parseCompetitorReferenceFeatureAnalysis(
      run.competitorReferenceFeatureAnalysis || "",
      run,
      competitors
    );
    current.competitorReferenceAdvantages.push(...competitorReferenceFeatures.advantages);
    current.competitorReferenceDisadvantages.push(...competitorReferenceFeatures.disadvantages);

    for (const name of parseReferenceMentionNameCounts(run.referenceFeatureAnalysis || "").keys()) {
      const mentionEntry = current.referenceMentionNameCounts.get(name) || {
        sources: new Map<string, AdvancedReferenceSourceItem>()
      };
      for (const source of collectSourcesMentioningName(run, name)) {
        mentionEntry.sources.set(source.id, source);
      }
      current.referenceMentionNameCounts.set(name, mentionEntry);
    }

  }

  return [...platformMap.values()]
    .map((item) => ({
      platformId: item.platformId,
      platformName: item.platformName,
      answerAdvantageSites: formatCountItems(item.answerAdvantageSites),
      answerDisadvantageSites: formatCountItems(item.answerDisadvantageSites),
      referenceAdvantages: item.referenceAdvantages,
      referenceDisadvantages: item.referenceDisadvantages,
      competitorReferenceAdvantages: item.competitorReferenceAdvantages,
      competitorReferenceDisadvantages: item.competitorReferenceDisadvantages,
      competitorReferenceAdvantageCounts: formatFeatureCountItems(item.competitorReferenceAdvantages),
      competitorReferenceDisadvantageCounts: formatFeatureCountItems(item.competitorReferenceDisadvantages),
      referenceMentionNames: formatReferenceMentionNameItems(item.referenceMentionNameCounts)
    }))
    .sort((left, right) => left.platformName.localeCompare(right.platformName));
}

export function formatRatio(hitCount: number, queryCount: number) {
  if (queryCount === 0) return "0/0 (0%)";
  return `${hitCount}/${queryCount} (${percentage(hitCount / queryCount)})`;
}

export function formatAverageBrandFirstPosition(brandFirstPosition: number, queryCount: number) {
  if (queryCount === 0) return "平均位于：0.00 %";
  return `平均位于：${(brandFirstPosition * 100).toFixed(2)} %`;
}

export function formatAveragePosition(position: number, queryCount: number) {
  if (queryCount === 0) return "0.00 %";
  return `${(position * 100).toFixed(2)} %`;
}

function incrementAnswerReferenceSiteCount(
  counts: Map<string, { sources: Map<string, AdvancedReferenceSourceItem> }>,
  siteName: string,
  sources: AdvancedReferenceSourceItem[]
) {
  const current = counts.get(siteName) || {
    sources: new Map<string, AdvancedReferenceSourceItem>()
  };
  for (const source of sources) {
    current.sources.set(source.id, source);
  }
  counts.set(siteName, current);
}

function formatCountItems(counts: Map<string, { sources: Map<string, AdvancedReferenceSourceItem> }>) {
  return [...counts.entries()]
    .map(([label, item]) => {
      const sources = sortAdvancedReferenceSources([...item.sources.values()]);
      return { label, count: sources.length, sources };
    })
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function buildAdvancedReferenceSource(source: {
  id: string;
  title: string;
  url: string;
  siteName: string | null;
  domain: string | null;
}): AdvancedReferenceSourceItem {
  return {
    id: source.id,
    title: source.title || "未命名引用",
    url: normalizeStoredReferenceUrl(source.url || ""),
    siteName: source.siteName || source.domain || "未知来源"
  };
}

function normalizeStoredReferenceUrl(url: string) {
  return normalizeReferenceSourceUrl(url) || url;
}

function formatReferenceMentionNameItems(counts: Map<string, { sources: Map<string, AdvancedReferenceSourceItem> }>) {
  return [...counts.entries()]
    .map(([label, item]) => {
      const sources = sortAdvancedReferenceSources([...item.sources.values()]);
      return { label, count: sources.length, sources };
    })
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function formatFeatureCountItems(items: AdvancedFeatureItem[]) {
  const byTarget = new Map<string, AdvancedFeatureItem[]>();
  for (const item of items) {
    const targetName = item.targetName?.trim();
    if (!targetName) continue;
    const current = byTarget.get(targetName) || [];
    current.push(item);
    byTarget.set(targetName, current);
  }
  return [...byTarget.entries()]
    .map(([label, groupItems]) => ({ label, count: groupItems.length, items: groupItems }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function sortAdvancedReferenceSources(sources: AdvancedReferenceSourceItem[]) {
  return sources.sort((left, right) => left.siteName.localeCompare(right.siteName) || left.title.localeCompare(right.title));
}

function collectSourcesForSite(run: AnswerTextRun, siteName: string) {
  const normalizedSiteName = normalizeSiteName(siteName);
  const targetDomains = extractSiteDomains(siteName);
  if (!normalizedSiteName && targetDomains.size === 0) return [] as AdvancedReferenceSourceItem[];
  return run.sources
    .filter((source) => {
      const sourceSiteName = normalizeSiteName(source.siteName || source.domain || "未知来源");
      if (sourceSiteName === normalizedSiteName) return true;
      return hasMatchingSiteDomain(targetDomains, source);
    })
    .map(buildAdvancedReferenceSource);
}

function normalizeSiteName(siteName: string) {
  return siteName.trim().toLocaleLowerCase();
}

function hasMatchingSiteDomain(targetDomains: Set<string>, source: AnswerTextRun["sources"][number]) {
  if (targetDomains.size === 0) return false;
  const sourceDomains = new Set<string>([
    ...extractSiteDomains(source.siteName || ""),
    ...extractSiteDomains(source.domain || ""),
    ...extractSiteDomains(source.url || "")
  ]);
  for (const targetDomain of targetDomains) {
    for (const sourceDomain of sourceDomains) {
      if (targetDomain === sourceDomain || rootDomain(targetDomain) === rootDomain(sourceDomain)) return true;
    }
  }
  return false;
}

function extractSiteDomains(value: string) {
  const domains = new Set<string>();
  const candidates = [
    ...value.matchAll(/https?:\/\/[^\s\]\[)）"'<>]+/gi),
    ...value.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\.[a-z]{2,})?\b/gi)
  ];

  for (const match of candidates) {
    const domain = normalizeDomainCandidate(match[0]);
    if (domain) domains.add(domain);
  }

  const directDomain = normalizeDomainCandidate(value);
  if (directDomain) domains.add(directDomain);
  return domains;
}

function normalizeDomainCandidate(value: string) {
  const trimmed = value.trim().toLocaleLowerCase().replace(/[，。；;、,.)）\]]+$/g, "");
  if (!trimmed) return "";
  try {
    return new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    const withoutProtocol = trimmed.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\.[a-z]{2,})?$/.test(withoutProtocol)) return "";
    return withoutProtocol;
  }
}

type ParsedBrandWebTarget = {
  raw: string;
  host: string;
  pathPrefix: string | null;
};

type ParsedSourceWebTarget = {
  host: string;
  path: string;
};

function parseBrandWebTargets(entries: string[]) {
  return entries
    .map(parseBrandWebTarget)
    .filter((target): target is ParsedBrandWebTarget => Boolean(target));
}

function parseBrandWebTarget(entry: string): ParsedBrandWebTarget | null {
  const trimmed = trimUrlLikeValue(entry);
  if (!trimmed) return null;
  const parsed = parseUrlLikeValue(trimmed);
  if (!parsed) return null;

  const host = normalizeHost(parsed.hostname);
  if (!host) return null;

  const pathPrefix = normalizePathPrefix(parsed.pathname);
  const bareHostEntry = !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !/[/?#]/.test(trimmed);
  return {
    raw: trimmed,
    host,
    pathPrefix: bareHostEntry || pathPrefix === "/" ? null : pathPrefix
  };
}

function isBrandWebTargetHit(source: AnswerTextRun["sources"][number], targets: ParsedBrandWebTarget[]) {
  const candidates = buildSourceWebTargets(source);
  return targets.some((target) =>
    candidates.some((candidate) => {
      if (!isHostMatch(candidate.host, target.host)) return false;
      if (!target.pathPrefix) return true;
      return isPathPrefixMatch(candidate.path, target.pathPrefix);
    })
  );
}

function buildSourceWebTargets(source: AnswerTextRun["sources"][number]) {
  const values = [source.url, source.fetchedUrl || "", source.domain || ""];
  const parsedTargets = new Map<string, ParsedSourceWebTarget>();
  for (const value of values) {
    const normalizedValue = normalizeReferenceSourceUrl(value || "") || value || "";
    const parsed = parseUrlLikeValue(normalizedValue);
    if (!parsed) continue;
    const host = normalizeHost(parsed.hostname);
    if (!host) continue;
    const target = { host, path: normalizePathPrefix(parsed.pathname) };
    parsedTargets.set(`${target.host}${target.path}`, target);
  }
  return [...parsedTargets.values()];
}

function parseUrlLikeValue(value: string) {
  const trimmed = trimUrlLikeValue(value);
  if (!trimmed) return null;
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  try {
    return new URL(hasProtocol ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function normalizeHost(hostname: string) {
  return hostname.trim().toLocaleLowerCase().replace(/^www\./, "");
}

function normalizePathPrefix(pathname: string) {
  const path = `/${pathname || ""}`.replace(/\/+/g, "/");
  const withoutTrailingSlash = path.length > 1 ? path.replace(/\/+$/g, "") : path;
  return withoutTrailingSlash || "/";
}

function isHostMatch(sourceHost: string, targetHost: string) {
  return sourceHost === targetHost || sourceHost.endsWith(`.${targetHost}`);
}

function isPathPrefixMatch(sourcePath: string, targetPath: string) {
  if (targetPath === "/") return true;
  return sourcePath === targetPath || sourcePath.startsWith(`${targetPath}/`);
}

function trimUrlLikeValue(value: string) {
  return value.trim().replace(/[，。；;、,.)）\]]+$/g, "");
}

function rootDomain(domain: string) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return domain;
  const lastTwo = parts.slice(-2).join(".");
  if (parts.length >= 3 && /^(com|net|org|gov|edu)\.cn$/.test(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function collectSourcesMentioningName(run: AnswerTextRun, name: string) {
  const normalizedName = name.trim().toLocaleLowerCase();
  if (!normalizedName) return [] as AdvancedReferenceSourceItem[];
  return run.sources
    .filter((source) =>
      `${source.title || ""} ${source.siteName || ""} ${source.summary || ""} ${source.bodyText || ""} ${source.content || ""}`
        .toLocaleLowerCase()
        .includes(normalizedName)
    )
    .map(buildAdvancedReferenceSource);
}

function parseAnswerReferenceAnalysis(report: string) {
  const advantages: string[] = [];
  const disadvantages: string[] = [];

  for (const line of splitReportLines(report)) {
    const match = line.match(/^\s*\[([^\]]+)\]\[(优势|劣势)\]/);
    if (!match) continue;
    const siteName = match[1].trim();
    if (!siteName || siteName === "站点名称") continue;
    if (match[2] === "优势") {
      advantages.push(siteName);
    } else {
      disadvantages.push(siteName);
    }
  }

  return { advantages, disadvantages };
}

function parseReferenceFeatureAnalysis(report: string, run: AnswerTextRun) {
  const advantages: AdvancedFeatureItem[] = [];
  const disadvantages: AdvancedFeatureItem[] = [];

  splitReferenceFeatureItems(report).forEach((line, index) => {
    const explicitTypeMatch = line.match(/^\s*(?:[-*•]|\d+[.、])?\s*\[[^\]]+\]\[(优势|劣势)\](.+)$/);
    const featureType = explicitTypeMatch?.[1] || classifyLegacyReferenceFeature(line);
    if (!featureType) return;

    const item = {
      id: `${run.id}-${featureType}-${index}`,
      queryText: run.query.queryText,
      content: line
    };
    if (featureType === "优势") {
      advantages.push(item);
    } else {
      disadvantages.push(item);
    }
  });

  return { advantages, disadvantages };
}

function parseCompetitorReferenceFeatureAnalysis(report: string, run: AnswerTextRun, competitors: CompetitorConfig[]) {
  const advantages: AdvancedFeatureItem[] = [];
  const disadvantages: AdvancedFeatureItem[] = [];
  const competitorNameByTerm = buildCompetitorNameByTerm(competitors);

  splitReferenceFeatureItems(report).forEach((line, index) => {
    const explicitTypeMatch = line.match(/^\s*(?:[-*•]|\d+[.、])?\s*\[(竞品名|别名)[:：]([^\]]+)\]\[(优势|劣势)\](.+)$/);
    if (!explicitTypeMatch) return;

    const matchedTerm = explicitTypeMatch[2].trim();
    const featureType = explicitTypeMatch[3];
    const targetName = competitorNameByTerm.get(matchedTerm.toLocaleLowerCase()) || matchedTerm;
    if (!targetName) return;

    const item = {
      id: `${run.id}-competitor-${targetName}-${featureType}-${index}`,
      queryText: run.query.queryText,
      content: line,
      targetName
    };
    if (featureType === "优势") {
      advantages.push(item);
    } else {
      disadvantages.push(item);
    }
  });

  return { advantages, disadvantages };
}

function buildCompetitorNameByTerm(competitors: CompetitorConfig[]) {
  const termMap = new Map<string, string>();
  for (const competitor of competitors) {
    const canonicalName = competitor.name.trim();
    if (!canonicalName) continue;
    for (const term of [canonicalName, ...splitCsv(competitor.aliases)]) {
      const normalizedTerm = term.trim().toLocaleLowerCase();
      if (normalizedTerm && !termMap.has(normalizedTerm)) {
        termMap.set(normalizedTerm, canonicalName);
      }
    }
  }
  return termMap;
}

function parseReferenceMentionNameCounts(report: string) {
  const counts = new Map<string, number>();

  for (const line of splitReferenceFeatureItems(report)) {
    const explicitMatches = [...line.matchAll(/\[(?:品牌名|别名)[:：]([^\]]+)\]/g)];
    if (explicitMatches.length > 0) {
      for (const match of explicitMatches) {
        addReferenceMentionNameCount(counts, match[1]);
      }
      continue;
    }

    const legacyMatch = line.match(/^\s*(?:[-*•]|\d+[.、])?\s*\[([^\]]+)\]\[(?:优势|劣势)\]/);
    if (legacyMatch) {
      addReferenceMentionNameCount(counts, legacyMatch[1]);
    }
  }

  return counts;
}

function addReferenceMentionNameCount(counts: Map<string, number>, rawName: string) {
  const name = rawName.trim();
  if (!name || name === "品牌名" || name === "别名" || name === "实际命中词") return;
  counts.set(name, (counts.get(name) || 0) + 1);
}

function splitReferenceFeatureItems(report: string) {
  return splitReportLines(report).flatMap((line) => {
    if (isReportHeadingLine(line)) return [];
    return line
      .split(/[、,，；;]\s*(?=\[[^\]]+\])/)
      .map((item) => item.trim())
      .filter((item) => item && !isReportHeadingLine(item));
  });
}

function splitReportLines(report: string) {
  return report
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isReportHeadingLine(line: string) {
  return /^【[^】]+】$/.test(line) || /^引用条目中涉及到的品牌特点[:：]?$/.test(line) || line === "暂无";
}

function classifyLegacyReferenceFeature(line: string): "优势" | "劣势" | "" {
  if (/\[劣势\]|劣势|不足|短板|缺乏|缺少|不支持|限制|风险|问题|门槛|复杂|较高|成本高|价格高|昂贵|慢|较弱|薄弱|有限|不够|依赖|无法/.test(line)) {
    return "劣势";
  }
  if (/\[优势\]|优势|支持|适合|提供|提升|提高|降低|优化|自动|便捷|灵活|高效|易用|安全|稳定|免费|集成|全面|丰富|强|领先|可视化|节省|覆盖|能力|特点/.test(line)) {
    return "优势";
  }
  return "";
}

function uniqueTerms(terms: string[]) {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findFirstLineNumberInLines(lines: string[], terms: string[]) {
  const normalizedTerms = terms
    .map((term) => term.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (normalizedTerms.length === 0 || lines.length === 0) return null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].toLocaleLowerCase();
    if (normalizedTerms.some((term) => line.includes(term))) {
      return index + 1;
    }
  }
  return null;
}
