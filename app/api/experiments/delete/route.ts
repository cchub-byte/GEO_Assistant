import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const experimentId = String(formData.get("experimentId") || "");
  if (experimentId) await prisma.experiment.delete({ where: { id: experimentId } });
  redirect("/experiments");
}

