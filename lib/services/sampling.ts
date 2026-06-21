import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/connectors";
import { parseAnswer } from "@/lib/ai/evaluator";
import { analyzeAnswerRun } from "@/lib/services/analysis";
import { closePersistentBrowserContext } from "@/lib/connectors/browser-session";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { domainFromUrl, primaryBrandName, splitCsv } from "@/lib/utils";
import type { CollectionOutput } from "@/lib/connectors/types";

type SamplingMode = "browser" | "mock";

type LoadedSamplingPlan = NonNullable<Awaited<ReturnType<typeof loadSamplingPlanForRun>>>;

type SamplingOptions = {
  queryIds?: string[];
  engineIds?: string[];
  batchName?: string;
};

type RetryAnswerRunsOptions = {
  sourceJobId?: string;
  workflowResume?: boolean;
};

const answerRunTimeoutMs = 120000;

type SamplingQuery = {
  id: string;
  clusterId: string;
  queryText: string;
  language: string;
  region: string;
  device: string;
};

type SamplingEngine = {
  id: string;
  engineType: string;
  baseUrl: string;
  language: string;
  region: string;
};

type PlannedRun = {
  query: SamplingQuery;
  engine: SamplingEngine;
  repeatIndex: number;
  sequence: number;
  runId: string;
  samplingBatchId: string;
};

type PreparedSamplingJob = {
  jobId: string;
  mode: SamplingMode;
  runs: PlannedRun[];
  brandName: string;
  competitors: string[];
};

async function loadSamplingPlanForRun(planId: string) {
  return prisma.samplingPlan.findUnique({
    where: { id: planId },
    include: {
      project: {
        include: {
          brandProfile: { include: { competitors: true } },
          queryClusters: {
            include: { queries: { orderBy: { createdAt: "asc" } } },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
          },
          engineConfigs: { orderBy: { createdAt: "asc" } }
        }
      },
      engines: { include: { engineConfig: true }, orderBy: { id: "asc" } }
    }
  });
}

export async function startSamplingPlan(planId: string, mode: SamplingMode = "mock", maxRuns = 0, options: SamplingOptions = {}) {
  const prepared = await prepareSamplingJob(planId, mode, maxRuns, options);
  // API 入口使用 start* 变体时只负责持久化任务；浏览器采集可能持续数分钟，必须在后台继续推进。
  void executePreparedSamplingJob(prepared).catch((error) => {
    console.error("sampling_run_failed", error);
  });
  return prisma.samplingJob.findUnique({ where: { id: prepared.jobId } });
}

export async function runSamplingPlan(planId: string, mode: SamplingMode = "mock", maxRuns = 0, options: SamplingOptions = {}) {
  const prepared = await prepareSamplingJob(planId, mode, maxRuns, options);
  return executePreparedSamplingJob(prepared);
}

export async function startRerunAnswerRun(runId: string, mode: SamplingMode = "browser") {
  const prepared = await prepareRerunAnswerRun(runId, mode);
  void executePreparedSamplingJob(prepared).catch((error) => {
    console.error("sampling_rerun_failed", error);
  });
  return prisma.answerRun.findUnique({ where: { id: runId } });
}

export async function startRetryAnswerRuns(runIds: string[], mode: SamplingMode = "browser", options: RetryAnswerRunsOptions = {}) {
  const prepared = await prepareRetryAnswerRuns(runIds, mode, options);
  void executePreparedSamplingJob(prepared).catch((error) => {
    console.error("sampling_retry_failed", error);
  });
  return prisma.samplingJob.findUnique({ where: { id: prepared.jobId } });
}

export async function rerunAnswerRun(runId: string, mode: SamplingMode = "mock") {
  const prepared = await prepareRerunAnswerRun(runId, mode);
  return executePreparedSamplingJob(prepared);
}

