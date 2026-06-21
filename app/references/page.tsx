import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Empty, Section } from "@/components/ui";
import { ReferenceResultsTable, type ReferenceResultsGroup } from "./reference-results-table";
import { prisma } from "@/lib/db";
import type { BrandProfileAnalysisResult } from "@/lib/services/brand-profile-analysis";
import {
  buildProfileAnalysisContextKey,
  getProfileAnalysisArchive
} from "@/lib/services/profile-analysis-archive";
import { buildCompetitorTerms, buildCurrentBrandTerms } from "@/lib/services/dashboard-analytics";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { getDefaultProjectId } from "@/lib/services/read";

export const dynamic = "force-dynamic";

type ReferencesSearchParams = {
  clusterId?: string | string[];
  queryId?: string | string[];
  keyword?: string | string[];
  mentionFilter?: string | string[];
  sortPlatform?: string | string[];
};

type MentionFilter = "" | "brand" | "competitor" | "both";

const mentionFilterValues = new Set<MentionFilter>(["", "brand", "competitor", "both"]);

type ReferenceSourceRecord = Prisma.SourceGetPayload<{
  include: {
    run: {
      include: {
        query: { include: { cluster: true } };
        engineConfig: true;
      };
    };
  };
}>;

type ReferenceSourceGroup = {
  key: string;
  url: string;
  title: string;
  sourceType: string;
  siteName: string;
  domain: string;
  items: ReferenceSourceRecord[];
};

