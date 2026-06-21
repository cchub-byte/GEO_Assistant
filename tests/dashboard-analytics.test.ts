import { describe, expect, it } from "vitest";
import {
  buildAdvancedAnalytics,
  buildBasicAnalytics,
  buildBrandWebTargets,
  buildClusterOverviewAnalytics,
  calculateLatestBatchAverageBrandFirstPosition,
  calculateLatestBatchBrandAssetHitRate,
  calculateLatestBatchCompetitorSubstitutionRate,
  calculateLatestBatchSourceSelectionRate,
  type AnswerTextRun
} from "@/lib/services/dashboard-analytics";

const engine = { id: "engine-1", displayName: "ChatGPT" };

function run(id: string, sourceUrl: string, fetchedUrl?: string | null): AnswerTextRun {
  return {
    id,
    answerText: "ExampleSaaS 适合企业团队。",
    engineConfig: engine,
    sources: [
      {
        id: `${id}-source`,
        title: "Source",
        url: sourceUrl,
        fetchedUrl,
        siteName: null,
        domain: null,
        summary: null,
        bodyText: null,
        content: null
      }
    ],
    query: { clusterId: "cluster-1", queryText: "项目管理工具推荐" }
  };
}

describe("dashboard basic analytics", () => {
  it("counts brand web hits by referenced source item", () => {
    const items = buildBasicAnalytics(
      [engine],
      [
        {
          ...run("run-1", "https://www.example-saas.com/product"),
          sources: [
            ...run("run-1", "https://www.example-saas.com/product").sources,
            ...run("run-1-extra", "https://docs.example-saas.com/help").sources
          ]
        },
        run("run-2", "https://unrelated.example/review")
      ],
      ["ExampleSaaS"],
      [],
      ["example-saas.com"]
    );

    expect(items[0].totalQueryCount).toBe(2);
    expect(items[0].referenceSourceCount).toBe(3);
    expect(items[0].brandDomainHitCount).toBe(2);
  });

  it("matches configured brand page URLs by same path or child path only", () => {
    const items = buildBasicAnalytics(
      [engine],
      [
        run("run-1", "https://example-saas.com/security/soc2"),
        run("run-2", "https://example-saas.com/security-checklist"),
        run("run-3", "https://example-saas.com/product")
      ],
      ["ExampleSaaS"],
      [],
      ["https://example-saas.com/security"]
    );

    expect(items[0].totalQueryCount).toBe(3);
    expect(items[0].referenceSourceCount).toBe(3);
    expect(items[0].brandDomainHitCount).toBe(1);
  });

  it("uses fetched URLs when the stored source URL is a proxy or redirect", () => {
    const items = buildBasicAnalytics(
      [engine],
      [run("run-1", "https://search.example/redirect", "https://example-saas.com/security")],
      ["ExampleSaaS"],
      [],
      buildBrandWebTargets({ brandUrls: "https://example-saas.com/security" })
    );

    expect(items[0].referenceSourceCount).toBe(1);
    expect(items[0].brandDomainHitCount).toBe(1);
  });

  it("averages current brand position only when brand and competitors co-appear", () => {
    const items = buildBasicAnalytics(
      [engine],
      [
        {
          ...run("co-appear-1", "https://unrelated.example/a"),
          answerText: "第一行\nExampleSaaS 位于第二行\nAsana 位于第三行\n第四行"
        },
        {
          ...run("brand-only", "https://unrelated.example/b"),
          answerText: "ExampleSaaS 单独出现\n第二行"
        },
        {
          ...run("competitor-only", "https://unrelated.example/c"),
          answerText: "Asana 单独出现\n第二行"
        },
        {
          ...run("co-appear-2", "https://unrelated.example/d"),
          answerText: "Asana 位于第一行\n第二行\nExampleSaaS 位于第三行\n第四行"
        }
      ],
      ["ExampleSaaS"],
      [{ name: "Asana" }]
    );

    expect(items[0].brandCompetitiveFirstPosition).toBeCloseTo(0.625);
    expect(items[0].brandCompetitorCoAppearCount).toBe(2);
    expect(items[0].brandBehindCompetitorCount).toBe(1);
  });

  it("calculates source selection rate from latest cluster batches and platforms with non-empty queries", () => {
    const secondEngine = { id: "engine-2", displayName: "Perplexity" };
    const emptyEngine = { id: "engine-3", displayName: "No Query Engine" };
    const rate = calculateLatestBatchSourceSelectionRate(
      [engine, secondEngine, emptyEngine],
      [
        {
          ...run("old-run", "https://example-saas.com/product"),
          samplingBatchId: "cluster-1-old"
        },
        {
          ...run("engine-1-latest-hit", "https://example-saas.com/product"),
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-1-latest-miss", "https://unrelated.example/review"),
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("engine-1-empty-query", "https://example-saas.com/security"),
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "   " }
        },
        {
          ...run("engine-2-latest-miss-1", "https://unrelated.example/a"),
          engineConfig: secondEngine,
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-2-latest-miss-2", "https://unrelated.example/b"),
          engineConfig: secondEngine,
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        }
      ],
      [
        { id: "cluster-1-old", clusterId: "cluster-1", batchDate: "2026-06-01", sequence: 1, createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "cluster-1-latest", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" },
        { id: "cluster-2-latest", clusterId: "cluster-2", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      ["example-saas.com"]
    );

    expect(rate).toBeCloseTo(0.25);
  });

  it("treats a shared sampling batch as latest for every Query集 represented by its runs", () => {
    const rate = calculateLatestBatchSourceSelectionRate(
      [engine],
      [
        {
          ...run("cluster-1-old", "https://example-saas.com/old"),
          samplingBatchId: "cluster-1-old"
        },
        {
          ...run("cluster-1-shared", "https://example-saas.com/product"),
          samplingBatchId: "shared-batch"
        },
        {
          ...run("cluster-2-shared", "https://unrelated.example/review"),
          samplingBatchId: "shared-batch",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        }
      ],
      [
        { id: "cluster-1-old", clusterId: "cluster-1", batchDate: "2026-06-01", sequence: 1, createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "shared-batch", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      ["example-saas.com"]
    );

    expect(rate).toBeCloseTo(0.5);
  });

  it("excludes stale runs from a shared batch when that run cluster has a newer batch", () => {
    const rate = calculateLatestBatchSourceSelectionRate(
      [engine],
      [
        {
          ...run("cluster-1-shared", "https://example-saas.com/product"),
          samplingBatchId: "shared-batch"
        },
        {
          ...run("cluster-2-shared-stale", "https://unrelated.example/review"),
          samplingBatchId: "shared-batch",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("cluster-2-newer", "https://example-saas.com/security"),
          samplingBatchId: "cluster-2-newer",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        }
      ],
      [
        { id: "shared-batch", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" },
        { id: "cluster-2-newer", clusterId: "cluster-2", batchDate: "2026-06-03", sequence: 1, createdAt: "2026-06-03T00:00:00.000Z" }
      ],
      ["example-saas.com"]
    );

    expect(rate).toBeCloseTo(1);
  });

  it("calculates competitor substitution rate from inverse latest-batch platform brand appearance average", () => {
    const secondEngine = { id: "engine-2", displayName: "Perplexity" };
    const emptyEngine = { id: "engine-3", displayName: "No Query Engine" };
    const rate = calculateLatestBatchCompetitorSubstitutionRate(
      [engine, secondEngine, emptyEngine],
      [
        {
          ...run("old-run", "https://unrelated.example/old"),
          answerText: "ExampleSaaS 旧批次命中不应参与。",
          samplingBatchId: "cluster-1-old"
        },
        {
          ...run("engine-1-latest-hit", "https://unrelated.example/a"),
          answerText: "ExampleSaaS 进入推荐列表。",
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-1-latest-miss", "https://unrelated.example/b"),
          answerText: "竞品进入推荐列表，本品牌未出现。",
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("engine-1-empty-query", "https://unrelated.example/c"),
          answerText: "ExampleSaaS 空 Query 不应参与。",
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "" }
        },
        {
          ...run("engine-2-latest-miss-1", "https://unrelated.example/d"),
          answerText: "竞品 A 被推荐。",
          engineConfig: secondEngine,
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-2-latest-miss-2", "https://unrelated.example/e"),
          answerText: "竞品 B 被推荐。",
          engineConfig: secondEngine,
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        }
      ],
      [
        { id: "cluster-1-old", clusterId: "cluster-1", batchDate: "2026-06-01", sequence: 1, createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "cluster-1-latest", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" },
        { id: "cluster-2-latest", clusterId: "cluster-2", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      ["ExampleSaaS"]
    );

    expect(rate).toBeCloseTo(0.75);
  });

  it("calculates current brand average position as latest-batch cluster-position average", () => {
    const secondEngine = { id: "engine-2", displayName: "Perplexity" };
    const rate = calculateLatestBatchAverageBrandFirstPosition(
      [engine, secondEngine],
      [
        {
          ...run("old-run", "https://unrelated.example/old"),
          answerText: "ExampleSaaS 旧批次不应参与。",
          samplingBatchId: "cluster-1-old"
        },
        {
          ...run("engine-1-cluster-1-latest", "https://unrelated.example/a"),
          answerText: "ExampleSaaS 位于第一行\n第二行\n第三行\n第四行",
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-1-cluster-2-latest", "https://unrelated.example/b"),
          answerText: "竞品进入推荐列表，本品牌未出现。",
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("engine-2-cluster-1-latest", "https://unrelated.example/c"),
          answerText: "第一行\nExampleSaaS 位于第二行",
          engineConfig: secondEngine,
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-2-cluster-2-latest", "https://unrelated.example/d"),
          answerText: "ExampleSaaS 位于第一行\n第二行",
          engineConfig: secondEngine,
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("engine-2-cluster-2-latest-extra", "https://unrelated.example/e"),
          answerText: "第一行\n第二行\n第三行\nExampleSaaS 位于第四行",
          engineConfig: secondEngine,
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("empty-query", "https://unrelated.example/e"),
          answerText: "ExampleSaaS 空 Query 不应参与。",
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: " " }
        }
      ],
      [
        { id: "cluster-1-old", clusterId: "cluster-1", batchDate: "2026-06-01", sequence: 1, createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "cluster-1-latest", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" },
        { id: "cluster-2-latest", clusterId: "cluster-2", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      ["ExampleSaaS"]
    );

    expect(rate).toBeCloseTo(0.5);
  });

  it("calculates brand asset hit rate as latest-batch platform-rate average", () => {
    const secondEngine = { id: "engine-2", displayName: "Perplexity" };
    const rate = calculateLatestBatchBrandAssetHitRate(
      [engine, secondEngine],
      [
        {
          ...run("old-run", "https://unrelated.example/old"),
          samplingBatchId: "cluster-1-old"
        },
        {
          ...run("engine-1-cluster-1-latest", "https://unrelated.example/a"),
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-1-cluster-2-latest", "https://unrelated.example/b"),
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        },
        {
          ...run("engine-2-cluster-1-latest", "https://unrelated.example/c"),
          engineConfig: secondEngine,
          samplingBatchId: "cluster-1-latest"
        },
        {
          ...run("engine-2-cluster-2-latest", "https://unrelated.example/d"),
          engineConfig: secondEngine,
          samplingBatchId: "cluster-2-latest",
          query: { clusterId: "cluster-2", queryText: "企业知识库工具推荐" }
        }
      ],
      [
        { id: "cluster-1-old", clusterId: "cluster-1", batchDate: "2026-06-01", sequence: 1, createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "cluster-1-latest", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" },
        { id: "cluster-2-latest", clusterId: "cluster-2", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      [
        { runId: "old-run", matched: true, evidenceSubmoduleId: "stale-evidence" },
        { runId: "engine-1-cluster-1-latest", matched: true, evidenceSubmoduleId: "evidence-1" },
        { runId: "engine-2-cluster-1-latest", matched: true, evidenceSubmoduleId: "evidence-2" },
        { runId: "engine-2-cluster-2-latest", matched: true, evidenceSubmoduleId: "evidence-3" },
        { runId: "engine-2-cluster-2-latest", matched: false, evidenceSubmoduleId: "evidence-4" }
      ],
      4
    );

    expect(rate).toBeCloseTo(0.375);
  });

  it("builds cluster overview with basic-analytics brand position and cross-batch stability", () => {
    const items = buildClusterOverviewAnalytics(
      [{ id: "cluster-1" }],
      [engine],
      [
        {
          ...run("old-run", "https://unrelated.example/old"),
          answerText: "ExampleSaaS 位于第一行\n第二行",
          samplingBatchId: "cluster-1-old"
        },
        {
          ...run("latest-run", "https://unrelated.example/latest"),
          answerText: "竞品进入推荐列表，本品牌未出现。",
          samplingBatchId: "cluster-1-latest"
        }
      ],
      [
        { id: "cluster-1-old", clusterId: "cluster-1", batchDate: "2026-06-01", sequence: 1, createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "cluster-1-latest", clusterId: "cluster-1", batchDate: "2026-06-02", sequence: 1, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      ["ExampleSaaS"],
      [
        { runId: "old-run", matched: true, evidenceSubmoduleId: "evidence-1" },
        { runId: "latest-run", matched: true, evidenceSubmoduleId: "evidence-1" },
        { runId: "latest-run", matched: true, evidenceSubmoduleId: "evidence-2" },
        { runId: "latest-run", matched: true, evidenceSubmoduleId: "evidence-3" }
      ],
      4
    );

    expect(items).toHaveLength(1);
    expect(items[0].averageBrandFirstPosition).toBeCloseTo(0.25);
    expect(items[0].brandAssetHitRate).toBeCloseTo(0.75);
    expect(items[0].stabilityScore).toBeCloseTo(1);
  });

  it("parses competitor reference features into per-competitor counts", () => {
    const items = buildAdvancedAnalytics(
      [engine],
      [
        {
          ...run("run-1", "https://review.example/a"),
          competitorReferenceFeatureAnalysis:
            "【引用分析报告】\n" +
            "引用条目中涉及到的目标对象特点：\n" +
            "[竞品名：Asana][优势]生态成熟\n" +
            "[别名：Monday][劣势]价格较高\n" +
            "[竞品名：Asana][优势]模板丰富"
        }
      ],
      ["ExampleSaaS"],
      [
        { name: "Asana", aliases: "Asana Enterprise" },
        { name: "Monday.com", aliases: "Monday" }
      ]
    );

    expect(items[0].competitorReferenceAdvantageCounts).toEqual([
      {
        label: "Asana",
        count: 2,
        items: [
          expect.objectContaining({ targetName: "Asana", content: "[竞品名：Asana][优势]生态成熟" }),
          expect.objectContaining({ targetName: "Asana", content: "[竞品名：Asana][优势]模板丰富" })
        ]
      }
    ]);
    expect(items[0].competitorReferenceDisadvantageCounts).toEqual([
      {
        label: "Monday.com",
        count: 1,
        items: [expect.objectContaining({ targetName: "Monday.com", content: "[别名：Monday][劣势]价格较高" })]
      }
    ]);
  });
});