async function prepareSamplingJob(planId: string, mode: SamplingMode, maxRuns: number, options: SamplingOptions): Promise<PreparedSamplingJob> {
  const plan = await loadSamplingPlanForRun(planId);
  if (!plan) throw new Error(`Sampling plan not found: ${planId}`);

  // 查询范围、平台范围与重复次数在执行前一次性展开，后续队列状态只依赖已创建的 AnswerRun。
  const projectId = plan.projectId;
  const allQueries = plan.project.queryClusters.flatMap((cluster) => cluster.queries.filter((query) => query.status === "active"));
  const requestedQueryIds = (options.queryIds || []).filter(Boolean);
  const queries = requestedQueryIds.length > 0
    ? resolveRequestedQueries(requestedQueryIds, allQueries)
    : resolveScopedQueries(plan.queryScope, allQueries);
  const requestedEngineIds = (options.engineIds || []).filter(Boolean);
  const planEngines = plan.engines.map((planEngine) => planEngine.engineConfig);
  const selectedEngines = requestedEngineIds.length > 0
    ? plan.project.engineConfigs.filter((engine) => engine.status === "active" && requestedEngineIds.includes(engine.id))
    : planEngines;
  const clusterNameById = new Map(plan.project.queryClusters.map((cluster) => [cluster.id, cluster.name]));
  const plannedRuns: Array<Omit<PlannedRun, "runId" | "samplingBatchId">> = [];
  const repeatTotal = Math.max(1, plan.repeatCount || 1);
  for (const engine of selectedEngines) {
    for (const query of queries) {
      for (let repeatIndex = 0; repeatIndex < repeatTotal; repeatIndex++) {
        if (maxRuns > 0 && plannedRuns.length >= maxRuns) {
          break;
        }
        plannedRuns.push({
          query,
          engine,
          repeatIndex,
          sequence: plannedRuns.length + 1
        });
      }
      if (maxRuns > 0 && plannedRuns.length >= maxRuns) {
        break;
      }
    }
    if (maxRuns > 0 && plannedRuns.length >= maxRuns) {
      break;
    }
  }
  const cappedRuns = maxRuns > 0 ? plannedRuns.slice(0, maxRuns) : plannedRuns;
  const startedAt = new Date();
  const job = await prisma.samplingJob.create({
    data: {
      planId,
      status: cappedRuns.length > 0 ? "running" : "succeeded",
      startedAt,
      finishedAt: cappedRuns.length > 0 ? undefined : startedAt,
      queryCount: queries.length,
      engineCount: selectedEngines.length,
      failureSummary: cappedRuns.length > 0 ? null : "No sampling runs planned"
    }
  });
  const batchIdsByClusterId = await createSamplingBatchesForRuns(
    projectId,
    job.id,
    cappedRuns,
    startedAt,
    options.batchName,
    clusterNameById
  );
  // 先创建所有 AnswerRun，再逐条执行；这样取消、继续、状态页和完整工作流都能看到稳定的计划清单。
  const answerRuns = await prisma.$transaction(
    cappedRuns.map((runSpec) =>
      prisma.answerRun.create({
        data: {
          projectId,
          queryId: runSpec.query.id,
          engineConfigId: runSpec.engine.id,
          samplingJobId: job.id,
          samplingBatchId: batchIdsByClusterId.get(runSpec.query.clusterId) || null,
          repeatIndex: runSpec.repeatIndex,
          status: "queued",
          answerText: "",
          engineMetadata: JSON.stringify({
            mode,
            plannedSequence: runSpec.sequence,
            samplingBatchId: batchIdsByClusterId.get(runSpec.query.clusterId) || null
          })
        },
        select: { id: true }
      })
    )
  );
  const brandProfile = plan.project.brandProfile;
  return {
    jobId: job.id,
    mode,
    runs: cappedRuns.map((runSpec, index) => ({
      ...runSpec,
      runId: answerRuns[index].id,
      samplingBatchId: batchIdsByClusterId.get(runSpec.query.clusterId) || ""
    })),
    brandName: primaryBrandName(brandProfile),
    competitors: brandProfile?.competitors.map((competitor) => competitor.name) || []
  };
}

async function prepareRerunAnswerRun(runId: string, mode: SamplingMode): Promise<PreparedSamplingJob> {
  return prepareRetryAnswerRuns([runId], mode);
}

