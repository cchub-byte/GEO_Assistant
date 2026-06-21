import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { contentAnalysisNoticeCookieName } from "@/lib/services/content-analysis-notice";
import { analyzeContentAsset } from "@/lib/services/analysis";

export async function POST(request: Request) {
  const formData = await request.formData();
  const assetId = String(formData.get("assetId") || "");
  const text = String(formData.get("textContent") || "").trim();
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  try {
    let analyzed = false;
    if (!assetId) {
      if (wantsJson) return Response.json({ error: "缺少内容资产" }, { status: 400 });
      redirect("/content");
    }
    if (!text) {
      if (wantsJson) return Response.json({ error: "请填写正文后再执行分析" }, { status: 400 });
      redirect("/content");
    }

    if (assetId) {
      await prisma.contentAsset.update({
        where: { id: assetId },
        data: {
          title: String(formData.get("title") || ""),
          status: String(formData.get("status") || "active")
        }
      });
      if (text) {
        await analyzeContentAsset(assetId, text);
        analyzed = true;
      }
    }

    if (analyzed) {
      const store = await cookies();
      store.set(contentAnalysisNoticeCookieName, "updated", { path: "/content", maxAge: 30, sameSite: "lax" });
    }
    if (wantsJson) return Response.json({ ok: true, analyzed });
    redirect("/content");
  } catch (error) {
    console.error(error);
    if (wantsJson) {
      return Response.json({ error: error instanceof Error ? error.message : "内容资产保存失败" }, { status: 500 });
    }
    throw error;
  }
}
