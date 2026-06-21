import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractEvidenceModules, parseAnswer } from "@/lib/ai/evaluator";
import { requestChatCompletion } from "@/lib/services/llm-chat";

vi.mock("@/lib/services/llm-chat", () => ({
  requestChatCompletion: vi.fn()
}));

const mockedRequestChatCompletion = vi.mocked(requestChatCompletion);

describe("answer evaluator normalization", () => {
  beforeEach(() => {
    mockedRequestChatCompletion.mockReset();
  });

  it("drops malformed citations and fills safe defaults for model JSON", async () => {
    mockedRequestChatCompletion.mockResolvedValueOnce(JSON.stringify({
      sources: [
        { url: "https://example.com/a" }
      ],
      citations: [
        {},
        {
          claimText: "ExampleSaaS 支持审计日志。",
          supportStatus: "unexpected_status"
        }
      ],
      mentions: [
        { entityName: "ExampleSaaS" }
      ]
    }));

    const parsed = await parseAnswer(
      "ExampleSaaS 支持审计日志。",
      [
        {
          url: "https://example.com/a",
          title: "安全能力说明",
          sourceType: "manual",
          position: 1,
          summary: "审计日志说明"
        }
      ],
      ["ExampleSaaS"],
      [],
      {
        baseUrl: "https://llm.example.test",
        apiKey: "test-key",
        modelName: "test-model",
        enabled: true
      }
    );

    expect(parsed.sources).toEqual([
      expect.objectContaining({
        url: "https://example.com/a",
        title: "安全能力说明",
        sourceType: "manual",
        position: 1,
        summary: "审计日志说明"
      })
    ]);
    expect(parsed.citations).toEqual([
      {
        claimText: "ExampleSaaS 支持审计日志。",
        claimLocation: "body:2",
        citationMarker: undefined,
        sourceUrl: undefined,
        supportStatus: "unverified"
      }
    ]);
    expect(parsed.mentions).toEqual([
      {
        entityType: "brand",
        entityName: "ExampleSaaS",
        canonicalName: "ExampleSaaS",
        location: "body",
        sentiment: "neutral",
        positionType: "body"
      }
    ]);
  });

  it("fills required evidence module fields when model JSON is incomplete", async () => {
    mockedRequestChatCompletion.mockResolvedValueOnce(JSON.stringify({
      modules: [
        {
          moduleType: "specification",
          body: "Galaxy Z Fold7 外屏尺寸为 6.5 英寸。"
        },
        {
          title: "无正文模块"
        }
      ]
    }));

    const modules = await extractEvidenceModules(
      "Galaxy Z Fold7 外屏尺寸为 6.5 英寸。",
      {
        baseUrl: "https://llm.example.test",
        apiKey: "test-key",
        modelName: "test-model",
        enabled: true
      }
    );

    expect(modules).toEqual([
      {
        moduleType: "specification",
        title: "Galaxy Z Fold7 外屏尺寸为 6.5 英寸",
        body: "Galaxy Z Fold7 外屏尺寸为 6.5 英寸。",
        locationPath: "block:1",
        confidence: 0.75
      }
    ]);
  });
});
