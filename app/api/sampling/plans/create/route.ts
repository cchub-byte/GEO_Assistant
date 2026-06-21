import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const engineIds = formData.getAll("engineId").map(String);
  if (projectId) {
    await prisma.samplingPlan.create({
      data: {
        projectId,
        name: String(formData.get("name") || "新采样计划"),
        frequency: String(formData.get("frequency") || "manual"),
        repeatCount: Number(formData.get("repeatCount") || 1),
        queryScope: "all_active",
        engines: { create: engineIds.map((engineConfigId) => ({ engineConfigId })) }
      }
    });
  }
  redirect("/sampling");
}

