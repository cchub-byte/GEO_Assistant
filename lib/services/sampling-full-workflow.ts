import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { analyzeAnswerEvidenceHits } from "@/lib/services/answer-evidence-hit-analysis";
import { analyzeAnswerRun } from "@/lib/services/answer-analysis";
import { buildBrandProfileAnalysisReport, buildCompetitorBrandAnalysisReport } from "@/lib/services/brand-profile-analysis";
import { fetchReferenceDetailsForRun } from "@/lib/services/reference-details";
import { startRetryAnswerRuns, startSamplingPlan } from "@/lib/services/sampling";

type SamplingMode = "browser" | "mock";

type SamplingFullWorkflowOptions = {
  queryIds?: string[];
  engineIds?: string[];
  batchName?: string;
};

export type SamplingFullWorkflowStatusView = {
  id: string;
  projectId: string;
  jobId: string;
  batchIds: string[];
  retryableRunCount: number;
  status: string;
  currentStep: string;
  message: string;
  error: string;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

type WorkflowStatusRow = {
  id: string;
  projectId: string;
  jobId: string;
  batchIds: string;
  status: string;
  currentStep: string;
  message: string;
  error: string | null;
  startedAt: Date | string;
  updatedAt: Date | string;
  finishedAt: Date | string | null;
};

const samplingPollIntervalMs = 3000;
const samplingWorkflowTimeoutMs = 2 * 60 * 60 * 1000;
const retryableAnswerRunStatuses = ["failed", "cancelled"];

export async function startSamplingFullWorkflow(
  planId: string,
  mode: SamplingMode,
  maxRuns: number,
  options: SamplingFullWorkflowOptions
) {
  const job = await startSamplingPlan(planId, mode, maxRuns, options);
  if (!job) return null;

  const batchIds = await batchIdsForJob(job.id);
  const projectId = await projectIdForJob(job.id);
  if (projectId) {
    await createWorkflowStatus({
      projectId,
      jobId: job.id,
      batchIds,
      status: "running",
      currentStep: "sampling",
      message: "采样已提交，等待本批次采样完成。"
    });
  }
  void runSamplingFullWorkflow(job.id).catch((error) => {
    console.error("sampling_full_workflow_failed", error);
  });

  return {
    jobId: job.id,
    batchIds
  };
}

export async function startContinueSamplingFullWorkflow(jobId: string, mode: SamplingMode = "browser") {
  const sourceWorkflow = await getSamplingFullWorkflowStatus(jobId);
  if (!sourceWorkflow) throw new Error(`完整工作流不存在：${jobId}`);
  if (sourceWorkflow.status === "running") throw new Error("完整工作流仍在运行，不能重复发起继续。");
  if (sourceWorkflow.batchIds.length === 0) throw new Error("完整工作流没有关联批次，不能继续。");

  const retryableRunIds = await retryableAnswerRunIdsForBatches(sourceWorkflow.batchIds);
  if (retryableRunIds.length > 0) {
    const retryJob = await startRetryAnswerRuns(retryableRunIds, mode, {
      sourceJobId: sourceWorkflow.jobId,
      workflowResume: true
    });
    if (!retryJob) throw new Error("创建重试采样任务失败。");
    await createWorkflowStatus({
      projectId: sourceWorkflow.projectId,
      jobId: retryJob.id,
      batchIds: sourceWorkflow.batchIds,
      status: "running",
      currentStep: "sampling",
      message: `继续工作流已提交：重试 ${retryableRunIds.length} 条失败/取消采样。`
    });
    void runSamplingFullWorkflow(retryJob.id, {
      batchIds: sourceWorkflow.batchIds,
      retryCount: retryableRunIds.length
    }).catch((error) => {
      console.error("sampling_full_workflow_continue_failed", error);
    });
    return {
      jobId: retryJob.id,
      batchIds: sourceWorkflow.batchIds,
      retryCount: retryableRunIds.length
    };
  }

  await updateWorkflowStatus(sourceWorkflow.jobId, {
    status: "running",
    currentStep: "answer-analysis",
    message: "继续工作流已提交：未发现失败/取消采样，继续执行后续分析。"
  });
  void runSamplingFullWorkflow(sourceWorkflow.jobId, {
    batchIds: sourceWorkflow.batchIds,
    skipSamplingWait: true
  }).catch((error) => {
    console.error("sampling_full_workflow_continue_failed", error);
  });

  return {
    jobId: sourceWorkflow.jobId,
    batchIds: sourceWorkflow.batchIds,
    retryCount: 0
  };
}

type RunSamplingFullWorkflowOptions = {
  batchIds?: string[];
  retryCount?: number;
  skipSamplingWait?: boolean;
};

async function runSamplingFullWorkflow(jobId: string, options: RunSamplingFullWorkflowOptions = {}) {
  const workflowErrors: string[] = [];
  try {
    await updateWorkflowStatus(jobId, {
      status: "running",
      currentStep: "sampling",
      message: options.skipSamplingWait
        ? "继续工作流运行中，跳过采样等待，直接执行后续分析。"
        : options.retryCount && options.retryCount > 0
          ? `重试采样运行中：等待 ${options.retryCount} 条失败/取消采样完成。`
          : "采样运行中，等待本批次采样完成。"
    });
    const job = options.skipSamplingWait ? await samplingJobStatus(jobId) : await waitForSamplingJob(jobId);
    const batchIds = options.batchIds?.length ? options.batchIds : await batchIdsForJob(jobId);
    if (batchIds.length === 0 || !job) {
      await updateWorkflowStatus(jobId, {
        status: "failed",
        currentStep: "sampling",
        message: "完整工作流终止：未找到本次采样批次。",
        error: "未找到本次采样批次。",
        finishedAt: new Date()
      });
      return;
    }

    if (job.status === "cancelled" && !options.skipSamplingWait) {
      await updateWorkflowStatus(jobId, {
        status: "cancelled",
        currentStep: "sampling",
        message: "完整工作流已取消：采样任务被取消。",
        finishedAt: new Date()
      });
      return;
    }

    const runs = await loadWorkflowRuns(batchIds);
    const unsuccessfulRuns = runs.filter((run) => retryableAnswerRunStatuses.includes(run.status));
    if (unsuccessfulRuns.length > 0) {
      workflowErrors.push(`采样未成功：${unsuccessfulRuns.length} 条采样处于失败或取消状态。`);
    }
    const analyzableRuns = runs.filter((run) => run.status === "succeeded" && run.answerText.trim());
    await updateWorkflowStatus(jobId, {
      status: "running",
      currentStep: "answer-analysis",
      message: `本批次回答分析中：0/${analyzableRuns.length}`
    });
    for (let index = 0; index < analyzableRuns.length; index += 1) {
      const run = analyzableRuns[index];
      try {
        await analyzeAnswerRun(run.id);
      } catch (error) {
        workflowErrors.push(`回答分析失败：${run.id}：${errorMessage(error)}`);
      }
      await updateWorkflowStatus(jobId, {
        status: "running",
        currentStep: "answer-analysis",
        message: `本批次回答分析中：${index + 1}/${analyzableRuns.length}`
      });
    }

    const runsAfterAnswerAnalysis = await loadWorkflowRuns(batchIds);
    const runsWithSources = runsAfterAnswerAnalysis.filter((item) => item.sources.length > 0);
    await updateWorkflowStatus(jobId, {
      status: "running",
      currentStep: "reference-fetch",
      message: `本批次获取引用中：0/${runsWithSources.length}`
    });
    for (let index = 0; index < runsWithSources.length; index += 1) {
      const run = runsWithSources[index];
      try {
        await fetchReferenceDetailsForRun(run.id);
      } catch (error) {
        workflowErrors.push(`获取引用失败：${run.id}：${errorMessage(error)}`);
      }
      await updateWorkflowStatus(jobId, {
        status: "running",
        currentStep: "reference-fetch",
        message: `本批次获取引用中：${index + 1}/${runsWithSources.length}`
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: runs[0]?.projectId || "" },
      include: {
        brandProfile: { include: { competitors: true } },
        llmConfig: true
      }
    });
    if (!project) {
      await updateWorkflowStatus(jobId, {
        status: "failed",
        currentStep: "project",
        message: "完整工作流终止：项目不存在。",
        error: "项目不存在。",
        finishedAt: new Date()
      });
      return;
    }

    const sources = await loadWorkflowSources(batchIds);
    const batchLabel = await workflowBatchLabel(batchIds);

    await updateWorkflowStatus(jobId, {
      status: "running",
      currentStep: "brand-profile-analysis",
      message: "本批次品牌画像分析中。"
    });
    try {
      const brandProfileAnalysis = await buildBrandProfileAnalysisReport({ project, sources });
      await createWorkflowReport({
        projectId: project.id,
        type: "batch_brand_profile",
        title: `${batchLabel} - 品牌画像分析`,
        warning: brandProfileAnalysis.warning,
        markdown: brandProfileAnalysis.report
      });
    } catch (error) {
      workflowErrors.push(`品牌画像分析失败：${errorMessage(error)}`);
    }

    await updateWorkflowStatus(jobId, {
      status: "running",
      currentStep: "competitor-brand-analysis",
      message: "本批次竞品画像分析中。"
    });
    try {
      const competitorBrandAnalysis = await buildCompetitorBrandAnalysisReport({ project, sources });
      await createWorkflowReport({
        projectId: project.id,
        type: "batch_competitor_brand_profile",
        title: `${batchLabel} - 竞品画像分析`,
        warning: competitorBrandAnalysis.warning,
        markdown: competitorBrandAnalysis.report
      });
    } catch (error) {
      workflowErrors.push(`竞品画像分析失败：${errorMessage(error)}`);
    }

    await updateWorkflowStatus(jobId, {
      status: "running",
      currentStep: "answer-evidence-hit-analysis",
      message: "本批次答案分析中。"
    });
    try {
      await analyzeAnswerEvidenceHits({ projectId: project.id, batchIds });
    } catch (error) {
      workflowErrors.push(`答案分析失败：${errorMessage(error)}`);
    }

    if (workflowErrors.length > 0) {
      await createWorkflowReport({
        projectId: project.id,
        type: "batch_full_workflow_status",
        title: `${batchLabel} - 完整工作流执行记录`,
        markdown: workflowErrors.map((error) => `- ${error}`).join("\n")
      });
    }

    await updateWorkflowStatus(jobId, {
      status: workflowErrors.length > 0 ? "completed_with_warnings" : "succeeded",
      currentStep: "completed",
      message: workflowErrors.length > 0
        ? `完整工作流完成，但存在 ${workflowErrors.length} 项异常。`
        : "完整工作流已完成，未发现异常。",
      error: workflowErrors.join("\n"),
      finishedAt: new Date()
    });
  } catch (error) {
    await updateWorkflowStatus(jobId, {
      status: "failed",
      currentStep: "failed",
      message: "完整工作流执行失败。",
      error: errorMessage(error),
      finishedAt: new Date()
    });
    throw error;
  }
}

async function waitForSamplingJob(jobId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < samplingWorkflowTimeoutMs) {
    const job = await samplingJobStatus(jobId);
    if (!job) return null;
    if (!["queued", "running"].includes(job.status)) return job;
    await sleep(samplingPollIntervalMs);
  }
  throw new Error(`Sampling job timed out: ${jobId}`);
}

