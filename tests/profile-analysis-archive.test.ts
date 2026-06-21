import { describe, expect, it } from "vitest";
import {
  buildProfileAnalysisArchiveMarkdown,
  buildProfileAnalysisContextKey,
  parseProfileAnalysisArchiveMarkdown
} from "@/lib/services/profile-analysis-archive";

describe("profile analysis archive helpers", () => {
  it("builds stable context keys from unordered filters and source ids", () => {
    const first = buildProfileAnalysisContextKey({
      scope: "dashboard",
      projectId: "project-1",
      filters: {
        batchIds: ["b2", "b1"],
        clusterIds: ["c1"]
      },
      sourceIds: ["s2", "s1"]
    });
    const second = buildProfileAnalysisContextKey({
      scope: "dashboard",
      projectId: "project-1",
      filters: {
        clusterIds: ["c1"],
        batchIds: ["b1", "b2"]
      },
      sourceIds: ["s1", "s2"]
    });

    expect(second).toBe(first);
  });

  it("round-trips metadata, warning and report count from archived markdown", () => {
    const contextKey = "context-key";
    const markdown = buildProfileAnalysisArchiveMarkdown({
      scope: "dashboard",
      target: "brand",
      contextKey,
      result: {
        warning: "使用兜底分析。",
        reportCount: 2,
        report: [
          "【豆包-Galaxy Fold 7画像分析报告】",
          "品牌域名提及品牌优势：",
          "[优势]轻薄设计被明确提及；",
          "",
          "【千问-Galaxy Fold 7画像分析报告】",
          "品牌域名提及品牌劣势：",
          "[劣势]价格偏高被明确提及；"
        ].join("\n")
      }
    });

    const parsed = parseProfileAnalysisArchiveMarkdown(markdown);

    expect(parsed.metadata).toMatchObject({
      scope: "dashboard",
      target: "brand",
      contextKey
    });
    expect(parsed.result.warning).toBe("使用兜底分析。");
    expect(parsed.result.reportCount).toBe(2);
    expect(parsed.result.report).toContain("【豆包-Galaxy Fold 7画像分析报告】");
    expect(parsed.result.report).not.toContain("geo-profile-analysis");
  });
});
