import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEFAULT_QUERY_INTENT_TYPE, normalizeQueryIntentType } from "@/lib/query-intents";
import { safeRedirectPath } from "@/lib/routes";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const clusterId = String(formData.get("clusterId") || "");
  const queryText = String(formData.get("queryText") || "").trim();
  const region = String(formData.get("region") || "CN");
  const intentType = String(formData.get("intentType") || "").trim();
  if (clusterId && queryText) {
    const cluster = await prisma.queryCluster.findUnique({ where: { id: clusterId } });
    if (cluster) {
      await prisma.query.create({
        data: {
          clusterId,
          queryText,
          region,
          intentType: normalizeQueryIntentType(intentType || DEFAULT_QUERY_INTENT_TYPE),
          status: String(formData.get("status") || "active")
        }
      });
    }
  }
  redirect(redirectTo);
}
