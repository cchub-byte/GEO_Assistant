import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const experimentId = String(formData.get("experimentId") || "") || null;
  if (projectId) {
    await prisma.strategyCard.create({
      data: {
        projectId,
        experimentId,
        strategyName: String(formData.get("strategyName") || "新策略"),
        applicableIntents: String(formData.get("applicableIntents") || ""),
        assetTypes: String(formData.get("assetTypes") || ""),
        changePattern: String(formData.get("changePattern") || ""),
        observedUplift: Number(formData.get("observedUplift") || 0),
        riskNotes: String(formData.get("riskNotes") || ""),
        doNotUseWhen: String(formData.get("doNotUseWhen") || ""),
        status: String(formData.get("status") || "published")
      }
    });
  }
  redirect("/experiments");
}

