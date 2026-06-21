import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/connectors";

export type SamplingEnvironmentCheckResult = {
  engineConfigId: string;
  displayName: string;
  engineType: string;
  baseUrl: string;
  status: "ok" | "blocked" | "error";
  message: string;
  currentUrl: string;
};

const environmentCheckQuery = "你好，昨天有什么新闻？";

export async function checkSamplingEnvironment(engineConfigIds: string[]): Promise<SamplingEnvironmentCheckResult[]> {
  const ids = unique(engineConfigIds);
  if (ids.length === 0) return [];

  const engines = await prisma.engineConfig.findMany({
    where: { id: { in: ids } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const engineById = new Map(engines.map((engine) => [engine.id, engine]));

  const results: SamplingEnvironmentCheckResult[] = [];
  for (const id of ids) {
    const engine = engineById.get(id);
    if (!engine) {
      results.push({
        engineConfigId: id,
        displayName: "未知平台",
        engineType: "",
        baseUrl: "",
        status: "error",
        message: "平台配置不存在。",
        currentUrl: ""
      });
      continue;
    }

    try {
      const connector = getConnector(engine.engineType, "browser");
      const output = await connector.collect({
        queryText: environmentCheckQuery,
        engineType: engine.engineType,
        baseUrl: engine.baseUrl,
        language: engine.language,
        region: engine.region,
        device: "desktop",
        timeoutMs: 90000,
        waitAfterSubmitMs: 90000,
        keepOpen: false
      });
      const currentUrl = typeof output.engineMetadata?.url === "string" ? output.engineMetadata.url : "";
      const failureReason = output.failureReason || "";
      results.push({
        engineConfigId: engine.id,
        displayName: engine.displayName,
        engineType: engine.engineType,
        baseUrl: engine.baseUrl,
        status: output.status === "succeeded" ? "ok" : classifySamplingFailure(failureReason),
        message: output.status === "succeeded"
          ? `已发送检查消息“${environmentCheckQuery}”，并完成一次 dry-run 采样；窗口已关闭，采样结果未入库。`
          : failureMessage(failureReason),
        currentUrl
      });
    } catch (error) {
      results.push({
        engineConfigId: engine.id,
        displayName: engine.displayName,
        engineType: engine.engineType,
        baseUrl: engine.baseUrl,
        status: "error",
        message: error instanceof Error ? error.message : "采样环境检查失败。",
        currentUrl: ""
      });
    }
  }

  return results;
}

function classifySamplingFailure(reason: string): SamplingEnvironmentCheckResult["status"] {
  return isBlockingFailure(reason) ? "blocked" : "error";
}

function failureMessage(reason: string) {
  if (isBlockingFailure(reason)) {
    return `检查消息“${environmentCheckQuery}”未能完成采样，平台窗口已保留供处理。阻碍原因：${reason || "疑似登录、验证码或安全验证阻碍"}`;
  }
  return `检查消息“${environmentCheckQuery}”未能完成 dry-run 采样；采样结果未入库。失败原因：${reason || "unknown_sampling_check_error"}`;
}

function isBlockingFailure(reason: string) {
  return /captcha|verify|verification|security|challenge|login|required|prompt_input_not_found|requires_login|验证码|验证|登录|风控|人机|访问受限/i.test(reason);
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
