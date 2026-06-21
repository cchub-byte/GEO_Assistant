import { prisma } from "@/lib/db";
import { assertUsableLlmConfig } from "@/lib/services/llm-models";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import { primaryBrandName, splitCsv } from "@/lib/utils";

const QUERY_INTENT_VERY_FUZZY = "场景模糊";
const QUERY_INTENT_FUZZY = "场景明确";
const QUERY_INTENT_SPECIFIC = "意图明确";
const QUERY_INTENT_TYPES = [QUERY_INTENT_VERY_FUZZY, QUERY_INTENT_FUZZY, QUERY_INTENT_SPECIFIC] as const;

export type GeneratedQueryCandidate = {
  queryText: string;
  intentType: string;
};

export type GeneratedQueryClusterCandidate = {
  name: string;
  intentType: string;
  queries: GeneratedQueryCandidate[];
};

export async function generateQueryCandidates(input: {
  projectId: string;
  clusterName: string;
  intentType: string;
}) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) throw new Error("项目不存在");

  const config = assertUsableLlmConfig(project.llmConfig, "queryGeneration");

  const brand = project.brandProfile;
  if (!brand) throw new Error("当前项目未设置品牌信息");

  const intentType = input.intentType.trim();
  if (!intentType) throw new Error("请先填写意图类型");
  const clusterName = input.clusterName.trim();
  if (!clusterName) throw new Error("请先填写 Query集名称");

  const raw = await requestChatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName: config.modelName,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO Query 策略专家。请根据品牌信息、Query集名称与意图类型生成用户可能向生成式搜索引擎提出的问题。" +
          "必须生成 10 条 Query；Query 应覆盖真实用户表达，不要重复，不要编造品牌未提供的信息。" +
          "10 条 Query 必须包含三类，比例为 3:3:4：3 条非常模糊提问，不提及任何当前品牌名、产品名或别名，必须包含 1 个限定词，该限定词可以是场景、需求或约束，每条 Query 的 intentType 必须为“场景模糊”；3 条模糊提问，不提及任何当前品牌名、产品名或别名，必须包含 1 个场景限定词和 1 个需求或约束限定词，每条 Query 的 intentType 必须为“场景明确”；4 条具体提问，必须提及当前品牌名，不提及产品名或别名，若输入中存在竞品，可提及竞品名称形成对比，每条 Query 的 intentType 必须为“意图明确”。" +
          "只返回 JSON，格式为 {\"queries\":[{\"queryText\":\"Query 1\",\"intentType\":\"场景模糊\"}]}，不要输出解释。"
      },
      {
        role: "user",
        content: JSON.stringify({
          brand: {
            name: primaryBrandName(brand),
            brandNames: splitCsv(brand.brandNames),
            productNames: splitCsv(brand.productNames),
            aliases: splitCsv(brand.aliases),
            customerGroups: brand.customerGroups || "",
            description: brand.description || ""
          },
          competitors: brand.competitors.map((competitor) => ({
            name: competitor.name,
            aliases: splitCsv(competitor.aliases)
          })),
          clusterName,
          intentType,
          requirements: {
            count: 10,
            veryFuzzyQueryCount: 3,
            veryFuzzyQueryRule: "非常模糊提问不得提及当前品牌名、产品名或别名；必须包含 1 个限定词；该限定词可以是场景、需求或约束；Query 意图必须设置为“场景模糊”。",
            fuzzyQueryCount: 3,
            fuzzyQueryRule: "模糊提问不得提及当前品牌名、产品名或别名；必须包含 1 个场景限定词和 1 个需求或约束限定词；Query 意图必须设置为“场景明确”。",
            specificQueryCount: 4,
            specificQueryRule: "具体提问必须提及当前品牌名；不得提及产品名或别名；若输入中存在竞品，可提及竞品名称形成对比；Query 意图必须设置为“意图明确”。",
            language: "优先中文；如意图天然包含英文搜索场景，可包含少量英文 Query。",
            output: "每条 Query 必须可独立作为采样问题使用，并以 queryText 和 intentType 两个字段输出。"
          }
        })
      }
    ]
  });

  const queries = parseQueryCandidates(raw);
  if (queries.length === 0) throw new Error("LLM 未返回可用 Query");
  return { queries: queries.slice(0, 10) };
}

