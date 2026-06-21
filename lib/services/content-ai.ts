import { prisma } from "@/lib/db";
import { assertUsableLlmConfig } from "@/lib/services/llm-models";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import { fetchReferenceDetail, type ReferenceFetchDetail } from "@/lib/services/reference-fetcher";
import { hashText, primaryBrandName, splitCsv } from "@/lib/utils";

export type ContentAiFeatureScope = "brand" | "competitor";
export type ContentAiFeatureKind = "advantage" | "disadvantage";

export type ContentAiFeatureOption = {
  id: string;
  scope: ContentAiFeatureScope;
  kind: ContentAiFeatureKind;
  queryText: string;
  platformName: string;
  content: string;
  targetName?: string;
};

export type ContentAiFeatureGroups = {
  brandAdvantages: ContentAiFeatureOption[];
  brandDisadvantages: ContentAiFeatureOption[];
  competitorAdvantages: ContentAiFeatureOption[];
  competitorDisadvantages: ContentAiFeatureOption[];
};

export type SelectedContentAiFeature = {
  scope: ContentAiFeatureScope;
  kind: ContentAiFeatureKind;
  queryText?: string;
  platformName?: string;
  content: string;
  targetName?: string;
};

export type ContentAiEvidenceModuleOption = {
  id: string;
  contentAssetId: string;
  contentAssetTitle: string;
  moduleType: string;
  moduleTitle: string;
  bodyPreview: string;
  bodyLength: number;
  snapshotAt: string;
};

export type ContentAiDraftEvidenceModuleSource = {
  id: string;
  contentAssetTitle: string;
  moduleType: string;
  title: string;
  body: string;
};

type CompetitorConfig = {
  name: string;
  aliases?: string | null;
};

type SamplingBatchSummary = {
  id: string;
  clusterId: string;
  batchDate: string;
  sequence: number;
  createdAt: Date | string;
};

type ReferenceTermEntry = {
  term: string;
  termType: "竞品名" | "别名";
  canonicalName: string;
};

type ReferenceSourceTitle = {
  title: string;
  url: string;
  siteName: string;
  clusterName: string;
  queryText: string;
  platformName: string;
};

export type BrandSiteDraftSource = {
  inputUrl: string;
  url: string;
  title: string;
  bodyTextLength: number;
  fetchMode: string;
};

export type BrandSiteDraftFailedSource = {
  inputUrl: string;
  error: string;
};

export type BrandSiteFetchedSource = BrandSiteDraftSource & {
  bodyText: string;
};

type EvidenceModuleDraftCandidate = {
  id: string;
  moduleType: string;
  title: string;
  body: string;
  snapshot: {
    asset: {
      title: string;
    };
  };
};

const brandSiteFetchLimit = 5;
const brandSiteFetchConcurrency = 2;
const brandSiteTextPerSourceLimit = 10000;
const brandSiteTotalTextLimit = 45000;
const contentEvidenceModuleDraftLimit = 30;
const contentAssetDraftEvidenceTextLimit = 800;
const manualBrandProfileReportType = "profile_brand_analysis";
const manualCompetitorProfileReportType = "profile_competitor_analysis";
const workflowBrandProfileReportType = "batch_brand_profile";
const workflowCompetitorProfileReportType = "batch_competitor_brand_profile";

export function emptyContentAiFeatureGroups(): ContentAiFeatureGroups {
  return {
    brandAdvantages: [],
    brandDisadvantages: [],
    competitorAdvantages: [],
    competitorDisadvantages: []
  };
}

