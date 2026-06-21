import { redirect } from "next/navigation";
import { computeProjectMetrics, createTasksFromFindings, generateFindings } from "@/lib/services/analysis";
import { getDefaultProjectId } from "@/lib/services/read";

export async function POST() {
  const projectId = await getDefaultProjectId();
  if (projectId) {
    await computeProjectMetrics(projectId);
    await generateFindings(projectId);
    await createTasksFromFindings(projectId);
  }
  redirect("/findings");
}

