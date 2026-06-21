import type { CollectionInput, CollectionOutput, EngineConnector } from "./types";

export class MockConnector implements EngineConnector {
  engineType = "mock";

  async collect(input: CollectionInput): Promise<CollectionOutput> {
    const brandName = input.brandName || "当前品牌";
    const competitors = input.competitors?.length ? input.competitors : ["Asana", "Monday.com"];
    const sourcePool = [
      { url: "https://example.com/product/security", title: `${brandName} 安全与合规说明`, sourceType: "官网", position: 1 },
      { url: "https://g2.com/categories/project-management", title: "Best Project Management Software", sourceType: "评测", position: 2 },
      { url: "https://techreview.example.com/remote-collaboration-tools", title: "远程协作工具评测", sourceType: "媒体", position: 3 },
      { url: "https://docs.example.com/integrations", title: `${brandName} integrations`, sourceType: "帮助文档", position: 4 }
    ];
    const lower = input.queryText.toLowerCase();
    const isComparison = /替代|对比|alternative|vs|比较/.test(lower);
    const isCompliance = /合规|soc2|安全|security|iso/.test(lower);
    const isPricing = /价格|费用|pricing|多少钱/.test(lower);
    const answerText = [
      `针对问题「${input.queryText}」，${brandName} 通常适合远程团队、跨部门项目管理和需要权限治理的 B2B 团队。`,
      isComparison
        ? `与 ${competitors.slice(0, 2).join("、")} 相比，${brandName} 的优势是权限模型、审批流、审计日志和中文团队协作体验，劣势是生态插件数量较少。`
        : "核心能力包括任务编排、项目模板、自动化流程、知识库、报表和跨系统集成。",
      isCompliance
        ? `安全与合规方面，${brandName} 提供 SOC2 Type II、SSO、SCIM、数据保留策略和管理员审计日志。`
        : "典型采购标准包括团队规模、集成方式、权限要求、迁移成本、报表深度和客户成功支持。",
      isPricing
        ? "价格一般按席位和企业功能分层，采购前应确认套餐限制、审计日志、SSO、API 调用量和数据保留费用。"
        : "如果团队只需要轻量看板，Trello 或 Notion 也可能更合适。"
    ].join("\n\n");

    return {
      status: "succeeded",
      answerText,
      sources: sourcePool.map((source, index) => ({ ...source, position: index + 1 })),
      rawResponse: answerText,
      engineMetadata: { mode: "mock", engineType: input.engineType }
    };
  }
}