export async function getContentAiFeatureGroups(projectId: string): Promise<ContentAiFeatureGroups> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brandProfile: true
    }
  });
  if (!project) return emptyContentAiFeatureGroups();

  const [manualBrandProfileReport, manualCompetitorProfileReport, workflowBrandProfileReport, workflowCompetitorProfileReport] =
    await Promise.all([
      findLatestProfileReport(projectId, manualBrandProfileReportType),
      findLatestProfileReport(projectId, manualCompetitorProfileReportType),
      findLatestProfileReport(projectId, workflowBrandProfileReportType),
      findLatestProfileReport(projectId, workflowCompetitorProfileReportType)
    ]);
  const brandProfileReport = manualBrandProfileReport || workflowBrandProfileReport;
  const competitorProfileReport = manualCompetitorProfileReport || workflowCompetitorProfileReport;

  const seen = new Set<string>();
  const items: ContentAiFeatureOption[] = [];

  if (brandProfileReport) {
    for (const item of parseBrandProfileAnalysisFeatures(brandProfileReport.markdown, primaryBrandName(project.brandProfile))) {
      addUniqueFeature(items, seen, item);
    }
  }
  if (competitorProfileReport) {
    for (const item of parseCompetitorBrandProfileAnalysisFeatures(competitorProfileReport.markdown)) {
      addUniqueFeature(items, seen, item);
    }
  }

  return groupContentAiFeatures(items);
}

function findLatestProfileReport(projectId: string, type: string) {
  return prisma.report.findFirst({
    where: { projectId, type },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
}

export async function generateContentTitleCandidates(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) throw new Error("项目不存在");

  const config = assertUsableLlmConfig(project.llmConfig, "contentTitleGeneration");
  const referenceTitles = await collectLatestCompetitorReferenceSourceTitles(projectId, project.brandProfile?.competitors || []);
  if (referenceTitles.length === 0) {
    throw new Error("当前所有 Query集的最新一次采样中，未找到竞品引用上下文不为空的引用标题");
  }

  const sourceTitlePayload = referenceTitles.slice(0, 120).map((item, index) => ({
    index: index + 1,
    title: item.title,
    siteName: item.siteName,
    clusterName: item.clusterName,
    query: item.queryText,
    platform: item.platformName,
    url: item.url
  }));

  const raw = await requestChatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName: config.modelName,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO 内容策略专家。请仅基于用户提供的竞品引用标题生成当前品牌可发布的中文内容标题。" +
          "必须生成 5 个候选标题；标题应适合内容资产页面使用，避免夸大承诺、避免编造具体数据。" +
          "只返回 JSON，格式为 {\"titles\":[\"标题1\",\"标题2\",\"标题3\",\"标题4\",\"标题5\"]}。"
      },
      {
        role: "user",
        content: JSON.stringify({
          brand: primaryBrandName(project.brandProfile),
          competitors: project.brandProfile?.competitors.map((competitor) => competitor.name) || [],
          sourceTitleCount: referenceTitles.length,
          sourceTitles: sourceTitlePayload
        })
      }
    ]
  });

  const titles = parseTitleCandidates(raw);
  if (titles.length === 0) throw new Error("LLM 未返回可用候选标题");
  return {
    titles: titles.slice(0, 5),
    sourceTitleCount: referenceTitles.length
  };
}