async function samplingJobStatus(jobId: string) {
  return prisma.samplingJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true }
  });
}

async function batchIdsForJob(jobId: string) {
  const batches = await prisma.samplingBatch.findMany({
    where: { samplingJobId: jobId },
    orderBy: [{ batchDate: "desc" }, { sequence: "desc" }, { id: "asc" }],
    select: { id: true }
  });
  return batches.map((batch) => batch.id);
}

async function projectIdForJob(jobId: string) {
  const job = await prisma.samplingJob.findUnique({
    where: { id: jobId },
    include: { plan: { select: { projectId: true } } }
  });
  return job?.plan.projectId || "";
}

export async function getSamplingFullWorkflowStatuses(projectId: string, limit = 8): Promise<SamplingFullWorkflowStatusView[]> {
  await ensureWorkflowStatusTable();
  const rows = await prisma.$queryRaw<WorkflowStatusRow[]>`
    SELECT
      "id",
      "projectId",
      "jobId",
      "batchIds",
      "status",
      "currentStep",
      "message",
      "error",
      "startedAt",
      "updatedAt",
      "finishedAt"
    FROM "SamplingFullWorkflowStatus"
    WHERE "projectId" = ${projectId}
    ORDER BY datetime("updatedAt") DESC, datetime("startedAt") DESC
    LIMIT ${limit}
  `;
  return attachRetryableRunCounts(rows.map(normalizeWorkflowStatusRow));
}

