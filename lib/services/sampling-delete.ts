import { prisma } from "@/lib/db";

export async function countClusterSamplingRecords(clusterId: string) {
  const [answerRunCount, batchCount] = await Promise.all([
    prisma.answerRun.count({
      where: {
        query: { clusterId }
      }
    }),
    prisma.samplingBatch.count({
      where: { clusterId }
    })
  ]);
  return answerRunCount + batchCount;
}

export async function deleteSamplingBatchWithRuns(batchId: string) {
  const runs = await prisma.answerRun.findMany({
    where: { samplingBatchId: batchId },
    select: { id: true }
  });
  const runIds = runs.map((run) => run.id);
  if (runIds.length > 0) {
    await prisma.findingEvidence.updateMany({
      where: { runId: { in: runIds } },
      data: { runId: null }
    });
    await prisma.answerRun.deleteMany({
      where: { id: { in: runIds } }
    });
  }
  await prisma.samplingBatch.delete({
    where: { id: batchId }
  });
  return { deletedRunCount: runIds.length };
}
