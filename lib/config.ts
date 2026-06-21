export const env = {
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  evalModel: process.env.GEO_EVAL_MODEL || "gpt-4.1-mini",
  browserProfileDir: process.env.GEO_BROWSER_PROFILE_DIR || ".geo-browser-profiles",
  feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || "",
  defaultWebhookUrl: process.env.DEFAULT_WEBHOOK_URL || ""
};

export const hasLLM = Boolean(env.openaiApiKey);

