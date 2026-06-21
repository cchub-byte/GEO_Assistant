import { describe, expect, it } from "vitest";
import { normalizeAnswerAnalysisOutput, parseAnswerAnalysisOutput } from "@/lib/services/answer-analysis";

describe("answer analysis output normalization", () => {
  it("keeps the required eight-line format for valid structured output", () => {
    const output = normalizeAnswerAnalysisOutput([
      "[提及品牌优点][是]",
      "[功能维度：提及集成能力强][采购决策维度：提及价格透明]",
      "[提及品牌缺点][否]",
      "[无]",
      "[提及竞品优点][是]",
      "[对比方法：提及 Asana 模板丰富]",
      "[提及竞品缺点][否]",
      "[无]"
    ].join("\n"));

    expect(output).toBe([
      "[提及品牌优点][是]",
      "[功能维度：提及集成能力强][采购决策维度：提及价格透明]",
      "[提及品牌缺点][否]",
      "[无]",
      "[提及竞品优点][是]",
      "[对比方法：提及 Asana 模板丰富]",
      "[提及竞品缺点][否]",
      "[无]"
    ].join("\n"));
  });

  it("removes extra title and code fence while preserving only structured lines", () => {
    const output = normalizeAnswerAnalysisOutput([
      "```",
      "回答分析：",
      "[提及品牌优点][否]",
      "[无]",
      "[提及品牌缺点][否]",
      "[无]",
      "[提及竞品优点][否]",
      "[无]",
      "[提及竞品缺点][否]",
      "[无]",
      "```"
    ].join("\n"));

    expect(output).toBe([
      "[提及品牌优点][否]",
      "[无]",
      "[提及品牌缺点][否]",
      "[无]",
      "[提及竞品优点][否]",
      "[无]",
      "[提及竞品缺点][否]",
      "[无]"
    ].join("\n"));
  });

  it("rejects yes status without a concrete timing segment", () => {
    expect(() =>
      normalizeAnswerAnalysisOutput([
        "[提及品牌优点][是]",
        "[提及品牌缺点][否]",
        "[无]",
        "[提及竞品优点][否]",
        "[无]",
        "[提及竞品缺点][否]",
        "[无]"
      ].join("\n"))
    ).toThrow("必须输出提及时机");
  });

  it("parses normalized answer analysis into display sections", () => {
    const sections = parseAnswerAnalysisOutput([
      "[提及品牌优点][是]",
      "[功能维度：提及集成能力强][采购决策维度：提及价格透明]",
      "[提及品牌缺点][否]",
      "[无]",
      "[提及竞品优点][是]",
      "[对比方法：提及 Asana 模板丰富]",
      "[提及竞品缺点][否]",
      "[无]"
    ].join("\n"));

    expect(sections).toEqual([
      {
        label: "提及品牌优点",
        status: "是",
        timings: ["功能维度：提及集成能力强", "采购决策维度：提及价格透明"]
      },
      {
        label: "提及品牌缺点",
        status: "否",
        timings: []
      },
      {
        label: "提及竞品优点",
        status: "是",
        timings: ["对比方法：提及 Asana 模板丰富"]
      },
      {
        label: "提及竞品缺点",
        status: "否",
        timings: []
      }
    ]);
  });
});
