import type { Prisma } from "@prisma/client";
import {
  buildBrandProfileAnalysisReport,
  buildCompetitorBrandAnalysisReport,
  type BrandProfileAnalysisSource
} from "@/lib/services/brand-profile-analysis";
import { buildCompetitorTerms, buildCurrentBrandTerms, normalizeSelectedIds } from "@/lib/services/dashboard-analytics";
import {
  buildProfileAnalysisContextKey,
  createProfileAnalysisArchive,
  toProfileAnalysisArchiveResponse,
  type ProfileAnalysisArchiveScope,
  type ProfileAnalysisArchiveTarget
} from "@/lib/services/profile-analysis-archive";
import { prisma } from "@/lib/db";
import { getDashboard, getDefaultProjectId } from "@/lib/services/read";

type ProfileAnalysisRequest = {
  scope?: unknown;
  target?: unknown;
  filters?: unknown;
};

type ProfileAnalysisFilters = Record<string, string | string[]>;

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

type MentionFilter = "" | "brand" | "competitor" | "both";

const mentionFilterValues = new Set<MentionFilter>(["", "brand", "competitor", "both"]);

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ProfileAnalysisRequest;
  const scope = normalizeScope(payload.scope);
  const target = normalizeTarget(payload.target);
  const filters = normalizeFilters(payload.filters);
  if (!scope || !target) {
    return Response.json({ error: "缺少有效的分析范围或分析目标" }, { status: 400 });
  }

  if (scope === "dashboard") {
    return analyzeDashboardProfile({ target, filters });
  }
  return analyzeReferencesProfile({ target, filters });
}

async function analyzeDashboardProfile(input: { target: ProfileAnalysisArchiveTarget; filters: ProfileAnalysisFilters }) {
  const data = await getDashboard();
  if (!data) return Response.json({ error: "没有项目" }, { status: 404 });

  const { project } = data;
  const selectedClusterIds = normalizeSelectedIds(input.filters.clusterIds, new Set(project.queryClusters.map((cluster) => cluster.id)));
  const selectedBatchIds = normalizeSelectedIds(input.filters.batchIds, new Set(project.samplingBatches.map((batch) => batch.id)));
  const validIntentTypes = new Set<string>();
  for (const cluster of project.queryClusters) {
    validIntentTypes.add(normalizeQueryIntentType(cluster.intentType));
    for (const query of cluster.queries) {
      validIntentTypes.add(normalizeQueryIntentType(query.intentType));
    }
  }
  for (const run of project.answerRuns) {
    validIntentTypes.add(normalizeQueryIntentType(run.query.intentType));
  }
  const selectedQueryIntentTypes = normalizeSelectedIds(input.filters.queryIntentTypes, validIntentTypes);
  const filteredAnswerRuns = project.answerRuns.filter((run) => {
    if (selectedClusterIds.length > 0 && !selectedClusterIds.includes(run.query.clusterId)) return false;
    if (selectedBatchIds.length > 0 && !selectedBatchIds.includes(run.samplingBatchId || "")) return false;
    if (selectedQueryIntentTypes.length > 0 && !selectedQueryIntentTypes.includes(normalizeQueryIntentType(run.query.intentType))) return false;
    return true;
  });
  const sources = buildDashboardProfileAnalysisSources(filteredAnswerRuns);
  const contextFilters = {
    clusterIds: selectedClusterIds,
    batchIds: selectedBatchIds,
    queryIntentTypes: selectedQueryIntentTypes
  };
  const contextKey = buildProfileAnalysisContextKey({
    scope: "dashboard",
    projectId: project.id,
    filters: contextFilters,
    sourceIds: sources.map((source) => source.id)
  });
  const analysis = await buildTargetProfileAnalysis(input.target, { project, sources });
  const archive = await createProfileAnalysisArchive({
    projectId: project.id,
    target: input.target,
    scope: "dashboard",
    contextKey,
    result: analysis
  });
  return Response.json({ analysis, archive: toProfileAnalysisArchiveResponse(archive) });
}

