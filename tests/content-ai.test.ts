import { describe, expect, it } from "vitest";
import {
  buildBrandSiteLlmSources,
  buildContentAssetEvidenceDraftSources,
  normalizeBrandSiteUrls,
  normalizeSelectedEvidenceModuleIds,
  parseBrandProfileAnalysisFeatures,
  parseCompetitorBrandProfileAnalysisFeatures
} from "@/lib/services/content-ai";

describe("content AI profile-analysis feature parsing", () => {
  it("extracts brand advantages and disadvantages from brand profile analysis reports", () => {
    const items = parseBrandProfileAnalysisFeatures(
      [
        "【ChatGPT-ExampleSaaS画像分析报告】",
        "引用TOP20：品牌域名占2个，10%；",
        "品牌域名提及品牌优势：",
        "[优势]支持审计日志和权限治理；",
        "品牌域名提及品牌劣势：",
        "[劣势]暂无明确提及；",
        "三方站点提及品牌优势：",
        "[优势]中文团队协作体验稳定；",
        "三方站点提及品牌劣势：",
        "[劣势]生态插件数量较少；"
      ].join("\n"),
      "ExampleSaaS"
    );

    expect(items).toEqual([
      expect.objectContaining({
        scope: "brand",
        kind: "advantage",
        targetName: "ExampleSaaS",
        platformName: "ChatGPT",
        queryText: "品牌域名提及品牌优势",
        content: "[优势]支持审计日志和权限治理"
      }),
      expect.objectContaining({
        scope: "brand",
        kind: "advantage",
        queryText: "三方站点提及品牌优势",
        content: "[优势]中文团队协作体验稳定"
      }),
      expect.objectContaining({
        scope: "brand",
        kind: "disadvantage",
        queryText: "三方站点提及品牌劣势",
        content: "[劣势]生态插件数量较少"
      })
    ]);
  });

  it("extracts competitor advantages and disadvantages with competitor target names", () => {
    const items = parseCompetitorBrandProfileAnalysisFeatures(
      [
        "【Perplexity-Asana画像分析报告】",
        "引用TOP20：品牌域名占1个，5%；",
        "品牌域名提及品牌优势：",
        "[优势]模板生态丰富；",
        "品牌域名提及品牌劣势：",
        "[劣势]复杂权限治理支持不足；",
        "三方站点提及品牌优势：",
        "[优势]第三方教程覆盖较多；",
        "三方站点提及品牌劣势：",
        "[劣势]暂无明确提及；"
      ].join("\n")
    );

    expect(items).toEqual([
      expect.objectContaining({
        scope: "competitor",
        kind: "advantage",
        targetName: "Asana",
        platformName: "Perplexity",
        content: "[优势]模板生态丰富"
      }),
      expect.objectContaining({
        scope: "competitor",
        kind: "disadvantage",
        targetName: "Asana",
        platformName: "Perplexity",
        content: "[劣势]复杂权限治理支持不足"
      }),
      expect.objectContaining({
        scope: "competitor",
        kind: "advantage",
        targetName: "Asana",
        platformName: "Perplexity",
        content: "[优势]第三方教程覆盖较多"
      })
    ]);
  });
});

describe("brand site content AI draft helpers", () => {
  it("normalizes configured brand site URLs and removes duplicates", () => {
    expect(normalizeBrandSiteUrls("example.com\nhttps://example.com/product， http://docs.example.com/a ")).toEqual([
      "https://example.com/",
      "https://example.com/product",
      "http://docs.example.com/a"
    ]);

    expect(normalizeBrandSiteUrls("example.com\nhttps://example.com/")).toEqual(["https://example.com/"]);
  });

  it("builds bounded source payloads for LLM generation", () => {
    const sources = buildBrandSiteLlmSources([
      {
        inputUrl: "https://example.com/",
        url: "https://example.com/",
        title: "Home",
        bodyText: "A".repeat(12000),
        bodyTextLength: 12000,
        fetchMode: "fetch"
      },
      {
        inputUrl: "https://example.com/product",
        url: "https://example.com/product",
        title: "Product",
        bodyText: "B".repeat(12000),
        bodyTextLength: 12000,
        fetchMode: "fetch"
      }
    ]);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ index: 1, title: "Home", url: "https://example.com/" });
    expect(sources[0].bodyText).toHaveLength(10000);
    expect(sources[1].bodyText).toHaveLength(10000);
  });
});

describe("content asset evidence module AI draft helpers", () => {
  it("normalizes selected evidence module ids", () => {
    expect(normalizeSelectedEvidenceModuleIds([" a ", "", "a", "b", null])).toEqual(["a", "b"]);
  });

  it("builds selected evidence module payloads in selected order", () => {
    const sources = buildContentAssetEvidenceDraftSources(
      [
        {
          id: "module-a",
          moduleType: "definition",
          title: "定义",
          body: "A 是项目管理平台。",
          snapshot: { asset: { title: "资产 A" } }
        },
        {
          id: "module-b",
          moduleType: "pricing",
          title: "价格",
          body: "B 支持企业套餐。",
          snapshot: { asset: { title: "资产 B" } }
        },
        {
          id: "module-empty",
          moduleType: "definition",
          title: "空模块",
          body: "",
          snapshot: { asset: { title: "空资产" } }
        }
      ],
      ["module-b", "module-empty", "module-a"]
    );

    expect(sources).toEqual([
      {
        id: "module-b",
        contentAssetTitle: "资产 B",
        moduleType: "pricing",
        title: "价格",
        body: "B 支持企业套餐。"
      },
      {
        id: "module-a",
        contentAssetTitle: "资产 A",
        moduleType: "definition",
        title: "定义",
        body: "A 是项目管理平台。"
      }
    ]);
  });
});
