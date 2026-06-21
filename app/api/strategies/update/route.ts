import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const strategyId = String(formData.get("strategyId") || "");
  const experimentId = String(formData.get("experimentId") || "") || null;
  if (strategyId) {
    await prisma.strategyCard.update({
      where: { id: strategyId },
      data: {
        experimentId,
        strategyName: String(formData.get("strategyName") || ""),
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

