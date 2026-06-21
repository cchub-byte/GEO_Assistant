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
