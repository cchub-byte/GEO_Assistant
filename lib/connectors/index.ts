import { BrowserConnector } from "./browser";
import { MockConnector } from "./mock";
import type { EngineConnector } from "./types";

export function getConnector(
  engineType: string,
  mode: "browser" | "mock" = "browser"
): EngineConnector {
  if (mode === "mock" || engineType === "mock") return new MockConnector();
  return new BrowserConnector(engineType);
}
