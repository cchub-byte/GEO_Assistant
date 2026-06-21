import { createBrandSiteArticleDraft } from "@/lib/services/content-ai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const projectId = String(payload.projectId || "").trim();
    const title = String(payload.title || "").trim();

    if (!projectId) {
      return Response.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const result = await createBrandSiteArticleDraft({ projectId, title });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "从品牌站点生成正文失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
