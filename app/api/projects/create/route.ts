import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseCompetitorInput } from "@/lib/services/brand-profile-input";
import { projectCookieName } from "@/lib/services/read";
import { primaryBrandName } from "@/lib/utils";

export async function POST(request: Request) {
  const formData = await request.formData();
  const sourceProjectId = String(formData.get("sourceProjectId") || "");
  const brandNames = String(formData.get("brandNames") || "").trim();
  const productNames = String(formData.get("productNames") || "").trim();
  const aliases = String(formData.get("aliases") || "").trim();
  const customerGroups = String(formData.get("customerGroups") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const brandUrls = String(formData.get("brandUrls") || "").trim();
  const forbiddenClaims = String(formData.get("forbiddenClaims") || "").trim();
  const approvedClaims = String(formData.get("approvedClaims") || "").trim();
  const competitors = parseCompetitorInput(String(formData.get("competitors") || ""));
  const nextBrand = { brandNames, productNames, aliases };
  const primary = primaryBrandName(nextBrand);
  if (!brandNames || primary === "未设置品牌") redirect("/settings");

  const source = sourceProjectId
    ? await prisma.project.findUnique({
        where: { id: sourceProjectId },
        include: { engineConfigs: true, integrations: true }
      })
    : null;

  const project = await prisma.project.create({
    data: {
      name: `${primary} GEO 监测项目`,
      businessUnit: source?.businessUnit || "Default",
      defaultLanguage: source?.defaultLanguage || "zh-CN",
      defaultRegion: source?.defaultRegion || "CN",
      industry: source?.industry || null,
      brandProfile: {
        create: {
          brandNames,
          productNames,
          aliases,
          customerGroups,
          description,
          brandUrls,
          forbiddenClaims,
          approvedClaims,
          competitors: { create: competitors }
        }
      }
    }
  });

  const sourceEngines = source?.engineConfigs || [];
  const engineCopies = [];
  for (const engine of sourceEngines) {
    engineCopies.push(await prisma.engineConfig.create({
      data: {
        projectId: project.id,
        engineType: engine.engineType,
        displayName: engine.displayName,
        connectorType: engine.connectorType,
        baseUrl: engine.baseUrl,
        region: engine.region,
        language: engine.language,
        status: engine.status,
        rateLimitPolicy: engine.rateLimitPolicy
      }
    }));
  }

  const plan = await prisma.samplingPlan.create({
    data: {
      projectId: project.id,
      name: `${primary} 默认采样计划`,
      frequency: "manual",
      repeatCount: 1,
      status: "active",
      queryScope: "all_active"
    }
  });
  if (engineCopies.length) {
    await prisma.samplingPlanEngine.createMany({
      data: engineCopies.map((engine) => ({ samplingPlanId: plan.id, engineConfigId: engine.id }))
    });
  }

  for (const integration of source?.integrations || []) {
    await prisma.integrationConfig.create({
      data: {
        projectId: project.id,
        type: integration.type,
        name: integration.name,
        endpointUrl: integration.endpointUrl,
        enabled: integration.enabled,
        secretHint: integration.secretHint
      }
    });
  }

  const store = await cookies();
  store.set(projectCookieName, project.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/settings");
}
