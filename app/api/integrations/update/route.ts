import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const integrationId = String(formData.get("integrationId") || "");
  if (integrationId) {
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: {
        type: String(formData.get("type") || "webhook"),
        name: String(formData.get("name") || ""),
        endpointUrl: String(formData.get("endpointUrl") || ""),
        enabled: formData.get("enabled") === "on",
        secretHint: String(formData.get("secretHint") || "")
      }
    });
  }
  redirect("/settings");
}
