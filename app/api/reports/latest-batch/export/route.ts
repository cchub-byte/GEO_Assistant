import { buildLatestGeoAnalysisReport } from "@/lib/services/geo-analysis-report";
import { getDefaultProjectId } from "@/lib/services/read";

export async function GET() {
  const projectId = await getDefaultProjectId();
  if (!projectId) {
    return new Response("当前没有可导出报告的项目。", { status: 404 });
  }

  try {
    const report = await buildLatestGeoAnalysisReport(projectId);
    return new Response(report.markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出最新报告失败。";
    return new Response(message, { status: 404 });
  }
}