async function analyzeReferencesProfile(input: { target: ProfileAnalysisArchiveTarget; filters: ProfileAnalysisFilters }) {
  const projectId = await getDefaultProjectId();
  if (!projectId) return Response.json({ error: "没有采样项目" }, { status: 404 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) return Response.json({ error: "没有采样项目" }, { status: 404 });

  const clusterId = await resolveReferenceClusterId(projectId, filterString(input.filters.clusterId));
  const queryId = await resolveReferenceQueryId(clusterId, filterString(input.filters.queryId));
  const keyword = filterString(input.filters.keyword);
  const mentionFilter = normalizeMentionFilter(filterString(input.filters.mentionFilter));
  const sortPlatform = filterString(input.filters.sortPlatform);
  const sources = await loadReferenceProfileAnalysisSources({
    projectId,
    clusterId,
    queryId,
    keyword,
    mentionFilter,
    project
  });
  const contextFilters = { clusterId, queryId, sortPlatform, keyword, mentionFilter };
  const contextKey = buildProfileAnalysisContextKey({
    scope: "references",
    projectId: project.id,
    filters: contextFilters,
    sourceIds: sources.map((source) => source.id)
  });
  const analysis = await buildTargetProfileAnalysis(input.target, { project, sources });
  const archive = await createProfileAnalysisArchive({
    projectId: project.id,
    target: input.target,
    scope: "references",
    contextKey,
    result: analysis
  });
  return Response.json({ analysis, archive: toProfileAnalysisArchiveResponse(archive) });
}

async function buildTargetProfileAnalysis(
  target: ProfileAnalysisArchiveTarget,
  input: Parameters<typeof buildBrandProfileAnalysisReport>[0]
) {
  if (target === "brand") return buildBrandProfileAnalysisReport(input);
  return buildCompetitorBrandAnalysisReport(input);
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

async function resolveReferenceClusterId(projectId: string, requestedClusterId: string) {
  if (!requestedClusterId) return "";
  const cluster = await prisma.queryCluster.findFirst({
    where: { projectId, id: requestedClusterId },
    select: { id: true }
  });
  return cluster?.id || "";
}

async function resolveReferenceQueryId(clusterId: string, requestedQueryId: string) {
  if (!requestedQueryId) return "";
  const query = await prisma.query.findFirst({
    where: {
      id: requestedQueryId,
      ...(clusterId ? { clusterId } : {})
    },
    select: { id: true }
  });
  return query?.id || "";
}

async function loadReferenceProfileAnalysisSources(input: {
  projectId: string;
  clusterId: string;
  queryId: string;
  keyword: string;
  mentionFilter: MentionFilter;
  project: {
    brandProfile?: {
      brandNames?: string | null;
      aliases?: string | null;
      competitors?: Array<{ name: string; aliases?: string | null }>;
    } | null;
  };
}) {
  const runWhere: Prisma.AnswerRunWhereInput = { projectId: input.projectId };
  if (input.clusterId) runWhere.query = { clusterId: input.clusterId };
  if (input.queryId) runWhere.queryId = input.queryId;

  const sourceWhere: Prisma.SourceWhereInput = {
    run: runWhere
  };
  const sourceFilters: Prisma.SourceWhereInput[] = [];
  const keywordTerms = splitSearchKeywords(input.keyword);
  if (keywordTerms.length > 0) {
    sourceFilters.push(...keywordTerms.map((term) => buildKeywordSourceFilter(term)));
  }
  if (input.mentionFilter === "brand" || input.mentionFilter === "both") {
    sourceFilters.push(buildReferenceMentionSourceFilter(buildCurrentBrandTerms(input.project.brandProfile)));
  }
  if (input.mentionFilter === "competitor" || input.mentionFilter === "both") {
    sourceFilters.push(buildReferenceMentionSourceFilter(buildCompetitorTerms(input.project.brandProfile?.competitors || [])));
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
  return sources.map(toBrandProfileAnalysisSource);
}

function toBrandProfileAnalysisSource(source: ReferenceSourceRecord): BrandProfileAnalysisSource {
  return {
    id: source.id,
    url: source.url,
    fetchedUrl: source.fetchedUrl,
    title: source.title,
    domain: source.domain,
    siteName: source.siteName,
    summary: source.summary,
    bodyText: source.bodyText,
    content: source.content,
    referenceFeatureAnalysis: source.referenceFeatureAnalysis,
    competitorReferenceFeatureAnalysis: source.competitorReferenceFeatureAnalysis,
    run: {
      runAt: source.run.runAt,
      engineConfig: {
        displayName: source.run.engineConfig.displayName
      }
    }
  };
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

function normalizeScope(value: unknown): ProfileAnalysisArchiveScope | "" {
  return value === "dashboard" || value === "references" ? value : "";
}

function normalizeTarget(value: unknown): ProfileAnalysisArchiveTarget | "" {
  return value === "brand" || value === "competitor" ? value : "";
}

function normalizeFilters(value: unknown): ProfileAnalysisFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const filters: ProfileAnalysisFilters = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string") {
      filters[key] = rawValue;
    } else if (Array.isArray(rawValue)) {
      filters[key] = rawValue.map((item) => String(item || "").trim()).filter(Boolean);
    }
  }
  return filters;
}

function filterString(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").trim();
}

function splitSearchKeywords(value: string) {
  return value.split(/\s+/).map((term) => term.trim()).filter(Boolean);
}

function normalizeMentionFilter(value: string): MentionFilter {
  return mentionFilterValues.has(value as MentionFilter) ? (value as MentionFilter) : "";
}

function normalizeQueryIntentType(value: string | null | undefined) {
  return String(value || "").trim() || "未设置意图";
}
