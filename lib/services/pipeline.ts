import { prisma } from "@/lib/db";
import { runSamplingPlan } from "@/lib/services/sampling";
import { analyzeContentAsset, computeProjectMetrics, createTasksFromFindings, generateAlerts, generateFindings, generateReport, refreshAuthority } from "@/lib/services/analysis";
import { primaryBrandName } from "@/lib/utils";

export async function runFullDemoPipeline(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { brandProfile: { include: { competitors: true } }, samplingPlans: true, contentAssets: true }
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const brandName = primaryBrandName(project.brandProfile);
  const competitors = project.brandProfile?.competitors.map((competitor) => competitor.name) || ["Asana", "Monday.com"];
  for (const asset of project.contentAssets) {
    const latest = await prisma.contentSnapshot.findFirst({ where: { assetId: asset.id } });
    if (!latest) await analyzeContentAsset(asset.id, demoContentForAsset(asset.title, brandName, competitors));
  }
  for (const plan of project.samplingPlans) {
    await runSamplingPlan(plan.id, "mock");
  }
  await computeProjectMetrics(projectId);
  await generateFindings(projectId);
  await createTasksFromFindings(projectId);
  await refreshAuthority(projectId);
  await createDemoExperiments(projectId);
  await generateAlerts(projectId);
  await generateReport(projectId, "weekly");
}

async function createDemoExperiments(projectId: string) {
  const cluster = await prisma.queryCluster.findFirst({ where: { projectId, intentType: "alternative" } });
  const experiment = await prisma.experiment.create({
    data: {
      projectId,
      clusterId: cluster?.id,
      name: "替代方案页面补充对比与限制条件",
      hypothesis: "增加竞品对比、价格/规格和限制条件模块，可提升替代方案类 query 的吸收得分。",
      targetMetric: "absorptionScore",
      guardrailMetrics: "errorDescriptionRate, negativeImpactRate",
      status: "completed",
      baselineWindow: "过去 7 天",
      posttestWindow: "上线后 7 天",
      resultSummary: "mock 演示数据中吸收得分提升 18%，无明显错误描述增加。"
    }
  });
  await prisma.strategyCard.create({
    data: {
      projectId,
      experimentId: experiment.id,
      strategyName: "替代方案类 Query 的对比证据模块",
      applicableIntents: "alternative, comparison, recommendation",
      assetTypes: "product_page, comparison_page, help_doc",
      changePattern: "增加对比表、适用/不适用场景、迁移成本、集成方式和价格限制说明。",
      observedUplift: 0.18,
      riskNotes: "竞品事实需要持续维护，避免过期描述。",
      doNotUseWhen: "页面没有可靠竞品事实来源或合规不允许直接对比时。"
    }
  });
}

function demoContentForAsset(title: string, brandName: string, competitors: string[]) {
  const competitorText = competitors.slice(0, 2).join("、") || "主要竞品";
  return `# ${title}

## 定义与适用场景
${brandName} 是面向 50 到 2000 人团队的项目管理与远程协作平台，适合跨部门项目、客户交付、研发协作和需要审计日志的企业团队。

## 价格与规格
${brandName} 按席位计费，企业套餐包含 SSO、SCIM、权限模板、审计日志、API、数据保留策略和专属客户成功支持。

## 与 ${competitorText} 的对比
${brandName} 更强调中文团队协作、权限治理、审批流和合规证据。${competitorText} 在生态插件或可视化配置方面各有优势。

## 限制条件
如果团队只需要轻量看板或个人任务管理，Trello、Notion 或飞书多维表格可能更轻量。需要复杂 BI 的团队应先评估报表接口。

## 安全与合规
${brandName} 支持 SOC2 Type II、SSO、SCIM、管理员审计日志、数据保留策略和细粒度权限。

## 更新时间与来源
本文档由产品团队维护，更新时间为 2026-06-02。价格、规格和合规状态以官网和合同为准。`;
}
