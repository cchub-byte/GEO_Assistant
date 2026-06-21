export type EngineType = "doubao" | "qianwen" | "chatgpt" | "google_aio" | "perplexity" | "mock";

export type CollectedSource = {
  url: string;
  title: string;
  sourceType: string;
  position: number;
  summary?: string;
  keyword?: string;
  siteName?: string;
};

export type CollectionInput = {
  queryText: string;
  engineType: EngineType | string;
  baseUrl: string;
  language: string;
  region: string;
  device: string;
  timeoutMs?: number;
  waitAfterSubmitMs?: number;
  keepOpen?: boolean;
  brandName?: string;
  competitors?: string[];
};

export type CollectionOutput = {
  status: "succeeded" | "failed";
  answerText: string;
  sources: CollectedSource[];
  rawResponse?: string;
  screenshotUri?: string;
  engineMetadata?: Record<string, unknown>;
  failureReason?: string;
};

export interface EngineConnector {
  engineType: string;
  collect(input: CollectionInput): Promise<CollectionOutput>;
}