async function prepareRetryAnswerRuns(runIds: string[], mode: SamplingMode, options: RetryAnswerRunsOptions = {}): Promise<PreparedSamplingJob> {
  const uniqueRunIds = uniqueInOrder(runIds.map((runId) => runId.trim()).filter(Boolean));
  if (uniqueRunIds.length === 0) throw new Error("缺少需要重试的采样");

  const runs = await prisma.answerRun.findMany({
    where: { id: { in: uniqueRunIds } },
    include: {
      query: true,
      engineConfig: true,
      samplingJob: { select: { planId: true } },
      project: {
        include: {
          brandProfile: { include: { competitors: true } },
          samplingPlans: { orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] }
        }
      }
    }
  });
  const runById = new Map(runs.map((run) => [run.id, run]));
  const orderedRuns: typeof runs = [];
  const missingRunIds: string[] = [];
  for (const runId of uniqueRunIds) {
    const run = runById.get(runId);
    if (run) orderedRuns.push(run);
    else missingRunIds.push(runId);
  }
  if (missingRunIds.length > 0) {
    throw new Error(`采样不存在：${missingRunIds.join("、")}`);
  }

  const firstRun = orderedRuns[0];
  const projectId = firstRun.projectId;
  if (orderedRuns.some((run) => run.projectId !== projectId)) {
    throw new Error("不能跨项目重试采样");
  }

  const planId = firstRun.samplingJob?.planId
    || firstRun.project.samplingPlans.find((plan) => plan.status === "active")?.id
    || firstRun.project.samplingPlans[0]?.id;
  if (!planId) throw new Error("当前项目没有可用于重新采样的 SamplingPlan");

  const startedAt = new Date();
  const job = await prisma.samplingJob.create({
    data: {
      planId,
      status: "running",
      startedAt,
      queryCount: new Set(orderedRuns.map((run) => run.queryId)).size,
      engineCount: new Set(orderedRuns.map((run) => run.engineConfigId)).size,
      failureSummary: null
    }
  });

  for (let index = 0; index < orderedRuns.length; index += 1) {
    const run = orderedRuns[index];
    await resetAnswerRunForRerun(run.id, job.id, mode, run.samplingBatchId, index + 1, options);
  }

  const brandProfile = firstRun.project.brandProfile;
  return {
    jobId: job.id,
    mode,
    runs: orderedRuns.map((run, index) => ({
      query: run.query,
      engine: run.engineConfig,
      repeatIndex: run.repeatIndex,
      sequence: index + 1,
      runId: run.id,
      samplingBatchId: run.samplingBatchId || ""
    })),
    brandName: primaryBrandName(brandProfile),
    competitors: brandProfile?.competitors.map((competitor) => competitor.name) || []
  };
}

async function resetAnswerRunForRerun(
  runId: string,
  samplingJobId: string,
  mode: SamplingMode,
  samplingBatchId?: string | null,
  plannedSequence = 1,
  options: RetryAnswerRunsOptions = {}
) {
  // 重跑会使引用、提及、指标和证据命中全部失效；先清理派生数据，避免新旧分析结果混用。
  await prisma.answerEvidenceHit.deleteMany({ where: { runId } });
  await prisma.citation.deleteMany({ where: { runId } });
  await prisma.source.deleteMany({ where: { runId } });
  await prisma.mention.deleteMany({ where: { runId } });
  await prisma.competitorOccurrence.deleteMany({ where: { runId } });
  await prisma.runMetric.deleteMany({ where: { runId } });
  await prisma.answerRun.update({
    where: { id: runId },
    data: {
      samplingJobId,
      status: "queued",
      answerText: "",
      rawResponseUri: null,
      screenshotUri: null,
      failureReason: null,
      answerAnalysis: null,
      answerAnalysisAt: null,
      answerAnalysisError: null,
      referenceFeatureAnalysis: null,
      referenceFeatureAnalysisAt: null,
      referenceFeatureAnalysisError: null,
      competitorReferenceFeatureAnalysis: null,
      competitorReferenceFeatureAnalysisAt: null,
      competitorReferenceFeatureAnalysisError: null,
      answerReferenceAnalysis: null,
      answerReferenceAnalysisAt: null,
      answerReferenceAnalysisError: null,
      engineMetadata: JSON.stringify({
        mode,
        rerun: true,
        workflowResume: Boolean(options.workflowResume),
        resumeSourceJobId: options.sourceJobId || undefined,
        plannedSequence,
        samplingBatchId: samplingBatchId || null
      })
    }
  });
}

