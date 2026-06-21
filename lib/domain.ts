export const engineCatalog = [
  { engineType: "doubao", displayName: "豆包", baseUrl: "https://www.doubao.com", region: "CN", language: "zh-CN" },
  { engineType: "qianwen", displayName: "千问", baseUrl: "https://www.qianwen.com", region: "CN", language: "zh-CN" },
  { engineType: "chatgpt", displayName: "ChatGPT", baseUrl: "https://chatgpt.com", region: "US", language: "en-US" },
  { engineType: "google_aio", displayName: "Google AIO", baseUrl: "https://www.google.com/search", region: "US", language: "en-US" },
  { engineType: "perplexity", displayName: "Perplexity", baseUrl: "https://www.perplexity.ai", region: "US", language: "en-US" }
] as const;

export const intentTypes = [
  "definition",
  "comparison",
  "recommendation",
  "how_to",
  "pricing",
  "risk",
  "alternative",
  "decision_criteria",
  "integration",
  "compliance"
] as const;

export const evidenceTypes = [
  "definition",
  "metric",
  "pricing",
  "specification",
  "comparison",
  "step",
  "constraint",
  "case",
  "trust_signal",
  "source_note"
] as const;

export const stageLabels: Record<string, string> = {
  discoverable: "可发现",
  selected: "被选择",
  absorbed: "被吸收",
  attributed: "被归因",
  stable: "可稳定"
};

export const taskTypeLabels: Record<string, string> = {
  content_update: "内容更新",
  technical_seo: "技术 SEO",
  external_authority: "外部权威",
  data_review: "数据核查",
  compliance_review: "合规审核",
  product_fact_update: "产品事实更新"
};

