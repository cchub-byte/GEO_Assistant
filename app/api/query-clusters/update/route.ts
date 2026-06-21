import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeRedirectPath } from "@/lib/routes";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const clusterId = String(formData.get("clusterId") || "");
  const defaultEngineIds = formData.getAll("defaultEngineId").map((engineId) => String(engineId)).filter(Boolean);

  if (clusterId) {
    await prisma.queryCluster.update({
      where: { id: clusterId },
      data: {
        name: String(formData.get("name") || ""),
        intentType: String(formData.get("intentType") || ""),
        funnelStage: String(formData.get("funnelStage") || "consideration"),
        priority: Number(formData.get("priority") || 3),
        businessValueScore: Number(formData.get("businessValueScore") || 50),
        targetMetric: String(formData.get("targetMetric") || "VAIR"),
        ownerTeam: String(formData.get("ownerTeam") || "Product"),
        defaultEngineIds: JSON.stringify(defaultEngineIds),
        status: String(formData.get("status") || "active")
      }
    });
  }
  redirect(redirectTo);
}