async function executePreparedSamplingJob(prepared: PreparedSamplingJob) {
  let failed = 0;
  let completed = 0;
  let cancelled = false;

  try {
    // 浏览器会话、页面焦点和剪贴板都属于共享资源；采样按计划串行执行以降低平台 UI 干扰。
    for (const runSpec of prepared.runs) {
      if (await isSamplingJobCancelled(prepared.jobId)) {
        cancelled = true;
        break;
      }
      const result = await executeRun(prepared, runSpec);
      if (result.cancelled) {
        cancelled = true;
        break;
      }
      if (result.failed) failed += 1;
      completed += 1;
    }
  } catch (error) {
    // 连接器抛错和用户取消可能同时发生；这里重新读取任务状态，确保最终状态以用户取消为准。
    if (await isSamplingJobCancelled(prepared.jobId)) {
      await cancelQueuedAndRunningRuns(prepared.jobId);
      return prisma.samplingJob.update({
        where: { id: prepared.jobId },
        data: {
          status: "cancelled",
          finishedAt: new Date(),
          failureSummary: "Cancelled by user request"
        }
      });
    }
    await prisma.answerRun.updateMany({
      where: { samplingJobId: prepared.jobId, status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        failureReason: error instanceof Error ? error.message.slice(0, 1000) : "unknown_sampling_error"
      }
    });
    await prisma.samplingJob.update({
      where: { id: prepared.jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        failureSummary: error instanceof Error ? error.message.slice(0, 1000) : "unknown_sampling_error"
      }
    });
    return prisma.samplingJob.findUnique({ where: { id: prepared.jobId } });
  }

  if (cancelled || await isSamplingJobCancelled(prepared.jobId)) {
    await cancelQueuedAndRunningRuns(prepared.jobId);
    return prisma.samplingJob.update({
      where: { id: prepared.jobId },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
        failureSummary: "Cancelled by user request"
      }
    });
  }

  return prisma.samplingJob.update({
    where: { id: prepared.jobId },
    data: {
      status: failed > 0 ? "partial_failed" : "succeeded",
      finishedAt: new Date(),
      failureSummary: failed > 0
        ? `${failed} 条采样失败；${completed} 条采样完成；${prepared.runs.length} 条采样计划执行`
        : `${completed} 条采样完成`
    }
  });
}

