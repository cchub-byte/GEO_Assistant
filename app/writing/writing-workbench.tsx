"use client";

import { useMemo, useState } from "react";
import { ContentAssetAiFormFields } from "@/app/content/content-asset-ai-form-fields";
import type { ContentAiEvidenceModuleOption, ContentAiFeatureGroups } from "@/lib/services/content-ai";

type WritingItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type WritingModalState =
  | { mode: "create" }
  | { mode: "update"; writing: WritingItem }
  | { mode: "view"; writing: WritingItem };

export function WritingWorkbench({
  projectId,
  featureGroups,
  evidenceModules,
  writings
}: {
  projectId: string;
  featureGroups: ContentAiFeatureGroups;
  evidenceModules: ContentAiEvidenceModuleOption[];
  writings: WritingItem[];
}) {
  const [keyword, setKeyword] = useState("");
  const [modal, setModal] = useState<WritingModalState | null>(null);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredWritings = useMemo(() => {
    if (!normalizedKeyword) return writings;
    return writings.filter((writing) =>
      `${writing.title}\n${writing.body}`.toLowerCase().includes(normalizedKeyword)
    );
  }, [writings, normalizedKeyword]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>内容写作</h1>
          <p className="muted">撰写符合 GEO 要求的内容，围绕品牌优势、竞品对比与证据模块组织正文。</p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setModal({ mode: "create" })}>
            新增写作
          </button>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>写作内容列表</h2>
          <span className="hint">显示 {filteredWritings.length} / {writings.length} 篇</span>
        </div>
        <div className="filter-bar" aria-label="写作内容筛选">
          <label className="writing-filter-field">
            关键词筛选
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题或正文"
            />
          </label>
          <button
            className="secondary"
            type="button"
            onClick={() => setKeyword("")}
            disabled={!keyword}
          >
            清除筛选
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>正文预览</th>
                <th>字数</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredWritings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="hint">{writings.length === 0 ? "暂无写作内容" : "暂无匹配写作内容"}</td>
                </tr>
              ) : (
                filteredWritings.map((writing) => (
                  <tr key={writing.id}>
                    <td className="writing-title-cell">
                      <strong>{writing.title}</strong>
                      <div className="hint">创建：{formatDateTime(writing.createdAt)}</div>
                    </td>
                    <td className="writing-preview-cell">{textPreview(writing.body)}</td>
                    <td>{countCnCharacters(writing.body)}</td>
                    <td>{formatDateTime(writing.updatedAt)}</td>
                    <td>
                      <div className="actions">
                        <button className="secondary compact-button" type="button" onClick={() => setModal({ mode: "view", writing })}>
                          查看
                        </button>
                        <button className="secondary compact-button" type="button" onClick={() => setModal({ mode: "update", writing })}>
                          编辑
                        </button>
                        <form
                          action="/api/writing/delete"
                          method="post"
                          onSubmit={(event) => {
                            if (!window.confirm(`确认删除写作“${writing.title}”？`)) event.preventDefault();
                          }}
                        >
                          <input type="hidden" name="writingId" value={writing.id} />
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
        <WritingModal
          key={modal.mode === "create" ? "create" : `${modal.mode}-${modal.writing.id}`}
          projectId={projectId}
          featureGroups={featureGroups}
          evidenceModules={evidenceModules}
          modal={modal}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

function WritingModal({
  projectId,
  featureGroups,
  evidenceModules,
  modal,
  onClose
}: {
  projectId: string;
  featureGroups: ContentAiFeatureGroups;
  evidenceModules: ContentAiEvidenceModuleOption[];
  modal: WritingModalState;
  onClose: () => void;
}) {
  const isCreate = modal.mode === "create";
  const isView = modal.mode === "view";
  const writing = modal.mode === "create" ? null : modal.writing;
  if (isView && writing) {
    return (
      <div className="modal-backdrop" role="presentation">
        <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="writing-view-modal-title">
          <div className="modal-head">
            <div>
              <h2 id="writing-view-modal-title">查看写作</h2>
              <div className="hint">只读模式，仅展示当前写作全文。</div>
            </div>
            <button className="icon-button secondary" type="button" onClick={onClose} aria-label="关闭">×</button>
          </div>
          <div className="writing-view-meta">
            <div>
              <span className="hint">标题</span>
              <strong>{writing.title}</strong>
            </div>
            <div>
              <span className="hint">字数</span>
              <strong>{countCnCharacters(writing.body)}</strong>
            </div>
            <div>
              <span className="hint">创建时间</span>
              <strong>{formatDateTime(writing.createdAt)}</strong>
            </div>
            <div>
              <span className="hint">更新时间</span>
              <strong>{formatDateTime(writing.updatedAt)}</strong>
            </div>
          </div>
          <pre className="writing-view-body">{writing.body.trim() || "暂无正文"}</pre>
          <div className="modal-actions">
            <button className="secondary" type="button" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="writing-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="writing-modal-title">{isCreate ? "新增写作" : "编辑写作"}</h2>
            <div className="hint">标题和正文会保存为内容写作草稿，可使用 AI 出题和 AI 创作辅助生成。</div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <form action={isCreate ? "/api/writing/create" : "/api/writing/update"} method="post" className="grid">
          <input type="hidden" name="projectId" value={projectId} />
          {writing ? <input type="hidden" name="writingId" value={writing.id} /> : null}
          <ContentAssetAiFormFields
            projectId={projectId}
            mode={isCreate ? "create" : "update"}
            surface="writing"
            featureGroups={featureGroups}
            evidenceModules={evidenceModules}
            initialTitle={writing?.title || ""}
            initialText={writing?.body || ""}
          />
          <div className="modal-actions">
            <button className="secondary" type="button" onClick={onClose}>取消</button>
            <button type="submit">{isCreate ? "保存写作" : "保存修改"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function textPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无正文";
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function countCnCharacters(value: string) {
  return value.replace(/\s/g, "").length;
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}
