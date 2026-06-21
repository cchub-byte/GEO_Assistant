import { env } from "@/lib/config";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import {
  LlmConfigLike,
  LlmModelScenarioKey,
  ResolvedLlmConfig,
  resolveUsableLlmConfig
} from "@/lib/services/llm-models";
import { domainFromUrl } from "@/lib/utils";

export type ParsedSource = {
  url: string;
  title: string;
  sourceType: string;
  position: number;
  summary?: string;
  keyword?: string;
  siteName?: string;
};

export type ParsedCitation = {
  claimText: string;
  claimLocation: string;
  citationMarker?: string;
  sourceUrl?: string;
  supportStatus: "supported" | "partially_supported" | "unsupported" | "unverified" | "not_applicable";
};

export type ParsedMention = {
  entityType: "brand" | "product" | "competitor";
  entityName: string;
  canonicalName: string;
  location: string;
  sentiment: "positive" | "neutral" | "negative";
  positionType: string;
};

export type EvidenceCandidate = {
  moduleType: string;
  title: string;
  body: string;
  locationPath: string;
  confidence: number;
};

export type ParsedAnswer = {
  sources: ParsedSource[];
  citations: ParsedCitation[];
  mentions: ParsedMention[];
};

export async function parseAnswer(
  answerText: string,
  rawSources: ParsedSource[],
  brandTerms: string[],
  competitors: string[],
  llmConfig?: LlmConfigLike | null
): Promise<ParsedAnswer> {
  const config = resolveEvaluatorLlmConfig(llmConfig, "answerParse");
  if (config) {
    const judged = await judgeJson<ParsedAnswer>("Parse GEO answer into sources, citations and brand mentions.", {
      answerText,
      rawSources,
      brandTerms,
      competitors
    }, config);
    if (judged) return normalizeParsedAnswer(judged, rawSources);
  }
  return ruleParseAnswer(answerText, rawSources, brandTerms, competitors);
}

export async function extractEvidenceModules(text: string, llmConfig?: LlmConfigLike | null): Promise<EvidenceCandidate[]> {
  const config = resolveEvaluatorLlmConfig(llmConfig, "evidenceModuleExtraction");
  if (config) {
    const judged = await judgeJson<{ modules: EvidenceCandidate[] }>(
      "Extract GEO evidence modules. Use moduleType from definition, metric, pricing, specification, comparison, step, constraint, case, trust_signal, source_note. Keep every body as concise factual evidence sentences; do not merge independent evidence into one sentence.",
      { text },
      config
    );
    const normalizedModules = normalizeEvidenceModules(judged?.modules);
    if (normalizedModules.length) return normalizedModules.slice(0, 16);
  }
  return ruleExtractEvidenceModules(text);
}

async function judgeJson<T>(instruction: string, payload: unknown, config: ResolvedLlmConfig): Promise<T | null> {
  try {
    const content = await requestChatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      temperature: 0,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: `${instruction}\nReturn strict JSON only.` },
        { role: "user", content: JSON.stringify(payload) }
      ]
    });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function resolveEvaluatorLlmConfig(config: LlmConfigLike | null | undefined, scenario: LlmModelScenarioKey) {
  if (config !== undefined) {
    return resolveUsableLlmConfig(config, scenario);
  }
  if (!env.openaiApiKey) return null;
  return {
    baseUrl: env.openaiBaseUrl,
    apiKey: env.openaiApiKey,
    modelName: env.evalModel,
    enabled: true
  } satisfies ResolvedLlmConfig;
}

function normalizeParsedAnswer(parsed: Partial<ParsedAnswer>, rawSources: ParsedSource[]): ParsedAnswer {
  const normalizedRawSources = rawSources
    .map((source, index) => normalizeParsedSource(source, index))
    .filter((source): source is ParsedSource => Boolean(source));
  const rawSourceMap = new Map(
    normalizedRawSources.map((source) => [source.url, source])
  );

  const sourceCandidates = Array.isArray(parsed.sources) && parsed.sources.length > 0
    ? parsed.sources
    : normalizedRawSources;
  const mergedSources = sourceCandidates
    .map((source, index) => normalizeParsedSource(source, index, rawSourceMap))
    .filter((source): source is ParsedSource => Boolean(source));

  return {
    sources: mergedSources.length > 0 ? mergedSources : normalizedRawSources,
    citations: normalizeParsedCitations(parsed.citations),
    mentions: normalizeParsedMentions(parsed.mentions)
  };
}

