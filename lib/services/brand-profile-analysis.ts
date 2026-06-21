import { requestChatCompletion } from "@/lib/services/llm-chat";
import { resolveUsableLlmConfig, type LlmConfigLike } from "@/lib/services/llm-models";
import { splitCsv } from "@/lib/utils";

type BrandProfileForAnalysis = {
  brandNames?: string | null;
  aliases?: string | null;
  brandUrls?: string | null;
  competitors?: Array<{
    name: string;
    aliases?: string | null;
    website?: string | null;
  }>;
};

type ProjectForBrandProfileAnalysis = {
  brandProfile?: BrandProfileForAnalysis | null;
  llmConfig?: LlmConfigLike | null;
};

export type BrandProfileAnalysisSource = {
  id: string;
  url: string;
  fetchedUrl?: string | null;
  title?: string | null;
  domain?: string | null;
  siteName?: string | null;
  summary?: string | null;
  bodyText?: string | null;
  content?: string | null;
  referenceFeatureAnalysis?: string | null;
  competitorReferenceFeatureAnalysis?: string | null;
  run: {
    runAt: Date;
    engineConfig: {
      displayName: string;
    };
  };
};

export type BrandProfileAnalysisResult = {
  report: string;
  warning: string;
  reportCount: number;
};

type BrandEntry = {
  name: string;
  terms: string[];
  domains: string[];
};

type SourceGroup = {
  key: string;
  displayUrl: string;
  items: BrandProfileAnalysisSource[];
};

type ContextSample = {
  url: string;
  title: string;
  siteName: string;
  context: string;
};

type FeatureBucket = {
  advantages: string[];
  disadvantages: string[];
};

type ReportInput = {
  platform: string;
  brandName: string;
  top20LinkCount: number;
  brandDomainLinkCount: number;
  brandDomainRatio: string;
  brandDomainContexts: ContextSample[];
  thirdPartyContexts: ContextSample[];
  brandDomainFeatures: FeatureBucket;
  thirdPartyFeatures: FeatureBucket;
};

const contextLimitPerBucket = 16;
const featureLimitPerBucket = 12;
type BrandProfileAnalysisTarget = "current_brand" | "competitors";

export async function buildBrandProfileAnalysisReport(input: {
  project: ProjectForBrandProfileAnalysis;
  sources: BrandProfileAnalysisSource[];
  useLlm?: boolean;
}): Promise<BrandProfileAnalysisResult> {
  return buildTargetBrandProfileAnalysisReport({ ...input, target: "current_brand" });
}

export async function buildCompetitorBrandAnalysisReport(input: {
  project: ProjectForBrandProfileAnalysis;
  sources: BrandProfileAnalysisSource[];
  useLlm?: boolean;
}): Promise<BrandProfileAnalysisResult> {
  return buildTargetBrandProfileAnalysisReport({ ...input, target: "competitors" });
}

