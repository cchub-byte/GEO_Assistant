import { Empty } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatCompetitorInput } from "@/lib/services/brand-profile-input";
import { llmModelScenarios, parseScenarioModelNames } from "@/lib/services/llm-models";
import { getDashboard } from "@/lib/services/read";
import { SettingsWorkbench } from "./settings-workbench";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有设置" body="请先运行 seed。" />;

  const projects = await prisma.project.findMany({
    include: {
      brandProfile: { include: { competitors: true } }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });

  const llmConfig = data.project.llmConfig;

  return (
    <SettingsWorkbench
      currentProjectId={data.project.id}
      scenarios={llmModelScenarios.map((scenario) => ({
        key: scenario.key,
        label: scenario.label,
        description: scenario.description
      }))}
      brands={projects.map((project) => {
        const brand = project.brandProfile;
        return {
          projectId: project.id,
          projectName: project.name,
          isCurrent: project.id === data.project.id,
          brandProfileId: brand?.id || "",
          brandNames: brand?.brandNames || "",
          productNames: brand?.productNames || "",
          aliases: brand?.aliases || "",
          customerGroups: brand?.customerGroups || "",
          description: brand?.description || "",
          brandUrls: brand?.brandUrls || "",
          forbiddenClaims: brand?.forbiddenClaims || "",
          approvedClaims: brand?.approvedClaims || "",
          competitorsText: brand ? formatCompetitorInput(brand.competitors) : "",
          competitorCount: brand?.competitors.length || 0
        };
      })}
      llmConfig={llmConfig ? {
        id: llmConfig.id,
        baseUrl: llmConfig.baseUrl,
        modelName: llmConfig.modelName,
        enabled: llmConfig.enabled,
        apiKeyConfigured: Boolean(llmConfig.apiKey),
        scenarioModelNames: parseScenarioModelNames(llmConfig.scenarioModelNames),
        createdAt: llmConfig.createdAt.toISOString(),
        updatedAt: llmConfig.updatedAt.toISOString()
      } : null}
      engines={data.project.engineConfigs.map((engine) => ({
        id: engine.id,
        engineType: engine.engineType,
        displayName: engine.displayName,
        connectorType: engine.connectorType,
        baseUrl: engine.baseUrl,
        region: engine.region,
        language: engine.language,
        status: engine.status,
        createdAt: engine.createdAt.toISOString()
      }))}
    />
  );
}
