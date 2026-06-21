import { redirect } from "next/navigation";

import { safeRedirectPath } from "@/lib/routes";
import { deleteSamplingBatchWithRuns } from "@/lib/services/sampling-delete";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling/query-clusters");
  const batchId = String(formData.get("batchId") || "");
  if (batchId) {
    await deleteSamplingBatchWithRuns(batchId);
  }
  redirect(redirectTo);
}
