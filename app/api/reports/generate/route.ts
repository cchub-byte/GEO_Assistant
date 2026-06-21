import { redirect } from "next/navigation";
import { generateAlerts, generateReport } from "@/lib/services/analysis";
import { getDefaultProjectId } from "@/lib/services/read";

export async function POST() {
  const projectId = await getDefaultProjectId();
  if (projectId) {
    await generateAlerts(projectId);
    await generateReport(projectId, "weekly");
  }
  redirect("/alerts");
}