async function buildTargetBrandProfileAnalysisReport(input: {
  project: ProjectForBrandProfileAnalysis;
  sources: BrandProfileAnalysisSource[];
  target: BrandProfileAnalysisTarget;
  useLlm?: boolean;
}): Promise<BrandProfileAnalysisResult> {
  const brands = buildBrandEntries(input.project.brandProfile, input.target);
  const targetLabel = input.target === "competitors" ? "竞品" : "当前品牌";
  const analysisName = input.target === "competitors" ? "竞品品牌分析" : "品牌画像分析";
  if (brands.length === 0) {
    return {
      report: input.target === "competitors"
        ? "当前项目未配置竞品名或竞品别名，无法生成竞品品牌分析报告。"
        : "当前项目未配置品牌名或别名，无法生成品牌画像分析报告。",
      warning: "",
      reportCount: 0
    };
  }

  const reportInputs = buildReportInputs(input.sources, brands, input.target);
  if (reportInputs.length === 0) {
    return {
      report: `当前引用列表筛选结果中，各平台引用量 TOP20 链接未找到包含${targetLabel}名或别名的品牌上下文。`,
      warning: "",
      reportCount: 0
    };
  }

  const fallbackReport = renderFallbackReport(reportInputs);
  if (input.useLlm === false) {
    return {
      report: fallbackReport,
      warning: "",
      reportCount: reportInputs.length
    };
  }

  const config = resolveUsableLlmConfig(input.project.llmConfig, input.target === "competitors" ? "competitorBrandAnalysis" : "brandProfileAnalysis");
  if (!config) {
    return {
      report: fallbackReport,
      warning: "未配置可用 LLM，已基于现有引用特征分析结果生成规则报告。",
      reportCount: reportInputs.length
    };
  }

  try {
    const report = await requestChatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            `你是 GEO ${analysisName}助手。请严格基于用户提供的各平台、${targetLabel} TOP20 引用链接中的品牌上下文，提炼品牌优势与劣势。\n\n` +
            "硬性要求：\n" +
            "1. 必须按用户输入的 reports 顺序逐个输出，不得新增、删除或合并平台-品牌报告。\n" +
            "2. 每个报告标题必须为：【[平台名称]-[品牌名称]画像分析报告】。\n" +
            `3. 仅分析输入 reports 中的${targetLabel}，不得分析其他品牌。\n` +
            "4. 必须区分品牌域名与三方站点，引用TOP20 行中的品牌域名个数、比例必须原样使用输入中的 brandDomainLinkCount 与 brandDomainRatio。\n" +
            "5. 只允许使用输入上下文和已有特征，不得编造事实、数据、客户案例或外部信息。\n" +
            "6. 每个优势行必须以 [优势] 开头，每个劣势行必须以 [劣势] 开头；每行末尾使用中文分号。\n" +
            "7. 若某一段没有明确优势或劣势，输出一行：[优势]暂无明确提及；或 [劣势]暂无明确提及；。\n" +
            "8. 不输出 Markdown 代码块、解释、编号或额外标题。"
        },
        {
          role: "user",
          content: JSON.stringify({
            outputTemplate:
              `${targetLabel}报告模板：\n` +
              "【[平台名称]-[品牌名称]画像分析报告】\n" +
              "引用TOP20：品牌域名占[个数]个，[比例]%；\n" +
              "品牌域名提及品牌优势：\n" +
              "[优势]...；\n" +
              "品牌域名提及品牌劣势：\n" +
              "[劣势]...；\n" +
              "三方站点提及品牌优势：\n" +
              "[优势]...；\n" +
              "三方站点提及品牌劣势：\n" +
              "[劣势]...；",
            reports: reportInputs
          })
        }
      ]
    });
    const normalized = normalizeLlmReport(report);
    return {
      report: normalized || fallbackReport,
      warning: normalized ? "" : "LLM 未返回有效报告，已基于现有引用特征分析结果生成规则报告。",
      reportCount: reportInputs.length
    };
  } catch (error) {
    return {
      report: fallbackReport,
      warning: `LLM ${analysisName}失败：${error instanceof Error ? error.message : "未知错误"}。已基于现有引用特征分析结果生成规则报告。`,
      reportCount: reportInputs.length
    };
  }
}

function buildBrandEntries(profile: BrandProfileForAnalysis | null | undefined, target: BrandProfileAnalysisTarget): BrandEntry[] {
  if (!profile) return [];
  if (target === "competitors") {
    return (profile.competitors || []).flatMap((competitor) => {
      const name = competitor.name.trim();
      const terms = uniqueTerms([name, ...splitCsv(competitor.aliases)]);
      if (!name || terms.length === 0) return [];
      return [{
        name,
        terms,
        domains: normalizeDomains(splitCsv(competitor.website))
      }];
    });
  }

  const currentBrandName = splitCsv(profile.brandNames)[0] || splitCsv(profile.aliases)[0] || "";
  const currentTerms = uniqueTerms([...splitCsv(profile.brandNames), ...splitCsv(profile.aliases)]);
  if (currentBrandName && currentTerms.length > 0) {
    return [{
      name: currentBrandName,
      terms: currentTerms,
      domains: normalizeDomains(splitCsv(profile.brandUrls))
    }];
  }
  return [];
}

