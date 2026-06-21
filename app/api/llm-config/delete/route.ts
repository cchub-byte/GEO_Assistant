import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const llmConfigId = String(formData.get("llmConfigId") || "");

  if (llmConfigId) {
    await prisma.llmConfig.delete({ where: { id: llmConfigId } });
  }

  redirect("/settings");
}