function normalizeParsedSource(
  source: Partial<ParsedSource> | unknown,
  index: number,
  rawSourceMap?: Map<string, ParsedSource>
): ParsedSource | null {
  const record = asRecord(source);
  const url = stringValue(record.url);
  if (!url) return null;
  const rawSource = rawSourceMap?.get(url);
  const title = stringValue(record.title) || rawSource?.title || domainFromUrl(url);
  return {
    url,
    title,
    sourceType: stringValue(record.sourceType) || rawSource?.sourceType || classifySource(url, title),
    position: numberValue(record.position) || rawSource?.position || index + 1,
    summary: stringValue(record.summary) || rawSource?.summary,
    keyword: stringValue(record.keyword) || rawSource?.keyword,
    siteName: stringValue(record.siteName) || rawSource?.siteName
  };
}

function normalizeParsedCitations(citations: unknown): ParsedCitation[] {
  if (!Array.isArray(citations)) return [];
  return citations
    .map((citation, index): ParsedCitation | null => {
      const record = asRecord(citation);
      const claimText = stringValue(record.claimText);
      if (!claimText) return null;
      return {
        claimText,
        claimLocation: stringValue(record.claimLocation) || `body:${index + 1}`,
        citationMarker: stringValue(record.citationMarker) || undefined,
        sourceUrl: stringValue(record.sourceUrl) || undefined,
        supportStatus: normalizeSupportStatus(record.supportStatus)
      };
    })
    .filter((citation): citation is ParsedCitation => Boolean(citation));
}

function normalizeParsedMentions(mentions: unknown): ParsedMention[] {
  if (!Array.isArray(mentions)) return [];
  return mentions
    .map((mention): ParsedMention | null => {
      const record = asRecord(mention);
      const entityName = stringValue(record.entityName);
      if (!entityName) return null;
      return {
        entityType: normalizeEntityType(record.entityType),
        entityName,
        canonicalName: stringValue(record.canonicalName) || entityName,
        location: stringValue(record.location) || "body",
        sentiment: normalizeSentiment(record.sentiment),
        positionType: stringValue(record.positionType) || "body"
      };
    })
    .filter((mention): mention is ParsedMention => Boolean(mention));
}

function normalizeEvidenceModules(modules: unknown): EvidenceCandidate[] {
  if (!Array.isArray(modules)) return [];
  return modules
    .map((module, index): EvidenceCandidate | null => {
      const record = asRecord(module);
      const body = stringValue(record.body) || stringValue(record.content) || stringValue(record.text);
      if (!body) return null;
      const title = stringValue(record.title) || body.split(/[\n。！？!?]/)[0]?.trim().slice(0, 80) || `证据模块 ${index + 1}`;
      const confidence = numberValue(record.confidence);
      return {
        moduleType: normalizeEvidenceModuleType(record.moduleType, `${title}\n${body}`),
        title,
        body,
        locationPath: stringValue(record.locationPath) || stringValue(record.location) || `block:${index + 1}`,
        confidence: confidence > 0 ? Math.max(0, Math.min(1, confidence)) : 0.75
      };
    })
    .filter((module): module is EvidenceCandidate => Boolean(module));
}

function normalizeEvidenceModuleType(value: unknown, text: string) {
  const moduleType = stringValue(value);
  if (
    moduleType === "definition"
    || moduleType === "metric"
    || moduleType === "pricing"
    || moduleType === "specification"
    || moduleType === "comparison"
    || moduleType === "step"
    || moduleType === "constraint"
    || moduleType === "case"
    || moduleType === "trust_signal"
    || moduleType === "source_note"
  ) {
    return moduleType;
  }
  return guessModuleType(text);
}

