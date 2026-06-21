import { createGeoArticleDraft, normalizeSelectedEvidenceModuleIds, type SelectedContentAiFeature } from "@/lib/services/content-ai";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const projectId = String(payload.projectId || "").trim();
    const title = String(payload.title || "").trim();
    const selectedFeatures = Array.isArray(payload.selectedFeatures)
      ? payload.selectedFeatures as SelectedContentAiFeature[]
      : [];
    const selectedEvidenceModuleIds = normalizeSelectedEvidenceModuleIds(payload.selectedEvidenceModuleIds);

    if (!projectId) {
      return Response.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const result = await createGeoArticleDraft({ projectId, title, selectedFeatures, selectedEvidenceModuleIds });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 创作失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
