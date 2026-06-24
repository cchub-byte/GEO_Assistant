import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { closePersistentBrowserContexts } from "@/lib/connectors/browser-session";

export async function POST() {
  const activeJobs = await prisma.samplingJob.findMany({
    where: { status: { in: ["queued", "running"] } },
    select: { id: true }
  });
  const activeJobIds = activeJobs.map((job) => job.id);
  if (activeJobIds.length > 0) {
    await prisma.answerRun.updateMany({
      where: {
        samplingJobId: { in: activeJobIds },
        status: { in: ["queued", "running"] }
      },
      data: {
        status: "cancelled",
        failureReason: "Cancelled by user request"
      }
    });
  }
  await prisma.samplingJob.updateMany({
    where: { status: { in: ["queued", "running"] } },
    data: {
      status: "cancelled",
      finishedAt: new Date(),
      failureSummary: "Cancelled by user request"
    }
  });
  await closePersistentBrowserContexts();
  redirect("/sampling");
}
