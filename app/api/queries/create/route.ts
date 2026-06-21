import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeRedirectPath } from "@/lib/routes";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const clusterId = String(formData.get("clusterId") || "");
  const queryText = String(formData.get("queryText") || "").trim();
  const language = String(formData.get("language") || "zh-CN");
  const region = String(formData.get("region") || "CN");
  const persona = String(formData.get("persona") || "").trim();
  const intentType = String(formData.get("intentType") || "").trim();
  const expectedEvidenceTypes = String(
    formData.get("expectedEvidenceTypes") || "definition,pricing,specification,comparison,constraint,trust_signal"
  ).trim();
  if (clusterId && queryText) {
    const cluster = await prisma.queryCluster.findUnique({ where: { id: clusterId } });
    if (cluster) {
      await prisma.query.create({
        data: {
          clusterId,
          queryText,
          language,
          region,
          persona: persona || null,
          device: String(formData.get("device") || "desktop"),
          intentType: intentType || cluster.intentType,
          expectedEvidenceTypes,
          status: String(formData.get("status") || "active")
        }
      });
    }
  }
  redirect(redirectTo);
}
