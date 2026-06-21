import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeRedirectPath } from "@/lib/routes";
import { countClusterSamplingRecords } from "@/lib/services/sampling-delete";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const clusterId = String(formData.get("clusterId") || "");
  if (clusterId) {
    const samplingRecordCount = await countClusterSamplingRecords(clusterId);
    if (samplingRecordCount > 0) {
      redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}error=cluster_has_sampling_records`);
    }
    await prisma.queryCluster.delete({ where: { id: clusterId } });
  }
  redirect(redirectTo);
}
