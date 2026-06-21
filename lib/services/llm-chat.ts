type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function requestChatCompletion(input: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  messages: LlmMessage[];
  temperature?: number;
  responseFormat?: { type: "json_object" };
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 600000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`
    };
    if (/openrouter\.ai/i.test(input.baseUrl)) {
      headers["HTTP-Referer"] = "http://localhost:7500";
      headers["X-Title"] = "GEO System";
    }
    const response = await fetch(chatCompletionsEndpoint(input.baseUrl), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: input.modelName,
        temperature: input.temperature ?? 0,
        ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
        messages: input.messages
      })
    });
    if (!response.ok) {
      const detail = parseProviderError(await response.text());
      throw new Error(`LLM 请求失败：HTTP ${response.status}${detail ? `，${detail}` : ""}`);
    }
    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM 未返回分析内容");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function chatCompletionsEndpoint(baseUrl: string) {
  const normalizedBaseUrl = normalizeChatCompletionsBaseUrl(baseUrl);
  if (/\/chat\/completions\/?$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/$/, "");
  }
  return `${normalizedBaseUrl.replace(/\/$/, "")}/chat/completions`;
}

function normalizeChatCompletionsBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (/dashscope[^/]*\.aliyuncs\.com\/api\/v2\/apps\/protocols\/compatible-mode\/v1/i.test(trimmed)) {
    return trimmed.replace(/\/api\/v2\/apps\/protocols\/compatible-mode\/v1\/?$/i, "/compatible-mode/v1");
  }
  return trimmed;
}

function parseProviderError(body: string) {
  const text = body.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message || parsed.message;
    return typeof message === "string" ? message : text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