export async function createGeoArticleDraft(input: {
  projectId: string;
  title: string;
  selectedFeatures: SelectedContentAiFeature[];
  selectedEvidenceModuleIds?: string[];
}) {
  const title = input.title.trim();
  if (!title) throw new Error("请先填写或选择标题");

  const selectedFeatures = normalizeSelectedFeatures(input.selectedFeatures);
  const selectedEvidenceModuleIds = normalizeSelectedEvidenceModuleIds(input.selectedEvidenceModuleIds || []);
  if (selectedFeatures.length === 0 && selectedEvidenceModuleIds.length === 0) {
    throw new Error("请至少勾选一条写作素材");
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) throw new Error("项目不存在");

  const evidenceModules = selectedEvidenceModuleIds.length > 0
    ? await prisma.evidenceModule.findMany({
        where: {
          id: { in: selectedEvidenceModuleIds },
          snapshot: { asset: { projectId: input.projectId } }
        },
        include: { snapshot: { include: { asset: true } } }
      })
    : [];
  const selectedEvidenceModules = buildContentAssetEvidenceDraftSources(evidenceModules, selectedEvidenceModuleIds);
  if (selectedEvidenceModuleIds.length > 0 && selectedEvidenceModules.length === 0) {
    throw new Error("所选证据模块暂无可用于写作的正文");
  }

  const config = assertUsableLlmConfig(project.llmConfig, "contentDraftGeneration");
  const brand = project.brandProfile;
  const raw = await requestChatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName: config.modelName,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO 文章创作专家。请基于用户勾选的品牌与竞品优劣势素材、内容资产证据模块，创作一篇可被生成式搜索引用和吸收的中文文章正文。" +
          "严格要求：只使用用户勾选的素材作为事实依据；内容资产证据模块可作为事实、结构和表达参考；不得编造数据、客户案例、奖项、价格或第三方背书；" +
          "应突出当前品牌的差异化价值，并以客观方式处理竞品优劣势；如存在禁用表述必须规避。" +
          "只输出 Markdown 正文，不重复输出标题，不输出解释性前后缀。"
      },
      {
        role: "user",
        content: JSON.stringify({
          title,
          brand: {
            name: primaryBrandName(brand),
            brandNames: splitCsv(brand?.brandNames),
            productNames: splitCsv(brand?.productNames),
            aliases: splitCsv(brand?.aliases),
            customerGroups: brand?.customerGroups || "",
            description: brand?.description || "",
            approvedClaims: brand?.approvedClaims || "",
            forbiddenClaims: brand?.forbiddenClaims || ""
          },
          competitors: brand?.competitors.map((competitor) => ({
            name: competitor.name,
            aliases: splitCsv(competitor.aliases),
            customerGroups: competitor.customerGroups || "",
            description: competitor.description || "",
            website: competitor.website || ""
          })) || [],
          selectedFeatures,
          selectedEvidenceModules
        })
      }
    ]
  });

  const content = raw.trim();
  if (!content) throw new Error("LLM 未返回文章正文");
  return { content };
}

export async function createBrandSiteArticleDraft(input: {
  projectId: string;
  title?: string;
}) {
  const projectId = input.projectId.trim();
  if (!projectId) throw new Error("缺少 projectId");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) throw new Error("项目不存在");

  const brandSiteUrls = normalizeBrandSiteUrls(project.brandProfile?.brandUrls).slice(0, brandSiteFetchLimit);
  if (brandSiteUrls.length === 0) {
    throw new Error("请先在设置中配置品牌站点 URL");
  }

  const config = assertUsableLlmConfig(project.llmConfig, "contentDraftGeneration");
  const fetchResult = await fetchBrandSiteDraftSources(brandSiteUrls);
  if (fetchResult.sources.length === 0) {
    const detail = fetchResult.failedSources.map((item) => `${item.inputUrl}：${item.error}`).join("；");
    throw new Error(`品牌站点内容获取失败${detail ? `：${detail}` : ""}`);
  }

  const title = String(input.title || "").trim();
  const brand = project.brandProfile;
  const raw = await requestChatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName: config.modelName,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO 内容写作专家。请基于用户提供的品牌站点正文素材，重写为可直接保存到内容资产正文中的中文 Markdown 正文。" +
          "严格要求：只使用品牌站点素材和品牌设置中明确给出的事实；不得编造数据、客户案例、奖项、价格、第三方背书或不可验证承诺；" +
          "不得逐字照搬网页原文，应进行结构化改写；如用户提供标题，则正文必须服务于该标题；如未提供标题，则输出通用品牌介绍型正文。" +
          "只输出正文，不输出标题、不输出解释性前后缀。"
      },
      {
        role: "user",
        content: JSON.stringify({
          title,
          brand: {
            name: primaryBrandName(brand),
            brandNames: splitCsv(brand?.brandNames),
            productNames: splitCsv(brand?.productNames),
            aliases: splitCsv(brand?.aliases),
            customerGroups: brand?.customerGroups || "",
            description: brand?.description || "",
            approvedClaims: brand?.approvedClaims || "",
            forbiddenClaims: brand?.forbiddenClaims || "",
            brandUrls: brandSiteUrls
          },
          competitors: brand?.competitors.map((competitor) => ({
            name: competitor.name,
            aliases: splitCsv(competitor.aliases),
            customerGroups: competitor.customerGroups || "",
            description: competitor.description || "",
            website: competitor.website || ""
          })) || [],
          sourceCount: fetchResult.sources.length,
          sources: buildBrandSiteLlmSources(fetchResult.sources),
          failedSources: fetchResult.failedSources
        })
      }
    ]
  });

  const content = raw.trim();
  if (!content) throw new Error("LLM 未返回文章正文");
  return {
    content,
    sourceCount: fetchResult.sources.length,
    failedCount: fetchResult.failedSources.length,
    sources: fetchResult.sources.map(({ bodyText: _bodyText, ...source }) => source),
    failedSources: fetchResult.failedSources
  };
}

