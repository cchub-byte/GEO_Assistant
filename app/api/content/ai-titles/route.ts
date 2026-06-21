import { generateContentTitleCandidates } from "@/lib/services/content-ai";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const projectId = String(payload.projectId || "").trim();
    if (!projectId) {
      return Response.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const result = await generateContentTitleCandidates(projectId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 出题失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
