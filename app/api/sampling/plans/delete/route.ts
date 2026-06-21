import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const planId = String(formData.get("planId") || "");
  if (planId) await prisma.samplingPlan.delete({ where: { id: planId } });
  redirect("/sampling");
}