export async function generateQueryClusterCandidates(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true
    }
  });
  if (!project) throw new Error("项目不存在");

  const config = assertUsableLlmConfig(project.llmConfig, "queryClusterGeneration");

  const brand = project.brandProfile;
  if (!brand) throw new Error("当前项目未设置品牌信息");

  const raw = await requestChatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName: config.modelName,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content:
          "你是 GEO Query集策略专家。请根据品牌名称、品牌客户群和品牌介绍，规划生成式搜索采样所需的 Query集。" +
          "必须生成 3 组 Query集，每组必须包含 10 条 Query；每组应有明确意图类型，并覆盖不同搜索意图。" +
          "每组 10 条 Query 必须包含三类，比例为 3:3:4：3 条非常模糊提问，不提及任何当前品牌名、产品名或别名，必须包含 1 个限定词，该限定词可以是场景、需求或约束，每条 Query 的 intentType 必须为“场景模糊”；3 条模糊提问，不提及任何当前品牌名、产品名或别名，必须包含 1 个场景限定词和 1 个需求或约束限定词，每条 Query 的 intentType 必须为“场景明确”；4 条具体提问，必须提及当前品牌名，不提及产品名或别名，若输入中存在竞品，可提及竞品名称形成对比，每条 Query 的 intentType 必须为“意图明确”。" +
          "不要编造品牌未提供的信息，不要输出重复 Query。" +
          "只返回 JSON，格式为 {\"clusters\":[{\"name\":\"Query集名称\",\"intentType\":\"recommendation\",\"queries\":[{\"queryText\":\"Query 1\",\"intentType\":\"场景模糊\"}]}]}，不要输出解释。"
      },
      {
        role: "user",
        content: JSON.stringify({
          brand: {
            name: primaryBrandName(brand),
            brandNames: splitCsv(brand.brandNames),
            productNames: splitCsv(brand.productNames),
            aliases: splitCsv(brand.aliases),
            customerGroups: brand.customerGroups || "",
            description: brand.description || ""
          },
          competitors: brand.competitors.map((competitor) => ({
            name: competitor.name,
            aliases: splitCsv(competitor.aliases)
          })),
          requirements: {
            clusterCount: 3,
            queryCountPerCluster: 10,
            veryFuzzyQueryCountPerCluster: 3,
            veryFuzzyQueryRule: "每组中的非常模糊提问不得提及当前品牌名、产品名或别名；必须包含 1 个限定词；该限定词可以是场景、需求或约束；Query 意图必须设置为“场景模糊”。",
            fuzzyQueryCountPerCluster: 3,
            fuzzyQueryRule: "每组中的模糊提问不得提及当前品牌名、产品名或别名；必须包含 1 个场景限定词和 1 个需求或约束限定词；Query 意图必须设置为“场景明确”。",
            specificQueryCountPerCluster: 4,
            specificQueryRule: "每组中的具体提问必须提及当前品牌名；不得提及产品名或别名；若输入中存在竞品，可提及竞品名称形成对比；Query 意图必须设置为“意图明确”。",
            language: "优先中文；如品牌或场景天然包含英文搜索，可包含少量英文 Query。",
            intentType: "使用短英文枚举或短语，例如 recommendation、alternative、pricing、compliance、integration、use_case、comparison。",
            output: "每条 Query 必须可独立作为采样问题使用，并以 queryText 和 intentType 两个字段输出。"
          }
        })
      }
    ]
  });

  const clusters = parseQueryClusterCandidates(raw);
  if (clusters.length !== 3 || clusters.some((cluster) => cluster.queries.length !== 10)) {
    throw new Error("LLM 未按要求返回 3 组 Query集且每组 10 条 Query");
  }
  return { clusters };
}

