import { prisma } from "@/lib/db";
import { assertUsableLlmConfig } from "@/lib/services/llm-models";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import { primaryBrandName, splitCsv } from "@/lib/utils";

export async function analyzeAnswerRun(runId: string) {
  const run = await prisma.answerRun.findUnique({
    where: { id: runId },
    include: {
      query: true,
      engineConfig: true,
      project: {
        include: {
          brandProfile: { include: { competitors: true } },
          llmConfig: true
        }
      }
    }
  });
  if (!run) return null;

  try {
    const config = assertUsableLlmConfig(run.project.llmConfig, "answerAnalysis");
    if (!run.answerText.trim()) {
      throw new Error("当前采样没有回答内容");
    }

    const brandName = primaryBrandName(run.project.brandProfile);
    const currentBrandTerms = buildCurrentBrandTerms(run.project.brandProfile);
    const competitors = run.project.brandProfile?.competitors.map((competitor) => competitor.name).filter(Boolean) || [];
    const analysis = await requestAnswerAnalysis({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      platform: run.engineConfig.displayName,
      queryText: run.query.queryText,
      answerText: run.answerText,
      brandName,
      brandTerms: currentBrandTerms,
      competitors
    });

    return prisma.answerRun.update({
      where: { id: run.id },
      data: {
        answerAnalysis: analysis,
        answerAnalysisAt: new Date(),
        answerAnalysisError: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "回答分析失败";
    return prisma.answerRun.update({
      where: { id: run.id },
      data: {
        answerAnalysisError: message,
        answerAnalysisAt: new Date()
      }
    });
  }
}

async function requestAnswerAnalysis(input: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  platform: string;
  queryText: string;
  answerText: string;
  brandName: string;
  brandTerms: string[];
  competitors: string[];
}) {
  const content = await requestChatCompletion({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    modelName: input.modelName,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO 分析助手。请基于给定 AI Query 回答，判断回答是否提及当前品牌优点、当前品牌缺点、竞品优点、竞品缺点，并输出可被程序稳定抽取的固定格式。\n\n" +
          "分析口径：\n" +
          "1. “品牌”仅指输入 brand 中的当前品牌名称或别名；“竞品”仅指输入 competitors 中列出的品牌。\n" +
          "2. “优点”包括优势、卖点、推荐理由、正向能力、正向评价、适用场景；“缺点”包括不足、风险、限制、负向评价、不适用场景。\n" +
          "3. “时机”不是行号或时间点，而是回答在什么角度、维度或方法下提及相关品牌/竞品的优点或缺点。建议格式为“角度/维度/方法：优缺点摘要”，例如“功能维度：提及集成能力强”“采购决策维度：提及价格限制”“对比方法：与 Asana 比较协作模板”。\n" +
          "4. 时机必须能从回答原文中归纳，不得编造回答中不存在的角度、维度、方法或事实。\n" +
          "5. 若某类没有提及，判断值必须为“否”，下一行必须输出且仅输出“[无]”。\n" +
          "6. 若 competitors 为空，则竞品优点和竞品缺点必须均为“否”。\n\n" +
          "输出硬性要求：\n" +
          "1. 只输出以下 8 行，不要标题、编号、解释、Markdown 或代码块。\n" +
          "2. 第 1、3、5、7 行第二个方括号只能是“是”或“否”。\n" +
          "3. 第 2、4、6、8 行必须是一个或多个方括号；有多个时机时连续输出，例如：[功能维度：提及集成能力强][采购决策维度：提及价格限制]；无提及时输出：[无]。\n\n" +
          "4. 必须将模板中的“是/否”“时机1”“时机2”替换为实际判断和实际时机，禁止原样输出占位符。\n\n" +
          "[提及品牌优点][是/否]\n" +
          "[时机1][时机2]\n" +
          "[提及品牌缺点][是/否]\n" +
          "[时机1][时机2]\n" +
          "[提及竞品优点][是/否]\n" +
          "[时机1][时机2]\n" +
          "[提及竞品缺点][是/否]\n" +
          "[时机1][时机2]"
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
          competitors: input.competitors,
          answerText: input.answerText.slice(0, 20000)
        })
      }
    ]
  });
  return normalizeAnswerAnalysisOutput(content);
}