async function getSamplingFullWorkflowStatus(jobId: string): Promise<SamplingFullWorkflowStatusView | null> {
  await ensureWorkflowStatusTable();
  const rows = await prisma.$queryRaw<WorkflowStatusRow[]>`
    SELECT
      "id",
      "projectId",
      "jobId",
      "batchIds",
      "status",
      "currentStep",
      "message",
      "error",
      "startedAt",
      "updatedAt",
      "finishedAt"
    FROM "SamplingFullWorkflowStatus"
    WHERE "jobId" = ${jobId}
    LIMIT 1
  `;
  const status = rows[0] ? normalizeWorkflowStatusRow(rows[0]) : null;
  if (!status) return null;
  const [withCounts] = await attachRetryableRunCounts([status]);
  return withCounts || null;
}

async function attachRetryableRunCounts(statuses: SamplingFullWorkflowStatusView[]) {
  return Promise.all(statuses.map(async (status) => ({
    ...status,
    retryableRunCount: await retryableAnswerRunCountForBatches(status.batchIds)
  })));
}

async function createWorkflowStatus(input: {
  projectId: string;
  jobId: string;
  batchIds: string[];
  status: string;
  currentStep: string;
  message: string;
}) {
  await ensureWorkflowStatusTable();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "SamplingFullWorkflowStatus" (
      "id",
      "projectId",
      "jobId",
      "batchIds",
      "status",
      "currentStep",
      "message",
      "error",
      "startedAt",
      "updatedAt",
      "finishedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.projectId},
      ${input.jobId},
      ${JSON.stringify(input.batchIds)},
      ${input.status},
      ${input.currentStep},
      ${input.message},
      ${""},
      ${now},
      ${now},
      ${null}
    )
    ON CONFLICT("jobId") DO UPDATE SET
      "batchIds" = excluded."batchIds",
      "status" = excluded."status",
      "currentStep" = excluded."currentStep",
      "message" = excluded."message",
      "updatedAt" = excluded."updatedAt"
  `;
}

async function updateWorkflowStatus(
  jobId: string,
  input: {
    status: string;
    currentStep: string;
    message: string;
    error?: string;
    finishedAt?: Date;
  }
) {
  await ensureWorkflowStatusTable();
  await prisma.$executeRaw`
    UPDATE "SamplingFullWorkflowStatus"
    SET
      "status" = ${input.status},
      "currentStep" = ${input.currentStep},
      "message" = ${input.message},
      "error" = ${input.error ?? ""},
      "updatedAt" = ${new Date()},
      "finishedAt" = ${input.finishedAt ?? null}
    WHERE "jobId" = ${jobId}
  `;
}

async function ensureWorkflowStatusTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SamplingFullWorkflowStatus" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT NOT NULL UNIQUE,
      "batchIds" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "currentStep" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "error" TEXT,
      "startedAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL,
      "finishedAt" DATETIME
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "SamplingFullWorkflowStatus_project_updated_idx"
    ON "SamplingFullWorkflowStatus" ("projectId", "updatedAt")
  `);
}

