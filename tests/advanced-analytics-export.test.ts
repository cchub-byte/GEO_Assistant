import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import {
  AdvancedAnalyticsSection,
  buildFeatureExportCsv,
  buildFeatureExportRows,
  type AdvancedPlatformAnalytics
} from "@/app/advanced-analytics-section";

const analytics: AdvancedPlatformAnalytics[] = [
  {
    platformId: "chatgpt",
    platformName: "ChatGPT",
    answerAdvantageSites: [],
    answerDisadvantageSites: [],
    referenceAdvantages: [
      { id: "adv-1", queryText: "Query A", content: "优势一" },
      { id: "adv-2", queryText: "Query B", content: '优势二，包含"引号"' }
    ],
    referenceDisadvantages: [{ id: "dis-1", queryText: "Query C", content: "劣势一" }],
    competitorReferenceAdvantages: [{ id: "comp-adv-1", queryText: "Query E", content: "Asana 优势", targetName: "Asana" }],
    competitorReferenceDisadvantages: [{ id: "comp-dis-1", queryText: "Query F", content: "Notion 劣势", targetName: "Notion" }],
    competitorReferenceAdvantageCounts: [{ label: "Asana", count: 1, items: [{ id: "comp-adv-1", queryText: "Query E", content: "Asana 优势", targetName: "Asana" }] }],
    competitorReferenceDisadvantageCounts: [{ label: "Notion", count: 1, items: [{ id: "comp-dis-1", queryText: "Query F", content: "Notion 劣势", targetName: "Notion" }] }],
    referenceMentionNames: []
  },
  {
    platformId: "perplexity",
    platformName: "Perplexity",
    answerAdvantageSites: [],
    answerDisadvantageSites: [],
    referenceAdvantages: [{ id: "adv-3", queryText: "Query D", content: "优势三" }],
    referenceDisadvantages: [],
    competitorReferenceAdvantages: [],
    competitorReferenceDisadvantages: [],
    competitorReferenceAdvantageCounts: [],
    competitorReferenceDisadvantageCounts: [],
    referenceMentionNames: []
  }
];

describe("advanced analytics feature exports", () => {
  it("builds platform-separated advantage export rows", () => {
    expect(buildFeatureExportRows(analytics, "brand", "advantage")).toEqual([
      {
        platformName: "ChatGPT",
        targetName: "品牌",
        platformFeatureCount: 2,
        platformItemIndex: 1,
        queryText: "Query A",
        content: "优势一"
      },
      {
        platformName: "ChatGPT",
        targetName: "品牌",
        platformFeatureCount: 2,
        platformItemIndex: 2,
        queryText: "Query B",
        content: '优势二，包含"引号"'
      },
      {
        platformName: "Perplexity",
        targetName: "品牌",
        platformFeatureCount: 1,
        platformItemIndex: 1,
        queryText: "Query D",
        content: "优势三"
      }
    ]);
  });

  it("builds CSV for disadvantage rows", () => {
    const csv = buildFeatureExportCsv(buildFeatureExportRows(analytics, "brand", "disadvantage"));

    expect(csv).toContain('"平台名称","对象名称","平台累计引用数","平台内序号","Query","引用内容"');
    expect(csv).toContain('"ChatGPT","品牌","1","1","Query C","劣势一"');
    expect(csv).not.toContain("Perplexity");
  });

  it("escapes CSV quotes", () => {
    const csv = buildFeatureExportCsv(buildFeatureExportRows(analytics, "brand", "advantage"));

    expect(csv).toContain('"优势二，包含""引号"""');
  });

  it("builds competitor export rows with target names", () => {
    expect(buildFeatureExportRows(analytics, "competitor", "advantage")).toEqual([
      {
        platformName: "ChatGPT",
        targetName: "Asana",
        platformFeatureCount: 1,
        platformItemIndex: 1,
        queryText: "Query E",
        content: "Asana 优势"
      }
    ]);
  });

  it("keeps advanced analytics table body aligned with feature count headers", () => {
    const tableItems: AdvancedPlatformAnalytics[] = [
      {
        platformId: "engine-1",
        platformName: "Engine",
        answerAdvantageSites: [],
        answerDisadvantageSites: [],
        referenceAdvantages: [{ id: "brand-adv-1", queryText: "Q", content: "品牌优势" }],
        referenceDisadvantages: [
          { id: "brand-dis-1", queryText: "Q", content: "品牌劣势1" },
          { id: "brand-dis-2", queryText: "Q", content: "品牌劣势2" }
        ],
        competitorReferenceAdvantages: [
          { id: "comp-adv-1", queryText: "Q", content: "竞品优势1", targetName: "Asana" },
          { id: "comp-adv-2", queryText: "Q", content: "竞品优势2", targetName: "Asana" },
          { id: "comp-adv-3", queryText: "Q", content: "竞品优势3", targetName: "Asana" }
        ],
        competitorReferenceDisadvantages: [
          { id: "comp-dis-1", queryText: "Q", content: "竞品劣势1", targetName: "Notion" },
          { id: "comp-dis-2", queryText: "Q", content: "竞品劣势2", targetName: "Notion" },
          { id: "comp-dis-3", queryText: "Q", content: "竞品劣势3", targetName: "Notion" },
          { id: "comp-dis-4", queryText: "Q", content: "竞品劣势4", targetName: "Notion" }
        ],
        competitorReferenceAdvantageCounts: [
          {
            label: "Asana",
            count: 3,
            items: [
              { id: "comp-adv-1", queryText: "Q", content: "竞品优势1", targetName: "Asana" },
              { id: "comp-adv-2", queryText: "Q", content: "竞品优势2", targetName: "Asana" },
              { id: "comp-adv-3", queryText: "Q", content: "竞品优势3", targetName: "Asana" }
            ]
          }
        ],
        competitorReferenceDisadvantageCounts: [
          {
            label: "Notion",
            count: 4,
            items: [
              { id: "comp-dis-1", queryText: "Q", content: "竞品劣势1", targetName: "Notion" },
              { id: "comp-dis-2", queryText: "Q", content: "竞品劣势2", targetName: "Notion" },
              { id: "comp-dis-3", queryText: "Q", content: "竞品劣势3", targetName: "Notion" },
              { id: "comp-dis-4", queryText: "Q", content: "竞品劣势4", targetName: "Notion" }
            ]
          }
        ],
        referenceMentionNames: []
      }
    ];
    const html = renderToStaticMarkup(
      React.createElement(AdvancedAnalyticsSection, {
        items: tableItems,
        filterSummary: "测试"
      })
    );
    const $ = load(html);
    const headers = $("thead th").map((_, element) => $(element).text()).get();
    const cells = $("tbody tr").first().find("td").map((_, element) => $(element).text().replace(/\s+/g, "")).get();

    expect(headers.slice(3, 7)).toEqual([
      "品牌累计引用优势数",
      "品牌累计引用劣势数",
      "竞品累计引用优势数",
      "竞品累计引用劣势数"
    ]);
    expect(cells.slice(3, 7)).toEqual(["1", "2", "Asana：3", "Notion：4"]);
  });
});