async function executeRun(prepared: PreparedSamplingJob, runSpec: PlannedRun) {
  const { query, engine } = runSpec;
  await prisma.answerRun.update({
    where: { id: runSpec.runId },
    data: {
      status: "running",
      runAt: new Date(),
      failureReason: null,
      engineMetadata: JSON.stringify({
        mode: prepared.mode,
        plannedSequence: runSpec.sequence,
        samplingBatchId: runSpec.samplingBatchId || null
      })
    }
  });
  try {
    if (await isSamplingJobCancelled(prepared.jobId)) {
      await markRunCancelled(runSpec.runId);
      return { failed: true, cancelled: true };
    }

    const connector = getConnector(engine.engineType, prepared.mode);
    const output = await collectWithAnswerRunTimeout(
      connector.collect({
        queryText: query.queryText,
        engineType: engine.engineType,
        baseUrl: engine.baseUrl,
        language: query.language || engine.language,
        region: query.region || engine.region,
        device: query.device,
        timeoutMs: answerRunTimeoutMs,
        waitAfterSubmitMs: answerRunTimeoutMs,
        keepOpen: false,
        brandName: prepared.brandName,
        competitors: prepared.competitors
      }),
      engine.engineType
    );
    if (await isSamplingJobCancelled(prepared.jobId)) {
      await markRunCancelled(runSpec.runId);
      return { failed: true, cancelled: true };
    }

    await prisma.answerRun.update({
      where: { id: runSpec.runId },
      data: {
        status: output.status,
        answerText: output.answerText || "",
        rawResponseUri: output.rawResponse ? "inline:raw_response" : undefined,
        failureReason: output.failureReason,
        engineMetadata: JSON.stringify({
          ...(output.engineMetadata || {}),
          plannedSequence: runSpec.sequence,
          samplingBatchId: runSpec.samplingBatchId || null
        }),
        sources: {
          // 采集阶段只保存平台返回的引用线索；正文抓取和结构化分析由后续工作流完成。
          create: output.sources.map((source) => {
            const url = normalizeStoredReferenceUrl(source.url);
            return {
              url,
              domain: domainFromUrl(url),
              title: source.title,
              sourceType: source.sourceType,
              position: source.position,
              summary: source.summary || null,
              keyword: source.keyword || null,
              siteName: source.siteName || null
            };
          })
        }
      }
    });
    return { failed: output.status === "failed", cancelled: false };
  } catch (error) {
    if (await isSamplingJobCancelled(prepared.jobId)) {
      await markRunCancelled(runSpec.runId);
      return { failed: true, cancelled: true };
    }
    await prisma.answerRun.update({
      where: { id: runSpec.runId },
      data: {
        status: "failed",
        answerText: "",
        failureReason: error instanceof Error ? error.message.slice(0, 1000) : "unknown_error",
        engineMetadata: JSON.stringify({
          mode: prepared.mode,
          plannedSequence: runSpec.sequence,
          samplingBatchId: runSpec.samplingBatchId || null
        })
      }
    });
    return { failed: true, cancelled: false };
  }
}

async function collectWithAnswerRunTimeout(collection: Promise<CollectionOutput>, engineType: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      collection,
      new Promise<CollectionOutput>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`answer_run_timeout:${Math.round(answerRunTimeoutMs / 1000)}s`));
        }, answerRunTimeoutMs);
      })
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("answer_run_timeout:")) {
      // 超时后关闭持久化上下文，避免平台页面仍在后台生成并污染下一次采集。
      await closePersistentBrowserContext(engineType);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function createSamplingBatchesForRuns(
  projectId: string,
  samplingJobId: string,
  runs: Array<Omit<PlannedRun, "runId" | "samplingBatchId">>,
  date: Date,
  batchName: string | undefined,
  clusterNameById: Map<string, string>
) {
  // 一次提交对应一个批次；多 Query 集场景下共享批次 ID，名称中保留涉及的 Query 集摘要。
  const batchDate = formatSamplingBatchDate(date);
  const clusterIds = uniqueInOrder(runs.map((run) => run.query.clusterId));
  const batchIdsByClusterId = new Map<string, string>();
  if (clusterIds.length === 0) return batchIdsByClusterId;

  const normalizedBatchName = normalizeUserBatchName(batchName);
  const formattedBatchName = formatStoredBatchName(
    clusterIds.map((clusterId) => clusterNameById.get(clusterId) || clusterId),
    normalizedBatchName
  );
  const primaryClusterId = clusterIds[0];
  const batch = await createSamplingBatch(projectId, primaryClusterId, samplingJobId, batchDate, formattedBatchName);
  for (const clusterId of clusterIds) {
    batchIdsByClusterId.set(clusterId, batch.id);
  }
  return batchIdsByClusterId;
}

async function createSamplingBatch(
  projectId: string,
  clusterId: string,
  samplingJobId: string,
  batchDate: string,
  batchName: string | null
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // sequence 由“读取最新值后插入”生成；并发提交时依赖唯一约束失败重试。
    const latest = await prisma.samplingBatch.findFirst({
      where: { projectId, batchDate },
      orderBy: { sequence: "desc" },
      select: { sequence: true }
    });
    const sequence = (latest?.sequence || 0) + 1;
    const id = buildSamplingBatchId(projectId, batchDate, sequence);
    try {
      return await prisma.samplingBatch.create({
        data: {
          id,
          name: batchName,
          projectId,
          clusterId,
          samplingJobId,
          batchDate,
          sequence
        },
        select: { id: true }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
  throw new Error(`Unable to create sampling batch for cluster ${clusterId} on ${batchDate}`);
}

function normalizeUserBatchName(value?: string) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 120) : null;
}

function formatStoredBatchName(clusterNames: string[], userBatchName: string | null) {
  if (!userBatchName) return null;
  const names = clusterNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return userBatchName;
  if (names.length === 1) return `${names[0]}-${userBatchName}`;
  return `${names[0]}等${names.length}个Query集-${userBatchName}`;
}

function buildSamplingBatchId(projectId: string, batchDate: string, sequence: number) {
  return `${projectId}-${batchDate}-${String(sequence).padStart(3, "0")}`;
}

function formatSamplingBatchDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date).replace(/\D/g, "");
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
  );
}

