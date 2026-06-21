import { redirect } from "next/navigation";
import { analyzeContentAsset } from "@/lib/services/analysis";

export async function POST(request: Request) {
  const formData = await request.formData();
  const assetId = String(formData.get("assetId") || "");
  const text = String(formData.get("text") || "");
  if (assetId) await analyzeContentAsset(assetId, text || undefined);
  redirect("/content");
}

