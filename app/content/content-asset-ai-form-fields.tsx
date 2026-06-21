"use client";

import React, { useMemo, useState } from "react";
import type { ContentAiEvidenceModuleOption, ContentAiFeatureGroups, ContentAiFeatureOption } from "@/lib/services/content-ai";

type ContentAssetAiFormFieldsProps = {
  projectId: string;
  mode: "create" | "update";
  featureGroups: ContentAiFeatureGroups;
  evidenceModules?: ContentAiEvidenceModuleOption[];
  surface?: "asset" | "writing";
  initialTitle?: string;
  initialStatus?: string;
  initialText?: string;
};

type TitleModalState = {
  loading: boolean;
  error: string;
  titles: string[];
  selectedTitle: string;
  sourceTitleCount: number;
};

type FeatureTabKey =
  | "brandAdvantages"
  | "brandDisadvantages"
  | "competitorAdvantages"
  | "competitorDisadvantages";

type DraftTabKey = FeatureTabKey | "contentAssets";

const featureTabs: Array<{
  key: FeatureTabKey;
  title: string;
  tone: "good" | "warn" | "info" | "bad";
  emptyText: string;
}> = [
  {
    key: "brandAdvantages",
    title: "品牌优势",
    tone: "good",
    emptyText: "当前项目尚未保存可解析的品牌画像分析结果，请先完成品牌画像分析。"
  },
  {
    key: "brandDisadvantages",
    title: "品牌劣势",
    tone: "warn",
    emptyText: "当前项目尚未保存可解析的品牌画像分析结果，请先完成品牌画像分析。"
  },
  {
    key: "competitorAdvantages",
    title: "竞品优势",
    tone: "info",
    emptyText: "当前项目尚未保存可解析的竞品画像分析结果，请先完成竞品画像分析。"
  },
  {
    key: "competitorDisadvantages",
    title: "竞品劣势",
    tone: "bad",
    emptyText: "当前项目尚未保存可解析的竞品画像分析结果，请先完成竞品画像分析。"
  }
];

