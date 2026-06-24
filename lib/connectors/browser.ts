import type { CollectionInput, CollectionOutput, EngineConnector } from "./types";

const unavailableReason = "browser_collection_unavailable";

export class BrowserConnector implements EngineConnector {
  constructor(public engineType: string) {}

  async collect(input: CollectionInput): Promise<CollectionOutput> {
    return {
      status: "failed",
      answerText: "",
      sources: [],
      rawResponse: unavailableReason,
      failureReason: unavailableReason,
      engineMetadata: {
        mode: "browser",
        engineType: input.engineType,
        unavailableReason: "Playwright capability is disabled in this distribution."
      }
    };
  }
}