function parseQueryCandidates(raw: string) {
  const parsed = parseJsonPayload(raw);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { queries?: unknown }).queries)
      ? (parsed as { queries: unknown[] }).queries
      : [];
  const fromJson = values
    .map((item, index) => normalizeGeneratedQueryCandidate(item, index))
    .filter((item): item is GeneratedQueryCandidate => Boolean(item));
  const candidates = fromJson.length > 0
    ? fromJson
    : parseQueryCandidatesFromLines(raw).map((queryText, index) => ({
        queryText,
        intentType: fallbackQueryIntentType(index)
      }));

  const seen = new Set<string>();
  return candidates
    .filter((query) => {
      const normalized = query.queryText.toLocaleLowerCase();
      if (!query.queryText || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function parseQueryClusterCandidates(raw: string): GeneratedQueryClusterCandidate[] {
  const parsed = parseJsonPayload(raw);
  const values = parsed && typeof parsed === "object" && Array.isArray((parsed as { clusters?: unknown }).clusters)
    ? (parsed as { clusters: unknown[] }).clusters
    : Array.isArray(parsed)
      ? parsed
      : [];

  const seenClusterNames = new Set<string>();
  return values
    .map((item) => normalizeClusterCandidate(item))
    .filter((item): item is GeneratedQueryClusterCandidate => Boolean(item))
    .filter((cluster) => {
      const key = cluster.name.toLocaleLowerCase();
      if (seenClusterNames.has(key)) return false;
      seenClusterNames.add(key);
      return true;
    })
    .slice(0, 3);
}

function normalizeClusterCandidate(item: unknown): GeneratedQueryClusterCandidate | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as { name?: unknown; clusterName?: unknown; intentType?: unknown; intent?: unknown; queries?: unknown };
  const name = String(raw.name || raw.clusterName || "").trim();
  const intentType = String(raw.intentType || raw.intent || "").trim();
  const rawQueries = Array.isArray(raw.queries) ? raw.queries : [];
  if (!name || !intentType || rawQueries.length === 0) return null;

  const seenQueries = new Set<string>();
  const queries = rawQueries
    .map((query, index) => normalizeGeneratedQueryCandidate(query, index))
    .filter((query): query is GeneratedQueryCandidate => Boolean(query))
    .filter((query) => {
      const key = query.queryText.toLocaleLowerCase();
      if (!query.queryText || seenQueries.has(key)) return false;
      seenQueries.add(key);
      return true;
    })
    .slice(0, 10);

  return {
    name,
    intentType,
    queries
  };
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

function parseQueryCandidatesFromLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map(normalizeQueryLine)
    .filter((line) => line.length > 0 && !/^【[^】]+】$/.test(line));
}

function normalizeGeneratedQueryCandidate(item: unknown, index: number): GeneratedQueryCandidate | null {
  if (typeof item === "string") {
    const queryText = normalizeQueryLine(item);
    if (!queryText) return null;
    return { queryText, intentType: fallbackQueryIntentType(index) };
  }
  if (!item || typeof item !== "object") return null;
  const raw = item as {
    queryText?: unknown;
    query?: unknown;
    text?: unknown;
    question?: unknown;
    intentType?: unknown;
    intent?: unknown;
  };
  const queryText = normalizeQueryLine(String(raw.queryText || raw.query || raw.text || raw.question || ""));
  if (!queryText) return null;
  return {
    queryText,
    intentType: normalizeQueryIntentType(raw.intentType || raw.intent, index)
  };
}

function normalizeQueryIntentType(value: unknown, index: number) {
  const intentType = String(value || "").trim();
  return QUERY_INTENT_TYPES.includes(intentType as (typeof QUERY_INTENT_TYPES)[number])
    ? intentType
    : fallbackQueryIntentType(index);
}

function fallbackQueryIntentType(index: number) {
  if (index < 3) return QUERY_INTENT_VERY_FUZZY;
  if (index < 6) return QUERY_INTENT_FUZZY;
  return QUERY_INTENT_SPECIFIC;
}

function normalizeQueryLine(line: string) {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.、)]|["“”'‘’])\s*/, "")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}
