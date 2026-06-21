import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  const engineType = String(formData.get("engineType") || "").trim();
  const baseUrl = String(formData.get("baseUrl") || "").trim();

  if (projectId && displayName && engineType && baseUrl) {
    await prisma.engineConfig.create({
      data: {
        projectId,
        engineType,
        displayName,
        baseUrl,
        connectorType: String(formData.get("connectorType") || "browser"),
        region: String(formData.get("region") || "CN"),
        language: String(formData.get("language") || "zh-CN"),
        status: String(formData.get("status") || "active")
      }
    });
  }
  redirect("/settings");
}
