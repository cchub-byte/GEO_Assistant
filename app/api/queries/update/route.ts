import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEFAULT_QUERY_INTENT_TYPE, normalizeQueryIntentType } from "@/lib/query-intents";
import { safeRedirectPath } from "@/lib/routes";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const queryId = String(formData.get("queryId") || "");
  const clusterId = String(formData.get("clusterId") || "");
  const intentType = String(formData.get("intentType") || "").trim();
  if (queryId) {
    const cluster = clusterId ? await prisma.queryCluster.findUnique({ where: { id: clusterId } }) : null;
    await prisma.query.update({
      where: { id: queryId },
      data: {
        ...(cluster ? { clusterId: cluster.id } : {}),
        intentType: normalizeQueryIntentType(intentType || DEFAULT_QUERY_INTENT_TYPE),
        queryText: String(formData.get("queryText") || ""),
        region: String(formData.get("region") || "CN"),
        status: String(formData.get("status") || "active")
      }
    });
  }
  redirect(redirectTo);
}