function normalizeSupportStatus(value: unknown): ParsedCitation["supportStatus"] {
  if (
    value === "supported"
    || value === "partially_supported"
    || value === "unsupported"
    || value === "unverified"
    || value === "not_applicable"
  ) {
    return value;
  }
  return "unverified";
}

function normalizeEntityType(value: unknown): ParsedMention["entityType"] {
  if (value === "brand" || value === "product" || value === "competitor") return value;
  return "brand";
}

function normalizeSentiment(value: unknown): ParsedMention["sentiment"] {
  if (value === "positive" || value === "neutral" || value === "negative") return value;
  return "neutral";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function ruleParseAnswer(answerText: string, rawSources: ParsedSource[], brandTerms: string[], competitors: string[]): ParsedAnswer {
  const sentences = answerText.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
  const mentions: ParsedMention[] = [];
  for (const term of brandTerms) {
    if (term && answerText.toLowerCase().includes(term.toLowerCase())) {
      mentions.push({ entityType: "brand", entityName: term, canonicalName: brandTerms[0] || term, location: "body", sentiment: "neutral", positionType: "body" });
    }
  }
  for (const competitor of competitors) {
    if (competitor && answerText.toLowerCase().includes(competitor.toLowerCase())) {
      mentions.push({ entityType: "competitor", entityName: competitor, canonicalName: competitor, location: "body", sentiment: "neutral", positionType: "body" });
    }
  }
  const citations = sentences.slice(0, Math.min(sentences.length, rawSources.length)).map((sentence, index) => ({
    claimText: sentence,
    claimLocation: `paragraph:${index + 1}`,
    citationMarker: `[${index + 1}]`,
    sourceUrl: rawSources[index]?.url,
    supportStatus: "unverified" as const
  }));
  return { sources: rawSources, citations, mentions };
}

function ruleExtractEvidenceModules(text: string): EvidenceCandidate[] {
  const chunks = text
    .split(/\n{2,}|(?=^#{1,3}\s)/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 30)
    .slice(0, 12);
  return chunks.map((chunk, index) => {
    const firstLine = chunk.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80);
    const body = chunk.replace(/^#+\s*.*\n?/, "").trim() || chunk;
    return {
      moduleType: guessModuleType(chunk),
      title: firstLine || `证据模块 ${index + 1}`,
      body,
      locationPath: `block:${index + 1}`,
      confidence: 0.65
    };
  });
}

function guessModuleType(text: string) {
  if (/价格|套餐|费用|price|pricing/i.test(text)) return "pricing";
  if (/规格|支持|集成|参数|feature|spec/i.test(text)) return "specification";
  if (/对比|相比|替代|versus|vs\.?/i.test(text)) return "comparison";
  if (/步骤|如何|配置|流程|step/i.test(text)) return "step";
  if (/限制|风险|不适用|合规|constraint|risk/i.test(text)) return "constraint";
  if (/\d+[%年月日]?|SOC2|ISO|ROI/i.test(text)) return "metric";
  if (/认证|客户|案例|评测|trust|review/i.test(text)) return "trust_signal";
  if (/来源|更新时间|method|source/i.test(text)) return "source_note";
  return "definition";
}

export function classifySource(url: string, title = "") {
  const domain = domainFromUrl(url);
  if (/youtube|bilibili|vimeo|douyin/i.test(domain)) return "video";
  if (/wikipedia|baike|wiki/i.test(domain)) return "百科";
  if (/gov|edu|org|iso|nist/i.test(domain)) return "机构";
  if (/g2|capterra|softwareadvice|producthunt|alternativeto/i.test(domain + title)) return "评测";
  if (/medium|36kr|techcrunch|wired|forbes|hbr|sspai|infoq/i.test(domain + title)) return "媒体";
  if (/reddit|zhihu|quora|stack/i.test(domain)) return "论坛";
  return "未知来源";
}
