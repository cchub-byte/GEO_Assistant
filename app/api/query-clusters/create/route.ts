import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEFAULT_QUERY_INTENT_TYPE, normalizeQueryIntentType } from "@/lib/query-intents";
import { safeRedirectPath } from "@/lib/routes";

const DEFAULT_QUERY_CLUSTER_INTENT_TYPE = "general";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const projectId = String(formData.get("projectId") || "");
  const name = String(formData.get("name") || "").trim();
  const defaultEngineIds = formData.getAll("defaultEngineId").map((engineId) => String(engineId)).filter(Boolean);
  const queryTexts = String(formData.get("queryTexts") || "")
    .split(/\r?\n/)
    .map((queryText) => queryText.trim())
    .filter(Boolean);
  const queryIntentTypes = parseQueryIntentTypes(formData.get("queryIntents"));

  if (projectId && name) {
    await prisma.queryCluster.create({
      data: {
        projectId,
        name,
        intentType: DEFAULT_QUERY_CLUSTER_INTENT_TYPE,
        defaultEngineIds: JSON.stringify(defaultEngineIds),
        status: String(formData.get("status") || "active"),
        ...(queryTexts.length > 0
          ? {
              queries: {
                create: queryTexts.map((queryText, index) => ({
                  queryText,
                  region: "CN",
                  status: "active",
                  intentType: normalizeQueryIntentType(queryIntentTypes[index] || DEFAULT_QUERY_INTENT_TYPE, index)
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
        return parsed.map((item, index) => normalizeQueryIntentType(item, index)).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}