export default async function ReferencesPage({
  searchParams
}: {
  searchParams: Promise<ReferencesSearchParams>;
}) {
  const projectId = await getDefaultProjectId();
  if (!projectId) return <Empty title="没有采样项目" body="请先运行 seed。" />;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) return <Empty title="没有采样项目" body="请先运行 seed。" />;

  const resolvedSearchParams = await Promise.resolve(searchParams || {});
  const requestedClusterId = normalizeSingleSearchParam(resolvedSearchParams.clusterId);
  const requestedQueryId = normalizeSingleSearchParam(resolvedSearchParams.queryId);
  const keyword = normalizeSingleSearchParam(resolvedSearchParams.keyword);
  const mentionFilter = normalizeMentionFilter(normalizeSingleSearchParam(resolvedSearchParams.mentionFilter));
  const requestedSortPlatform = normalizeSingleSearchParam(resolvedSearchParams.sortPlatform);
  const keywordTerms = splitSearchKeywords(keyword);
  const brandTerms = buildCurrentBrandTerms(project.brandProfile);
  const competitorTerms = buildCompetitorTerms(project.brandProfile?.competitors || []);

  const clusters = await prisma.queryCluster.findMany({
    where: { projectId },
    include: {
      queries: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }]
  });

  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const clusterId = requestedClusterId && clusterIds.has(requestedClusterId) ? requestedClusterId : "";
  const queryOptions = clusters
    .filter((cluster) => !clusterId || cluster.id === clusterId)
    .flatMap((cluster) =>
      cluster.queries.map((query) => ({
        id: query.id,
        queryText: query.queryText,
        intentType: query.intentType,
        clusterName: cluster.name
      }))
    );
  const queryIds = new Set(queryOptions.map((query) => query.id));
  const queryId = requestedQueryId && queryIds.has(requestedQueryId) ? requestedQueryId : "";

  const runWhere: Prisma.AnswerRunWhereInput = { projectId };
  if (clusterId) runWhere.query = { clusterId };
  if (queryId) runWhere.queryId = queryId;

  const sourceWhere: Prisma.SourceWhereInput = {
    run: runWhere
  };
  const sourceFilters: Prisma.SourceWhereInput[] = [];
  if (keywordTerms.length > 0) {
    sourceFilters.push(...keywordTerms.map((term) => buildKeywordSourceFilter(term)));
  }
  if (mentionFilter === "brand" || mentionFilter === "both") {
    sourceFilters.push(buildReferenceMentionSourceFilter(brandTerms));
  }
  if (mentionFilter === "competitor" || mentionFilter === "both") {
    sourceFilters.push(buildReferenceMentionSourceFilter(competitorTerms));
  }
  if (sourceFilters.length > 0) {
    sourceWhere.AND = sourceFilters;
  }

  const sources = await prisma.source.findMany({
    where: sourceWhere,
    include: {
      run: {
        include: {
          query: { include: { cluster: true } },
          engineConfig: true
        }
      }
    },
    orderBy: [{ run: { runAt: "desc" } }, { position: "asc" }, { id: "asc" }]
  });
  const platformOptions = summarizePlatformCounts(sources);
  const sortPlatform = requestedSortPlatform && platformOptions.some((item) => item.platform === requestedSortPlatform) ? requestedSortPlatform : "";
  const sourceGroups = sortReferenceGroups(groupSourcesByLink(sources), sortPlatform);
  const resultGroups = serializeReferenceGroups(sourceGroups);
  const baseQueryParams = { clusterId, queryId, sortPlatform, keyword, mentionFilter };
  const profileAnalysisContextKey = buildProfileAnalysisContextKey({
    scope: "references",
    projectId: project.id,
    filters: baseQueryParams,
    sourceIds: sources.map((source) => source.id)
  });
  const [brandProfileAnalysis, competitorBrandAnalysis]: [BrandProfileAnalysisResult | null, BrandProfileAnalysisResult | null] =
    await Promise.all([
      getProfileAnalysisArchive({
        projectId: project.id,
        scope: "references",
        target: "brand",
        contextKey: profileAnalysisContextKey
      }),
      getProfileAnalysisArchive({
        projectId: project.id,
        scope: "references",
        target: "competitor",
        contextKey: profileAnalysisContextKey
      })
    ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>引用查询</h1>
          <p className="muted">集中检索所有采样获取到的引用来源，并按 Query集、Query 与关键词定位引用。</p>
        </div>
      </div>

      {brandProfileAnalysis ? (
        <Section title="品牌画像分析">
          {brandProfileAnalysis.warning ? <div className="hint answer-analysis-error">{brandProfileAnalysis.warning}</div> : null}
          <div className="hint">基于当前引用列表筛选结果中，各平台命中当前品牌名或别名的引用量 TOP20 链接上下文生成，共 {brandProfileAnalysis.reportCount} 份平台-品牌报告。</div>
          <pre className="report-tab-content reference-brand-profile-report">{brandProfileAnalysis.report}</pre>
        </Section>
      ) : null}

      {competitorBrandAnalysis ? (
        <Section title="竞品画像分析">
          {competitorBrandAnalysis.warning ? <div className="hint answer-analysis-error">{competitorBrandAnalysis.warning}</div> : null}
          <div className="hint">基于当前引用列表筛选结果中，各平台命中竞品名或别名的引用量 TOP20 链接上下文生成，共 {competitorBrandAnalysis.reportCount} 份平台-竞品画像报告。</div>
          <pre className="report-tab-content reference-brand-profile-report">{competitorBrandAnalysis.report}</pre>
        </Section>
      ) : null}

      <Section title="引用列表">
        <form method="get" className="filter-bar reference-filter-bar">
          <label className="reference-filter-field">
            <span>Query集</span>
            <select name="clusterId" defaultValue={clusterId}>
              <option value="">全部 Query集</option>
              {clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </label>
          <label className="reference-filter-field">
            <span>Query</span>
            <select name="queryId" defaultValue={queryId}>
              <option value="">全部 Query</option>
              {queryOptions.map((query) => (
                <option key={query.id} value={query.id}>
                  {query.queryText}
                </option>
              ))}
            </select>
          </label>
          <label className="reference-filter-field">
            <span>排序平台</span>
            <select name="sortPlatform" defaultValue={sortPlatform}>
              <option value="">全部平台引用次数</option>
              {platformOptions.map((item) => (
                <option key={item.platform} value={item.platform}>
                  {item.platform}（{item.count} 次）
                </option>
              ))}
            </select>
          </label>
          <label className="reference-filter-field">
            <span>提及筛选</span>
            <select name="mentionFilter" defaultValue={mentionFilter}>
              <option value="">全部提及情况</option>
              <option value="brand">提及品牌</option>
              <option value="competitor">提及竞品</option>
              <option value="both">都提及</option>
            </select>
          </label>
          <label className="reference-filter-field reference-keyword-field">
            <span>关键词</span>
            <input name="keyword" defaultValue={keyword} placeholder="多个关键词以空格分隔；匹配标题、URL、域名、摘要或正文" />
          </label>
          <div className="actions reference-filter-actions">
            <button type="submit">查询</button>
            {clusterId || queryId || keyword || mentionFilter || sortPlatform ? (
              <Link className="button secondary" href="/references">
                清除筛选
              </Link>
            ) : null}
          </div>
          <div className="hint reference-filter-count">
            当前显示 {sourceGroups.length} 个引用链接 / {sources.length} 次引用
          </div>
        </form>

        {sources.length === 0 ? (
          <Empty title="没有匹配引用" body="请调整筛选条件，或先完成采样。" />
        ) : (
          <ReferenceResultsTable
            groups={resultGroups}
            sortPlatform={sortPlatform}
            brandTerms={brandTerms}
            competitorTerms={competitorTerms}
          />
        )}
      </Section>
    </>
  );
}

function normalizeSingleSearchParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").trim();
}

function normalizeMentionFilter(value: string): MentionFilter {
  return mentionFilterValues.has(value as MentionFilter) ? (value as MentionFilter) : "";
}

function splitSearchKeywords(value: string) {
  return value.split(/\s+/).map((term) => term.trim()).filter(Boolean);
}

