import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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
        ...(intentType ? { intentType } : cluster ? { intentType: cluster.intentType } : {}),
        queryText: String(formData.get("queryText") || ""),
        language: String(formData.get("language") || "zh-CN"),
        region: String(formData.get("region") || "CN"),
        persona: String(formData.get("persona") || ""),
        device: String(formData.get("device") || "desktop"),
        status: String(formData.get("status") || "active"),
        expectedEvidenceTypes: String(formData.get("expectedEvidenceTypes") || "")
      }
    });
  }
  redirect(redirectTo);
}
