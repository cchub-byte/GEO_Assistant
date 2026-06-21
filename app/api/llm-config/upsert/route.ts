import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { llmModelScenarios, stringifyScenarioModelNames } from "@/lib/services/llm-models";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const baseUrl = String(formData.get("baseUrl") || "").trim();
  const modelName = String(formData.get("modelName") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();
  const enabled = formData.get("enabled") === "on";
  const scenarioModelNames = stringifyScenarioModelNames(
    Object.fromEntries(
      llmModelScenarios.map((scenario) => [
        scenario.key,
        String(formData.get(`scenarioModelName:${scenario.key}`) || "").trim()
      ])
    )
  );

  if (projectId && baseUrl && modelName) {
    await ensureScenarioModelNamesColumn();
    const existing = await prisma.llmConfig.findUnique({ where: { projectId } });
    if (existing) {
      await prisma.llmConfig.update({
        where: { id: existing.id },
        data: {
          baseUrl,
          modelName,
          enabled,
          ...(apiKey ? { apiKey } : {})
        }
      });
    } else if (apiKey) {
      await prisma.llmConfig.create({
        data: {
          projectId,
          baseUrl,
          modelName,
          apiKey,
          enabled
        }
      });
    }
    await prisma.$executeRaw`
      UPDATE "LlmConfig"
      SET "scenarioModelNames" = ${scenarioModelNames}
      WHERE "projectId" = ${projectId}
    `;
  }

  redirect("/settings");
}

async function ensureScenarioModelNamesColumn() {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info('LlmConfig')");
  if (columns.some((column) => column.name === "scenarioModelNames")) return;
  await prisma.$executeRawUnsafe('ALTER TABLE "LlmConfig" ADD COLUMN "scenarioModelNames" TEXT');
}
