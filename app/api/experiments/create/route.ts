import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const clusterId = String(formData.get("clusterId") || "") || null;
  if (projectId) {
    await prisma.experiment.create({
      data: {
        projectId,
        clusterId,
        name: String(formData.get("name") || "新 GEO 实验"),
        hypothesis: String(formData.get("hypothesis") || ""),
        targetMetric: String(formData.get("targetMetric") || "absorptionScore"),
        guardrailMetrics: String(formData.get("guardrailMetrics") || "errorDescriptionRate,negativeImpactRate"),
        status: String(formData.get("status") || "draft"),
        baselineWindow: String(formData.get("baselineWindow") || "前测 7 天"),
        posttestWindow: String(formData.get("posttestWindow") || "后测 7 天"),
        minimumRepeats: Number(formData.get("minimumRepeats") || 3),
        successThreshold: Number(formData.get("successThreshold") || 0.1),
        negativeImpactThreshold: Number(formData.get("negativeImpactThreshold") || 0.05),
        resultSummary: String(formData.get("resultSummary") || "")
      }
    });
  }
  redirect("/experiments");
}

