import { redirect } from "next/navigation";

import { startRerunAnswerRun } from "@/lib/services/sampling";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as { runId?: unknown; mode?: unknown };
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    const mode = payload.mode === "mock" ? "mock" : "browser";
    if (!runId) {
      return Response.json({ error: "缺少 runId" }, { status: 400 });
    }
    try {
      const run = await startRerunAnswerRun(runId, mode);
      if (!run) {
        return Response.json({ error: "采样不存在" }, { status: 404 });
      }
      return Response.json({
        id: run.id,
        status: run.status,
        runAt: run.runAt.toISOString(),
        failureReason: run.failureReason || ""
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新采样失败";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  const formData = await request.formData();
  const runId = String(formData.get("runId") || "");
  const mode = String(formData.get("mode") || "browser") === "mock" ? "mock" : "browser";
  if (runId) {
    await startRerunAnswerRun(runId, mode);
  }
  redirect("/sampling");
}