function normalizeWorkflowStatusRow(row: WorkflowStatusRow): SamplingFullWorkflowStatusView {
  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    batchIds: parseBatchIds(row.batchIds),
    retryableRunCount: 0,
    status: row.status,
    currentStep: row.currentStep,
    message: row.message,
    error: row.error || "",
    startedAt: new Date(row.startedAt),
    updatedAt: new Date(row.updatedAt),
    finishedAt: row.finishedAt ? new Date(row.finishedAt) : null
  };
}

async function retryableAnswerRunIdsForBatches(batchIds: string[]) {
  const runs = await prisma.answerRun.findMany({
    where: {
      samplingBatchId: { in: batchIds },
      status: { in: retryableAnswerRunStatuses }
    },
    orderBy: [{ runAt: "asc" }, { id: "asc" }],
    select: { id: true }
  });
  return runs.map((run) => run.id);
}

async function retryableAnswerRunCountForBatches(batchIds: string[]) {
  if (batchIds.length === 0) return 0;
  return prisma.answerRun.count({
    where: {
      samplingBatchId: { in: batchIds },
      status: { in: retryableAnswerRunStatuses }
    }
  });
}

function parseBatchIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
  return [];
}

async function loadWorkflowRuns(batchIds: string[]) {
  return prisma.answerRun.findMany({
    where: { samplingBatchId: { in: batchIds } },
    include: { sources: true },
    orderBy: [{ runAt: "asc" }, { id: "asc" }]
  });
}

async function loadWorkflowSources(batchIds: string[]) {
  return prisma.source.findMany({
    where: { run: { samplingBatchId: { in: batchIds } } },
    include: {
      run: {
        include: {
          engineConfig: true
        }
      }
    },
    orderBy: [{ run: { runAt: "desc" } }, { position: "asc" }, { id: "asc" }]
  });
}

async function workflowBatchLabel(batchIds: string[]) {
  const batches = await prisma.samplingBatch.findMany({
    where: { id: { in: batchIds } },
    orderBy: [{ batchDate: "desc" }, { sequence: "desc" }, { id: "asc" }],
    select: { id: true, name: true }
  });
  const names = batches.map((batch) => batch.name?.trim() || batch.id);
  return names.length === 0 ? "未命名批次" : names.join("、");
}

async function createWorkflowReport(input: {
  projectId: string;
  type: string;
  title: string;
  markdown: string;
  warning?: string;
}) {
  const markdown = input.warning ? `> ${input.warning}\n\n${input.markdown}` : input.markdown;
  return prisma.report.create({
    data: {
      projectId: input.projectId,
      type: input.type,
      title: input.title,
      markdown,
      status: input.warning ? "generated_with_warning" : "generated"
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown_error";
}
