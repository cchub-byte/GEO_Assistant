import { PrismaClient } from "@prisma/client";
import { fallbackQueryIntentType } from "../lib/query-intents";
import { engineCatalog } from "../lib/domain";

const prisma = new PrismaClient();

async function main() {
  await clear();
  const admin = await prisma.user.create({
    data: { name: "GEO Admin", email: "admin@example.com", role: "admin" }
  });
  const project = await prisma.project.create({
    data: {
      name: "ExampleSaaS GEO 监测项目",
      businessUnit: "Product Growth",
      defaultLanguage: "zh-CN",
      defaultRegion: "CN",
      industry: "B2B SaaS",
      brandProfile: {
        create: {
          brandNames: "ExampleSaaS,示例协作云",
          productNames: "ExampleSaaS Enterprise,ExampleSaaS 项目管理",
          aliases: "示例SaaS,Example SaaS",
          customerGroups: "中大型企业项目管理团队、研发团队、运营管理团队、项目管理办公室",
          description: "面向中文企业团队的项目管理与协作平台，强调权限治理、审批流、审计日志、安全合规和跨部门项目协同。",
          brandUrls: "example-saas.com\nhttps://example-saas.com/product\nhttps://example-saas.com/security",
          forbiddenClaims: "永久免费,医疗诊断,金融收益保证",
          approvedClaims: "SOC2 Type II,SSO,SCIM,审计日志,项目模板",
          competitors: {
            create: [
              {
                name: "Asana",
                aliases: "Asana Enterprise",
                customerGroups: "中大型项目管理与协作团队",
                description: "覆盖任务协作、项目计划和跨团队工作管理的平台。",
                website: "https://asana.com"
              },
              {
                name: "Monday.com",
                aliases: "Monday",
                customerGroups: "业务运营、项目管理和低代码流程团队",
                description: "以可视化工作流和灵活配置为核心的工作管理平台。",
                website: "https://monday.com"
              },
              {
                name: "Trello",
                aliases: "Atlassian Trello",
                customerGroups: "轻量项目管理团队和个人协作者",
                description: "基于看板的轻量任务协作工具。",
                website: "https://trello.com"
              },
              {
                name: "Notion",
                aliases: "Notion Projects",
                customerGroups: "知识管理、文档协作和轻量项目团队",
                description: "集文档、知识库和项目管理于一体的协作工作区。",
                website: "https://notion.so"
              }
            ]
          }
        }
      }
    }
  });
  const engines = await Promise.all(
    engineCatalog.map((engine) =>
      prisma.engineConfig.create({
        data: {
          projectId: project.id,
          engineType: engine.engineType,
          displayName: engine.displayName,
          baseUrl: engine.baseUrl,
          region: engine.region,
          language: engine.language,
          connectorType: "browser"
        }
      })
    )
  );
  const clusters = [
    {
      name: "远程团队项目管理工具推荐",
      intentType: "recommendation",
      queries: ["适合远程团队的项目管理工具有哪些？", "best project management software for remote teams", "跨部门协作项目管理软件推荐"]
    },
    {
      name: "Asana 替代方案",
      intentType: "alternative",
      queries: ["Asana 替代方案有哪些？", "Asana alternatives for enterprise teams", "Asana 和 ExampleSaaS 哪个更适合中国团队？"]
    },
    {
      name: "SOC2 合规项目管理软件",
      intentType: "compliance",
      queries: ["支持 SOC2 的项目管理软件有哪些？", "项目管理软件如何满足审计日志和 SSO 要求？", "SOC2 compliant project management tools"]
    },
    {
      name: "价格与采购决策",
      intentType: "pricing",
      queries: ["企业项目管理软件采购前要看哪些价格和限制？", "ExampleSaaS 价格和套餐限制是什么？", "项目管理软件 ROI 如何评估？"]
    },
    {
      name: "集成与部署",
      intentType: "integration",
      queries: ["项目管理软件如何集成 Slack、飞书和 Jira？", "企业项目管理系统部署要考虑什么？", "ExampleSaaS 支持哪些集成方式？"]
    }
  ];
  for (const [clusterIndex, cluster] of clusters.entries()) {
    await prisma.queryCluster.create({
      data: {
        projectId: project.id,
        name: cluster.name,
        intentType: cluster.intentType,
        priority: clusterIndex < 3 ? 1 : 2,
        businessValueScore: clusterIndex < 3 ? 90 : 75,
        targetMetric: "VAIR",
        ownerTeam: "Product",
        queries: {
          create: cluster.queries.map((queryText, queryIndex) => ({
            queryText,
            language: /[a-zA-Z]/.test(queryText) && !/[一-龥]/.test(queryText) ? "en-US" : "zh-CN",
            region: /[a-zA-Z]/.test(queryText) && !/[一-龥]/.test(queryText) ? "US" : "CN",
            intentType: fallbackQueryIntentType(queryIndex)
          }))
        }
      }
    });
  }
  const plan = await prisma.samplingPlan.create({
    data: {
      projectId: project.id,
      name: "核心 Query 每周采样",
      frequency: "weekly",
      repeatCount: 2,
      engines: { create: engines.map((engine) => ({ engineConfigId: engine.id })) }
    }
  });
  await prisma.contentAsset.createMany({
    data: [
      {
        projectId: project.id,
        title: "ExampleSaaS 企业项目管理产品页",
        url: "https://example-saas.com/product",
        assetType: "product_page",
        ownerTeam: "Product"
      },
      {
        projectId: project.id,
        title: "ExampleSaaS 安全与合规说明",
        url: "https://example-saas.com/security",
        assetType: "trust_page",
        ownerTeam: "Security"
      },
      {
        projectId: project.id,
        title: "Asana 替代方案对比页",
        url: "https://example-saas.com/compare/asana-alternative",
        assetType: "comparison_page",
        ownerTeam: "Content"
      }
    ]
  });
  await prisma.integrationConfig.createMany({
    data: [
      { projectId: project.id, type: "feishu", name: "飞书群机器人", endpointUrl: process.env.FEISHU_WEBHOOK_URL || "", enabled: Boolean(process.env.FEISHU_WEBHOOK_URL) },
      { projectId: project.id, type: "webhook", name: "通用 Webhook", endpointUrl: process.env.DEFAULT_WEBHOOK_URL || "", enabled: Boolean(process.env.DEFAULT_WEBHOOK_URL) }
    ]
  });
  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      userId: admin.id,
      action: "seed",
      entity: "Project",
      entityId: project.id,
      detail: `Created demo project and sampling plan ${plan.id}`
    }
  });
  console.log(`Seeded project: ${project.id}`);
}

async function clear() {
  await prisma.webhookDelivery.deleteMany();
  await prisma.integrationConfig.deleteMany();
  await prisma.report.deleteMany();
  await prisma.projectMetric.deleteMany();
  await prisma.clusterMetric.deleteMany();
  await prisma.queryMetric.deleteMany();
  await prisma.runMetric.deleteMany();
  await prisma.competitorOccurrence.deleteMany();
  await prisma.mention.deleteMany();
  await prisma.citation.deleteMany();
  await prisma.source.deleteMany();
  await prisma.answerRun.deleteMany();
  await prisma.samplingJob.deleteMany();
  await prisma.samplingPlanEngine.deleteMany();
  await prisma.samplingPlan.deleteMany();
  await prisma.engineConfig.deleteMany();
  await prisma.assetClusterMapping.deleteMany();
  await prisma.evidenceModule.deleteMany();
  await prisma.structureFeature.deleteMany();
  await prisma.contentSnapshot.deleteMany();
  await prisma.contentAsset.deleteMany();
  await prisma.queryMetric.deleteMany();
  await prisma.query.deleteMany();
  await prisma.queryCluster.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.brandProfile.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.project.deleteMany();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
