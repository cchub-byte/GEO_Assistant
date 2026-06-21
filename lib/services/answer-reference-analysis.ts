import { prisma } from "@/lib/db";
import { assertUsableLlmConfig } from "@/lib/services/llm-models";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import { primaryBrandName, splitCsv } from "@/lib/utils";

type BrandReferenceContext = {
  siteName: string;
  sourceTitle: string;
  sourceUrl: string;
  term: string;
  context: string;
  position: number;
};

export async function analyzeAnswerReferenceRun(runId: string) {
  const run = await prisma.answerRun.findUnique({
    where: { id: runId },
    include: {
      query: true,
      engineConfig: true,
      project: {
        include: {
          brandProfile: true,
          llmConfig: true
        }
      },
      sources: { orderBy: [{ position: "asc" }, { id: "asc" }] }
    }
  });
  if (!run) return null;

  try {
    const config = assertUsableLlmConfig(run.project.llmConfig, "answerAnalysis");
    if (!run.answerAnalysis?.trim()) {
      throw new Error("请先完成回答分析，再进行二合一分析");
    }

    const brandTerms = buildCurrentBrandTerms(run.project.brandProfile);
    if (brandTerms.length === 0) {
      throw new Error("当前项目未设置品牌名或品牌别名");
    }

    const contexts = run.sources.flatMap((source) =>
      buildBrandReferenceContexts({
        text: source.bodyText || source.content || "",
        brandTerms,
        siteName: source.siteName || source.domain || "未知来源",
        sourceTitle: source.title || "未命名引用",
        sourceUrl: source.fetchedUrl || source.url
      })
    );
    if (contexts.length === 0) {
      throw new Error("当前 Query 没有可用于二合一分析的品牌引用上下文");
    }

    const analysis = await requestAnswerReferenceAnalysis({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      platform: run.engineConfig.displayName,
      queryText: run.query.queryText,
      brandName: primaryBrandName(run.project.brandProfile),
      brandTerms,
      answerAnalysis: run.answerAnalysis,
      contexts
    });

    return prisma.answerRun.update({
      where: { id: run.id },
      data: {
        answerReferenceAnalysis: analysis,
        answerReferenceAnalysisAt: new Date(),
        answerReferenceAnalysisError: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "二合一分析失败";
    return prisma.answerRun.update({
      where: { id: run.id },
      data: {
        answerReferenceAnalysisError: message,
        answerReferenceAnalysisAt: new Date()
      }
    });
  }
}

async function requestAnswerReferenceAnalysis(input: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  platform: string;
  queryText: string;
  brandName: string;
  brandTerms: string[];
  answerAnalysis: string;
  contexts: BrandReferenceContext[];
}) {
  return requestChatCompletion({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    modelName: input.modelName,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO 生成式搜索营销分析助手。请读取回答分析报告中的固定格式字段：[提及品牌优点] 与 [提及品牌缺点]，并将其中判断为“是”的优点/缺点时机，与每个引用的品牌引用上下文进行对比，判断回答内容提及的当前品牌优点和缺点分别来源于哪些站点。\n\n" +
          "严格要求：只分析当前品牌；不要分析[提及竞品优点]或[提及竞品缺点]；只使用回答分析报告中[提及品牌优点]和[提及品牌缺点]对应的时机内容；只基于引用上下文做来源归因，不得编造来源；如果无法匹配来源则不要输出该项。\n\n" +
          "输出格式：\n【二合一分析报告】\n[站点名称][优势][内容]\n[站点名称][劣势][内容]\n\n" +
          "每条独立成行；站点名称必须来自输入的 siteName；第二个方括号只能是“优势”或“劣势”，其中“优势”对应[提及品牌优点]，“劣势”对应[提及品牌缺点]；内容需要说明回答中的优点/缺点与该站点引用上下文的对应关系。若没有任何可匹配项，仅输出：\n【二合一分析报告】\n暂无"
      },
      {
        role: "user",
        content: JSON.stringify({
          platform: input.platform,
          query: input.queryText,
          brand: {
            name: input.brandName,
            terms: input.brandTerms
          },
          answerAnalysis: input.answerAnalysis,
          brandReferenceContexts: input.contexts.map((context, index) => ({
            index: index + 1,
            siteName: context.siteName,
            sourceTitle: context.sourceTitle,
            sourceUrl: context.sourceUrl,
            matchedKeyword: context.term,
            context: context.context
          }))
        })
      }
    ]
  });
}

function buildBrandReferenceContexts(input: {
  text: string;
  brandTerms: string[];
  siteName: string;
  sourceTitle: string;
  sourceUrl: string;
}) {
  const detailText = normalizeContextText(input.text);
  if (!detailText) return [] as BrandReferenceContext[];

  const lowerText = detailText.toLocaleLowerCase();
  const contexts: BrandReferenceContext[] = [];
  for (const term of uniqueTerms(input.brandTerms)) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) continue;

    const lowerTerm = normalizedTerm.toLocaleLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const position = lowerText.indexOf(lowerTerm, searchFrom);
      if (position < 0) break;
      const endPosition = position + normalizedTerm.length;
      contexts.push({
        siteName: input.siteName,
        sourceTitle: input.sourceTitle,
        sourceUrl: input.sourceUrl,
        term: normalizedTerm,
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

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
