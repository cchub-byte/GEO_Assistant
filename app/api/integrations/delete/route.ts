import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const integrationId = String(formData.get("integrationId") || "");
  if (integrationId) {
    await prisma.integrationConfig.delete({ where: { id: integrationId } });
  }
  redirect("/settings");
}
