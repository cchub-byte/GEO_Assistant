import { prisma } from "@/lib/db";
import { runSamplingPlan } from "@/lib/services/sampling";
import { analyzeContentAsset, computeProjectMetrics } from "@/lib/services/analysis";
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
