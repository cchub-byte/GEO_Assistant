import { redirect } from "next/navigation";

import { startContinueSamplingFullWorkflow } from "@/lib/services/sampling-full-workflow";

export async function POST(request: Request) {
  const formData = await request.formData();
  const jobId = String(formData.get("jobId") || "");
  const mode = String(formData.get("mode") || "browser") === "mock" ? "mock" : "browser";

  if (!jobId) {
    redirect("/sampling");
  }

  const result = await startContinueSamplingFullWorkflow(jobId, mode);
  const batchQuery = result.batchIds.length ? `?batchId=${encodeURIComponent(result.batchIds.join(","))}` : "";
  redirect(`/sampling${batchQuery}`);
}