function buildReferencesHref(params: {
  clusterId?: string;
  queryId?: string;
  sortPlatform?: string;
  keyword?: string;
  mentionFilter?: MentionFilter;
}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/references?${query}` : "/references";
}

function buildKeywordSourceFilter(term: string): Prisma.SourceWhereInput {
  return {
    OR: [
      { title: { contains: term } },
      { url: { contains: term } },
      { fetchedUrl: { contains: term } },
      { domain: { contains: term } },
      { siteName: { contains: term } },
      { summary: { contains: term } },
      { keyword: { contains: term } },
      { bodyText: { contains: term } },
      { content: { contains: term } }
    ]
  };
}

function buildReferenceMentionSourceFilter(terms: string[]): Prisma.SourceWhereInput {
  const filters = terms.flatMap((term) => {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) return [];
    return [
      { bodyText: { contains: normalizedTerm } },
      { content: { contains: normalizedTerm } }
    ] satisfies Prisma.SourceWhereInput[];
  });

  if (filters.length === 0) {
    return { id: { equals: "__no_reference_mention_terms__" } };
  }
  return { OR: filters };
}

function groupSourcesByLink(sources: ReferenceSourceRecord[]) {
  const groups = new Map<string, ReferenceSourceGroup>();
  for (const source of sources) {
    const url = referenceDisplayUrl(source);
    const key = url ? normalizeReferenceGroupKey(url) : `source:${source.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(source);
      continue;
    }
    groups.set(key, {
      key,
      url,
      title: source.title || source.siteName || source.domain || url || "未命名引用",
      sourceType: source.sourceType || "",
      siteName: source.siteName || "",
      domain: source.domain || "",
      items: [source]
    });
  }
  return [...groups.values()];
}

function sortReferenceGroups(groups: ReferenceSourceGroup[], sortPlatform: string) {
  return [...groups].sort((left, right) => {
    if (sortPlatform) {
      const platformDelta = countGroupPlatformReferences(right, sortPlatform) - countGroupPlatformReferences(left, sortPlatform);
      if (platformDelta !== 0) return platformDelta;
    }
    if (right.items.length !== left.items.length) return right.items.length - left.items.length;
    return right.items[0]?.run.runAt.getTime() - left.items[0]?.run.runAt.getTime();
  });
}

function countGroupPlatformReferences(group: ReferenceSourceGroup, platform: string) {
  return group.items.reduce((total, source) => total + (source.run.engineConfig.displayName === platform ? 1 : 0), 0);
}

function serializeReferenceGroups(groups: ReferenceSourceGroup[]): ReferenceResultsGroup[] {
  return groups.map((group) => ({
    key: group.key,
    url: group.url,
    title: group.title,
    sourceType: group.sourceType,
    siteName: group.siteName,
    domain: group.domain,
    citationCount: group.items.length,
    platformCounts: summarizePlatformCounts(group.items),
    items: group.items.map((source) => ({
      id: source.id,
      siteLabel: source.siteName || source.domain || source.sourceType || "-",
      clusterName: source.run.query.cluster.name,
      clusterIntentType: source.run.query.cluster.intentType,
      queryText: source.run.query.queryText,
      queryIntentType: source.run.query.intentType,
      platform: source.run.engineConfig.displayName,
      positionLabel: source.position ? String(source.position) : "-",
      summary: textPreview(source.summary || source.bodyText || source.content || "", 180),
      runAtText: formatDateTime(source.run.runAt),
      url: referenceDisplayUrl(source),
      rawUrl: source.url || "",
      fetchedUrl: source.fetchedUrl ? referenceDisplayUrl({ ...source, url: source.fetchedUrl }) : "",
      title: source.title || "",
      sourceType: source.sourceType || "",
      author: source.author || "",
      publishedAt: source.publishedAt || "",
      bodyText: source.bodyText || "",
      content: source.content || "",
      fetchMode: source.fetchMode || "",
      fetchError: source.fetchError || "",
      fetchedAtText: source.fetchedAt ? formatDateTime(source.fetchedAt) : "",
      referenceFeatureAnalysis: source.referenceFeatureAnalysis || "",
      referenceFeatureAnalysisAtText: source.referenceFeatureAnalysisAt ? formatDateTime(source.referenceFeatureAnalysisAt) : "",
      referenceFeatureAnalysisError: source.referenceFeatureAnalysisError || "",
      competitorReferenceFeatureAnalysis: source.competitorReferenceFeatureAnalysis || "",
      competitorReferenceFeatureAnalysisAtText: source.competitorReferenceFeatureAnalysisAt ? formatDateTime(source.competitorReferenceFeatureAnalysisAt) : "",
      competitorReferenceFeatureAnalysisError: source.competitorReferenceFeatureAnalysisError || ""
    }))
  }));
}

function summarizePlatformCounts(items: ReferenceSourceRecord[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const platform = item.run.engineConfig.displayName || "未知平台";
    counts.set(platform, (counts.get(platform) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.platform.localeCompare(right.platform, "zh-CN");
    });
}

function normalizeReferenceGroupKey(value: string) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

function referenceDisplayUrl(source: { fetchedUrl?: string | null; url: string }) {
  const candidate = source.fetchedUrl || source.url;
  return normalizeReferenceSourceUrl(candidate) || candidate || "";
}

function textPreview(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
