import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const planId = String(formData.get("planId") || "");
  const engineIds = formData.getAll("engineId").map(String);
  if (planId) {
    await prisma.samplingPlan.update({
      where: { id: planId },
      data: {
        name: String(formData.get("name") || "采样计划"),
        frequency: String(formData.get("frequency") || "manual"),
        repeatCount: Number(formData.get("repeatCount") || 1),
        status: String(formData.get("status") || "active"),
        engines: {
          deleteMany: {},
          create: engineIds.map((engineConfigId) => ({ engineConfigId }))
        }
      }
    });
  }
  redirect("/sampling");
}

