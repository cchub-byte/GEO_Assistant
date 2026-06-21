import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const assetId = String(formData.get("assetId") || "");
  if (assetId) await prisma.contentAsset.delete({ where: { id: assetId } });
  redirect("/content");
}

