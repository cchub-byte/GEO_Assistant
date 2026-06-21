import { describe, expect, it } from "vitest";
import {
  buildBrandProfileAnalysisReport,
  buildCompetitorBrandAnalysisReport,
  type BrandProfileAnalysisSource
} from "@/lib/services/brand-profile-analysis";

const runAt = new Date("2026-06-08T00:00:00.000Z");

function source(input: Partial<BrandProfileAnalysisSource> & { id: string; url: string; platform?: string }): BrandProfileAnalysisSource {
  return {
    id: input.id,
    url: input.url,
    fetchedUrl: input.fetchedUrl || null,
    title: input.title || "Source",
    domain: input.domain || "",
    siteName: input.siteName || "",
    summary: input.summary || null,
    bodyText: input.bodyText || null,
    content: input.content || null,
    referenceFeatureAnalysis: input.referenceFeatureAnalysis || null,
    competitorReferenceFeatureAnalysis: input.competitorReferenceFeatureAnalysis || null,
    run: {
      runAt,
      engineConfig: { displayName: input.platform || "ChatGPT" }
    }
  };
}

describe("brand profile analysis report", () => {
  it("builds a fallback platform-brand report from top referenced brand contexts", async () => {
    const result = await buildBrandProfileAnalysisReport({
      project: {
        brandProfile: {
          brandNames: "ExampleSaaS",
          aliases: "Example SaaS",
          brandUrls: "https://example-saas.com",
          competitors: [{ name: "Asana", aliases: "Asana Enterprise", website: "https://asana.com" }]
        },
        llmConfig: null
      },
      sources: [
        source({
          id: "owned",
          url: "https://example-saas.com/product",
          bodyText: "ExampleSaaS 支持审计日志和权限治理。",
          referenceFeatureAnalysis: "[品牌名：ExampleSaaS][优势]支持审计日志和权限治理"
        }),
        source({
          id: "third-party",
          url: "https://review.example/tools",
          bodyText: "Example SaaS 在轻量团队中配置成本较高。",
          referenceFeatureAnalysis: "[别名：Example SaaS][劣势]轻量团队配置成本较高"
        })
      ]
    });

    expect(result.warning).toContain("未配置可用 LLM");
    expect(result.report).toContain("【ChatGPT-ExampleSaaS画像分析报告】");
    expect(result.report).toContain("引用TOP20：品牌域名占1个，50%；");
    expect(result.report).toContain("[优势]支持审计日志和权限治理；");
    expect(result.report).toContain("[劣势]轻量团队配置成本较高；");
  });

  it("does not build competitor reports for brand profile analysis", async () => {
    const result = await buildBrandProfileAnalysisReport({
      project: {
        brandProfile: {
          brandNames: "ExampleSaaS",
          aliases: "Example SaaS",
          brandUrls: "https://example-saas.com"
        },
        llmConfig: null
      },
      sources: [
        source({
          id: "current-brand",
          url: "https://example-saas.com/product",
          bodyText: "ExampleSaaS 支持审计日志。",
          referenceFeatureAnalysis: "[品牌名：ExampleSaaS][优势]支持审计日志"
        }),
        source({
          id: "competitor-owned",
          url: "https://asana.com/features",
          bodyText: "Asana Enterprise 模板生态丰富。",
          competitorReferenceFeatureAnalysis: "[竞品名：Asana][优势]模板生态丰富"
        }),
        source({
          id: "competitor-third-party",
          url: "https://review.example/asana",
          bodyText: "Asana 对复杂权限治理支持不足。",
          competitorReferenceFeatureAnalysis: "[竞品名：Asana][劣势]复杂权限治理支持不足"
        })
      ]
    });

    expect(result.reportCount).toBe(1);
    expect(result.report).toContain("【ChatGPT-ExampleSaaS画像分析报告】");
    expect(result.report).toContain("引用TOP20：品牌域名占1个，100%；");
    expect(result.report).toContain("[优势]支持审计日志；");
    expect(result.report).not.toContain("【ChatGPT-Asana画像分析报告】");
    expect(result.report).not.toContain("模板生态丰富");
    expect(result.report).not.toContain("复杂权限治理支持不足");
  });

  it("builds competitor brand reports with the same profile format", async () => {
    const result = await buildCompetitorBrandAnalysisReport({
      project: {
        brandProfile: {
          brandNames: "ExampleSaaS",
          aliases: "Example SaaS",
          brandUrls: "https://example-saas.com",
          competitors: [{ name: "Asana", aliases: "Asana Enterprise", website: "https://asana.com" }]
        },
        llmConfig: null
      },
      sources: [
        source({
          id: "current-brand",
          url: "https://example-saas.com/product",
          bodyText: "ExampleSaaS 支持审计日志。",
          referenceFeatureAnalysis: "[品牌名：ExampleSaaS][优势]支持审计日志"
        }),
        source({
          id: "competitor-owned",
          url: "https://asana.com/features",
          bodyText: "Asana Enterprise 模板生态丰富。",
          competitorReferenceFeatureAnalysis: "[竞品名：Asana][优势]模板生态丰富"
        }),
        source({
          id: "competitor-third-party",
          url: "https://review.example/asana",
          bodyText: "Asana 对复杂权限治理支持不足。",
          competitorReferenceFeatureAnalysis: "[竞品名：Asana][劣势]复杂权限治理支持不足"
        })
      ]
    });

    expect(result.warning).toContain("未配置可用 LLM");
    expect(result.reportCount).toBe(1);
    expect(result.report).toContain("【ChatGPT-Asana画像分析报告】");
    expect(result.report).toContain("引用TOP20：品牌域名占1个，50%；");
    expect(result.report).toContain("品牌域名提及品牌优势：");
    expect(result.report).toContain("[优势]模板生态丰富；");
    expect(result.report).toContain("三方站点提及品牌劣势：");
    expect(result.report).toContain("[劣势]复杂权限治理支持不足；");
    expect(result.report).not.toContain("【ChatGPT-ExampleSaaS画像分析报告】");
    expect(result.report).not.toContain("支持审计日志；");
  });
});
