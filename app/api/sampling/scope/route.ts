import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const planId = String(formData.get("planId") || "");
  const queryIds = formData.getAll("queryId").map((value) => String(value)).filter(Boolean);
  if (planId) {
    await prisma.samplingPlan.update({
      where: { id: planId },
      data: {
        queryScope: JSON.stringify({ mode: "query_ids", queryIds })
      }
    });
  }
  redirect("/sampling");
}

