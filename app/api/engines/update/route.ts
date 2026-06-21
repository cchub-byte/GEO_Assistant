import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const engineId = String(formData.get("engineId") || "");
  if (engineId) {
    await prisma.engineConfig.update({
      where: { id: engineId },
      data: {
        engineType: String(formData.get("engineType") || ""),
        displayName: String(formData.get("displayName") || ""),
        baseUrl: String(formData.get("baseUrl") || ""),
        region: String(formData.get("region") || "CN"),
        language: String(formData.get("language") || "zh-CN"),
        connectorType: String(formData.get("connectorType") || "browser"),
        status: String(formData.get("status") || "active"),
      }
    });
  }
  redirect("/settings");
}