export function ContentAssetAiFormFields({
  projectId,
  mode,
  featureGroups,
  evidenceModules = [],
  surface = "asset",
  initialTitle = "",
  initialStatus = "active",
  initialText = ""
}: ContentAssetAiFormFieldsProps) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [titleModal, setTitleModal] = useState<TitleModalState | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [brandSiteDraftLoading, setBrandSiteDraftLoading] = useState(false);
  const [brandSiteDraftMessage, setBrandSiteDraftMessage] = useState("");
  const [brandSiteDraftError, setBrandSiteDraftError] = useState("");
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<Set<string>>(new Set());
  const [selectedEvidenceModuleIds, setSelectedEvidenceModuleIds] = useState<Set<string>>(new Set());

  const allFeatures = useMemo(() => flattenFeatureGroups(featureGroups), [featureGroups]);
  const selectedFeatures = allFeatures.filter((item) => selectedFeatureIds.has(item.id));
  const selectedEvidenceModules = evidenceModules.filter((item) => selectedEvidenceModuleIds.has(item.id));
  const isCreateMode = mode === "create";
  const isWritingMode = surface === "writing";
  const selectableEvidenceModules = isWritingMode ? evidenceModules : [];
  const totalDraftSourceCount = allFeatures.length + selectableEvidenceModules.length;
  const selectedDraftSourceCount = selectedFeatures.length + selectedEvidenceModules.length;
  const titleRequired = isCreateMode || isWritingMode;
  const textRequired = !isWritingMode;
  const textLabel = isWritingMode ? "正文" : isCreateMode ? "页面正文或内容草稿" : "重新分析正文";
  const textPlaceholder = isWritingMode
    ? "撰写符合 GEO 要求的正文，可通过 AI创作生成后继续编辑。"
    : isCreateMode
      ? "可粘贴页面正文，保存后会自动抽取证据模块。"
      : undefined;

  async function openTitleModal() {
    setTitleModal({
      loading: true,
      error: "",
      titles: [],
      selectedTitle: "",
      sourceTitleCount: 0
    });

    try {
      const response = await fetch("/api/content/ai-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `AI 出题失败：HTTP ${response.status}`);

      const titles = Array.isArray(payload.titles) ? payload.titles.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [];
      setTitleModal({
        loading: false,
        error: titles.length === 0 ? "AI 未返回候选标题" : "",
        titles,
        selectedTitle: titles[0] || "",
        sourceTitleCount: Number(payload.sourceTitleCount || 0)
      });
    } catch (error) {
      setTitleModal({
        loading: false,
        error: error instanceof Error ? error.message : "AI 出题失败",
        titles: [],
        selectedTitle: "",
        sourceTitleCount: 0
      });
    }
  }

  function openDraftModal() {
    setDraftModalOpen(true);
    setDraftError("");
    setDraftLoading(false);
    setSelectedFeatureIds(new Set());
    setSelectedEvidenceModuleIds(new Set());
  }

  function toggleFeature(featureId: string) {
    setSelectedFeatureIds((current) => {
      const next = new Set(current);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  }

  function toggleEvidenceModule(moduleId: string) {
    setSelectedEvidenceModuleIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }

  async function generateDraft() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setDraftError("请先填写或选择标题");
      return;
    }
    if (selectedDraftSourceCount === 0) {
      setDraftError("请至少勾选一条写作素材");
      return;
    }

    setDraftLoading(true);
    setDraftError("");
    try {
      const response = await fetch("/api/content/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: normalizedTitle,
          selectedFeatures,
          selectedEvidenceModuleIds: selectedEvidenceModules.map((item) => item.id)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `AI 创作失败：HTTP ${response.status}`);

      const content = String(payload.content || "").trim();
      if (!content) throw new Error("AI 未返回文章正文");
      setText(content);
      setDraftModalOpen(false);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "AI 创作失败");
    } finally {
      setDraftLoading(false);
    }
  }

  async function generateDraftFromBrandSite() {
    setBrandSiteDraftLoading(true);
    setBrandSiteDraftMessage("");
    setBrandSiteDraftError("");

    try {
      const response = await fetch("/api/content/brand-site-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: title.trim()
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `从品牌站点生成正文失败：HTTP ${response.status}`);

      const content = String(payload.content || "").trim();
      if (!content) throw new Error("LLM 未返回文章正文");
      const sourceCount = Number(payload.sourceCount || 0);
      const failedCount = Number(payload.failedCount || 0);
      setText(content);
      setBrandSiteDraftMessage(
        `已基于 ${sourceCount} 个品牌站点页面生成正文${failedCount > 0 ? `，${failedCount} 个页面获取失败` : ""}。`
      );
    } catch (error) {
      setBrandSiteDraftError(error instanceof Error ? error.message : "从品牌站点生成正文失败");
    } finally {
      setBrandSiteDraftLoading(false);
    }
  }

  return (
    <>
      <div className="form-grid">
        <label>
          标题
          <div className="content-ai-title-row">
            <input
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={isWritingMode ? "例如：企业项目管理软件选型指南" : isCreateMode ? "例如：品牌官网产品页" : undefined}
              required={titleRequired}
            />
            <button className="secondary" type="button" onClick={openTitleModal} disabled={Boolean(titleModal?.loading)}>
              AI出题
            </button>
          </div>
        </label>
      </div>

      {!isCreateMode && !isWritingMode ? (
        <label>
          状态
          <select name="status" defaultValue={initialStatus}>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </select>
        </label>
      ) : null}

      <label>
        {textLabel}
        <textarea
          name="textContent"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={textPlaceholder}
          required={textRequired}
        />
      </label>
      <div className="actions content-ai-inline-actions">
        <button className="secondary" type="button" onClick={openDraftModal}>
          AI创作
        </button>
        {!isWritingMode ? (
          <button className="secondary" type="button" onClick={generateDraftFromBrandSite} disabled={brandSiteDraftLoading}>
            {brandSiteDraftLoading ? "获取并生成中" : "从品牌站点获取"}
          </button>
        ) : null}
        {totalDraftSourceCount === 0 ? (
          <span className="hint">
            {isWritingMode ? "暂无可勾选的写作素材，请先完成画像分析或新增内容资产。" : "暂无可勾选的画像分析素材，请先完成品牌画像分析或竞品画像分析。"}
          </span>
        ) : null}
      </div>
      {!isWritingMode && brandSiteDraftLoading ? <div className="content-ai-status">正在获取品牌站点内容并调用 LLM 生成正文。</div> : null}
      {!isWritingMode && brandSiteDraftMessage ? <div className="content-ai-status">{brandSiteDraftMessage}</div> : null}
      {!isWritingMode && brandSiteDraftError ? <div className="content-ai-error">{brandSiteDraftError}</div> : null}

      {titleModal ? (
        <TitleCandidateModal
          state={titleModal}
          onSelect={(selectedTitle) => setTitleModal({ ...titleModal, selectedTitle })}
          onApply={() => {
            if (!titleModal.selectedTitle) return;
            setTitle(titleModal.selectedTitle);
            setTitleModal(null);
          }}
          onClose={() => setTitleModal(null)}
        />
      ) : null}

      {draftModalOpen ? (
        <DraftFeatureModal
          featureGroups={featureGroups}
          allFeatures={allFeatures}
          evidenceModules={selectableEvidenceModules}
          selectedFeatureIds={selectedFeatureIds}
          selectedEvidenceModuleIds={selectedEvidenceModuleIds}
          selectedCount={selectedDraftSourceCount}
          loading={draftLoading}
          error={draftError}
          onToggleFeature={toggleFeature}
          onToggleEvidenceModule={toggleEvidenceModule}
          onSelectAll={() => {
            setSelectedFeatureIds(new Set(allFeatures.map((item) => item.id)));
            setSelectedEvidenceModuleIds(new Set(selectableEvidenceModules.map((item) => item.id)));
          }}
          onClear={() => {
            setSelectedFeatureIds(new Set());
            setSelectedEvidenceModuleIds(new Set());
          }}
          onGenerate={generateDraft}
          onClose={() => {
            if (!draftLoading) setDraftModalOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function TitleCandidateModal({
  state,
  onSelect,
  onApply,
  onClose
}: {
  state: TitleModalState;
  onSelect: (title: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-md" role="dialog" aria-modal="true" aria-labelledby="content-ai-title-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="content-ai-title-modal-title">AI出题</h2>
            <div className="hint">
              {state.sourceTitleCount > 0 ? `已基于 ${state.sourceTitleCount} 个竞品引用标题生成候选。` : "根据最新采样中的竞品引用标题生成候选。"}
            </div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {state.loading ? <div className="content-ai-status">正在生成候选标题。</div> : null}
        {state.error ? <div className="content-ai-error">{state.error}</div> : null}
        {!state.loading && state.titles.length > 0 ? (
          <div className="content-ai-choice-list">
            {state.titles.map((title) => (
              <label className="content-ai-choice-item" key={title}>
                <input
                  type="radio"
                  checked={state.selectedTitle === title}
                  onChange={() => onSelect(title)}
                />
                <span>{title}</span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>取消</button>
          <button type="button" onClick={onApply} disabled={state.loading || !state.selectedTitle}>使用标题</button>
        </div>
      </div>
    </div>
  );
}

function DraftFeatureModal({
  featureGroups,
  allFeatures,
  evidenceModules,
  selectedFeatureIds,
  selectedEvidenceModuleIds,
  selectedCount,
  loading,
  error,
  onToggleFeature,
  onToggleEvidenceModule,
  onSelectAll,
  onClear,
  onGenerate,
  onClose
}: {
  featureGroups: ContentAiFeatureGroups;
  allFeatures: ContentAiFeatureOption[];
  evidenceModules: ContentAiEvidenceModuleOption[];
  selectedFeatureIds: Set<string>;
  selectedEvidenceModuleIds: Set<string>;
  selectedCount: number;
  loading: boolean;
  error: string;
  onToggleFeature: (featureId: string) => void;
  onToggleEvidenceModule: (moduleId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const draftTabs: Array<{
    key: DraftTabKey;
    title: string;
    tone: "good" | "warn" | "info" | "bad" | "neutral";
    count: number;
    emptyText?: string;
  }> = [
    ...featureTabs.map((tab) => ({
      ...tab,
      count: featureGroups[tab.key].length
    })),
    {
      key: "contentAssets",
      title: "证据模块",
      tone: "neutral",
      count: evidenceModules.length,
      emptyText: "暂无可选择的证据模块，请先在内容资产页面新增内容资产并完成分析。"
    }
  ];
  const [activeTab, setActiveTab] = useState<DraftTabKey>("brandAdvantages");
  const activeTabConfig = draftTabs.find((tab) => tab.key === activeTab) || draftTabs[0];
  const activeFeatureTabConfig = activeTabConfig.key === "contentAssets"
    ? null
    : featureTabs.find((tab) => tab.key === activeTabConfig.key) || featureTabs[0];
  const activeTabItems = activeFeatureTabConfig ? featureGroups[activeFeatureTabConfig.key] : [];
  const totalSelectableCount = allFeatures.length + evidenceModules.length;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="content-ai-draft-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="content-ai-draft-modal-title">AI创作</h2>
            <div className="hint">素材来自已保存的品牌画像分析、竞品画像分析与内容资产证据模块。</div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} disabled={loading} aria-label="关闭">×</button>
        </div>

        <div className="actions content-ai-modal-toolbar">
          <button className="secondary" type="button" onClick={onSelectAll} disabled={loading || totalSelectableCount === 0}>全选</button>
          <button className="secondary" type="button" onClick={onClear} disabled={loading || selectedCount === 0}>清空</button>
          <span className="hint">已选择 {selectedCount} / {totalSelectableCount}</span>
        </div>

        {error ? <div className="content-ai-error">{error}</div> : null}

        <div className="tab-list content-ai-feature-tabs" role="tablist" aria-label="AI创作素材分类">
          {draftTabs.map((tab) => (
            <button
              key={tab.key}
              className={`tab-button ${activeTab === tab.key ? "tab-button-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              disabled={loading}
            >
              {tab.title}
              <span className={`badge badge-${tab.tone}`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {activeTabConfig.key === "contentAssets" ? (
          <EvidenceModuleSourceGroup
            items={evidenceModules}
            selectedEvidenceModuleIds={selectedEvidenceModuleIds}
            onToggleEvidenceModule={onToggleEvidenceModule}
          />
        ) : (
          <FeatureGroup
            title={activeFeatureTabConfig?.title || ""}
            tone={activeFeatureTabConfig?.tone || "info"}
            emptyText={activeFeatureTabConfig?.emptyText || ""}
            items={activeTabItems}
            selectedFeatureIds={selectedFeatureIds}
            onToggleFeature={onToggleFeature}
          />
        )}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose} disabled={loading}>取消</button>
          <button type="button" onClick={onGenerate} disabled={loading || selectedCount === 0}>
            {loading ? "创作中" : "AI创作"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeatureGroup({
  title,
  tone,
  emptyText,
  items,
  selectedFeatureIds,
  onToggleFeature
}: {
  title: string;
  tone: "good" | "warn" | "info" | "bad";
  emptyText: string;
  items: ContentAiFeatureOption[];
  selectedFeatureIds: Set<string>;
  onToggleFeature: (featureId: string) => void;
}) {
  return (
    <div className="content-ai-feature-group">
      <div className="content-ai-feature-group-head">
        <h3>{title}</h3>
        <span className={`badge badge-${tone}`}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="hint">{emptyText}</div>
      ) : (
        <div className="content-ai-feature-list">
          {items.map((item) => (
            <label className="content-ai-feature-option" key={item.id}>
              <input
                type="checkbox"
                checked={selectedFeatureIds.has(item.id)}
                onChange={() => onToggleFeature(item.id)}
              />
              <span>
                {item.targetName ? <strong>{item.targetName}</strong> : null}
                <span className="content-ai-feature-content">{item.content}</span>
                <span className="hint">{[item.platformName, item.queryText].filter(Boolean).join(" / ")}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceModuleSourceGroup({
  items,
  selectedEvidenceModuleIds,
  onToggleEvidenceModule
}: {
  items: ContentAiEvidenceModuleOption[];
  selectedEvidenceModuleIds: Set<string>;
  onToggleEvidenceModule: (moduleId: string) => void;
}) {
  return (
    <div className="content-ai-feature-group">
      <div className="content-ai-feature-group-head">
        <h3>证据模块</h3>
        <span className="badge badge-neutral">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="hint">暂无可选择的证据模块，请先在内容资产页面新增内容资产并完成分析。</div>
      ) : (
        <div className="content-ai-feature-list">
          {items.map((item) => (
            <label className="content-ai-feature-option content-ai-asset-option" key={item.id}>
              <input
                type="checkbox"
                checked={selectedEvidenceModuleIds.has(item.id)}
                onChange={() => onToggleEvidenceModule(item.id)}
              />
              <span>
                <strong>{item.moduleTitle}</strong>
                <span className="content-ai-feature-content">{item.bodyPreview}</span>
                <span className="hint content-ai-feature-meta">
                  {[
                    item.contentAssetTitle,
                    item.moduleType,
                    `${item.bodyLength} 字`,
                    `快照 ${formatDateTime(item.snapshotAt)}`
                  ].filter(Boolean).join(" / ")}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function flattenFeatureGroups(groups: ContentAiFeatureGroups) {
  return [
    ...groups.brandAdvantages,
    ...groups.brandDisadvantages,
    ...groups.competitorAdvantages,
    ...groups.competitorDisadvantages
  ];
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}
