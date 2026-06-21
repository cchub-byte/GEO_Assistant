import { describe, expect, it } from "vitest";
import { buildEvidenceSubmodules, isEvidenceSentence, splitEvidenceTextIntoSentences } from "@/lib/services/evidence-submodules";

describe("evidence submodules", () => {
  it("splits evidence text into sentence-level items", () => {
    expect(splitEvidenceTextIntoSentences([
      "ExampleSaaS 支持 SSO、SCIM 和审计日志。",
      "- 管理员可以导出操作日志；",
      "1. 企业版支持 SOC2 Type II。",
      "**长租公寓管理**：支持集中式与分散式公寓管理。"
    ].join("\n"))).toEqual([
      "ExampleSaaS 支持 SSO、SCIM 和审计日志。",
      "管理员可以导出操作日志；",
      "企业版支持 SOC2 Type II。",
      "长租公寓管理：支持集中式与分散式公寓管理。"
    ]);
  });

  it("builds stable submodule metadata from a parent evidence module", () => {
    const submodules = buildEvidenceSubmodules({
      id: "module-1",
      moduleType: "trust_signal",
      title: "安全与合规",
      body: "ExampleSaaS 支持 SSO。ExampleSaaS 支持管理员审计日志。",
      locationPath: "block:2",
      confidence: 0.8
    });

    expect(submodules).toEqual([
      expect.objectContaining({
        id: "module-1:sentence:1",
        parentModuleId: "module-1",
        parentTitle: "安全与合规",
        body: "ExampleSaaS 支持 SSO。",
        locationPath: "block:2/sentence:1",
        sentenceIndex: 1
      }),
      expect.objectContaining({
        id: "module-1:sentence:2",
        body: "ExampleSaaS 支持管理员审计日志。",
        locationPath: "block:2/sentence:2",
        sentenceIndex: 2
      })
    ]);
  });

  it("filters introductory text while keeping concrete evidence sentences", () => {
    const submodules = buildEvidenceSubmodules({
      id: "module-2",
      moduleType: "specification",
      title: "产品特色",
      body: [
        "XX 产品有以下特色：",
        "特色1：支持集中式与分散式公寓管理。",
        "特色2：提供业财一体化智能核算。"
      ].join("\n"),
      locationPath: "block:3",
      confidence: 0.8
    });

    expect(submodules.map((submodule) => submodule.body)).toEqual([
      "特色1：支持集中式与分散式公寓管理。",
      "特色2：提供业财一体化智能核算。"
    ]);
  });

  it("classifies evidence-like and non-evidence sentences", () => {
    expect(isEvidenceSentence("全房通通过七大基础服务模块，轻松实现对各类租赁场景的AI智慧化管理：")).toBe(false);
    expect(isEvidenceSentence("长租公寓管理：支持集中式与分散式公寓管理。")).toBe(true);
    expect(isEvidenceSentence("具体如下。")).toBe(false);
  });
});
