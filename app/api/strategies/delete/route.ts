import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const strategyId = String(formData.get("strategyId") || "");
  if (strategyId) await prisma.strategyCard.delete({ where: { id: strategyId } });
  redirect("/experiments");
}

