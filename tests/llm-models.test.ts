import { describe, expect, it } from "vitest";
import {
  parseScenarioModelNames,
  resolveLlmModelName,
  stringifyScenarioModelNames
} from "@/lib/services/llm-models";

describe("LLM scenario model names", () => {
  it("resolves scenario-specific model names before falling back to the default model", () => {
    const config = {
      modelName: "default-model",
      scenarioModelNames: JSON.stringify({
        answerAnalysis: "analysis-model",
        unknownScenario: "ignored-model"
      })
    };

    expect(resolveLlmModelName(config, "answerAnalysis")).toBe("analysis-model");
    expect(resolveLlmModelName(config, "contentDraftGeneration")).toBe("default-model");
  });

  it("serializes only known non-empty scenario model names", () => {
    const serialized = stringifyScenarioModelNames({
      answerParse: "parser-model",
      answerAnalysis: "",
      contentDraftGeneration: " draft-model "
    });

    expect(parseScenarioModelNames(serialized)).toEqual({
      answerParse: "parser-model",
      contentDraftGeneration: "draft-model"
    });
  });
});
