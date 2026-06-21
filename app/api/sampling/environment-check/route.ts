import { checkSamplingEnvironment } from "@/lib/services/sampling-environment-check";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { engineConfigIds?: unknown };
  const engineConfigIds = Array.isArray(payload.engineConfigIds)
    ? payload.engineConfigIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (engineConfigIds.length === 0) {
    return Response.json({ error: "请选择要检查的平台。" }, { status: 400 });
  }

  const results = await checkSamplingEnvironment(engineConfigIds);
  return Response.json({ results });
}