async function isSamplingJobCancelled(jobId: string) {
  const currentJob = await prisma.samplingJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return currentJob?.status === "cancelled";
}

async function cancelQueuedAndRunningRuns(jobId: string) {
  await prisma.answerRun.updateMany({
    where: { samplingJobId: jobId, status: { in: ["queued", "running"] } },
    data: {
      status: "cancelled",
      failureReason: "Cancelled by user request"
    }
  });
}

async function markRunCancelled(runId: string) {
  await prisma.answerRun.update({
    where: { id: runId },
    data: {
      status: "cancelled",
      failureReason: "Cancelled by user request"
    }
  });
}

function resolveScopedQueries<T extends { id: string }>(queryScope: string, allQueries: T[]) {
  if (!queryScope || queryScope === "all_active") return allQueries;
  try {
    const parsed = JSON.parse(queryScope) as { mode?: string; queryIds?: string[] };
    if (parsed.mode === "query_ids") {
      const selected = new Set(parsed.queryIds || []);
      return allQueries.filter((query) => selected.has(query.id));
    }
  } catch {
    // 历史数据可能存有非 JSON scope；解析失败时回退到全部活跃 Query，保证采样仍可执行。
    return allQueries;
  }
  return allQueries;
}

function resolveRequestedQueries<T extends { id: string }>(queryIds: string[], allQueries: T[]) {
  const selected = new Set(queryIds);
  return allQueries.filter((query) => selected.has(query.id));
}

export async function importManualAnswer(input: {
  projectId: string;
  queryId: string;
  engineConfigId: string;
  answerText: string;
  sources?: Array<{ url: string; title: string; sourceType?: string; summary?: string; keyword?: string; siteName?: string }>;
}) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { brandProfile: { include: { competitors: true } }, llmConfig: true }
  });
  if (!project) throw new Error(`Project not found: ${input.projectId}`);
  const rawSources = (input.sources || []).map((source, index) => ({
    url: source.url,
    title: source.title,
    sourceType: source.sourceType || "manual",
    position: index + 1,
    summary: source.summary,
    keyword: source.keyword,
    siteName: source.siteName
  }));
  const parsed = await parseAnswer(
    input.answerText,
    rawSources,
    [...splitCsv(project.brandProfile?.brandNames), ...splitCsv(project.brandProfile?.productNames), ...splitCsv(project.brandProfile?.aliases)],
    project.brandProfile?.competitors.map((competitor) => competitor.name) || [],
    project.llmConfig
  );
  const run = await prisma.answerRun.create({
    data: {
      projectId: input.projectId,
      queryId: input.queryId,
      engineConfigId: input.engineConfigId,
      status: "succeeded",
      answerText: input.answerText,
      engineMetadata: JSON.stringify({ mode: "manual_import" }),
      sources: {
        create: parsed.sources.map((source) => {
          const url = normalizeStoredReferenceUrl(source.url);
          return {
            url,
            domain: domainFromUrl(url),
            title: source.title,
            sourceType: source.sourceType,
            position: source.position,
            summary: source.summary || null,
            keyword: source.keyword || null,
            siteName: source.siteName || null
          };
        })
      }
    }
  });
  await analyzeAnswerRun(run.id);
  return run;
}

function normalizeStoredReferenceUrl(url: string) {
  return normalizeReferenceSourceUrl(url) || url;
}
