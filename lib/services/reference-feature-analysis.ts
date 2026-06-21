import { prisma } from "@/lib/db";
import { assertUsableLlmConfig } from "@/lib/services/llm-models";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import { primaryBrandName, splitCsv } from "@/lib/utils";

const systemPrompt = `你是一个GEO生成式搜索营销专家，给定目标品牌或竞品在互联网上的引用条目，你来分析这些引用条目，按给定格式输出分析报告。

## 给定格式
【引用分析报告】
引用条目中涉及到的目标对象特点：
[品牌名：实际命中词][优势]特点1 [答案提及]
[别名：实际命中词][劣势]特点2
[竞品名：实际命中词][优势]特点3
...`;

type ReferenceTermType = "品牌名" | "竞品名" | "别名";

type ReferenceTermEntry = {
  term: string;
  termType: ReferenceTermType;
  canonicalName?: string;
};

type ReferenceContext = {
  sourcePosition: number;
  sourceTitle: string;
  sourceUrl: string;
  term: string;
  termType: ReferenceTermType;
  canonicalName?: string;
  context: string;
  position: number;
};

type ReferenceFeatureRun = NonNullable<Awaited<ReturnType<typeof loadReferenceFeatureRun>>>;

export async function analyzeReferenceFeatureRun(runId: string) {
  const run = await loadReferenceFeatureRun(runId);
  if (!run) return null;

  try {
    const termEntries = buildCurrentBrandTermEntries(run.project.brandProfile);
    const competitorTermEntries = buildCompetitorTermEntries(run.project.brandProfile?.competitors || []);
    if (!hasAnyReferenceMention(run.sources, termEntries, competitorTermEntries)) {
      return clearRunReferenceFeatureAnalysis(run, "brand");
    }

    if (termEntries.length === 0) {
      throw new Error("当前项目未设置品牌名或品牌别名");
    }

    return analyzeSourceReferenceFeatures({
      run,
      termEntries,
      targetName: primaryBrandName(run.project.brandProfile),
      targetKind: "current_brand",
      outputPrefixes: ["品牌名", "别名"],
      scope: "brand"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "引用特征分析失败";
    return prisma.answerRun.update({
      where: { id: run.id },
      data: {
        referenceFeatureAnalysisError: message,
        referenceFeatureAnalysisAt: new Date()
      }
    });
  }
}

export async function analyzeCompetitorReferenceFeatureRun(runId: string) {
  const run = await loadReferenceFeatureRun(runId);
  if (!run) return null;

  try {
    const termEntries = buildCompetitorTermEntries(run.project.brandProfile?.competitors || []);
    const currentBrandTermEntries = buildCurrentBrandTermEntries(run.project.brandProfile);
    if (!hasAnyReferenceMention(run.sources, currentBrandTermEntries, termEntries)) {
      return clearRunReferenceFeatureAnalysis(run, "competitor");
    }

    if (termEntries.length === 0) {
      throw new Error("当前项目未设置竞品名或竞品别名");
    }

    return analyzeSourceReferenceFeatures({
      run,
      termEntries,
      targetName: "竞品集合",
      targetKind: "competitors",
      outputPrefixes: ["竞品名", "别名"],
      scope: "competitor"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "竞品引用特征分析失败";
    return prisma.answerRun.update({
      where: { id: run.id },
      data: {
        competitorReferenceFeatureAnalysisError: message,
        competitorReferenceFeatureAnalysisAt: new Date()
      }
    });
  }
}

function loadReferenceFeatureRun(runId: string) {
  return prisma.answerRun.findUnique({
    where: { id: runId },
    include: {
      query: true,
      engineConfig: true,
      project: {
        include: {
          brandProfile: { include: { competitors: true } },
          llmConfig: true
        }
      },
      sources: { orderBy: [{ position: "asc" }, { id: "asc" }] }
    }
  });
}

async function analyzeSourceReferenceFeatures(input: {
  run: ReferenceFeatureRun;
  termEntries: ReferenceTermEntry[];
  targetName: string;
  targetKind: "current_brand" | "competitors";
  outputPrefixes: ReferenceTermType[];
  scope: "brand" | "competitor";
}) {
  const config = assertUsableLlmConfig(
    input.run.project.llmConfig,
    input.scope === "brand" ? "referenceFeatureAnalysis" : "competitorReferenceFeatureAnalysis"
  );

  const now = new Date();
  const sourceResults: Array<{ sourceId: string; analysis: string }> = [];
  let failedCount = 0;
  let analyzableCount = 0;

  for (const source of input.run.sources) {
    const contexts = buildReferenceContexts({
      text: source.bodyText || source.content || "",
      termEntries: input.termEntries,
      sourcePosition: source.position,
      sourceTitle: source.title || "未命名引用",
      sourceUrl: source.fetchedUrl || source.url
    });

    if (contexts.length === 0) {
      await updateSourceReferenceFeatureAnalysis(source.id, input.scope, {
        analysis: null,
        analyzedAt: null,
        error: null
      });
      continue;
    }

    analyzableCount += 1;
    try {
      const analysis = await requestReferenceFeatureAnalysis({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        modelName: config.modelName,
        platform: input.run.engineConfig.displayName,
        queryText: input.run.query.queryText,
        targetName: input.targetName,
        targetKind: input.targetKind,
        termEntries: input.termEntries,
        contexts,
        answerText: input.run.answerText,
        outputPrefixes: input.outputPrefixes
      });
      await updateSourceReferenceFeatureAnalysis(source.id, input.scope, {
        analysis,
        analyzedAt: now,
        error: null
      });
      sourceResults.push({ sourceId: source.id, analysis });
    } catch (error) {
      failedCount += 1;
      await updateSourceReferenceFeatureAnalysis(source.id, input.scope, {
        analysis: null,
        analyzedAt: now,
        error: error instanceof Error ? error.message : "引用特征分析失败"
      });
    }
  }

  if (analyzableCount === 0) {
    return clearRunReferenceFeatureAnalysis(input.run, input.scope);
  }

  const aggregateAnalysis = sourceResults
    .flatMap((item) => item.analysis.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .join("\n");
  const aggregateError = failedCount > 0 ? `${failedCount} 条引用分析失败` : null;
  return updateRunReferenceFeatureAnalysis(input.run.id, input.scope, {
    analysis: aggregateAnalysis || null,
    analyzedAt: now,
    error: aggregateError
  });
}

async function clearRunReferenceFeatureAnalysis(run: ReferenceFeatureRun, scope: "brand" | "competitor") {
  if (scope === "brand") {
    await prisma.source.updateMany({
      where: { runId: run.id },
      data: {
        referenceFeatureAnalysis: null,
        referenceFeatureAnalysisAt: null,
        referenceFeatureAnalysisError: null
      }
    });
  } else {
    await prisma.source.updateMany({
      where: { runId: run.id },
      data: {
        competitorReferenceFeatureAnalysis: null,
        competitorReferenceFeatureAnalysisAt: null,
        competitorReferenceFeatureAnalysisError: null
      }
    });
  }
  return updateRunReferenceFeatureAnalysis(run.id, scope, {
    analysis: null,
    analyzedAt: null,
    error: null
  });
}

function updateRunReferenceFeatureAnalysis(
  runId: string,
  scope: "brand" | "competitor",
  values: { analysis: string | null; analyzedAt: Date | null; error: string | null }
) {
  if (scope === "brand") {
    return prisma.answerRun.update({
      where: { id: runId },
      data: {
        referenceFeatureAnalysis: values.analysis,
        referenceFeatureAnalysisAt: values.analyzedAt,
        referenceFeatureAnalysisError: values.error
      },
      include: { sources: { orderBy: [{ position: "asc" }, { id: "asc" }] } }
    });
  }
  return prisma.answerRun.update({
    where: { id: runId },
    data: {
      competitorReferenceFeatureAnalysis: values.analysis,
      competitorReferenceFeatureAnalysisAt: values.analyzedAt,
      competitorReferenceFeatureAnalysisError: values.error
    },
    include: { sources: { orderBy: [{ position: "asc" }, { id: "asc" }] } }
  });
}

function updateSourceReferenceFeatureAnalysis(
  sourceId: string,
  scope: "brand" | "competitor",
  values: { analysis: string | null; analyzedAt: Date | null; error: string | null }
) {
  if (scope === "brand") {
    return prisma.source.update({
      where: { id: sourceId },
      data: {
        referenceFeatureAnalysis: values.analysis,
        referenceFeatureAnalysisAt: values.analyzedAt,
        referenceFeatureAnalysisError: values.error
      }
    });
  }
  return prisma.source.update({
    where: { id: sourceId },
    data: {
      competitorReferenceFeatureAnalysis: values.analysis,
      competitorReferenceFeatureAnalysisAt: values.analyzedAt,
      competitorReferenceFeatureAnalysisError: values.error
    }
  });
}

async function requestReferenceFeatureAnalysis(input: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  platform: string;
  queryText: string;
  targetName: string;
  targetKind: "current_brand" | "competitors";
  termEntries: ReferenceTermEntry[];
  contexts: ReferenceContext[];
  answerText: string;
  outputPrefixes: ReferenceTermType[];
}) {
  const targetDescription = input.targetKind === "competitors"
    ? "分析对象仅限 user 消息中 target.terms 指定的竞品集合；如果上下文中出现当前品牌或其他未列入竞品术语的品牌，只能作为背景信息理解，不得提炼或输出为竞品特点；"
    : "分析对象仅限 user 消息中 target.name 与 target.terms 指定的当前品牌；如果品牌引用上下文中出现其他品牌、竞品、平台或产品，只能作为背景信息理解，不得提炼或输出为被分析品牌的特点；";
  const allowedPrefixText = input.outputPrefixes
    .map((prefix) => `[${prefix}：实际命中词][优势]特点 或 [${prefix}：实际命中词][劣势]特点`)
    .join("、");

  return requestChatCompletion({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    modelName: input.modelName,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          `${systemPrompt}\n\n` +
          "要求：严格只输出给定格式；只基于输入的目标引用上下文，不得编造上下文中不存在的特点；" +
          targetDescription +
          `每个特点必须以实际命中的目标词和特点类型作为前缀，格式只能是 ${allowedPrefixText}；` +
          "实际命中词必须来自对应引用上下文的 matchedKeyword，matchedKeywordType 为“品牌名”则使用 [品牌名：...]，matchedKeywordType 为“竞品名”则使用 [竞品名：...]，matchedKeywordType 为“别名”则使用 [别名：...]，不得统一改写为主品牌名或竞品名；" +
          "如果上下文体现的是正向价值、能力、适用场景、功能、效率、体验、成本收益等，标为 [优势]；如果上下文体现的是限制、问题、缺口、门槛、风险、成本、复杂度或不足，标为 [劣势]；" +
          "每提炼一条优势或劣势后，必须与 answerText 对照；如果该优势或劣势在 answerText 中已经被明确说明，或以语义等价方式被说明，则必须在该条特点文本末尾追加空格和标注 [答案提及]；如果 answerText 未说明该特点，则不得追加该标注；" +
          "标注只能放在整条特点最后，例如：[品牌名：实际命中词][优势]支持审批流 [答案提及]，不得放在 [优势] 或 [劣势] 前后缀位置；" +
          "每个特点必须独立成行展示，不要用顿号、逗号或分号把多个特点放在同一行。"
      },
      {
        role: "user",
        content: JSON.stringify({
          platform: input.platform,
          query: input.queryText,
          target: {
            name: input.targetName,
            kind: input.targetKind,
            terms: input.termEntries,
            analysisScope: input.targetKind === "competitors"
              ? "仅分析列出的竞品；忽略当前品牌和未列入竞品术语的其他品牌特点。"
              : "仅分析当前品牌；忽略上下文中涉及的其他品牌特点。"
          },
          answerText: input.answerText.slice(0, 20000),
          referenceContexts: input.contexts.map((context, index) => ({
            index: index + 1,
            sourcePosition: context.sourcePosition,
            sourceTitle: context.sourceTitle,
            sourceUrl: context.sourceUrl,
            matchedKeyword: context.term,
            matchedKeywordType: context.termType,
            canonicalName: context.canonicalName,
            context: context.context
          }))
        })
      }
    ]
  });
}

function buildReferenceContexts(input: {
  text: string;
  termEntries: ReferenceTermEntry[];
  sourcePosition: number;
  sourceTitle: string;
  sourceUrl: string;
}) {
  const detailText = normalizeContextText(input.text);
  if (!detailText) return [] as ReferenceContext[];

  const lowerText = detailText.toLocaleLowerCase();
  const contexts: ReferenceContext[] = [];
  for (const entry of input.termEntries) {
    const normalizedTerm = entry.term.trim();
    if (!normalizedTerm) continue;

    const lowerTerm = normalizedTerm.toLocaleLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const position = lowerText.indexOf(lowerTerm, searchFrom);
      if (position < 0) break;
      const endPosition = position + normalizedTerm.length;
      contexts.push({
        sourcePosition: input.sourcePosition,
        sourceTitle: input.sourceTitle,
        sourceUrl: input.sourceUrl,
        term: normalizedTerm,
        termType: entry.termType,
        canonicalName: entry.canonicalName,
        context: [
          detailText.slice(Math.max(0, position - 30), position),
          detailText.slice(position, endPosition),
          detailText.slice(endPosition, Math.min(detailText.length, endPosition + 300))
        ].join(""),
        position
      });
      searchFrom = endPosition;
    }
  }

  return contexts.sort((left, right) => left.position - right.position || right.term.length - left.term.length);
}

function buildCurrentBrandTermEntries(brand?: { brandNames?: string | null; aliases?: string | null } | null) {
  return uniqueTermEntries([
    ...splitCsv(brand?.brandNames).map((term) => ({ term, termType: "品牌名" as const })),
    ...splitCsv(brand?.aliases).map((term) => ({ term, termType: "别名" as const }))
  ]);
}

function buildCompetitorTermEntries(competitors: Array<{ name: string; aliases?: string | null }>) {
  return uniqueTermEntries(
    competitors.flatMap((competitor) => [
      { term: competitor.name, termType: "竞品名" as const, canonicalName: competitor.name },
      ...splitCsv(competitor.aliases).map((term) => ({ term, termType: "别名" as const, canonicalName: competitor.name }))
    ])
  );
}

function uniqueTermEntries(entries: ReferenceTermEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const normalized = entry.term.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function hasAnyReferenceMention(
  sources: Array<{ bodyText?: string | null; content?: string | null }>,
  brandTermEntries: ReferenceTermEntry[],
  competitorTermEntries: ReferenceTermEntry[]
) {
  const brandTerms = brandTermEntries.map((entry) => entry.term);
  const competitorTerms = competitorTermEntries.map((entry) => entry.term);
  return sources.some((source) => {
    const text = source.bodyText || source.content || "";
    const hasBrand = containsAnyTerm(text, brandTerms);
    const hasCompetitor = containsAnyTerm(text, competitorTerms);
    return hasBrand || hasCompetitor || (hasBrand && hasCompetitor);
  });
}

function containsAnyTerm(text: string, terms: string[]) {
  const normalizedText = text.toLocaleLowerCase();
  return terms.some((term) => {
    const normalizedTerm = term.trim().toLocaleLowerCase();
    return normalizedTerm.length > 0 && normalizedText.includes(normalizedTerm);
  });
}
