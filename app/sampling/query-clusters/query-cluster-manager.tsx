"use client";

import { AdvancedAnalyticsSection } from "@/app/advanced-analytics-section";
import { BasicAnalyticsTable } from "@/app/basic-analytics-table";
import type { AdvancedPlatformAnalytics, BasicPlatformAnalytics } from "@/lib/services/dashboard-analytics";
import type { GeneratedQueryCandidate, GeneratedQueryClusterCandidate } from "@/lib/services/query-ai";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type QueryManagerItem = {
  id: string;
  queryText: string;
  intentType: string;
  language: string;
  region: string;
  persona: string;
  device: string;
  status: string;
  expectedEvidenceTypes: string;
};

export type EngineManagerItem = {
  id: string;
  displayName: string;
};

export type QueryClusterManagerItem = {
  id: string;
  name: string;
  intentType: string;
  funnelStage: string;
  priority: number;
  businessValueScore: number;
  targetMetric: string;
  ownerTeam: string;
  defaultEngineIds: string[] | null;
  status: string;
  samplingRecordCount: number;
  samplingBatches: SamplingBatchHistoryItem[];
  queries: QueryManagerItem[];
};

export type SamplingBatchHistoryItem = {
  id: string;
  name: string;
  batchDate: string;
  sequence: number;
  createdAt: string;
  runCount: number;
  basicAnalytics: BasicPlatformAnalytics[];
  advancedAnalytics: AdvancedPlatformAnalytics[];
};

type QueryIntentGroupQuery = QueryManagerItem & {
  clusterId: string;
  clusterName: string;
};

type QueryIntentGroup = {
  intentType: string;
  queries: QueryIntentGroupQuery[];
};

const QUERY_INTENT_OPTIONS = ["场景模糊", "场景明确", "意图明确"] as const;

