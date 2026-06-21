import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const name = String(formData.get("name") || "").trim();
  const endpointUrl = String(formData.get("endpointUrl") || "").trim();

  if (projectId && name && endpointUrl) {
    await prisma.integrationConfig.create({
      data: {
        projectId,
        name,
        endpointUrl,
        type: String(formData.get("type") || "webhook"),
        enabled: formData.get("enabled") === "on",
        secretHint: String(formData.get("secretHint") || "")
      }
    });
  }
  redirect("/settings");
}
