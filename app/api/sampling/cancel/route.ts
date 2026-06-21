import { redirect } from "next/navigation";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";
import { closePersistentBrowserContexts } from "@/lib/connectors/browser-session";

const execAsync = promisify(exec);

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
  await execAsync(`pkill -TERM -f "${process.cwd()}/.geo-browser-profiles"`).catch(() => undefined);
  redirect("/sampling");
}
