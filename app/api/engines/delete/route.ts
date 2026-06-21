import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const engineId = String(formData.get("engineId") || "");
  if (engineId) {
    await prisma.engineConfig.delete({ where: { id: engineId } });
  }
  redirect("/settings");
}
