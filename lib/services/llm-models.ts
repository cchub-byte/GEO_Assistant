export const llmModelScenarios = [
  {
    key: "answerParse",
    label: "回答结构解析",
    description: "从平台回答中解析来源、引用与品牌提及。"
  },
  {
    key: "evidenceModuleExtraction",
    label: "证据模块抽取",
    description: "从内容资产文本中抽取定义、指标、对比、限制等证据模块。"
  },
  {
    key: "optimizationBriefGeneration",
    label: "优化 Brief 生成",
    description: "根据发现问题生成 GEO 优化建议。"
  },
  {
    key: "answerAnalysis",
    label: "回答优缺点分析",
    description: "判断回答是否提及当前品牌与竞品的优点、缺点。"
  },
  {
    key: "answerReferenceAnalysis",
    label: "二合一引用归因分析",
    description: "将回答中的品牌优缺点与引用上下文进行来源归因。"
  },
  {
    key: "answerEvidenceHitAnalysis",
    label: "答案优点证据命中分析",
    description: "判断答案分析中的品牌优点是否命中内容资产的句级证据。"
  },
  {
    key: "referenceFeatureAnalysis",
    label: "当前品牌引用特征分析",
    description: "从引用上下文中提炼当前品牌优势与劣势。"
  },
  {
    key: "competitorReferenceFeatureAnalysis",
    label: "竞品引用特征分析",
    description: "从引用上下文中提炼竞品优势与劣势。"
  },
  {
    key: "brandProfileAnalysis",
    label: "品牌画像分析",
    description: "基于平台引用 TOP20 中的品牌上下文生成分平台、分品牌画像报告。"
  },
  {
    key: "competitorBrandAnalysis",
    label: "竞品品牌分析",
    description: "基于平台引用 TOP20 中的竞品上下文生成分平台、分竞品画像报告。"
  },
  {
    key: "queryGeneration",
    label: "Query 生成",
    description: "为指定 Query集生成采样 Query。"
  },
  {
    key: "queryClusterGeneration",
    label: "Query集与 Query 生成",
    description: "根据品牌信息生成 Query集与对应 Query。"
  },
  {
    key: "contentTitleGeneration",
    label: "内容标题生成",
    description: "基于竞品引用标题生成当前品牌内容标题候选。"
  },
  {
    key: "contentDraftGeneration",
    label: "内容草稿生成",
    description: "基于勾选的优劣势素材生成 GEO 文章正文。"
  }
] as const;

export type LlmModelScenarioKey = (typeof llmModelScenarios)[number]["key"];

export type LlmConfigLike = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  enabled: boolean;
  scenarioModelNames?: string | null;
};

export type ResolvedLlmConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  enabled: true;
};

export type ScenarioModelNameMap = Partial<Record<LlmModelScenarioKey, string>>;

const scenarioKeys = new Set<string>(llmModelScenarios.map((scenario) => scenario.key));

export function parseScenarioModelNames(value: unknown): ScenarioModelNameMap {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, modelName]) => scenarioKeys.has(key) && typeof modelName === "string" && modelName.trim())
        .map(([key, modelName]) => [key, String(modelName).trim()])
    ) as ScenarioModelNameMap;
  } catch {
    return {};
  }
}

export function stringifyScenarioModelNames(modelNames: ScenarioModelNameMap) {
  const normalized = Object.fromEntries(
    Object.entries(modelNames)
      .filter(([key, modelName]) => scenarioKeys.has(key) && typeof modelName === "string" && modelName.trim())
      .map(([key, modelName]) => [key, String(modelName).trim()])
  );
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

export function explicitScenarioModelName(config: Pick<LlmConfigLike, "scenarioModelNames"> | null | undefined, scenario: LlmModelScenarioKey) {
  return parseScenarioModelNames(config?.scenarioModelNames)[scenario];
}

export function resolveLlmModelName(config: Pick<LlmConfigLike, "modelName" | "scenarioModelNames">, scenario: LlmModelScenarioKey) {
  return explicitScenarioModelName(config, scenario) || config.modelName.trim();
}

export function resolveUsableLlmConfig(config: LlmConfigLike | null | undefined, scenario: LlmModelScenarioKey): ResolvedLlmConfig | null {
  if (!config || !config.enabled || !config.apiKey || !config.baseUrl || !config.modelName) return null;
  const modelName = resolveLlmModelName(config, scenario);
  if (!modelName) return null;
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName,
    enabled: true
  };
}

export function assertUsableLlmConfig(config: LlmConfigLike | null | undefined, scenario: LlmModelScenarioKey) {
  const resolved = resolveUsableLlmConfig(config, scenario);
  if (!resolved) {
    throw new Error("未配置可用的 LLM 分析配置");
  }
  return resolved;
}
