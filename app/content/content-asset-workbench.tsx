"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ContentAssetAiFormFields } from "@/app/content/content-asset-ai-form-fields";
import type { ContentAiFeatureGroups } from "@/lib/services/content-ai";
import { contentAnalysisNoticeCookieName, type ContentAnalysisNotice } from "@/lib/services/content-analysis-notice";

type ContentAssetSubmoduleItem = {
  id: string;
  body: string;
  locationPath: string;
  sentenceIndex: number;
  hitCount: number;
};

type ContentAssetEvidenceModuleItem = {
  id: string;
  moduleType: string;
  title: string;
  body: string;
  locationPath: string;
  submodules: ContentAssetSubmoduleItem[];
};

export type ContentAssetListItem = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  snapshot: {
    crawlStatus: string;
    snapshotAt: string;
    textContent: string;
    structureScore: number;
    evidenceModules: ContentAssetEvidenceModuleItem[];
  } | null;
};

type ContentAssetModalState =
  | { mode: "create" }
  | { mode: "view"; asset: ContentAssetListItem }
  | { mode: "update"; asset: ContentAssetListItem };

export function ContentAssetWorkbench({
  projectId,
  featureGroups,
  assets,
  analysisNotice = ""
}: {
  projectId: string;
  featureGroups: ContentAiFeatureGroups;
  assets: ContentAssetListItem[];
  analysisNotice?: ContentAnalysisNotice | "";
}) {
  const [modal, setModal] = useState<ContentAssetModalState | null>(null);
  const [visibleNotice, setVisibleNotice] = useState<ContentAnalysisNotice | "">(analysisNotice);

  useEffect(() => {
    if (!analysisNotice) return;
    document.cookie = `${contentAnalysisNoticeCookieName}=; Path=/content; Max-Age=0; SameSite=Lax`;
  }, [analysisNotice]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>内容资产</h1>
          <p className="muted">管理可供 GEO 分析使用的内容资产，并查看正文与证据模块。</p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setModal({ mode: "create" })}>
            添加内容资产
          </button>
        </div>
      </div>

      {visibleNotice ? (
        <div className="content-analysis-notice" role="status" aria-live="polite">
          <span>{getContentAnalysisNoticeText(visibleNotice)}</span>
          <button className="secondary compact-button" type="button" onClick={() => setVisibleNotice("")}>
            关闭
          </button>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>内容资产列表</h2>
          <span className="hint">共 {assets.length} 条</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>结构评分</th>
                <th>证据模块</th>
                <th>最近快照</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="hint">暂无内容资产</td>
                </tr>
              ) : (
                assets.map((asset) => (
                  <tr key={asset.id}>
                    <td className="content-asset-title-cell">
                      <strong>{asset.title}</strong>
                      <div className="hint">更新：{formatDateTime(asset.updatedAt)}</div>
                    </td>
                    <td>
                      <span className={`badge ${asset.status === "active" ? "badge-good" : "badge-neutral"}`}>{asset.status}</span>
                    </td>
                    <td>{asset.snapshot ? formatPercent(asset.snapshot.structureScore) : "-"}</td>
                    <td>{asset.snapshot ? `${asset.snapshot.evidenceModules.length} / ${countEvidenceSubmodules(asset)}` : "-"}</td>
                    <td>{asset.snapshot ? formatDateTime(asset.snapshot.snapshotAt) : "-"}</td>
                    <td>
                      <div className="actions">
                        <button className="secondary compact-button" type="button" onClick={() => setModal({ mode: "view", asset })}>
                          查看
                        </button>
                        <button className="secondary compact-button" type="button" onClick={() => setModal({ mode: "update", asset })}>
                          编辑
                        </button>
                        <form
                          action="/api/content/delete"
                          method="post"
                          onSubmit={(event) => {
                            if (!window.confirm(`确认删除内容资产“${asset.title}”？`)) event.preventDefault();
                          }}
                        >
                          <input type="hidden" name="assetId" value={asset.id} />
                          <button className="danger secondary compact-button" type="submit">删除</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal ? (
        <ContentAssetModal
          key={modal.mode === "create" ? "create" : `${modal.mode}-${modal.asset.id}`}
          projectId={projectId}
          featureGroups={featureGroups}
          modal={modal}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

function ContentAssetModal({
  projectId,
  featureGroups,
  modal,
  onClose
}: {
  projectId: string;
  featureGroups: ContentAiFeatureGroups;
  modal: ContentAssetModalState;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  if (modal.mode === "view") {
    return <ContentAssetViewModal asset={modal.asset} onClose={onClose} />;
  }

  const isCreate = modal.mode === "create";
  const asset = modal.mode === "update" ? modal.asset : null;
  const submittingText = isCreate
    ? "正在新增并分析，请勿关闭窗口。分析完成后会返回内容资产列表并显示完成提示。"
    : "正在保存并重新分析，请勿关闭窗口。分析完成后会返回内容资产列表并显示完成提示。";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    setSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData
      });
      const payload = await readJsonPayload(response);
      if (!response.ok) throw new Error(payload.error || "内容资产保存失败");
      window.location.assign("/content");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "内容资产保存失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="content-asset-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="content-asset-modal-title">{isCreate ? "新增内容资产" : "编辑内容资产"}</h2>
            <div className="hint">保存后会重新抽取证据模块。</div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} disabled={submitting} aria-label="关闭">×</button>
        </div>
        <form
          action={isCreate ? "/api/content/create" : "/api/content/update"}
          method="post"
          className="grid"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="projectId" value={projectId} />
          {asset ? <input type="hidden" name="assetId" value={asset.id} /> : null}
          <ContentAssetAiFormFields
            projectId={projectId}
            mode={isCreate ? "create" : "update"}
            featureGroups={featureGroups}
            initialTitle={asset?.title || ""}
            initialStatus={asset?.status || "active"}
            initialText={asset?.snapshot?.textContent || ""}
          />
          {submitting ? <div className="content-analysis-inline-status" role="status" aria-live="polite">{submittingText}</div> : null}
          {submitError ? <div className="content-ai-error" role="alert">{submitError}</div> : null}
          <div className="modal-actions">
            <button className="secondary" type="button" onClick={onClose} disabled={submitting}>取消</button>
            <button type="submit" disabled={submitting}>
              {submitting ? (isCreate ? "新增并分析中" : "保存并分析中") : (isCreate ? "新增并分析" : "保存并重新分析")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ContentAssetViewModal({ asset, onClose }: { asset: ContentAssetListItem; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"body" | "evidence">("body");
  const evidenceModuleCount = asset.snapshot?.evidenceModules.length || 0;
  const evidenceSubmoduleCount = countEvidenceSubmodules(asset);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="content-asset-view-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="content-asset-view-modal-title">查看内容资产</h2>
            <div className="hint">只读模式，展示正文、快照和证据模块。</div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="content-asset-view-meta">
          <div>
            <span className="hint">标题</span>
            <strong>{asset.title}</strong>
          </div>
          <div>
            <span className="hint">状态</span>
            <strong>{asset.status}</strong>
          </div>
          <div>
            <span className="hint">结构评分</span>
            <strong>{asset.snapshot ? formatPercent(asset.snapshot.structureScore) : "-"}</strong>
          </div>
          <div>
            <span className="hint">最近快照</span>
            <strong>{asset.snapshot ? formatDateTime(asset.snapshot.snapshotAt) : "-"}</strong>
          </div>
        </div>

        <div className="tab-list content-asset-view-tabs" role="tablist" aria-label="内容资产查看分类">
          <button
            className={`tab-button ${activeTab === "body" ? "tab-button-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "body"}
            onClick={() => setActiveTab("body")}
          >
            全文
          </button>
          <button
            className={`tab-button ${activeTab === "evidence" ? "tab-button-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "evidence"}
            onClick={() => setActiveTab("evidence")}
          >
            证据模块
            <span className="badge badge-info">{evidenceModuleCount} / {evidenceSubmoduleCount}</span>
          </button>
        </div>

        {activeTab === "body" ? (
          <pre className="content-asset-view-body">{asset.snapshot?.textContent.trim() || "暂无正文"}</pre>
        ) : asset.snapshot && asset.snapshot.evidenceModules.length > 0 ? (
          <div className="content-asset-view-evidence-list">
            {asset.snapshot.evidenceModules.map((module) => (
              <div className="content-asset-view-evidence-item" key={module.id}>
                <div className="content-evidence-module-head">
                  <span className="badge badge-info">{module.moduleType}</span>
                  <span className="hint">子模块 {module.submodules.length}</span>
                </div>
                <h4>{module.title.trim()}</h4>
                <div className="hint">{module.locationPath}</div>
                {module.submodules.length === 0 ? (
                  <div className="hint">未识别到可独立对比的证据句。</div>
                ) : (
                  <ol className="evidence-submodule-list">
                    {module.submodules.map((submodule) => (
                      <li className="evidence-submodule-item" key={submodule.id}>
                        <div className="evidence-submodule-label">证据 {submodule.sentenceIndex}</div>
                        <div className="evidence-submodule-hit-count">命中 {submodule.hitCount} 次</div>
                        <p>{submodule.body}</p>
                        <div className="hint">{submodule.locationPath}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>暂无证据模块</strong>
            <p>请先保存内容资产并执行分析。</p>
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function countEvidenceSubmodules(asset: ContentAssetListItem) {
  return asset.snapshot?.evidenceModules.reduce((sum, module) => sum + module.submodules.length, 0) || 0;
}

function getContentAnalysisNoticeText(notice: ContentAnalysisNotice) {
  if (notice === "created") return "内容资产已新增并完成分析。";
  return "内容资产已保存并完成重新分析。";
}

async function readJsonPayload(response: Response): Promise<{ error?: string }> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value || 0)) * 100)}%`;
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}
