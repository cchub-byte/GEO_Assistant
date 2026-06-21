"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export type SamplingPlanView = {
  id: string;
  name: string;
  repeatCount: number;
  engines: Array<{ id: string; displayName: string; engineType: string; baseUrl: string }>;
};

export type QueryOptionView = {
  id: string;
  queryText: string;
  region: string;
  status: string;
};

export type QueryClusterView = {
  id: string;
  name: string;
  status: string;
  defaultEngineIds: string[] | null;
  queries: QueryOptionView[];
};

export type AnswerRunSourceView = {
  id: string;
  position: number;
  title: string;
  summary: string;
  url: string;
  siteName: string;
  domain: string;
  fetchedUrl: string;
  bodyText: string;
  author: string;
  publishedAt: string;
  content: string;
  fetchMode: string;
  fetchError: string;
  fetchedAt: string;
  referenceFeatureAnalysis: string;
  referenceFeatureAnalysisAt: string;
  referenceFeatureAnalysisError: string;
  competitorReferenceFeatureAnalysis: string;
  competitorReferenceFeatureAnalysisAt: string;
  competitorReferenceFeatureAnalysisError: string;
};

export type BrandAnalysisView = {
  brandName: string;
  brandMatchedTerm: string;
  totalLineCount: number;
  brandLine: number | null;
  competitors: Array<{
    name: string;
    line: number | null;
  }>;
};

export type AnswerRunView = {
  id: string;
  samplingBatchId: string;
  samplingBatchName: string;
  queryId: string;
  queryClusterId: string;
  runAt: string;
  platform: string;
  queryText: string;
  status: string;
  failureReason: string;
  answerText: string;
  brandAnalysis: BrandAnalysisView;
  answerAnalysis: string;
  answerAnalysisAt: string;
  answerAnalysisError: string;
  answerReferenceAnalysis: string;
  answerReferenceAnalysisAt: string;
  answerReferenceAnalysisError: string;
  referenceFeatureAnalysis: string;
  referenceFeatureAnalysisAt: string;
  referenceFeatureAnalysisError: string;
  competitorReferenceFeatureAnalysis: string;
  competitorReferenceFeatureAnalysisAt: string;
  competitorReferenceFeatureAnalysisError: string;
  searchKeywords: string[];
  brandTerms: string[];
  competitorTerms: string[];
  sources: AnswerRunSourceView[];
};

export type SamplingWorkflowStatusView = {
  id: string;
  jobId: string;
  batchIds: string[];
  batchLabel: string;
  retryableRunCount: number;
  canContinue: boolean;
  status: string;
  currentStep: string;
  message: string;
  error: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
};

type ReferenceFetchState = {
  loading: boolean;
  message: string;
  error: string;
};

type SamplingEnvironmentCheckResult = {
  engineConfigId: string;
  displayName: string;
  engineType: string;
  baseUrl: string;
  status: "ok" | "blocked" | "error";
  message: string;
  currentUrl: string;
};

type RerunSamplingState = {
  loading: boolean;
  message: string;
  error: string;
};

type BatchOperationState = {
  loading: boolean;
  kind: string;
  message: string;
  error: string;
};

type OneClickAnalysisState = {
  loading: boolean;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentLabel: string;
  message: string;
  error: string;
};

type OperationResult = {
  ok: boolean;
  error?: string;
};

type DetailTabKey =
  | "answer"
  | "references";

type BatchOperationKind =
  | "answer-analysis"
  | "reference-fetch";

const batchOperationLabels: Record<BatchOperationKind, string> = {
  "answer-analysis": "全部回答分析",
  "reference-fetch": "全部获取引用"
};

const workflowStepOrder = [
  "sampling",
  "answer-analysis",
  "reference-fetch",
  "brand-profile-analysis",
  "competitor-brand-analysis",
  "answer-evidence-hit-analysis",
  "completed"
];