export function QueryClusterManager({
  projectId,
  clusters,
  engines
}: {
  projectId: string;
  clusters: QueryClusterManagerItem[];
  engines: EngineManagerItem[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createClusterName, setCreateClusterName] = useState("");
  const [createIntentType, setCreateIntentType] = useState("recommendation");
  const [createQueryTexts, setCreateQueryTexts] = useState("");
  const [createQueryIntents, setCreateQueryIntents] = useState("");
  const [queryGenerationLoading, setQueryGenerationLoading] = useState(false);
  const [queryGenerationError, setQueryGenerationError] = useState("");
  const [queryGenerationMessage, setQueryGenerationMessage] = useState("");
  const [aiClusterModalOpen, setAiClusterModalOpen] = useState(false);
  const [aiClusterLoading, setAiClusterLoading] = useState(false);
  const [aiClusterCreating, setAiClusterCreating] = useState(false);
  const [aiClusterError, setAiClusterError] = useState("");
  const [aiGeneratedClusters, setAiGeneratedClusters] = useState<GeneratedQueryClusterCandidate[]>([]);
  const [expandedClusterKeys, setExpandedClusterKeys] = useState<Set<string>>(new Set());
  const [expandedIntentKeys, setExpandedIntentKeys] = useState<Set<string>>(new Set());
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState<Set<string>>(new Set());
  const [detailClusterId, setDetailClusterId] = useState<string | null>(null);
  const [batchDetailSelection, setBatchDetailSelection] = useState<{ clusterId: string; batchId: string } | null>(null);
  const intentGroups = buildQueryIntentGroups(clusters);
  const detailCluster = clusters.find((cluster) => cluster.id === detailClusterId) || null;
  const batchDetailCluster = batchDetailSelection
    ? clusters.find((cluster) => cluster.id === batchDetailSelection.clusterId) || null
    : null;
  const batchDetail = batchDetailCluster?.samplingBatches.find((batch) => batch.id === batchDetailSelection?.batchId) || null;
  const batchDetailName = batchDetail ? displayBatchName(batchDetail) : "";

  function toggleClusterGroup(clusterId: string) {
    setExpandedClusterKeys((current) => toggleSetKey(current, clusterId));
  }

  function toggleIntentGroup(intentType: string) {
    setExpandedIntentKeys((current) => toggleSetKey(current, intentType));
  }

  function toggleHistoryGroup(clusterId: string) {
    setExpandedHistoryKeys((current) => toggleSetKey(current, clusterId));
  }

  function openCreateModal() {
    setCreateClusterName("");
    setCreateIntentType("recommendation");
    setCreateQueryTexts("");
    setCreateQueryIntents("");
    setQueryGenerationError("");
    setQueryGenerationMessage("");
    setQueryGenerationLoading(false);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    if (queryGenerationLoading) return;
    setCreateOpen(false);
  }

  async function generateCreateQueries() {
    const clusterName = createClusterName.trim();
    if (!clusterName) {
      setQueryGenerationError("请先填写 Query集名称");
      setQueryGenerationMessage("");
      return;
    }

    const intentType = createIntentType.trim();
    if (!intentType) {
      setQueryGenerationError("请先填写意图类型");
      setQueryGenerationMessage("");
      return;
    }

    setQueryGenerationLoading(true);
    setQueryGenerationError("");
    setQueryGenerationMessage("");
    setCreateQueryIntents("");
    try {
      const response = await fetch("/api/query-clusters/generate-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, clusterName, intentType })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `AI 生成 Query 失败：HTTP ${response.status}`);

      const queries = normalizeGeneratedQueries(payload.queries);
      if (queries.length === 0) throw new Error("AI 未返回可用 Query");
      const limitedQueries = queries.slice(0, 10);
      setCreateQueryTexts(limitedQueries.map((query) => query.queryText).join("\n"));
      setCreateQueryIntents(JSON.stringify(limitedQueries.map((query) => query.intentType)));
      setQueryGenerationMessage(`已生成 ${Math.min(queries.length, 10)} 条 Query。`);
    } catch (error) {
      setQueryGenerationError(error instanceof Error ? error.message : "AI 生成 Query 失败");
    } finally {
      setQueryGenerationLoading(false);
    }
  }

  function openAiClusterModal() {
    setAiClusterModalOpen(true);
    void generateAiClusters();
  }

  function closeAiClusterModal() {
    if (aiClusterLoading || aiClusterCreating) return;
    setAiClusterModalOpen(false);
  }

  async function generateAiClusters() {
    setAiClusterLoading(true);
    setAiClusterCreating(false);
    setAiClusterError("");
    setAiGeneratedClusters([]);
    try {
      const response = await fetch("/api/query-clusters/generate-clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `AI 生成失败：HTTP ${response.status}`);
      const clusters = normalizeGeneratedClusters(payload.clusters);
      if (clusters.length !== 3 || clusters.some((cluster) => cluster.queries.length !== 10)) {
        throw new Error("AI 未按要求返回 3 组 Query集且每组 10 条 Query");
      }
      setAiGeneratedClusters(clusters);
    } catch (error) {
      setAiClusterError(error instanceof Error ? error.message : "AI 生成失败");
    } finally {
      setAiClusterLoading(false);
    }
  }

  async function createAiGeneratedClusters() {
    if (aiGeneratedClusters.length !== 3) return;
    setAiClusterCreating(true);
    setAiClusterError("");
    try {
      const response = await fetch("/api/query-clusters/create-generated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clusters: aiGeneratedClusters,
          defaultEngineIds: engines.map((engine) => engine.id)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `创建失败：HTTP ${response.status}`);
      window.location.reload();
    } catch (error) {
      setAiClusterError(error instanceof Error ? error.message : "AI 生成 Query集创建失败");
      setAiClusterCreating(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Query集管理</h1>
          <p className="muted">管理采样 Query集及其下属 Query。</p>
        </div>
        <div className="actions">
          <button className="secondary" type="button" onClick={openAiClusterModal}>
            AI生成
          </button>
          <button type="button" onClick={openCreateModal}>
            新建Query集
          </button>
          <Link className="button secondary" href="/sampling">
            返回采样列表
          </Link>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Query集</h2>
          <span className="hint">共 {clusters.length} 个 Query集</span>
        </div>
        <div className="reference-table-toolbar">
          <span className="hint">默认收起，以 Query集为父行、Query 为子行展示。</span>
          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setExpandedClusterKeys(new Set(clusters.map((cluster) => cluster.id)))}
              disabled={clusters.length === 0 || expandedClusterKeys.size === clusters.length}
            >
              展开全部 Query集
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setExpandedClusterKeys(new Set())}
              disabled={expandedClusterKeys.size === 0}
            >
              全部收起
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>条目</th>
                <th>意图</th>
                <th>漏斗 / 语言</th>
                <th>优先级 / 设备</th>
                <th>指标 / 用户角色</th>
                <th>负责人 / 证据</th>
                <th>默认平台 / 地区</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            {clusters.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9} className="hint">暂无 Query集</td>
                </tr>
              </tbody>
            ) : (
              clusters.map((cluster) => {
                const expanded = expandedClusterKeys.has(cluster.id);
                return (
                  <tbody key={cluster.id} className="reference-group-body">
                    <tr className="reference-parent-row">
                      <td className="reference-parent-cell" colSpan={9}>
                        <div className="reference-parent-head cluster-parent-head">
                          <button
                            className="reference-expand-button"
                            type="button"
                            onClick={() => toggleClusterGroup(cluster.id)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "收起" : "展开"} Query集下属 Query`}
                          >
                            {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                            <span>{expanded ? "收起" : "展开"}</span>
                          </button>
                          <div className="reference-parent-main">
                            <strong>{cluster.name}</strong>
                            <div className="reference-parent-meta">
                              <span>意图：{cluster.intentType}</span>
                              <span>漏斗：{cluster.funnelStage}</span>
                              <span>优先级：{cluster.priority}</span>
                              <span>指标：{cluster.targetMetric || "未设置"}</span>
                              <span>负责人：{cluster.ownerTeam || "未设置"}</span>
                              <span>默认平台：{formatEngineNames(cluster.defaultEngineIds, engines)}</span>
                            </div>
                          </div>
                          <div className="reference-parent-stats cluster-parent-stats">
                            <span className={`badge badge-${cluster.status === "active" ? "good" : "neutral"}`}>
                              {cluster.status}
                            </span>
                            <div className="reference-platform-counts" aria-label="Query集记录统计">
                              <span>Query {cluster.queries.length} 条</span>
                              <span>采样批次 {cluster.samplingBatches.length} 次</span>
                              <span>采样记录 {cluster.samplingRecordCount} 条</span>
                            </div>
                          </div>
                          <div className="run-actions cluster-parent-actions">
                            <button className="secondary" type="button" onClick={() => setDetailClusterId(cluster.id)}>
                              详情
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expanded
                      ? cluster.queries.length === 0
                        ? (
                            <tr className="reference-child-row">
                              <td colSpan={9} className="hint cluster-empty-child-cell">
                                当前 Query集下暂无 Query。
                              </td>
                            </tr>
                          )
                        : cluster.queries.map((query) => (
                            <tr key={query.id} className="reference-child-row">
                              <td className="reference-child-source-cell cluster-query-text-cell">
                                <span className="reference-child-label">Query 明细</span>
                                <div>{query.queryText}</div>
                              </td>
                              <td>
                                <span className="badge badge-info">{query.intentType}</span>
                              </td>
                              <td>{query.language}</td>
                              <td>{query.device}</td>
                              <td>{query.persona || <span className="hint">未设置</span>}</td>
                              <td className="cluster-evidence-cell">
                                {query.expectedEvidenceTypes || <span className="hint">未设置</span>}
                              </td>
                              <td>{query.region}</td>
                              <td>
                                <span className={`badge badge-${query.status === "active" ? "good" : "neutral"}`}>
                                  {query.status}
                                </span>
                              </td>
                              <td>
                                <div className="run-actions">
                                  <button className="secondary" type="button" onClick={() => setDetailClusterId(cluster.id)}>
                                    编辑
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                      : null}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>问题意图列表</h2>
          <span className="hint">共 {intentGroups.length} 类问题意图</span>
        </div>
        <div className="reference-table-toolbar">
          <span className="hint">默认收起，以问题意图为父行、Query 为子行展示。</span>
          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setExpandedIntentKeys(new Set(intentGroups.map((group) => group.intentType)))}
              disabled={intentGroups.length === 0 || expandedIntentKeys.size === intentGroups.length}
            >
              展开全部意图
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setExpandedIntentKeys(new Set())}
              disabled={expandedIntentKeys.size === 0}
            >
              全部收起
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Query</th>
                <th>所属 Query集</th>
                <th>语言 / 地区</th>
                <th>设备 / 用户角色</th>
                <th>期望证据</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            {intentGroups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="hint">暂无 Query</td>
                </tr>
              </tbody>
            ) : (
              intentGroups.map((group) => {
                const expanded = expandedIntentKeys.has(group.intentType);
                return (
                  <tbody key={group.intentType} className="reference-group-body">
                    <tr className="reference-parent-row">
                      <td className="reference-parent-cell" colSpan={7}>
                        <div className="reference-parent-head cluster-parent-head">
                          <button
                            className="reference-expand-button"
                            type="button"
                            onClick={() => toggleIntentGroup(group.intentType)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "收起" : "展开"}该问题意图下属 Query`}
                          >
                            {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                            <span>{expanded ? "收起" : "展开"}</span>
                          </button>
                          <div className="reference-parent-main">
                            <strong>{group.intentType}</strong>
                            <div className="reference-parent-meta">
                              <span>问题意图</span>
                              <span>涉及 Query集：{countIntentGroupClusters(group)} 个</span>
                            </div>
                          </div>
                          <div className="reference-parent-stats cluster-parent-stats">
                            <span className="badge badge-info">Query {group.queries.length} 条</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expanded
                      ? group.queries.map((query) => (
                          <tr key={query.id} className="reference-child-row">
                            <td className="reference-child-source-cell cluster-query-text-cell">
                              <span className="reference-child-label">Query 明细</span>
                              <div>{query.queryText}</div>
                            </td>
                            <td className="reference-cluster-cell">
                              <span className="reference-child-label">Query集</span>
                              <div>{query.clusterName}</div>
                            </td>
                            <td>
                              <div>{query.language}</div>
                              <div className="hint">{query.region}</div>
                            </td>
                            <td>
                              <div>{query.device}</div>
                              <div className="hint">{query.persona || "未设置"}</div>
                            </td>
                            <td className="cluster-evidence-cell">
                              {query.expectedEvidenceTypes || <span className="hint">未设置</span>}
                            </td>
                            <td>
                              <span className={`badge badge-${query.status === "active" ? "good" : "neutral"}`}>
                                {query.status}
                              </span>
                            </td>
                            <td>
                              <div className="run-actions">
                                <button className="secondary" type="button" onClick={() => setDetailClusterId(query.clusterId)}>
                                  编辑
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>采样历史</h2>
          <span className="hint">按 Query集汇总历次采样批次</span>
        </div>
        <div className="reference-table-toolbar">
          <span className="hint">默认收起，以 Query集为父行、采样批次为子行展示。</span>
          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setExpandedHistoryKeys(new Set(clusters.map((cluster) => cluster.id)))}
              disabled={clusters.length === 0 || expandedHistoryKeys.size === clusters.length}
            >
              展开全部历史
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setExpandedHistoryKeys(new Set())}
              disabled={expandedHistoryKeys.size === 0}
            >
              全部收起
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>采样批次</th>
                <th>采样时间</th>
                <th>采样数</th>
                <th>操作</th>
              </tr>
            </thead>
            {clusters.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={4} className="hint">暂无 Query集</td>
                </tr>
              </tbody>
            ) : (
              clusters.map((cluster) => {
                const expanded = expandedHistoryKeys.has(cluster.id);
                const runCount = cluster.samplingBatches.reduce((total, batch) => total + batch.runCount, 0);
                return (
                  <tbody key={cluster.id} className="reference-group-body">
                    <tr className="reference-parent-row">
                      <td className="reference-parent-cell" colSpan={4}>
                        <div className="reference-parent-head">
                          <button
                            className="reference-expand-button"
                            type="button"
                            onClick={() => toggleHistoryGroup(cluster.id)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "收起" : "展开"}采样历史`}
                          >
                            {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                            <span>{expanded ? "收起" : "展开"}</span>
                          </button>
                          <div className="reference-parent-main">
                            <strong>{cluster.name}</strong>
                            <div className="reference-parent-meta">
                              <span>意图：{cluster.intentType}</span>
                              <span>状态：{cluster.status}</span>
                            </div>
                          </div>
                          <div className="reference-parent-stats">
                            <span className="badge badge-info">批次 {cluster.samplingBatches.length} 次</span>
                            <div className="reference-platform-counts" aria-label="采样历史统计">
                              <span>{runCount} 条采样</span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expanded
                      ? cluster.samplingBatches.length === 0
                        ? (
                            <tr className="reference-child-row">
                              <td colSpan={4} className="hint cluster-empty-child-cell">
                                当前 Query集暂无采样批次。
                              </td>
                            </tr>
                          )
                        : cluster.samplingBatches.map((batch) => (
                            <tr key={batch.id} className="reference-child-row">
                              <td className="reference-child-source-cell">
                                <span className="reference-child-label">采样批次</span>
                                <div>{displayBatchName(batch)}</div>
                              </td>
                              <td>{formatDateTime(batch.createdAt)}</td>
                              <td>{batch.runCount}</td>
                              <td>
                                <div className="run-actions">
                                  <button
                                    className="secondary"
                                    type="button"
                                    onClick={() => setBatchDetailSelection({ clusterId: cluster.id, batchId: batch.id })}
                                  >
                                    详情
                                  </button>
                                  <Link className="button secondary" href={`/sampling?batchId=${encodeURIComponent(batch.id)}`}>
                                    采样
                                  </Link>
                                  <form
                                    action="/api/sampling/batches/delete"
                                    method="post"
                                    onSubmit={(event) => {
                                      if (!window.confirm(`确认删除采样批次“${displayBatchName(batch)}”及其全部采样？`)) {
                                        event.preventDefault();
                                      }
                                    }}
                                  >
                                    <input type="hidden" name="batchId" value={batch.id} />
                                    <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
                                    <button className="danger secondary" type="submit">删除批次</button>
                                  </form>
                                </div>
                              </td>
                            </tr>
                          ))
                      : null}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </section>

      {createOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-md" role="dialog" aria-modal="true" aria-labelledby="create-cluster-title">
            <div className="modal-head">
              <div>
                <h2 id="create-cluster-title">新建Query集</h2>
                <p className="muted">可同时按行添加多条 Query。</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={closeCreateModal} disabled={queryGenerationLoading} aria-label="关闭">
                ×
              </button>
            </div>
            <form action="/api/query-clusters/create" method="post" className="grid">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
              <input type="hidden" name="queryIntents" value={createQueryIntents} />
              <label>
                Query集名称
                <input
                  name="name"
                  value={createClusterName}
                  onChange={(event) => setCreateClusterName(event.target.value)}
                  required
                />
              </label>
              <div className="form-grid">
                <label>
                  意图类型
                  <input
                    name="intentType"
                    placeholder="recommendation"
                    value={createIntentType}
                    onChange={(event) => setCreateIntentType(event.target.value)}
                    required
                  />
                </label>
                <label>
                  漏斗阶段
                  <select name="funnelStage" defaultValue="consideration">
                    <option value="awareness">awareness</option>
                    <option value="consideration">consideration</option>
                    <option value="decision">decision</option>
                    <option value="retention">retention</option>
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label>
                  优先级
                  <input name="priority" type="number" min="1" defaultValue="3" />
                </label>
                <label>
                  业务价值分
                  <input name="businessValueScore" type="number" min="0" max="100" defaultValue="50" />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  目标指标
                  <input name="targetMetric" defaultValue="VAIR" />
                </label>
                <label>
                  负责人团队
                  <input name="ownerTeam" defaultValue="Product" />
                </label>
              </div>
              <label>
                状态
                <select name="status" defaultValue="active">
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <div>
                <div className="muted">默认平台</div>
                <EngineCheckboxList engines={engines} selectedEngineIds={engines.map((engine) => engine.id)} />
              </div>
              <label>
                Query（每行一个）
                <textarea
                  name="queryTexts"
                  placeholder="输入 Query，每行一条"
                  value={createQueryTexts}
                  onChange={(event) => setCreateQueryTexts(event.target.value)}
                />
              </label>
              <div className="query-ai-actions">
                <button className="secondary" type="button" onClick={generateCreateQueries} disabled={queryGenerationLoading}>
                  {queryGenerationLoading ? "生成中" : "AI生成Query"}
                </button>
                {queryGenerationMessage ? <span className="hint">{queryGenerationMessage}</span> : null}
              </div>
              {queryGenerationError ? <div className="query-ai-error">{queryGenerationError}</div> : null}
              <div className="modal-actions">
                <button className="secondary" type="button" onClick={closeCreateModal} disabled={queryGenerationLoading}>
                  取消
                </button>
                <button type="submit">创建</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {aiClusterModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-xl" role="dialog" aria-modal="true" aria-labelledby="ai-cluster-title">
            <div className="modal-head">
              <div>
                <h2 id="ai-cluster-title">AI生成Query集</h2>
                <p className="muted">AI 将基于当前品牌名称、品牌客户群和品牌介绍生成 3 组 Query集，每组 10 条 Query。</p>
              </div>
              <button
                className="secondary icon-button"
                type="button"
                onClick={closeAiClusterModal}
                disabled={aiClusterLoading || aiClusterCreating}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            {aiClusterLoading ? <div className="content-ai-status">正在生成 Query集与 Query。</div> : null}
            {aiClusterError ? <div className="query-ai-error">{aiClusterError}</div> : null}

            {aiGeneratedClusters.length > 0 ? (
              <div className="generated-cluster-list">
                {aiGeneratedClusters.map((cluster, index) => (
                  <div className="generated-cluster-card" key={`${cluster.name}-${index}`}>
                    <div className="section-head">
                      <div>
                        <h3>{cluster.name}</h3>
                        <div className="hint">{cluster.intentType} / {cluster.queries.length} 条 Query</div>
                      </div>
                      <span className="badge badge-info">Query集 {index + 1}</span>
                    </div>
                    <ol className="generated-query-list">
                      {cluster.queries.map((query, queryIndex) => (
                        <li className="generated-query-item" key={`${query.queryText}-${queryIndex}`}>
                          <span>{query.queryText}</span>
                          <span className="badge badge-info">{query.intentType || cluster.intentType}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="modal-actions">
              <button className="secondary" type="button" onClick={closeAiClusterModal} disabled={aiClusterLoading || aiClusterCreating}>
                取消
              </button>
              <button className="secondary" type="button" onClick={generateAiClusters} disabled={aiClusterLoading || aiClusterCreating}>
                重新生成
              </button>
              <button
                type="button"
                onClick={createAiGeneratedClusters}
                disabled={aiClusterLoading || aiClusterCreating || aiGeneratedClusters.length !== 3}
              >
                {aiClusterCreating ? "创建中" : "确认新建"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailCluster ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-xl" role="dialog" aria-modal="true" aria-labelledby="cluster-detail-title">
            <div className="modal-head">
              <div>
                <h2 id="cluster-detail-title">Query集详情</h2>
                <p className="muted">{detailCluster.name}</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={() => setDetailClusterId(null)} aria-label="关闭">
                ×
              </button>
            </div>

            <div className="modal-body-grid">
              <form action="/api/query-clusters/update" method="post" className="grid panel-subsection">
                <input type="hidden" name="clusterId" value={detailCluster.id} />
                <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
                <h3>Query集基础字段</h3>
                <label>
                  Query集名称
                  <input name="name" defaultValue={detailCluster.name} required />
                </label>
                <div className="form-grid">
                  <label>
                    意图类型
                    <input name="intentType" defaultValue={detailCluster.intentType} required />
                  </label>
                  <label>
                    漏斗阶段
                    <select name="funnelStage" defaultValue={detailCluster.funnelStage}>
                      <option value="awareness">awareness</option>
                      <option value="consideration">consideration</option>
                      <option value="decision">decision</option>
                      <option value="retention">retention</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    优先级
                    <input name="priority" type="number" min="1" defaultValue={detailCluster.priority} />
                  </label>
                  <label>
                    业务价值分
                    <input name="businessValueScore" type="number" min="0" max="100" defaultValue={detailCluster.businessValueScore} />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    目标指标
                    <input name="targetMetric" defaultValue={detailCluster.targetMetric} />
                  </label>
                  <label>
                    负责人团队
                    <input name="ownerTeam" defaultValue={detailCluster.ownerTeam} />
                  </label>
                </div>
                <label>
                  状态
                  <select name="status" defaultValue={detailCluster.status}>
                    <option value="active">active</option>
                    <option value="paused">paused</option>
                    <option value="archived">archived</option>
                  </select>
                </label>
                <div>
                  <div className="muted">默认平台</div>
                  <EngineCheckboxList
                    engines={engines}
                    selectedEngineIds={defaultEngineIdsForCluster(detailCluster.defaultEngineIds, engines)}
                  />
                </div>
                <div className="modal-actions">
                  <button type="submit">保存 Query集</button>
                </div>
              </form>

              <form
                action="/api/query-clusters/delete"
                method="post"
                className="panel-subsection danger-zone"
                onSubmit={(event) => {
                  if (detailCluster.samplingRecordCount > 0) {
                    event.preventDefault();
                    return;
                  }
                  if (!window.confirm("确认删除该 Query集及其全部 Query？")) event.preventDefault();
                }}
              >
                <input type="hidden" name="clusterId" value={detailCluster.id} />
                <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
                <h3>删除 Query集</h3>
                {detailCluster.samplingRecordCount > 0 ? (
                  <p className="muted">当前 Query集已有采样记录，需先删除相关采样批次后才能删除 Query集。</p>
                ) : (
                  <p className="muted">当前 Query集没有采样记录。删除 Query集会级联删除其下所有 Query。</p>
                )}
                <button className="danger" type="submit" disabled={detailCluster.samplingRecordCount > 0}>
                  删除 Query集
                </button>
              </form>
            </div>

            <div className="panel-subsection">
              <h3>Query</h3>
              <form action="/api/queries/create" method="post" className="grid query-create-form">
                <input type="hidden" name="clusterId" value={detailCluster.id} />
                <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
                <label>
                  新增问题
                  <textarea name="queryText" placeholder="输入新增问题文本" required />
                </label>
                <label>
                  Query 意图
                  <QueryIntentSelect name="intentType" defaultValue={defaultQueryIntentForNew(detailCluster.intentType)} />
                </label>
                <div className="form-grid">
                  <label>
                    语言
                    <select name="language" defaultValue="zh-CN">
                      <option value="zh-CN">zh-CN</option>
                      <option value="en-US">en-US</option>
                    </select>
                  </label>
                  <label>
                    地区
                    <select name="region" defaultValue="CN">
                      <option value="CN">CN</option>
                      <option value="US">US</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    设备
                    <select name="device" defaultValue="desktop">
                      <option value="desktop">desktop</option>
                      <option value="mobile">mobile</option>
                    </select>
                  </label>
                  <label>
                    状态
                    <select name="status" defaultValue="active">
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="archived">archived</option>
                    </select>
                  </label>
                </div>
                <label>
                  用户角色
                  <input name="persona" placeholder="可选" />
                </label>
                <label>
                  期望证据类型
                  <input
                    name="expectedEvidenceTypes"
                    defaultValue="definition,pricing,specification,comparison,constraint,trust_signal"
                  />
                </label>
                <div className="modal-actions">
                  <button type="submit">新增问题</button>
                </div>
              </form>
              {detailCluster.queries.length === 0 ? (
                <p className="hint">当前 Query集下暂无 Query。</p>
              ) : (
                <div className="query-edit-list">
                  {detailCluster.queries.map((query) => (
                    <div className="query-edit-item" key={query.id}>
                      <form action="/api/queries/update" method="post" className="grid">
                        <input type="hidden" name="queryId" value={query.id} />
                        <input type="hidden" name="clusterId" value={detailCluster.id} />
                        <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
                        <label>
                          Query 文本
                          <textarea name="queryText" defaultValue={query.queryText} required />
                        </label>
                        <label>
                          Query 意图
                          <QueryIntentSelect name="intentType" defaultValue={query.intentType} />
                        </label>
                        <div className="form-grid">
                          <label>
                            语言
                            <select name="language" defaultValue={query.language}>
                              <option value="zh-CN">zh-CN</option>
                              <option value="en-US">en-US</option>
                            </select>
                          </label>
                          <label>
                            地区
                            <select name="region" defaultValue={query.region}>
                              <option value="CN">CN</option>
                              <option value="US">US</option>
                            </select>
                          </label>
                        </div>
                        <div className="form-grid">
                          <label>
                            设备
                            <select name="device" defaultValue={query.device}>
                              <option value="desktop">desktop</option>
                              <option value="mobile">mobile</option>
                            </select>
                          </label>
                          <label>
                            状态
                            <select name="status" defaultValue={query.status}>
                              <option value="active">active</option>
                              <option value="paused">paused</option>
                              <option value="archived">archived</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          用户角色
                          <input name="persona" defaultValue={query.persona} />
                        </label>
                        <label>
                          期望证据类型
                          <input name="expectedEvidenceTypes" defaultValue={query.expectedEvidenceTypes} />
                        </label>
                        <div className="modal-actions">
                          <button type="submit">保存 Query</button>
                        </div>
                      </form>
                      <form
                        action="/api/queries/delete"
                        method="post"
                        onSubmit={(event) => {
                          if (!window.confirm("确认删除该 Query？")) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="queryId" value={query.id} />
                        <input type="hidden" name="redirectTo" value="/sampling/query-clusters" />
                        <button className="danger secondary" type="submit">删除 Query</button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {batchDetailCluster && batchDetail ? (
        <div className="modal-backdrop modal-backdrop-stacked" role="presentation">
          <div className="modal-panel modal-panel-xl" role="dialog" aria-modal="true" aria-labelledby="batch-detail-title">
            <div className="modal-head">
              <div>
                <h2 id="batch-detail-title">批次详情</h2>
                <p className="muted">{batchDetailCluster.name}</p>
              </div>
              <button
                className="secondary icon-button"
                type="button"
                onClick={() => setBatchDetailSelection(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="sampling-batch-analysis">
              <div className="section-head">
                <div>
                  <h2>批次分析</h2>
                  <div className="hint">
                    批次：{batchDetailName} / 采样时间：{formatDateTime(batchDetail.createdAt)}
                  </div>
                </div>
                <Link className="button secondary" href={`/sampling?batchId=${encodeURIComponent(batchDetail.id)}`}>
                  查看本批次采样
                </Link>
              </div>
              <div className="panel-subsection">
                <h2>基础数据分析</h2>
                <BasicAnalyticsTable items={batchDetail.basicAnalytics} />
              </div>
              <AdvancedAnalyticsSection
                items={batchDetail.advancedAnalytics}
                filterSummary={`采样批次：${batchDetailName}`}
                embedded
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toggleSetKey(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

function buildQueryIntentGroups(clusters: QueryClusterManagerItem[]): QueryIntentGroup[] {
  const groups = new Map<string, QueryIntentGroupQuery[]>();
  for (const cluster of clusters) {
    for (const query of cluster.queries) {
      const intentType = normalizeQueryIntentLabel(query.intentType);
      const groupQueries = groups.get(intentType) || [];
      groupQueries.push({
        ...query,
        intentType,
        clusterId: cluster.id,
        clusterName: cluster.name
      });
      groups.set(intentType, groupQueries);
    }
  }

  return Array.from(groups, ([intentType, queries]) => ({ intentType, queries })).sort((left, right) =>
    compareQueryIntentTypes(left.intentType, right.intentType)
  );
}

function normalizeQueryIntentLabel(value: string) {
  return value.trim() || "未设置意图";
}

function compareQueryIntentTypes(left: string, right: string) {
  const leftIndex = QUERY_INTENT_OPTIONS.findIndex((option) => option === left);
  const rightIndex = QUERY_INTENT_OPTIONS.findIndex((option) => option === right);
  const leftOrder = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const rightOrder = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.localeCompare(right, "zh-CN");
}

function countIntentGroupClusters(group: QueryIntentGroup) {
  return new Set(group.queries.map((query) => query.clusterId)).size;
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

function displayBatchName(batch: Pick<SamplingBatchHistoryItem, "id" | "name">) {
  return batch.name.trim() || batch.id;
}

function EngineCheckboxList({ engines, selectedEngineIds }: { engines: EngineManagerItem[]; selectedEngineIds: string[] }) {
  if (engines.length === 0) return <div className="hint">暂无 active 平台。</div>;
  const selected = new Set(selectedEngineIds);
  return (
    <div className="check-list check-list-compact">
      {engines.map((engine) => (
        <label key={engine.id} className="check-row">
          <input type="checkbox" name="defaultEngineId" value={engine.id} defaultChecked={selected.has(engine.id)} />
          <span>
            <strong>{engine.displayName}</strong>
          </span>
        </label>
      ))}
    </div>
  );
}

function QueryIntentSelect({ name, defaultValue }: { name: string; defaultValue: string }) {
  const normalizedDefaultValue = defaultValue.trim() || "意图明确";
  const options = QUERY_INTENT_OPTIONS.includes(normalizedDefaultValue as (typeof QUERY_INTENT_OPTIONS)[number])
    ? [...QUERY_INTENT_OPTIONS]
    : [normalizedDefaultValue, ...QUERY_INTENT_OPTIONS];

  return (
    <select name={name} defaultValue={normalizedDefaultValue} required>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function defaultQueryIntentForNew(clusterIntentType: string) {
  return QUERY_INTENT_OPTIONS.includes(clusterIntentType as (typeof QUERY_INTENT_OPTIONS)[number])
    ? clusterIntentType
    : "意图明确";
}

function defaultEngineIdsForCluster(defaultEngineIds: string[] | null, engines: EngineManagerItem[]) {
  if (defaultEngineIds === null) return engines.map((engine) => engine.id);
  return defaultEngineIds;
}

function formatEngineNames(defaultEngineIds: string[] | null, engines: EngineManagerItem[]) {
  const ids = defaultEngineIdsForCluster(defaultEngineIds, engines);
  if (ids.length === 0) return "未选择";
  const nameById = new Map(engines.map((engine) => [engine.id, engine.displayName]));
  return ids.map((id) => nameById.get(id)).filter(Boolean).join("、") || "未选择";
}

function normalizeGeneratedClusters(value: unknown): GeneratedQueryClusterCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGeneratedCluster).filter((item): item is GeneratedQueryClusterCandidate => Boolean(item));
}

function normalizeGeneratedCluster(value: unknown): GeneratedQueryClusterCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { name?: unknown; intentType?: unknown; queries?: unknown };
  const name = String(raw.name || "").trim();
  const intentType = String(raw.intentType || "").trim();
  const queries = normalizeGeneratedQueries(raw.queries).slice(0, 10);
  if (!name || !intentType || queries.length === 0) return null;
  return { name, intentType, queries };
}

function normalizeGeneratedQueries(value: unknown): GeneratedQueryCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((query, index) => normalizeGeneratedQuery(query, index))
    .filter((query): query is GeneratedQueryCandidate => Boolean(query));
}

function normalizeGeneratedQuery(value: unknown, index: number): GeneratedQueryCandidate | null {
  if (typeof value === "string") {
    const queryText = value.trim();
    return queryText ? { queryText, intentType: fallbackQueryIntentType(index) } : null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as { queryText?: unknown; query?: unknown; text?: unknown; question?: unknown; intentType?: unknown; intent?: unknown };
  const queryText = String(raw.queryText || raw.query || raw.text || raw.question || "").trim();
  if (!queryText) return null;
  return {
    queryText,
    intentType: String(raw.intentType || raw.intent || fallbackQueryIntentType(index)).trim()
  };
}

function fallbackQueryIntentType(index: number) {
  if (index < 3) return "场景模糊";
  if (index < 6) return "场景明确";
  return "意图明确";
}