function buildReportInputs(sources: BrandProfileAnalysisSource[], brands: BrandEntry[], target: BrandProfileAnalysisTarget) {
  const groups = groupSourcesByLink(sources);
  const platforms = summarizePlatformCounts(sources).map((item) => item.platform);
  const reports: ReportInput[] = [];

  for (const platform of platforms) {
    for (const brand of brands) {
      const topGroups = top20GroupsForPlatform(groups, platform, brand.terms);
      if (topGroups.length === 0) continue;
      const brandDomainLinkCount = topGroups.filter((group) => isBrandDomain(group.displayUrl, brand.domains)).length;
      const brandDomainContexts: ContextSample[] = [];
      const thirdPartyContexts: ContextSample[] = [];
      const brandDomainFeatures = emptyFeatureBucket();
      const thirdPartyFeatures = emptyFeatureBucket();

      for (const group of topGroups) {
        const isOwnedDomain = isBrandDomain(group.displayUrl, brand.domains);
        const bucketContexts = isOwnedDomain ? brandDomainContexts : thirdPartyContexts;
        const bucketFeatures = isOwnedDomain ? brandDomainFeatures : thirdPartyFeatures;
        const platformSources = group.items.filter((source) => source.run.engineConfig.displayName === platform);

        for (const source of platformSources) {
          const contexts = buildReferenceContexts(sourceText(source), brand.terms);
          if (contexts.length === 0) continue;
          for (const context of contexts.slice(0, 3)) {
            const sample = {
              url: referenceDisplayUrl(source),
              title: source.title || source.siteName || source.domain || referenceDisplayUrl(source) || "未命名引用",
              siteName: source.siteName || source.domain || domainFromMaybeUrl(referenceDisplayUrl(source)),
              context
            };
            pushUniqueContext(bucketContexts, sample);
          }
          const featureItems = parseSourceFeatureItems(source, brand.terms, target);
          pushFeatureItems(bucketFeatures, featureItems);
        }
      }

      if (brandDomainContexts.length === 0 && thirdPartyContexts.length === 0) continue;
      reports.push({
        platform,
        brandName: brand.name,
        top20LinkCount: topGroups.length,
        brandDomainLinkCount,
        brandDomainRatio: `${Math.round((brandDomainLinkCount / Math.max(1, topGroups.length)) * 100)}%`,
        brandDomainContexts: brandDomainContexts.slice(0, contextLimitPerBucket),
        thirdPartyContexts: thirdPartyContexts.slice(0, contextLimitPerBucket),
        brandDomainFeatures: limitFeatureBucket(brandDomainFeatures),
        thirdPartyFeatures: limitFeatureBucket(thirdPartyFeatures)
      });
    }
  }

  return reports;
}

function renderFallbackReport(reports: ReportInput[]) {
  return reports.map((report) => [
    `【${report.platform}-${report.brandName}画像分析报告】`,
    `引用TOP20：品牌域名占${report.brandDomainLinkCount}个，${report.brandDomainRatio}；`,
    "品牌域名提及品牌优势：",
    ...renderFeatureLines("优势", report.brandDomainFeatures.advantages),
    "品牌域名提及品牌劣势：",
    ...renderFeatureLines("劣势", report.brandDomainFeatures.disadvantages),
    "三方站点提及品牌优势：",
    ...renderFeatureLines("优势", report.thirdPartyFeatures.advantages),
    "三方站点提及品牌劣势：",
    ...renderFeatureLines("劣势", report.thirdPartyFeatures.disadvantages)
  ].join("\n")).join("\n\n");
}

function renderFeatureLines(kind: "优势" | "劣势", values: string[]) {
  if (values.length === 0) return [`[${kind}]暂无明确提及；`];
  return values.map((value) => `[${kind}]${ensureChineseSemicolon(cleanFeatureText(value))}`);
}

