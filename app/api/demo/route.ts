import { redirect } from "next/navigation";
import { getDefaultProjectId } from "@/lib/services/read";
import { runFullDemoPipeline } from "@/lib/services/pipeline";

export async function POST() {
  const projectId = await getDefaultProjectId();
  if (projectId) await runFullDemoPipeline(projectId);
  redirect("/");
}