export const answerAnalysisLabels = ["提及品牌优点", "提及品牌缺点", "提及竞品优点", "提及竞品缺点"] as const;
export type AnswerAnalysisLabel = (typeof answerAnalysisLabels)[number];
export type ParsedAnswerAnalysisSection = {
  label: AnswerAnalysisLabel;
  status: "是" | "否";
  timings: string[];
};

export function normalizeAnswerAnalysisOutput(content: string) {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"));
  const normalizedLines: string[] = [];
  let searchStart = 0;

  for (const label of answerAnalysisLabels) {
    const lineIndex = lines.findIndex((line, index) => index >= searchStart && line.includes(`[${label}]`));
    if (lineIndex < 0) {
      throw new Error(`回答分析格式不符合要求：缺少[${label}]`);
    }

    const labelLine = lines[lineIndex];
    const statusPattern = new RegExp(`\\[${escapeRegex(label)}\\]\\s*\\[(是|否)\\]`);
    const statusMatch = labelLine.match(statusPattern);
    if (!statusMatch) {
      throw new Error(`回答分析格式不符合要求：[${label}]必须标记为[是]或[否]`);
    }

    const status = statusMatch[1];
    normalizedLines.push(`[${label}][${status}]`);

    if (status === "否") {
      normalizedLines.push("[无]");
      searchStart = lineIndex + 1;
      continue;
    }

    const sameLineTail = labelLine.slice((statusMatch.index || 0) + statusMatch[0].length);
    const sameLineTimings = extractTimingSegments(sameLineTail);
    const nextLineTimings = sameLineTimings.length > 0 ? [] : extractTimingSegments(lines[lineIndex + 1] || "");
    const timings = sameLineTimings.length > 0 ? sameLineTimings : nextLineTimings;
    if (timings.length === 0) {
      throw new Error(`回答分析格式不符合要求：[${label}]为[是]时必须输出提及时机`);
    }

    normalizedLines.push(timings.join(""));
    searchStart = sameLineTimings.length > 0 ? lineIndex + 1 : lineIndex + 2;
  }

  return normalizedLines.join("\n");
}

export function parseAnswerAnalysisOutput(content: string): ParsedAnswerAnalysisSection[] {
  if (!content.trim()) return [];
  let normalized = "";
  try {
    normalized = normalizeAnswerAnalysisOutput(content);
  } catch {
    return [];
  }

  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections: ParsedAnswerAnalysisSection[] = [];

  for (let index = 0; index < lines.length; index += 2) {
    const labelLine = lines[index] || "";
    const timingLine = lines[index + 1] || "";
    const match = labelLine.match(/^\[([^\]]+)\]\[(是|否)\]$/);
    if (!match || !answerAnalysisLabels.includes(match[1] as AnswerAnalysisLabel)) continue;

    sections.push({
      label: match[1] as AnswerAnalysisLabel,
      status: match[2] as "是" | "否",
      timings: match[2] === "是" ? extractTimingSegments(timingLine).map(cleanTimingSegment).filter(Boolean) : []
    });
  }

  return sections;
}

function cleanTimingSegment(segment: string) {
  return segment.replace(/^\[/, "").replace(/\]$/, "").trim();
}

function extractTimingSegments(line: string) {
  const excludedSegments = new Set([
    "[时机1]",
    "[时机2]",
    "[是]",
    "[否]",
    "[是/否]",
    "[无]",
    ...answerAnalysisLabels.map((label) => `[${label}]`)
  ]);
  return (line.match(/\[[^\]]+\]/g) || []).filter((segment) => !excludedSegments.has(segment));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
