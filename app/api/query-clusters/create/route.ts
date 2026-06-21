import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeRedirectPath } from "@/lib/routes";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const projectId = String(formData.get("projectId") || "");
  const name = String(formData.get("name") || "").trim();
  const intentType = String(formData.get("intentType") || "").trim();
  const defaultEngineIds = formData.getAll("defaultEngineId").map((engineId) => String(engineId)).filter(Boolean);
  const queryTexts = String(formData.get("queryTexts") || "")
    .split(/\r?\n/)
    .map((queryText) => queryText.trim())
    .filter(Boolean);
  const queryIntentTypes = parseQueryIntentTypes(formData.get("queryIntents"));

  if (projectId && name && intentType) {
    await prisma.queryCluster.create({
      data: {
        projectId,
        name,
        intentType,
        funnelStage: String(formData.get("funnelStage") || "consideration"),
        priority: Number(formData.get("priority") || 3),
        businessValueScore: Number(formData.get("businessValueScore") || 50),
        targetMetric: String(formData.get("targetMetric") || "VAIR"),
        ownerTeam: String(formData.get("ownerTeam") || "Product"),
        defaultEngineIds: JSON.stringify(defaultEngineIds),
        status: String(formData.get("status") || "active"),
        ...(queryTexts.length > 0
          ? {
              queries: {
                create: queryTexts.map((queryText, index) => ({
                  queryText,
                  language: "zh-CN",
                  region: "CN",
                  device: "desktop",
                  status: "active",
                  intentType: queryIntentTypes[index] || intentType,
                  expectedEvidenceTypes: "definition,pricing,specification,comparison,constraint,trust_signal"
                }))
              }
            }
          : {})
      }
    });
  }
  redirect(redirectTo);
}

function parseQueryIntentTypes(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}
