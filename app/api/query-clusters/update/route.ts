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
        defaultEngineIds: JSON.stringify(defaultEngineIds),
        status: String(formData.get("status") || "active")
      }
    });
  }
  redirect(redirectTo);
}
