import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const experimentId = String(formData.get("experimentId") || "");
  const clusterId = String(formData.get("clusterId") || "") || null;
  if (experimentId) {
    await prisma.experiment.update({
      where: { id: experimentId },
      data: {
        clusterId,
        name: String(formData.get("name") || ""),
        hypothesis: String(formData.get("hypothesis") || ""),
        targetMetric: String(formData.get("targetMetric") || "absorptionScore"),
        guardrailMetrics: String(formData.get("guardrailMetrics") || ""),
        status: String(formData.get("status") || "draft"),
        baselineWindow: String(formData.get("baselineWindow") || ""),
        posttestWindow: String(formData.get("posttestWindow") || ""),
        minimumRepeats: Number(formData.get("minimumRepeats") || 3),
        successThreshold: Number(formData.get("successThreshold") || 0.1),
        negativeImpactThreshold: Number(formData.get("negativeImpactThreshold") || 0.05),
        resultSummary: String(formData.get("resultSummary") || "")
      }
    });
  }
  redirect("/experiments");
}