function groupSourcesByLink(sources: BrandProfileAnalysisSource[]) {
  const groups = new Map<string, SourceGroup>();
  for (const source of sources) {
    const displayUrl = referenceDisplayUrl(source);
    const key = displayUrl ? normalizeReferenceGroupKey(displayUrl) : `source:${source.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(source);
      continue;
    }
    groups.set(key, { key, displayUrl, items: [source] });
  }
  return [...groups.values()];
}

function top20GroupsForPlatform(groups: SourceGroup[], platform: string, terms: string[]) {
  return [...groups]
    .filter((group) => countGroupPlatformReferences(group, platform, terms) > 0)
    .sort((left, right) => {
      const platformDelta = countGroupPlatformReferences(right, platform, terms) - countGroupPlatformReferences(left, platform, terms);
      if (platformDelta !== 0) return platformDelta;
      if (right.items.length !== left.items.length) return right.items.length - left.items.length;
      return latestRunAt(right) - latestRunAt(left);
    })
    .slice(0, 20);
}

function countGroupPlatformReferences(group: SourceGroup, platform: string, terms: string[]) {
  return group.items.reduce((total, source) => {
    if (source.run.engineConfig.displayName !== platform) return total;
    return buildReferenceContexts(sourceText(source), terms).length > 0 ? total + 1 : total;
  }, 0);
}

function latestRunAt(group: SourceGroup) {
  return Math.max(...group.items.map((source) => source.run.runAt.getTime()));
}

function summarizePlatformCounts(items: BrandProfileAnalysisSource[]) {
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

function parseSourceFeatureItems(source: BrandProfileAnalysisSource, terms: string[], target: BrandProfileAnalysisTarget) {
  return parseFeatureItems(
    target === "competitors" ? source.competitorReferenceFeatureAnalysis || "" : source.referenceFeatureAnalysis || "",
    terms,
    target
  );
}

function parseFeatureItems(report: string, terms: string[], target: BrandProfileAnalysisTarget) {
  const normalizedTerms = new Set(terms.map((term) => term.trim().toLocaleLowerCase()).filter(Boolean));
  const targetPrefixPattern = target === "competitors" ? "竞品名|别名" : "品牌名|别名";
  return report.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    const match = line.match(new RegExp(`^\\s*(?:[-*•]|\\d+[.、])?\\s*\\[(?:${targetPrefixPattern})(?:[:：]([^\\]]+))?\\]\\[(优势|劣势)\\](.+)$`));
    if (!match) return [];
    const matchedTerm = match[1]?.trim();
    if (matchedTerm && !normalizedTerms.has(matchedTerm.toLocaleLowerCase())) return [];
    return [{
      kind: match[2] as "优势" | "劣势",
      text: cleanFeatureText(match[3])
    }];
  });
}

function buildReferenceContexts(text: string, terms: string[]) {
  const detailText = normalizeContextText(text);
  if (!detailText) return [] as string[];

  const lowerText = detailText.toLocaleLowerCase();
  const contexts: string[] = [];
  for (const term of uniqueTerms(terms)) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) continue;

    const lowerTerm = normalizedTerm.toLocaleLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length && contexts.length < 24) {
      const position = lowerText.indexOf(lowerTerm, searchFrom);
      if (position < 0) break;
      const endPosition = position + normalizedTerm.length;
      contexts.push([
        detailText.slice(Math.max(0, position - 60), position),
        detailText.slice(position, endPosition),
        detailText.slice(endPosition, Math.min(detailText.length, endPosition + 360))
      ].join(""));
      searchFrom = endPosition;
    }
  }

  return uniqueTerms(contexts).sort((left, right) => left.length - right.length);
}

function pushFeatureItems(bucket: FeatureBucket, items: Array<{ kind: "优势" | "劣势"; text: string }>) {
  for (const item of items) {
    const target = item.kind === "优势" ? bucket.advantages : bucket.disadvantages;
    pushUniqueText(target, item.text, featureLimitPerBucket * 2);
  }
}

function pushUniqueContext(target: ContextSample[], context: ContextSample) {
  if (target.some((item) => normalizeDedupeKey(item.context) === normalizeDedupeKey(context.context))) return;
  target.push({
    ...context,
    context: context.context.slice(0, 520)
  });
}

function limitFeatureBucket(bucket: FeatureBucket): FeatureBucket {
  return {
    advantages: bucket.advantages.slice(0, featureLimitPerBucket),
    disadvantages: bucket.disadvantages.slice(0, featureLimitPerBucket)
  };
}

function emptyFeatureBucket(): FeatureBucket {
  return { advantages: [], disadvantages: [] };
}

function normalizeDomains(values: string[]) {
  return uniqueTerms(values.map(normalizeDomain).filter(Boolean));
}

function normalizeDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./i, "").toLocaleLowerCase();
  } catch {
    return trimmed.replace(/^www\./i, "").split("/")[0].toLocaleLowerCase();
  }
}

function isBrandDomain(url: string, brandDomains: string[]) {
  if (brandDomains.length === 0) return false;
  const domain = domainFromMaybeUrl(url);
  return brandDomains.some((brandDomain) => domain === brandDomain || domain.endsWith(`.${brandDomain}`));
}

function domainFromMaybeUrl(value: string) {
  const normalized = normalizeDomain(value);
  return normalized || "未知域名";
}

function referenceDisplayUrl(source: Pick<BrandProfileAnalysisSource, "fetchedUrl" | "url">) {
  return source.fetchedUrl || source.url || "";
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

function sourceText(source: BrandProfileAnalysisSource) {
  return [source.bodyText, source.content, source.summary, source.title].filter(Boolean).join("\n");
}

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cleanFeatureText(value: string) {
  return value
    .replace(/\[答案提及\]/g, "")
    .replace(/^[：:，,；;\s]+/, "")
    .replace(/[；;\s]+$/g, "")
    .trim();
}

function ensureChineseSemicolon(value: string) {
  const trimmed = value.trim().replace(/[；;。.\s]+$/g, "");
  return `${trimmed || "暂无明确提及"}；`;
}

function pushUniqueText(target: string[], value: string, limit: number) {
  const cleaned = cleanFeatureText(value);
  if (!cleaned || target.length >= limit) return;
  if (target.some((item) => normalizeDedupeKey(item) === normalizeDedupeKey(cleaned))) return;
  target.push(cleaned);
}

function normalizeDedupeKey(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase();
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

function normalizeLlmReport(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:text|markdown|md)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] || trimmed).trim();
}