export function normalizeBrandSiteUrls(value?: string | null) {
  const seen = new Set<string>();
  return splitCsv(value)
    .map((item) => item.trim())
    .map((item) => (/^https?:\/\//i.test(item) ? item : `https://${item}`))
    .map((item) => {
      try {
        const parsed = new URL(item);
        if (!parsed.hostname) return "";
        return parsed.toString();
      } catch {
        return "";
      }
    })
    .filter((item) => {
      const normalized = item.toLocaleLowerCase();
      if (!item || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function buildBrandSiteLlmSources(sources: BrandSiteFetchedSource[]) {
  let remaining = brandSiteTotalTextLimit;
  return sources.flatMap((source, index) => {
    if (remaining <= 0) return [];
    const text = normalizeBrandSiteSourceText(source.bodyText).slice(0, Math.min(brandSiteTextPerSourceLimit, remaining));
    if (!text) return [];
    remaining -= text.length;
    return [{
      index: index + 1,
      title: source.title,
      url: source.url,
      fetchMode: source.fetchMode,
      bodyText: text
    }];
  });
}

export function normalizeSelectedEvidenceModuleIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, contentEvidenceModuleDraftLimit);
}

export function buildContentAssetEvidenceDraftSources(
  modules: EvidenceModuleDraftCandidate[],
  selectedIds: string[]
): ContentAiDraftEvidenceModuleSource[] {
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  return selectedIds.flatMap((moduleId) => {
    const module = moduleById.get(moduleId);
    const body = normalizeContentAssetDraftText(module?.body || "").slice(0, contentAssetDraftEvidenceTextLimit);
    const title = normalizeFeatureLine(module?.title || "");
    if (!module || !body || !title) return [];
    return [{
      id: module.id,
      contentAssetTitle: module.snapshot.asset.title,
      moduleType: module.moduleType,
      title,
      body
    }];
  });
}

async function fetchBrandSiteDraftSources(inputUrls: string[]) {
  const results = await mapWithConcurrency(inputUrls, brandSiteFetchConcurrency, async (inputUrl) => {
    try {
      const detail = await fetchReferenceDetail(inputUrl);
      return { ok: true as const, source: toBrandSiteFetchedSource(inputUrl, detail) };
    } catch (error) {
      return {
        ok: false as const,
        failedSource: {
          inputUrl,
          error: error instanceof Error ? error.message.slice(0, 500) : "unknown_brand_site_fetch_error"
        }
      };
    }
  });

  return {
    sources: results.flatMap((item) => (item.ok && item.source.bodyText ? [item.source] : [])),
    failedSources: results.flatMap((item) => (!item.ok ? [item.failedSource] : []))
  };
}

function toBrandSiteFetchedSource(inputUrl: string, detail: ReferenceFetchDetail): BrandSiteFetchedSource {
  const bodyText = normalizeBrandSiteSourceText(detail.bodyText || detail.content);
  return {
    inputUrl,
    url: detail.url || inputUrl,
    title: detail.title || detail.url || inputUrl,
    bodyText,
    bodyTextLength: bodyText.length,
    fetchMode: detail.fallbackReason ? `${detail.fetchMode}; fallback: ${detail.fallbackReason}` : detail.fetchMode
  };
}

function normalizeBrandSiteSourceText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseBrandFeatureReport(report: string) {
  return splitReferenceFeatureItems(report).flatMap((line, index) => {
    const explicitMatch = line.match(/^\s*(?:[-*•]|\d+[.、])?\s*\[(?:品牌名|别名)(?:[:：][^\]]+)?\]\[(优势|劣势)\](.+)$/);
    const featureType = explicitMatch?.[1] || classifyLegacyReferenceFeature(line);
    if (!featureType) return [];
    return [{
      id: "",
      scope: "brand" as const,
      kind: featureType === "优势" ? "advantage" as const : "disadvantage" as const,
      queryText: "",
      platformName: "",
      content: normalizeFeatureLine(line),
      targetName: undefined,
      index
    }];
  }).map(({ index: _index, ...item }) => item);
}

export function parseCompetitorFeatureReport(report: string, competitorNameByTerm: Map<string, string>) {
  return splitReferenceFeatureItems(report).flatMap((line, index) => {
    const explicitMatch = line.match(/^\s*(?:[-*•]|\d+[.、])?\s*\[(?:竞品名|别名)[:：]([^\]]+)\]\[(优势|劣势)\](.+)$/);
    if (!explicitMatch) return [];

    const matchedTerm = explicitMatch[1].trim();
    const targetName = competitorNameByTerm.get(matchedTerm.toLocaleLowerCase()) || matchedTerm;
    if (!targetName) return [];

    return [{
      id: "",
      scope: "competitor" as const,
      kind: explicitMatch[2] === "优势" ? "advantage" as const : "disadvantage" as const,
      queryText: "",
      platformName: "",
      content: normalizeFeatureLine(line),
      targetName,
      index
    }];
  }).map(({ index: _index, ...item }) => item);
}

export function parseBrandProfileAnalysisFeatures(report: string, fallbackTargetName: string): ContentAiFeatureOption[] {
  return parseProfileAnalysisFeatures(report, "brand", fallbackTargetName);
}

export function parseCompetitorBrandProfileAnalysisFeatures(report: string): ContentAiFeatureOption[] {
  return parseProfileAnalysisFeatures(report, "competitor", "");
}

function parseProfileAnalysisFeatures(report: string, scope: ContentAiFeatureScope, fallbackTargetName: string): ContentAiFeatureOption[] {
  const items: ContentAiFeatureOption[] = [];
  let currentPlatformName = "";
  let currentTargetName = fallbackTargetName.trim();
  let currentSectionName = "";
  let currentSectionKind: ContentAiFeatureKind | null = null;

  for (const rawLine of splitReportLines(report)) {
    const line = rawLine.trim();
    const heading = parseProfileReportHeading(line);
    if (heading) {
      currentPlatformName = heading.platformName;
      currentTargetName = heading.targetName || fallbackTargetName.trim();
      currentSectionName = "";
      currentSectionKind = null;
      continue;
    }

    const section = parseProfileFeatureSectionHeading(line);
    if (section) {
      currentSectionName = section.sectionName;
      currentSectionKind = section.kind;
      continue;
    }

    const feature = parseProfileFeatureLine(line);
    if (!feature) continue;

    const kind = feature.kind || currentSectionKind;
    if (!kind || isEmptyProfileFeatureText(feature.content)) continue;

    items.push({
      id: "",
      scope,
      kind,
      targetName: currentTargetName || undefined,
      platformName: currentPlatformName,
      queryText: currentSectionName,
      content: normalizeFeatureLine(`[${kind === "advantage" ? "优势" : "劣势"}]${feature.content}`)
    });
  }

  return items;
}

function parseProfileReportHeading(line: string) {
  const match = line.match(/^【(.+)画像分析报告】$/);
  if (!match) return null;

  const body = match[1].trim();
  const separatorIndex = body.lastIndexOf("-");
  if (separatorIndex < 0) {
    return { platformName: "", targetName: body };
  }

  return {
    platformName: body.slice(0, separatorIndex).trim(),
    targetName: body.slice(separatorIndex + 1).trim()
  };
}

function parseProfileFeatureSectionHeading(line: string): { sectionName: string; kind: ContentAiFeatureKind } | null {
  const normalized = line.replace(/[:：]\s*$/, "").trim();
  if (!normalized || normalized.startsWith("[") || /^【[^】]+】$/.test(normalized)) return null;
  if (/优势$/.test(normalized)) return { sectionName: normalized, kind: "advantage" };
  if (/劣势$/.test(normalized)) return { sectionName: normalized, kind: "disadvantage" };
  return null;
}

function parseProfileFeatureLine(line: string): { kind: ContentAiFeatureKind; content: string } | null {
  const match = line.match(/^\s*(?:[-*•]|\d+[.、])?\s*\[(优势|劣势)\]\s*(.+?)\s*[；;]?\s*$/);
  if (!match) return null;
  return {
    kind: match[1] === "优势" ? "advantage" : "disadvantage",
    content: cleanProfileFeatureContent(match[2])
  };
}

function cleanProfileFeatureContent(value: string) {
  return value.replace(/\s*[；;]\s*$/, "").trim();
}

function isEmptyProfileFeatureText(value: string) {
  return !value.trim() || /暂无明确提及|未找到|无法生成|未配置/.test(value);
}

async function collectLatestCompetitorReferenceSourceTitles(projectId: string, competitors: CompetitorConfig[]) {
  const termEntries = buildCompetitorTermEntries(competitors);
  if (termEntries.length === 0) throw new Error("当前项目未设置竞品名或竞品别名");

  const runs = await prisma.answerRun.findMany({
    where: {
      projectId,
      samplingBatchId: { not: null }
    },
    include: {
      query: { include: { cluster: true } },
      engineConfig: true,
      samplingBatch: true,
      sources: { orderBy: [{ position: "asc" }, { id: "asc" }] }
    },
    orderBy: [{ runAt: "desc" }, { id: "desc" }]
  });
  const latestBatchIdByCluster = selectLatestBatchIdByRunCluster(runs);
  if (latestBatchIdByCluster.size === 0) return [] as ReferenceSourceTitle[];

  const seen = new Set<string>();
  const items: ReferenceSourceTitle[] = [];
  for (const run of runs.filter((item) => item.samplingBatchId && latestBatchIdByCluster.get(item.query.clusterId) === item.samplingBatchId)) {
    for (const source of run.sources) {
      const contexts = buildReferenceContexts(source.bodyText || source.content || "", termEntries);
      if (contexts.length === 0) continue;

      const title = (source.title || source.siteName || source.domain || source.url || "").trim();
      if (!title) continue;

      const key = `${title.toLocaleLowerCase()}|${source.url || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title,
        url: source.fetchedUrl || source.url || "",
        siteName: source.siteName || source.domain || "未知来源",
        clusterName: run.query.cluster.name,
        queryText: run.query.queryText,
        platformName: run.engineConfig.displayName
      });
    }
  }

  return items;
}

function buildCompetitorTermEntries(competitors: CompetitorConfig[]) {
  const entries = competitors.flatMap((competitor) => {
    const canonicalName = competitor.name.trim();
    if (!canonicalName) return [] as ReferenceTermEntry[];
    return [
      { term: canonicalName, termType: "竞品名" as const, canonicalName },
      ...splitCsv(competitor.aliases).map((term) => ({ term, termType: "别名" as const, canonicalName }))
    ];
  });

  const seen = new Set<string>();
  return entries.filter((entry) => {
    const normalized = entry.term.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildReferenceContexts(text: string, termEntries: ReferenceTermEntry[]) {
  const detailText = normalizeContextText(text);
  if (!detailText) return [];

  const lowerText = detailText.toLocaleLowerCase();
  const contexts: Array<{ term: string; position: number; context: string }> = [];
  for (const entry of termEntries) {
    const normalizedTerm = entry.term.trim();
    if (!normalizedTerm) continue;

    const lowerTerm = normalizedTerm.toLocaleLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const position = lowerText.indexOf(lowerTerm, searchFrom);
      if (position < 0) break;
      const endPosition = position + normalizedTerm.length;
      contexts.push({
        term: normalizedTerm,
        position,
        context: [
          detailText.slice(Math.max(0, position - 30), position),
          detailText.slice(position, endPosition),
          detailText.slice(endPosition, Math.min(detailText.length, endPosition + 300))
        ].join("")
      });
      searchFrom = endPosition;
    }
  }

  return contexts.sort((left, right) => left.position - right.position || right.term.length - left.term.length);
}

function selectLatestBatchIdByRunCluster(
  runs: Array<{ samplingBatchId: string | null; query: { clusterId: string }; samplingBatch: SamplingBatchSummary | null }>
) {
  const latestByCluster = new Map<string, SamplingBatchSummary>();
  for (const run of runs) {
    if (!run.samplingBatchId || !run.samplingBatch) continue;
    const current = latestByCluster.get(run.query.clusterId);
    if (!current || compareSamplingBatches(run.samplingBatch, current) > 0) {
      latestByCluster.set(run.query.clusterId, run.samplingBatch);
    }
  }
  return new Map([...latestByCluster.entries()].map(([clusterId, batch]) => [clusterId, batch.id]));
}

function compareSamplingBatches(left: SamplingBatchSummary, right: SamplingBatchSummary) {
  const dateCompare = left.batchDate.localeCompare(right.batchDate);
  if (dateCompare !== 0) return dateCompare;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function addUniqueFeature(items: ContentAiFeatureOption[], seen: Set<string>, item: Omit<ContentAiFeatureOption, "id">) {
  const key = [
    item.scope,
    item.kind,
    item.targetName || "",
    normalizeFeatureLine(item.content).toLocaleLowerCase()
  ].join("|");
  if (seen.has(key)) return;
  seen.add(key);
  items.push({
    ...item,
    id: `${item.scope}-${item.kind}-${hashText(key).slice(0, 14)}`
  });
}

function groupContentAiFeatures(items: ContentAiFeatureOption[]): ContentAiFeatureGroups {
  return {
    brandAdvantages: items.filter((item) => item.scope === "brand" && item.kind === "advantage"),
    brandDisadvantages: items.filter((item) => item.scope === "brand" && item.kind === "disadvantage"),
    competitorAdvantages: items.filter((item) => item.scope === "competitor" && item.kind === "advantage"),
    competitorDisadvantages: items.filter((item) => item.scope === "competitor" && item.kind === "disadvantage")
  };
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

function normalizeSelectedFeatures(features: SelectedContentAiFeature[]) {
  return features
    .map((feature) => ({
      scope: feature.scope,
      kind: feature.kind,
      targetName: feature.targetName?.trim() || undefined,
      queryText: feature.queryText?.trim() || undefined,
      platformName: feature.platformName?.trim() || undefined,
      content: normalizeFeatureLine(feature.content || "")
    }))
    .filter((feature) =>
      (feature.scope === "brand" || feature.scope === "competitor") &&
      (feature.kind === "advantage" || feature.kind === "disadvantage") &&
      feature.content.length > 0
    )
    .slice(0, 80);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function parseTitleCandidates(raw: string) {
  const parsed = parseJsonPayload(raw);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { titles?: unknown }).titles)
      ? (parsed as { titles: unknown[] }).titles
      : [];
  const fromJson = values.map((item) => String(item || "").trim()).filter(Boolean);
  const candidates = fromJson.length > 0 ? fromJson : parseTitleCandidatesFromLines(raw);

  const seen = new Set<string>();
  return candidates
    .map((title) => title.replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim())
    .filter((title) => {
      const normalized = title.toLocaleLowerCase();
      if (!title || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function parseJsonPayload(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(text.slice(objectStart, objectEnd + 1));
      } catch {
        return null;
      }
    }
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseTitleCandidatesFromLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^【[^】]+】$/.test(line));
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
  return /^【[^】]+】$/.test(line) || /^引用条目中涉及到的(?:目标对象|品牌)特点[:：]?$/.test(line) || line === "暂无";
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

function normalizeFeatureLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function normalizeContentAssetDraftText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
