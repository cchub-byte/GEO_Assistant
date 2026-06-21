import { redirect } from "next/navigation";
import { startSamplingFullWorkflow } from "@/lib/services/sampling-full-workflow";

export async function POST(request: Request) {
  const formData = await request.formData();
  const planId = String(formData.get("planId") || "");
  const mode = String(formData.get("mode") || "mock") === "browser" ? "browser" : "mock";
  const maxRuns = Number(formData.get("maxRuns") || 0);
  const batchName = String(formData.get("batchName") || "").trim();
  const queryIds = formData.getAll("queryId").map((queryId) => String(queryId)).filter(Boolean);
  const engineIds = formData.getAll("engineId").map((engineId) => String(engineId)).filter(Boolean);
  const options = {
    ...(queryIds.length > 0 ? { queryIds } : {}),
    ...(engineIds.length > 0 ? { engineIds } : {}),
    ...(batchName ? { batchName } : {})
  };

  if (!planId) {
    redirect("/sampling");
  }

  const safeMaxRuns = Number.isFinite(maxRuns) ? maxRuns : 0;
  const result = await startSamplingFullWorkflow(planId, mode, safeMaxRuns, options);
  const batchQuery = result?.batchIds.length ? `?batchId=${encodeURIComponent(result.batchIds.join(","))}` : "";
  redirect(`/sampling${batchQuery}`);
}