export function SamplingWorkbench({
  activePlan,
  clusters,
  runs,
  initialBatchIds = [],
  workflowStatuses = []
}: {
  activePlan: SamplingPlanView | null;
  clusters: QueryClusterView[];
  runs: AnswerRunView[];
  initialBatchIds?: string[];
  workflowStatuses?: SamplingWorkflowStatusView[];
}) {
  const router = useRouter();
  const [runItems, setRunItems] = useState(runs);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [environmentCheckOpen, setEnvironmentCheckOpen] = useState(false);
  const [environmentCheckEngineIds, setEnvironmentCheckEngineIds] = useState<string[]>(() => activePlan?.engines.map((engine) => engine.id) || []);
  const [environmentCheckLoading, setEnvironmentCheckLoading] = useState(false);
  const [environmentCheckError, setEnvironmentCheckError] = useState("");
  const [environmentCheckResults, setEnvironmentCheckResults] = useState<SamplingEnvironmentCheckResult[]>([]);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTabKey>("answer");
  const [sourceDetail, setSourceDetail] = useState<{ runId: string; sourceId: string } | null>(null);
  const [referenceFetchState, setReferenceFetchState] = useState<Record<string, ReferenceFetchState>>({});
  const [rerunSamplingState, setRerunSamplingState] = useState<Record<string, RerunSamplingState>>({});
  const [batchOperationState, setBatchOperationState] = useState<BatchOperationState>({
    loading: false,
    kind: "",
    message: "",
    error: ""
  });
  const [oneClickAnalysisState, setOneClickAnalysisState] = useState<OneClickAnalysisState>({
    loading: false,
    total: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    currentLabel: "",
    message: "",
    error: ""
  });
  const initialLaunchCluster = clusters.find((cluster) => cluster.status === "active") || null;
  const initialLaunchClusterIds = initialLaunchCluster ? [initialLaunchCluster.id] : [];
  const [selectedClusterIds, setSelectedClusterIds] = useState<string[]>(initialLaunchClusterIds);
  const [selectedQueryIds, setSelectedQueryIds] = useState<string[]>(() => activeQueryIdsForClusterIds(clusters, initialLaunchClusterIds));
  const [selectedEngineIds, setSelectedEngineIds] = useState<string[]>(
    () => defaultEngineIdsForClusters(clusters.filter((cluster) => initialLaunchClusterIds.includes(cluster.id)), activePlan)
  );
  const [filterClusterIds, setFilterClusterIds] = useState<string[]>([]);
  const [filterQueryIds, setFilterQueryIds] = useState<string[]>([]);
  const [filterBatchIds, setFilterBatchIds] = useState<string[]>(initialBatchIds);
  const [workflowHistoryExpanded, setWorkflowHistoryExpanded] = useState(false);
  const selectedClusters = useMemo(() => {
    const selected = new Set(selectedClusterIds);
    return clusters.filter((cluster) => selected.has(cluster.id));
  }, [clusters, selectedClusterIds]);
  const activeQueries = useMemo(
    () => selectedClusters.flatMap((cluster) =>
      cluster.queries
        .filter((query) => query.status === "active")
        .map((query) => ({ ...query, clusterId: cluster.id, clusterName: cluster.name }))
    ),
    [selectedClusters]
  );
  const filterQueries = useMemo(() => {
    const selectedClusterIdSet = new Set(filterClusterIds);
    return clusters
      .filter((cluster) => selectedClusterIdSet.size === 0 || selectedClusterIdSet.has(cluster.id))
      .flatMap((cluster) => cluster.queries.map((query) => ({ ...query, clusterName: cluster.name })));
  }, [clusters, filterClusterIds]);
  const effectiveFilterQueryIds = useMemo(() => {
    const availableQueryIds = new Set(filterQueries.map((query) => query.id));
    return filterQueryIds.filter((queryId) => availableQueryIds.has(queryId));
  }, [filterQueries, filterQueryIds]);
  const batchOptions = useMemo(() => {
    const clusterNameById = new Map(clusters.map((cluster) => [cluster.id, cluster.name]));
    const batches = new Map<string, { id: string; label: string; latestRunAt: string; clusterNames: Set<string> }>();
    for (const run of runItems) {
      if (!run.samplingBatchId) continue;
      const current = batches.get(run.samplingBatchId) || {
        id: run.samplingBatchId,
        label: run.samplingBatchName || run.samplingBatchId,
        latestRunAt: run.runAt,
        clusterNames: new Set<string>()
      };
      if (run.runAt > current.latestRunAt) current.latestRunAt = run.runAt;
      current.clusterNames.add(clusterNameById.get(run.queryClusterId) || "未知 Query集");
      batches.set(run.samplingBatchId, current);
    }
    return [...batches.values()]
      .map((batch) => ({
        id: batch.id,
        label: batch.label,
        latestRunAt: batch.latestRunAt,
        clusterName: [...batch.clusterNames].join("、")
      }))
      .sort((left, right) => right.latestRunAt.localeCompare(left.latestRunAt) || left.id.localeCompare(right.id));
  }, [runItems, clusters]);
  const filteredRuns = useMemo(() => {
    const clusterIdSet = new Set(filterClusterIds);
    const queryIdSet = new Set(effectiveFilterQueryIds);
    const batchIdSet = new Set(filterBatchIds);
    return runItems.filter((run) => {
      if (clusterIdSet.size > 0 && !clusterIdSet.has(run.queryClusterId)) return false;
      if (queryIdSet.size > 0 && !queryIdSet.has(run.queryId)) return false;
      if (batchIdSet.size > 0 && !batchIdSet.has(run.samplingBatchId)) return false;
      return true;
    });
  }, [runItems, filterClusterIds, effectiveFilterQueryIds, filterBatchIds]);
  const detailRun = runItems.find((run) => run.id === detailRunId) || null;
  const detailSource = sourceDetail
    ? runItems.find((run) => run.id === sourceDetail.runId)?.sources.find((source) => source.id === sourceDetail.sourceId) || null
    : null;
  const oneClickProgressPercent = oneClickAnalysisState.total === 0
    ? 0
    : Math.round((oneClickAnalysisState.completed / oneClickAnalysisState.total) * 100);
  const activeQueryIds = activeQueries.map((query) => query.id);
  const selectedActiveQueryCount = selectedQueryIds.filter((queryId) => activeQueryIds.includes(queryId)).length;
  const allActiveQueriesSelected = activeQueryIds.length > 0 && selectedActiveQueryCount === activeQueryIds.length;
  const activeLaunchClusterIds = clusters.filter((cluster) => cluster.status === "active").map((cluster) => cluster.id);
  const allLaunchClustersSelected = activeLaunchClusterIds.length > 0 && activeLaunchClusterIds.every((clusterId) => selectedClusterIds.includes(clusterId));
  const orderedWorkflowStatuses = useMemo(
    () =>
      [...workflowStatuses].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || right.startedAt.localeCompare(left.startedAt)
        || right.id.localeCompare(left.id)
      ),
    [workflowStatuses]
  );
  const visibleWorkflowStatuses = workflowHistoryExpanded
    ? orderedWorkflowStatuses
    : orderedWorkflowStatuses.slice(0, 1);
  const hiddenWorkflowCount = Math.max(0, orderedWorkflowStatuses.length - 1);
  const runningWorkflowCount = orderedWorkflowStatuses.filter((status) => status.status === "running").length;

  useEffect(() => {
    setRunItems(runs);
  }, [runs]);

  useEffect(() => {
    setFilterBatchIds(initialBatchIds);
  }, [initialBatchIds.join(",")]);

  useEffect(() => {
    setEnvironmentCheckEngineIds(activePlan?.engines.map((engine) => engine.id) || []);
  }, [activePlan]);

  function toggleLaunchCluster(clusterId: string) {
    setSelectedClusterIds((current) => {
      const next = current.includes(clusterId)
        ? current.filter((item) => item !== clusterId)
        : [...current, clusterId];
      const nextClusters = clusters.filter((cluster) => next.includes(cluster.id));
      setSelectedQueryIds(activeQueryIdsForClusterIds(clusters, next));
      setSelectedEngineIds(defaultEngineIdsForClusters(nextClusters, activePlan));
      return next;
    });
  }

  function toggleAllLaunchClusters() {
    const next = allLaunchClustersSelected ? [] : activeLaunchClusterIds;
    setSelectedClusterIds(next);
    setSelectedQueryIds(activeQueryIdsForClusterIds(clusters, next));
    setSelectedEngineIds(defaultEngineIdsForClusters(clusters.filter((cluster) => next.includes(cluster.id)), activePlan));
  }

  function toggleQuery(queryId: string) {
    setSelectedQueryIds((current) =>
      current.includes(queryId) ? current.filter((item) => item !== queryId) : [...current, queryId]
    );
  }

  function toggleAllActiveQueries() {
    setSelectedQueryIds(allActiveQueriesSelected ? [] : activeQueryIds);
  }

  function toggleEngine(engineId: string) {
    setSelectedEngineIds((current) =>
      current.includes(engineId) ? current.filter((item) => item !== engineId) : [...current, engineId]
    );
  }

  function toggleEnvironmentCheckEngine(engineId: string) {
    setEnvironmentCheckEngineIds((current) =>
      current.includes(engineId) ? current.filter((item) => item !== engineId) : [...current, engineId]
    );
  }

  async function runEnvironmentCheck() {
    if (environmentCheckEngineIds.length === 0) {
      setEnvironmentCheckError("请选择至少一个平台。");
      setEnvironmentCheckResults([]);
      return;
    }
    setEnvironmentCheckLoading(true);
    setEnvironmentCheckError("");
    setEnvironmentCheckResults([]);
    try {
      const response = await fetch("/api/sampling/environment-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineConfigIds: environmentCheckEngineIds })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        results?: SamplingEnvironmentCheckResult[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || `采样环境检查失败：HTTP ${response.status}`);
      }
      setEnvironmentCheckResults(Array.isArray(payload.results) ? payload.results : []);
    } catch (error) {
      setEnvironmentCheckError(error instanceof Error ? error.message : "采样环境检查失败。");
    } finally {
      setEnvironmentCheckLoading(false);
    }
  }

  function toggleFilterCluster(clusterId: string) {
    setFilterClusterIds((current) => {
      const next = current.includes(clusterId) ? current.filter((item) => item !== clusterId) : [...current, clusterId];
      const availableQueryIds = new Set(
        clusters
          .filter((cluster) => next.length === 0 || next.includes(cluster.id))
          .flatMap((cluster) => cluster.queries.map((query) => query.id))
      );
      setFilterQueryIds((queryIds) => queryIds.filter((queryId) => availableQueryIds.has(queryId)));
      return next;
    });
  }

  function toggleFilterQuery(queryId: string) {
    setFilterQueryIds((current) =>
      current.includes(queryId) ? current.filter((item) => item !== queryId) : [...current, queryId]
    );
  }

  function toggleFilterBatch(batchId: string) {
    setFilterBatchIds((current) =>
      current.includes(batchId) ? current.filter((item) => item !== batchId) : [...current, batchId]
    );
  }

  function openDetail(runId: string) {
    setDetailTab("answer");
    setSourceDetail(null);
    setDetailRunId(runId);
  }

  async function fetchReferenceDetails(runId: string): Promise<OperationResult> {
    setReferenceFetchState((current) => ({
      ...current,
      [runId]: { loading: true, message: "", error: "" }
    }));

    try {
      const response = await fetch("/api/answer-runs/references/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload.error || "获取引用失败。"));
      }

      const nextSources = Array.isArray(payload.sources) ? (payload.sources as AnswerRunSourceView[]) : [];
      setRunItems((current) =>
        current.map((run) => (run.id === runId ? { ...run, sources: nextSources } : run))
      );
      const failedCount = nextSources.filter((source) => source.fetchError).length;
      setReferenceFetchState((current) => ({
        ...current,
        [runId]: {
          loading: false,
          error: "",
          message: failedCount > 0 ? `已完成，${failedCount} 条失败` : "已完成"
        }
      }));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取引用失败。";
      setReferenceFetchState((current) => ({
        ...current,
        [runId]: {
          loading: false,
          message: "",
          error: message
        }
      }));
      return { ok: false, error: message };
    }
  }

  async function analyzeAnswer(runId: string): Promise<OperationResult> {
    try {
      const response = await fetch("/api/answer-runs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        answerAnalysis?: string;
        answerAnalysisAt?: string;
        answerAnalysisError?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || `回答分析请求失败：HTTP ${response.status}`);
      }
      setRunItems((current) =>
        current.map((run) =>
          run.id === runId
            ? {
                ...run,
                answerAnalysis: payload.answerAnalysis || "",
                answerAnalysisAt: payload.answerAnalysisAt || "",
                answerAnalysisError: payload.answerAnalysisError || ""
              }
            : run
        )
      );
      return { ok: !payload.answerAnalysisError, error: payload.answerAnalysisError };
    } catch (error) {
      const message = error instanceof Error ? error.message : "回答分析失败";
      return { ok: false, error: message };
    }
  }

  async function rerunSampling(runId: string): Promise<OperationResult> {
    setRerunSamplingState((current) => ({
      ...current,
      [runId]: { loading: true, message: "", error: "" }
    }));
    try {
      const response = await fetch("/api/sampling/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, mode: "browser" })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        runAt?: string;
        failureReason?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || `重新采样请求失败：HTTP ${response.status}`);
      }
      setRunItems((current) =>
        current.map((run) =>
          run.id === runId
            ? {
                ...run,
                status: payload.status || "queued",
                runAt: payload.runAt || run.runAt,
                failureReason: payload.failureReason || "",
                answerText: "",
                answerAnalysis: "",
                answerAnalysisAt: "",
                answerAnalysisError: "",
                answerReferenceAnalysis: "",
                answerReferenceAnalysisAt: "",
                answerReferenceAnalysisError: "",
                referenceFeatureAnalysis: "",
                referenceFeatureAnalysisAt: "",
                referenceFeatureAnalysisError: "",
                competitorReferenceFeatureAnalysis: "",
                competitorReferenceFeatureAnalysisAt: "",
                competitorReferenceFeatureAnalysisError: "",
                sources: []
              }
            : run
        )
      );
      setRerunSamplingState((current) => ({
        ...current,
        [runId]: { loading: false, message: "已提交重新采样", error: "" }
      }));
      router.refresh();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新采样失败";
      setRerunSamplingState((current) => ({
        ...current,
        [runId]: { loading: false, message: "", error: message }
      }));
      return { ok: false, error: message };
    }
  }

  function getBatchOperationTargets(kind: BatchOperationKind) {
    return filteredRuns.filter((run) => {
      if (kind === "answer-analysis") return Boolean(run.answerText.trim());
      if (kind === "reference-fetch") return run.sources.length > 0;
      return run.sources.length > 0;
    });
  }

  async function executeBatchOperationForRun(kind: BatchOperationKind, runId: string) {
    if (kind === "answer-analysis") return analyzeAnswer(runId);
    return fetchReferenceDetails(runId);
  }

  async function runBatchOperation(kind: BatchOperationKind) {
    const labels = batchOperationLabels;
    const targets = getBatchOperationTargets(kind);
    if (targets.length === 0) {
      setBatchOperationState({
        loading: false,
        kind,
        message: "",
        error: "当前筛选结果没有可执行该批量操作的采样。"
      });
      return;
    }

    let succeeded = 0;
    let failed = 0;
    setBatchOperationState({
      loading: true,
      kind,
      message: `${labels[kind]}：0/${targets.length}`,
      error: ""
    });

    for (let index = 0; index < targets.length; index += 1) {
      const run = targets[index];
      setBatchOperationState({
        loading: true,
        kind,
        message: `${labels[kind]}：${index + 1}/${targets.length}`,
        error: ""
      });

      const result = await executeBatchOperationForRun(kind, run.id);
      if (result.ok) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    setBatchOperationState({
      loading: false,
      kind,
      message: `${labels[kind]}完成：成功 ${succeeded}，失败 ${failed}`,
      error: ""
    });
  }

  async function runOneClickAnalysis() {
    const steps: Array<{ kind: BatchOperationKind; label: string }> = [
      { kind: "reference-fetch", label: "全部获取引用" },
      { kind: "answer-analysis", label: "回答分析" }
    ];
    const tasks = steps.flatMap((step) => getBatchOperationTargets(step.kind).map((run) => ({ ...step, runId: run.id })));
    if (tasks.length === 0) {
      setOneClickAnalysisState({
        loading: false,
        total: 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        currentLabel: "",
        message: "",
        error: "当前筛选结果没有可执行的一键分析任务。"
      });
      return;
    }

    let succeeded = 0;
    let failed = 0;
    setOneClickAnalysisState({
      loading: true,
      total: tasks.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentLabel: tasks[0].label,
      message: `一键分析：0/${tasks.length}`,
      error: ""
    });

    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      setOneClickAnalysisState((current) => ({
        ...current,
        loading: true,
        currentLabel: task.label,
        message: `${task.label}：${index + 1}/${tasks.length}`
      }));
      const result = await executeBatchOperationForRun(task.kind, task.runId);
      if (result.ok) succeeded += 1;
      else failed += 1;
      setOneClickAnalysisState({
        loading: true,
        total: tasks.length,
        completed: index + 1,
        succeeded,
        failed,
        currentLabel: task.label,
        message: `${task.label}：${index + 1}/${tasks.length}`,
        error: result.ok ? "" : result.error || ""
      });
    }

    setOneClickAnalysisState({
      loading: false,
      total: tasks.length,
      completed: tasks.length,
      succeeded,
      failed,
      currentLabel: "",
      message: `一键分析完成：成功 ${succeeded}，失败 ${failed}`,
      error: ""
    });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>采样列表</h1>
          <p className="muted">发起采样和查看采样结果</p>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setEnvironmentCheckOpen(true)} disabled={!activePlan || activePlan.engines.length === 0}>
            检查采样环境
          </button>
          <button type="button" onClick={() => setLaunchOpen(true)} disabled={!activePlan}>
            发起采样
          </button>
          <form action="/api/sampling/cancel" method="post">
            <button className="secondary" type="submit">停止所有采样</button>
          </form>
          <Link className="button secondary" href="/sampling/query-clusters">
            管理Query集
          </Link>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>采样</h2>
          {activePlan ? (
            <span className="hint">
              当前计划：{activePlan.name} / 平台 {activePlan.engines.map((engine) => engine.displayName).join("、") || "未配置"} / 重复 {activePlan.repeatCount}
            </span>
          ) : (
            <span className="hint">未找到 active SamplingPlan</span>
          )}
        </div>
        <div className="filter-bar" aria-label="采样筛选">
          <MultiSelectDropdown
            label="Query集"
            selectedCount={filterClusterIds.length}
            summary={summarizeSelectedClusters(clusters, filterClusterIds)}
            emptyText="全部 Query集"
          >
            {clusters.length === 0 ? (
              <div className="hint">暂无 Query集</div>
            ) : (
              clusters.map((cluster) => (
                <label key={cluster.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={filterClusterIds.includes(cluster.id)}
                    onChange={() => toggleFilterCluster(cluster.id)}
                  />
                  <span>
                    <strong>{cluster.name}</strong>
                  </span>
                </label>
              ))
            )}
          </MultiSelectDropdown>
          <MultiSelectDropdown
            label="Query"
            selectedCount={effectiveFilterQueryIds.length}
            summary={summarizeSelectedQueries(filterQueries, effectiveFilterQueryIds)}
            emptyText="全部 Query"
          >
            {filterQueries.length === 0 ? (
              <div className="hint">暂无 Query</div>
            ) : (
              filterQueries.map((query) => (
                <label key={query.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={effectiveFilterQueryIds.includes(query.id)}
                    onChange={() => toggleFilterQuery(query.id)}
                  />
                  <span>
                    <strong>{query.queryText}</strong>
                    <span className="hint">{query.clusterName}</span>
                  </span>
                </label>
              ))
            )}
          </MultiSelectDropdown>
          <MultiSelectDropdown
            label="批次"
            selectedCount={filterBatchIds.length}
            summary={summarizeSelectedBatches(batchOptions, filterBatchIds)}
            emptyText="全部批次"
          >
            {batchOptions.length === 0 ? (
              <div className="hint">暂无采样批次</div>
            ) : (
              batchOptions.map((batch) => (
                <label key={batch.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={filterBatchIds.includes(batch.id)}
                    onChange={() => toggleFilterBatch(batch.id)}
                  />
                  <span>
                    <strong>{batch.label}</strong>
                    <span className="hint">{batch.clusterName}</span>
                  </span>
                </label>
              ))
            )}
          </MultiSelectDropdown>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setFilterClusterIds([]);
              setFilterQueryIds([]);
              setFilterBatchIds([]);
            }}
            disabled={filterClusterIds.length === 0 && filterQueryIds.length === 0 && filterBatchIds.length === 0}
          >
            清除筛选
          </button>
          <span className="hint">显示 {filteredRuns.length} / {runItems.length} 条</span>
        </div>
        <div className="workflow-status-panel" aria-label="完整工作流运行状态">
          <div className="workflow-status-head">
            <div>
              <h3>完整工作流状态</h3>
              <p className="hint">
                {runningWorkflowCount > 0 ? `${runningWorkflowCount} 个工作流运行中` : "最近完整工作流记录"}
              </p>
            </div>
            <div className="workflow-status-head-actions">
              <span className="hint">最近 {orderedWorkflowStatuses.length} 条</span>
              {hiddenWorkflowCount > 0 ? (
                <button
                  className="secondary compact-button"
                  type="button"
                  aria-expanded={workflowHistoryExpanded}
                  aria-controls="workflow-status-list"
                  onClick={() => setWorkflowHistoryExpanded((current) => !current)}
                >
                  {workflowHistoryExpanded ? "收起" : "展开"}
                </button>
              ) : null}
            </div>
          </div>
          {orderedWorkflowStatuses.length === 0 ? (
            <div className="workflow-status-empty">暂无完整工作流运行记录。</div>
          ) : (
            <div id="workflow-status-list" className="workflow-status-list">
              {visibleWorkflowStatuses.map((workflow) => {
                const status = workflowStatusMeta(workflow.status);
                return (
                  <div key={workflow.id} className="workflow-status-item">
                    <div className="workflow-status-summary">
                      <div className="workflow-status-title">
                        <strong>{workflow.batchLabel}</strong>
                        <span className="hint">Job {shortId(workflow.jobId)}</span>
                        {workflow.retryableRunCount > 0 ? (
                          <span className="hint">待重试 {workflow.retryableRunCount} 条</span>
                        ) : null}
                      </div>
                      <div className="workflow-status-actions">
                        <span className={`badge badge-${status.tone}`}>{status.label}</span>
                        {workflow.canContinue ? (
                          <form action="/api/sampling/full-workflow/continue" method="post">
                            <input type="hidden" name="jobId" value={workflow.jobId} />
                            <input type="hidden" name="mode" value="browser" />
                            <button className="secondary compact-button" type="submit">
                              继续工作流
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    <div className="workflow-status-detail">
                      <div className="workflow-status-message">{workflow.message || workflowStepLabel(workflow.currentStep)}</div>
                      <div className="workflow-status-steps" aria-label={`${workflow.batchLabel} 工作流步骤`}>
                        {workflowStepOrder.map((step) => (
                          <span
                            key={step}
                            className={`workflow-step workflow-step-${workflowStepState(workflow, step)}`}
                          >
                            {workflowStepLabel(step)}
                          </span>
                        ))}
                      </div>
                      <div className="workflow-status-meta">
                        <span>当前步骤：{workflowStepLabel(workflow.currentStep)}</span>
                        <span>开始时间：{formatDateTime(workflow.startedAt)}</span>
                        <span>更新时间：{formatDateTime(workflow.updatedAt)}</span>
                        {workflow.finishedAt ? <span>完成时间：{formatDateTime(workflow.finishedAt)}</span> : null}
                      </div>
                      {workflow.error ? <div className="workflow-status-error">{workflow.error}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="batch-actions" aria-label="采样批量操作">
          <button
            type="button"
            onClick={() => runOneClickAnalysis()}
            disabled={oneClickAnalysisState.loading || batchOperationState.loading || filteredRuns.length === 0}
          >
            一键分析
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => runBatchOperation("answer-analysis")}
            disabled={batchOperationState.loading || oneClickAnalysisState.loading || filteredRuns.length === 0}
          >
            全部回答分析
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => runBatchOperation("reference-fetch")}
            disabled={batchOperationState.loading || oneClickAnalysisState.loading || filteredRuns.length === 0}
          >
            全部获取引用
          </button>
          {batchOperationState.message ? <span className="hint">{batchOperationState.message}</span> : null}
          {batchOperationState.error ? <span className="hint answer-analysis-error">{batchOperationState.error}</span> : null}
        </div>
        {(oneClickAnalysisState.loading || oneClickAnalysisState.message || oneClickAnalysisState.error) ? (
          <div className="analysis-progress" role="status" aria-live="polite">
            <div className="analysis-progress-head">
              <strong>{oneClickAnalysisState.loading ? "一键分析进行中" : "一键分析"}</strong>
              <span className="hint">
                {oneClickAnalysisState.completed}/{oneClickAnalysisState.total} · 成功 {oneClickAnalysisState.succeeded} · 失败 {oneClickAnalysisState.failed}
              </span>
            </div>
            <div className="analysis-progress-bar" aria-label="一键分析进度">
              <div className="analysis-progress-fill" style={{ width: `${oneClickProgressPercent}%` }} />
            </div>
            <div className="analysis-progress-foot">
              <span>{oneClickAnalysisState.message || "等待执行"}</span>
              {oneClickAnalysisState.currentLabel ? <span className="hint">当前步骤：{oneClickAnalysisState.currentLabel}</span> : null}
            </div>
            {oneClickAnalysisState.error ? <div className="hint answer-analysis-error">{oneClickAnalysisState.error}</div> : null}
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>采样时间</th>
                <th>批次</th>
                <th>平台</th>
                <th>Query</th>
                <th>状态</th>
                <th>品牌分析</th>
                <th>回答分析</th>
                <th>引用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="hint">{runItems.length === 0 ? "暂无采样" : "暂无匹配采样"}</td>
                </tr>
              ) : (
                filteredRuns.map((run) => {
                  const status = statusMeta(run.status);
                  const fetchState = referenceFetchState[run.id];
                  const rerunState = rerunSamplingState[run.id];
                  const samplingActive = run.status === "queued" || run.status === "running";
                  return (
                    <tr key={run.id}>
                      <td>{formatDateTime(run.runAt)}</td>
                      <td>{run.samplingBatchName || run.samplingBatchId || "-"}</td>
                      <td>{run.platform}</td>
                      <td className="sampling-query-cell">{run.queryText}</td>
                      <td>
                        <span className={`badge badge-${status.tone}`}>{status.label}</span>
                        {run.failureReason ? <div className="hint">{run.failureReason}</div> : null}
                      </td>
                      <td>
                        <BrandAnalysis analysis={run.brandAnalysis} />
                      </td>
                      <td>
                        <AnswerAnalysis run={run} />
                      </td>
                      <td>
                        <ReferenceSummary run={run} />
                      </td>
                      <td>
                        <div className="run-actions">
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => fetchReferenceDetails(run.id)}
                            disabled={run.sources.length === 0 || fetchState?.loading}
                          >
                            {fetchState?.loading ? "获取中" : "获取引用"}
                          </button>
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => rerunSampling(run.id)}
                            disabled={samplingActive || rerunState?.loading}
                          >
                            {rerunState?.loading ? "提交中" : "重新采样"}
                          </button>
                          <button className="secondary" type="button" onClick={() => openDetail(run.id)}>
                            查看详情
                          </button>
                          {fetchState?.error ? <div className="hint answer-analysis-error">{fetchState.error}</div> : null}
                          {fetchState?.message ? <div className="hint">{fetchState.message}</div> : null}
                          {rerunState?.error ? <div className="hint answer-analysis-error">{rerunState.error}</div> : null}
                          {rerunState?.message ? <div className="hint">{rerunState.message}</div> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {environmentCheckOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-md" role="dialog" aria-modal="true" aria-labelledby="sampling-environment-check-title">
            <div className="modal-head">
              <div>
                <h2 id="sampling-environment-check-title">检查采样环境</h2>
                <p className="muted">选择要检查的平台；提交后会发送“你好，昨天有什么新闻？”，完成一次不入库的 dry-run 采样。</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={() => setEnvironmentCheckOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="grid">
              <div>
                <div className="query-select-toolbar">
                  <div>
                    <div className="muted">平台</div>
                    <div className="hint">已选 {environmentCheckEngineIds.length} / {activePlan?.engines.length || 0}</div>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      const allEngineIds = activePlan?.engines.map((engine) => engine.id) || [];
                      setEnvironmentCheckEngineIds(environmentCheckEngineIds.length === allEngineIds.length ? [] : allEngineIds);
                    }}
                    disabled={!activePlan || activePlan.engines.length === 0}
                  >
                    {activePlan && environmentCheckEngineIds.length === activePlan.engines.length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="check-list check-list-compact">
                  {!activePlan || activePlan.engines.length === 0 ? (
                    <div className="hint">当前计划没有可检查的平台。</div>
                  ) : (
                    activePlan.engines.map((engine) => (
                      <label key={engine.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={environmentCheckEngineIds.includes(engine.id)}
                          onChange={() => toggleEnvironmentCheckEngine(engine.id)}
                        />
                        <span>
                          <strong>{engine.displayName}</strong>
                          <span className="hint">{engine.engineType} / {engine.baseUrl}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button className="secondary" type="button" onClick={() => setEnvironmentCheckOpen(false)}>
                  关闭
                </button>
                <button type="button" onClick={runEnvironmentCheck} disabled={environmentCheckLoading || environmentCheckEngineIds.length === 0}>
                  {environmentCheckLoading ? "检查中" : "开始检查"}
                </button>
              </div>
              {environmentCheckError ? <div className="content-ai-error">{environmentCheckError}</div> : null}
              {environmentCheckResults.length > 0 ? (
                <div className="sampling-environment-results">
                  {environmentCheckResults.map((result) => (
                    <div className="sampling-environment-result" key={result.engineConfigId}>
                      <div>
                        <strong>{result.displayName}</strong>
                        <div className="hint">{result.currentUrl || result.baseUrl}</div>
                      </div>
                      <span className={`badge badge-${environmentCheckTone(result.status)}`}>
                        {environmentCheckStatusLabel(result.status)}
                      </span>
                      <div className="sampling-environment-message">{result.message}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {launchOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-md" role="dialog" aria-modal="true" aria-labelledby="launch-query-title">
            <div className="modal-head">
              <div>
                <h2 id="launch-query-title">发起采样</h2>
                <p className="muted">可同时选择多个 Query集；下方 Query 默认选中所选 Query集的全部 active Query。</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={() => setLaunchOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <form action="/api/sampling/run" method="post" className="grid">
              {activePlan ? <input type="hidden" name="planId" value={activePlan.id} /> : null}
              <input type="hidden" name="mode" value="browser" />
              <label>
                批次名称
                <input name="batchName" maxLength={120} placeholder="例如：2026-06-05 第1批；多 Query集将共用同一批次" />
              </label>
              <div>
                <div className="query-select-toolbar">
                  <div>
                    <div className="muted">Query集</div>
                    <div className="hint">已选 {selectedClusterIds.length} / {activeLaunchClusterIds.length}</div>
                  </div>
                  <button className="secondary" type="button" onClick={toggleAllLaunchClusters} disabled={activeLaunchClusterIds.length === 0}>
                    {allLaunchClustersSelected ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="check-list check-list-compact">
                  {clusters.length === 0 ? (
                    <div className="hint">暂无 Query集。</div>
                  ) : (
                    clusters.map((cluster) => (
                      <label key={cluster.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={selectedClusterIds.includes(cluster.id)}
                          onChange={() => toggleLaunchCluster(cluster.id)}
                          disabled={cluster.status !== "active"}
                        />
                        <span>
                          <strong>{cluster.name}</strong>
                          <span className="hint">{cluster.status}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div>
                <div className="muted">平台</div>
                <div className="check-list check-list-compact">
                  {!activePlan || activePlan.engines.length === 0 ? (
                    <div className="hint">当前计划没有可选平台。</div>
                  ) : (
                    activePlan.engines.map((engine) => (
                      <label key={engine.id} className="check-row">
                        <input
                          type="checkbox"
                          name="engineId"
                          value={engine.id}
                          checked={selectedEngineIds.includes(engine.id)}
                          onChange={() => toggleEngine(engine.id)}
                        />
                        <span>
                          <strong>{engine.displayName}</strong>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div>
                <div className="query-select-toolbar">
                  <div>
                    <div className="muted">Query</div>
                    <div className="hint">已选 {selectedActiveQueryCount} / {activeQueryIds.length}</div>
                  </div>
                  <button className="secondary" type="button" onClick={toggleAllActiveQueries} disabled={activeQueryIds.length === 0}>
                    {allActiveQueriesSelected ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="check-list">
                  {selectedClusterIds.length === 0 ? (
                    <div className="hint">请先选择 Query集。</div>
                  ) : activeQueries.length === 0 ? (
                    <div className="hint">所选 Query集没有 active Query。</div>
                  ) : (
                    activeQueries.map((query) => (
                      <label key={query.id} className="check-row">
                        <input
                          type="checkbox"
                          name="queryId"
                          value={query.id}
                          checked={selectedQueryIds.includes(query.id)}
                          onChange={() => toggleQuery(query.id)}
                        />
                        <span>
                          <strong>{query.queryText}</strong>
                          <span className="hint">{query.clusterName} / {query.region}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button className="secondary" type="button" onClick={() => setLaunchOpen(false)}>
                  取消
                </button>
                <button type="submit" disabled={!activePlan || selectedActiveQueryCount === 0 || selectedEngineIds.length === 0}>
                  运行
                </button>
                <button
                  type="submit"
                  formAction="/api/sampling/full-workflow"
                  disabled={!activePlan || selectedActiveQueryCount === 0 || selectedEngineIds.length === 0}
                >
                  运行完整工作流
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {detailRun ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-xl" role="dialog" aria-modal="true" aria-labelledby="run-detail-title">
            <div className="modal-head">
              <div>
                <h2 id="run-detail-title">Query详情</h2>
                <p className="muted">
                  {detailRun.platform} / {formatDateTime(detailRun.runAt)} / 批次：{detailRun.samplingBatchName || detailRun.samplingBatchId || "-"} / {detailRun.queryText}
                </p>
              </div>
              <button
                className="secondary icon-button"
                type="button"
                onClick={() => {
                  setSourceDetail(null);
                  setDetailRunId(null);
                }}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="tab-list" role="tablist" aria-label="Query详情">
              <DetailTabButton activeTab={detailTab} tab="answer" onSelect={setDetailTab}>
                回答内容
              </DetailTabButton>
              <DetailTabButton activeTab={detailTab} tab="references" onSelect={setDetailTab}>
                引用详情
              </DetailTabButton>
            </div>
            {detailTab === "answer" ? (
              <div className="answer-content" role="tabpanel">
                <AnswerContentWithLineNumbers answerText={detailRun.answerText} />
              </div>
            ) : detailTab === "references" ? (
              <div className="table-wrap" role="tabpanel">
                <table className="table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>引用项目名称</th>
                      <th>引用项目链接</th>
                      <th>来源站点名称</th>
                      <th>品牌引用上下文</th>
                      <th>竞品引用上下文</th>
                      <th>引用标签</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortSources(detailRun.sources).length === 0 ? (
                      <tr>
                        <td colSpan={8} className="hint">暂无引用</td>
                      </tr>
                    ) : (
                      sortSources(detailRun.sources).map((source, index) => (
                        <tr key={source.id}>
                          <td>{source.position || index + 1}</td>
                          <td>{source.title || "未命名引用"}</td>
                          <td>
                            {source.url ? (
                              <a className="text-link" href={source.url} target="_blank" rel="noreferrer">
                                {source.url}
                              </a>
                            ) : null}
                          </td>
                          <td>{source.siteName || source.domain || ""}</td>
                          <td>
                            <BrandReferenceContexts contexts={brandReferenceContextsForSource(source, detailRun)} />
                          </td>
	                          <td>
	                            <BrandReferenceContexts contexts={competitorReferenceContextsForSource(source, detailRun)} />
                          </td>
                          <td>
                            <ReferenceTags tags={referenceTagsForSource(source, detailRun)} />
                          </td>
	                          <td>
                            <button
                              className="secondary"
                              type="button"
                              onClick={() => setSourceDetail({ runId: detailRun.id, sourceId: source.id })}
                            >
                              查看详情
                            </button>
                            {source.fetchError ? <div className="hint answer-analysis-error">抓取失败</div> : null}
                            {source.fetchedAt && !source.fetchError ? <div className="hint">已获取</div> : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {detailSource ? (
        <div className="modal-backdrop reference-detail-backdrop" role="presentation">
          <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="reference-detail-title">
            <div className="modal-head">
              <div>
                <h2 id="reference-detail-title">引用详情</h2>
                <p className="muted reference-detail-subtitle">{detailSource.title || "未命名引用"}</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={() => setSourceDetail(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="reference-detail-grid">
              <DetailField label="URL">
                {detailSource.fetchedUrl || detailSource.url ? (
                  <a className="text-link" href={detailSource.fetchedUrl || detailSource.url} target="_blank" rel="noreferrer">
                    {detailSource.fetchedUrl || detailSource.url}
                  </a>
                ) : (
                  "未提取到"
                )}
              </DetailField>
              <DetailField label="title">{detailSource.title || "未提取到"}</DetailField>
              <DetailField label="引用项目摘要">{detailSource.summary || "未提取到"}</DetailField>
              <DetailField label="author">{detailSource.author || "未提取到"}</DetailField>
              <DetailField label="published_at">{detailSource.publishedAt || "未提取到"}</DetailField>
              <DetailField label="fetch_mode">{detailSource.fetchMode || "未获取"}</DetailField>
              <DetailField label="fetched_at">{detailSource.fetchedAt ? formatDateTime(detailSource.fetchedAt) : "未获取"}</DetailField>
            </div>
            {detailSource.fetchError ? (
              <div className="reference-detail-error">
                抓取失败：{detailSource.fetchError}
                {detailSource.fetchMode === "source_summary_fallback" ? " 当前正文文本与 content 展示的是引用摘要兜底，不等同于目标页面原文。" : ""}
              </div>
            ) : null}
            <div className="reference-detail-section">
              <h3>正文文本</h3>
              <div className="reference-detail-text">{detailSource.bodyText || "未获取"}</div>
            </div>
            <div className="reference-detail-section">
              <h3>content</h3>
              <div className="reference-detail-text">{detailSource.content || "未获取"}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function statusMeta(status: string) {
  switch (status) {
    case "queued":
      return { label: "未开始", tone: "neutral" };
    case "running":
      return { label: "已开始", tone: "info" };
    case "succeeded":
      return { label: "已结束", tone: "good" };
    case "failed":
      return { label: "失败", tone: "bad" };
    case "cancelled":
      return { label: "已取消", tone: "warn" };
    default:
      return { label: status || "未知", tone: "neutral" };
  }
}

function environmentCheckTone(status: SamplingEnvironmentCheckResult["status"]) {
  if (status === "ok") return "good";
  if (status === "blocked") return "warn";
  return "bad";
}

function environmentCheckStatusLabel(status: SamplingEnvironmentCheckResult["status"]) {
  if (status === "ok") return "未发现阻碍";
  if (status === "blocked") return "需要处理";
  return "检查失败";
}

function workflowStatusMeta(status: string) {
  switch (status) {
    case "running":
      return { label: "运行中", tone: "info" };
    case "succeeded":
      return { label: "已完成", tone: "good" };
    case "completed_with_warnings":
      return { label: "有异常", tone: "warn" };
    case "failed":
      return { label: "失败", tone: "bad" };
    case "cancelled":
      return { label: "已取消", tone: "warn" };
    default:
      return { label: status || "未知", tone: "neutral" };
  }
}

function workflowStepLabel(step: string) {
  switch (step) {
    case "sampling":
      return "发起采样";
    case "answer-analysis":
      return "本批次回答分析";
    case "reference-fetch":
      return "本批次获取引用";
    case "brand-profile-analysis":
      return "本批次品牌画像分析";
    case "competitor-brand-analysis":
      return "本批次竞品画像分析";
    case "answer-evidence-hit-analysis":
      return "本批次答案分析";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "project":
      return "项目校验";
    default:
      return step || "未知步骤";
  }
}

function workflowStepState(workflow: SamplingWorkflowStatusView, step: string) {
  const currentIndex = workflowStepOrder.indexOf(workflow.currentStep);
  const stepIndex = workflowStepOrder.indexOf(step);
  if (workflow.currentStep === step) {
    if (workflow.status === "failed") return "failed";
    if (workflow.status === "cancelled") return "cancelled";
    return "active";
  }
  if (currentIndex >= 0 && stepIndex >= 0 && stepIndex < currentIndex) return "done";
  if (workflow.status === "succeeded" || workflow.status === "completed_with_warnings") return "done";
  return "pending";
}

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value || "-";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function summarizeSites(sources: AnswerRunSourceView[]) {
  if (sources.length === 0) return "暂无";
  const counts = new Map<string, number>();
  for (const source of sortSources(sources)) {
    const site = source.siteName || source.domain || "未知来源";
    counts.set(site, (counts.get(site) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([site, count]) => `${site}${count}`).join("、") || "暂无";
}

function MultiSelectDropdown({
  label,
  selectedCount,
  summary,
  emptyText,
  children
}: {
  label: string;
  selectedCount: number;
  summary: string;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <details className="filter-dropdown">
      <summary>
        <span>{label}</span>
        <strong>{selectedCount > 0 ? `${selectedCount} 项` : emptyText}</strong>
      </summary>
      <div className="filter-dropdown-panel">
        <div className="filter-dropdown-summary">{summary}</div>
        <div className="filter-dropdown-list">{children}</div>
      </div>
    </details>
  );
}

function DetailTabButton({
  activeTab,
  tab,
  onSelect,
  children
}: {
  activeTab: DetailTabKey;
  tab: DetailTabKey;
  onSelect: (tab: DetailTabKey) => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`tab-button ${activeTab === tab ? "tab-button-active" : ""}`}
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      onClick={() => onSelect(tab)}
    >
      {children}
    </button>
  );
}

function summarizeSelectedClusters(clusters: QueryClusterView[], selectedIds: string[]) {
  if (selectedIds.length === 0) return "全部 Query集";
  const selected = new Set(selectedIds);
  return clusters.filter((cluster) => selected.has(cluster.id)).map((cluster) => cluster.name).join("、") || "全部 Query集";
}

function summarizeSelectedQueries(queries: Array<QueryOptionView & { clusterName: string }>, selectedIds: string[]) {
  if (selectedIds.length === 0) return "全部 Query";
  const selected = new Set(selectedIds);
  return queries.filter((query) => selected.has(query.id)).map((query) => query.queryText).join("、") || "全部 Query";
}

function summarizeSelectedBatches(batches: Array<{ id: string; label: string; clusterName: string }>, selectedIds: string[]) {
  if (selectedIds.length === 0) return "全部批次";
  const selected = new Set(selectedIds);
  return batches
    .filter((batch) => selected.has(batch.id))
    .map((batch) => `${batch.clusterName} / ${batch.label}`)
    .join("、") || selectedIds.join("、");
}

function ReferenceSummary({ run }: { run: AnswerRunView }) {
  const stats = referenceMentionStats(run);
  const hasReferenceMention = hasAnyReferenceMention(run);
  return (
    <div className="reference-summary">
      <div>来源站点名称：{summarizeSites(run.sources)}</div>
      <div>搜索关键词：{run.searchKeywords.length > 0 ? run.searchKeywords.join("、") : "暂无"}</div>
      <div className="reference-summary-metrics">
        <span>总引用条目数（可读）：{stats.readable}</span>
        <span>引用提及品牌次数：{stats.brand}</span>
        <span>引用提及竞品次数：{stats.competitor}</span>
        <span>引用均提及次数：{stats.both}</span>
      </div>
      {!hasReferenceMention ? <div className="hint">引用未提及品牌或竞品。</div> : null}
    </div>
  );
}

function ReferenceTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="hint">无</span>;
  return (
    <div className="reference-tags">
      {tags.map((tag) => (
        <span className={`reference-tag ${referenceTagClassName(tag)}`} key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function referenceTagClassName(tag: string) {
  if (tag === "提及品牌") return "reference-tag-brand";
  if (tag === "提及竞品") return "reference-tag-competitor";
  return "reference-tag-neutral";
}

function BrandReferenceContexts({ contexts }: { contexts: BrandReferenceContext[] }) {
  if (contexts.length === 0) return <span className="hint">未提及</span>;
  return (
    <div className="brand-reference-contexts">
      {contexts.map((context) => (
        <div className="brand-reference-context" key={`${context.term}-${context.position}`}>
          <div className="brand-reference-context-term">{context.term}</div>
          <div className="brand-reference-context-text">
            {context.hasPrefix ? <span className="muted">...</span> : null}
            {context.prefix}
            <mark>{context.matchedText}</mark>
            {context.suffix}
            {context.hasSuffix ? <span className="muted">...</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="reference-detail-field">
      <div className="reference-detail-label">{label}</div>
      <div className="reference-detail-value">{children}</div>
    </div>
  );
}

function BrandAnalysis({ analysis }: { analysis: BrandAnalysisView }) {
  return (
    <div className="brand-analysis">
      <div>
        品牌名：{analysis.brandName || "未设置"}，首次出现：{formatLineNumber(analysis.brandLine)}
        {analysis.totalLineCount > 0 ? `（${formatLinePercent(analysis.brandLine, analysis.totalLineCount)}）` : "（0%）"}
        {analysis.brandMatchedTerm && analysis.brandMatchedTerm !== analysis.brandName ? `，匹配词：${analysis.brandMatchedTerm}` : ""}
      </div>
      {analysis.competitors.length === 0 ? (
        <div>竞品名称：暂无</div>
      ) : (
        analysis.competitors.map((competitor) => (
          <div key={competitor.name}>
            竞品名称：{competitor.name}，首次出现：{formatLineNumber(competitor.line)}
            {analysis.totalLineCount > 0
              ? `（${formatLinePercent(competitor.line, analysis.totalLineCount)}）`
              : "（0%）"}
          </div>
        ))
      )}
      <div>总行数：{analysis.totalLineCount}</div>
    </div>
  );
}

function AnswerAnalysis({ run }: { run: AnswerRunView }) {
  return (
    <div className="answer-analysis">
      {run.answerAnalysis ? <div className="answer-analysis-text">{run.answerAnalysis}</div> : null}
      {run.answerAnalysisAt ? <div className="hint">分析时间：{formatDateTime(run.answerAnalysisAt)}</div> : null}
      {run.answerAnalysisError ? <div className="hint answer-analysis-error">分析失败：{run.answerAnalysisError}</div> : null}
      <form action="/api/answer-runs/analyze" method="post">
        <input type="hidden" name="runId" value={run.id} />
        <button className="secondary" type="submit" disabled={!run.answerText}>
          {run.answerAnalysis ? "重新分析" : "分析"}
        </button>
      </form>
    </div>
  );
}

function formatLineNumber(line: number | null) {
  return line == null ? "未出现" : `第${line}行`;
}

function formatLinePercent(line: number | null, totalLineCount: number) {
  if (line == null || totalLineCount <= 0) return "0%";
  return `${Math.round((line / totalLineCount) * 100)}%`;
}

function AnswerContentWithLineNumbers({ answerText }: { answerText: string }) {
  if (!answerText) return <div className="answer-empty">暂无回答内容</div>;
  return (
    <div className="answer-line-list">
      {answerText.split(/\r?\n/).map((line, index) => (
        <div className="answer-line" key={index}>
          <div className="answer-line-number">{index + 1}</div>
          <div className="answer-line-text">{line || " "}</div>
        </div>
      ))}
    </div>
  );
}

function activeQueryIdsForClusterIds(clusters: QueryClusterView[], clusterIds: string[]) {
  const selected = new Set(clusterIds);
  return clusters
    .filter((cluster) => selected.has(cluster.id))
    .flatMap((cluster) => cluster.queries.filter((query) => query.status === "active").map((query) => query.id));
}

function defaultEngineIdsForClusters(clusters: QueryClusterView[], activePlan: SamplingPlanView | null) {
  const availableIds = new Set(activePlan?.engines.map((engine) => engine.id) || []);
  if (clusters.length === 0 || clusters.some((cluster) => cluster.defaultEngineIds === null)) return Array.from(availableIds);
  const selected = new Set<string>();
  for (const cluster of clusters) {
    for (const engineId of cluster.defaultEngineIds || []) {
      if (availableIds.has(engineId)) selected.add(engineId);
    }
  }
  return Array.from(selected);
}

function sortSources(sources: AnswerRunSourceView[]) {
  return [...sources].sort((left, right) => sourcePosition(left) - sourcePosition(right) || left.id.localeCompare(right.id));
}

function sourcePosition(source: AnswerRunSourceView) {
  return Number.isFinite(source.position) && source.position > 0 ? source.position : Number.MAX_SAFE_INTEGER;
}

function referenceTagsForSource(source: AnswerRunSourceView, run: AnswerRunView) {
  const detailText = source.bodyText || source.content || "";
  const tags: string[] = [];
  if (containsAnyTerm(detailText, run.brandTerms)) tags.push("提及品牌");
  if (containsAnyTerm(detailText, run.competitorTerms)) tags.push("提及竞品");
  return tags;
}

type BrandReferenceContext = {
  term: string;
  matchedText: string;
  prefix: string;
  suffix: string;
  position: number;
  hasPrefix: boolean;
  hasSuffix: boolean;
};

function brandReferenceContextsForSource(source: AnswerRunSourceView, run: AnswerRunView) {
  return referenceContextsForSource(source, run.brandTerms);
}

function competitorReferenceContextsForSource(source: AnswerRunSourceView, run: AnswerRunView) {
  return referenceContextsForSource(source, run.competitorTerms);
}

function referenceContextsForSource(source: AnswerRunSourceView, terms: string[]) {
  const detailText = normalizeContextText(source.bodyText || source.content || "");
  if (!detailText) return [] as BrandReferenceContext[];

  const lowerText = detailText.toLocaleLowerCase();
  const contexts: BrandReferenceContext[] = [];
  for (const term of uniqueTerms(terms)) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) continue;

    const lowerTerm = normalizedTerm.toLocaleLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const position = lowerText.indexOf(lowerTerm, searchFrom);
      if (position < 0) break;
      const endPosition = position + normalizedTerm.length;
      contexts.push({
        term: normalizedTerm,
        matchedText: detailText.slice(position, endPosition),
        prefix: detailText.slice(Math.max(0, position - 30), position),
        suffix: detailText.slice(endPosition, Math.min(detailText.length, endPosition + 300)),
        position,
        hasPrefix: position > 30,
        hasSuffix: endPosition + 300 < detailText.length
      });
      searchFrom = endPosition;
    }
  }

  return contexts.sort((left, right) => left.position - right.position || right.term.length - left.term.length);
}

function referenceMentionStats(run: AnswerRunView) {
  return run.sources.reduce(
    (stats, source) => {
      const tags = referenceTagsForSource(source, run);
      const hasBrand = tags.includes("提及品牌");
      const hasCompetitor = tags.includes("提及竞品");
      return {
        readable: stats.readable + (isReadableSource(source) ? 1 : 0),
        brand: stats.brand + (hasBrand ? 1 : 0),
        competitor: stats.competitor + (hasCompetitor ? 1 : 0),
        both: stats.both + (hasBrand && hasCompetitor ? 1 : 0)
      };
    },
    { readable: 0, brand: 0, competitor: 0, both: 0 }
  );
}

function hasAnyReferenceMention(run: AnswerRunView) {
  const stats = referenceMentionStats(run);
  return stats.brand > 0 || stats.competitor > 0 || stats.both > 0;
}

function isReadableSource(source: AnswerRunSourceView) {
  return Boolean((source.bodyText || source.content).trim());
}

function containsAnyTerm(text: string, terms: string[]) {
  const normalizedText = text.toLocaleLowerCase();
  return terms.some((term) => {
    const normalizedTerm = term.trim().toLocaleLowerCase();
    return normalizedTerm.length > 0 && normalizedText.includes(normalizedTerm);
  });
}

function uniqueTerms(terms: string[]) {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
