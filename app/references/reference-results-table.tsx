"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type ReferenceResultsGroup = {
  key: string;
  url: string;
  title: string;
  sourceType: string;
  siteName: string;
  domain: string;
  citationCount: number;
  platformCounts: Array<{ platform: string; count: number }>;
  items: ReferenceResultItem[];
};

type ReferenceResultItem = {
  id: string;
  url: string;
  rawUrl: string;
  fetchedUrl: string;
  title: string;
  siteLabel: string;
  sourceType: string;
  clusterName: string;
  clusterIntentType: string;
  queryText: string;
  queryIntentType: string;
  platform: string;
  positionLabel: string;
  summary: string;
  runAtText: string;
  author: string;
  publishedAt: string;
  bodyText: string;
  content: string;
  fetchMode: string;
  fetchError: string;
  fetchedAtText: string;
  referenceFeatureAnalysis: string;
  referenceFeatureAnalysisAtText: string;
  referenceFeatureAnalysisError: string;
  competitorReferenceFeatureAnalysis: string;
  competitorReferenceFeatureAnalysisAtText: string;
  competitorReferenceFeatureAnalysisError: string;
};

type ContextKind = "brand" | "competitor";

type ReferenceContext = {
  sourceId: string;
  sourceTitle: string;
  platform: string;
  queryText: string;
  term: string;
  matchedText: string;
  prefix: string;
  suffix: string;
  position: number;
  hasPrefix: boolean;
  hasSuffix: boolean;
};

export function ReferenceResultsTable({
  groups,
  sortPlatform,
  brandTerms,
  competitorTerms
}: {
  groups: ReferenceResultsGroup[];
  sortPlatform?: string;
  brandTerms: string[];
  competitorTerms: string[];
}) {
  const duplicateGroupKeys = useMemo(() => groups.filter((group) => group.citationCount > 1).map((group) => group.key), [groups]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [contextModal, setContextModal] = useState<{ groupKey: string; kind: ContextKind } | null>(null);
  const [detailSource, setDetailSource] = useState<ReferenceResultItem | null>(null);
  const contextGroup = contextModal ? groups.find((group) => group.key === contextModal.groupKey) || null : null;
  const contextTerms = contextModal?.kind === "competitor" ? competitorTerms : brandTerms;
  const contextItems = contextGroup ? referenceContextsForGroup(contextGroup, contextTerms) : [];

  function toggleGroup(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function expandDuplicateGroups() {
    setExpandedKeys(new Set(duplicateGroupKeys));
  }

  function collapseAllGroups() {
    setExpandedKeys(new Set());
  }

  return (
    <>
      <div className="reference-table-toolbar">
        <span className="hint">{sortPlatform ? `默认收起，按 ${sortPlatform} 引用次数降序展示。` : "默认收起，按引用次数降序展示。"}</span>
        <div className="actions">
          <button className="secondary" type="button" onClick={expandDuplicateGroups} disabled={duplicateGroupKeys.length === 0}>
            展开多次引用
          </button>
          <button className="secondary" type="button" onClick={collapseAllGroups} disabled={expandedKeys.size === 0}>
            全部收起
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>引用</th>
              <th>Query集</th>
              <th>Query</th>
              <th>平台</th>
              <th>位置</th>
              <th>摘要 / 正文片段</th>
            </tr>
          </thead>
          {groups.map((group) => {
            const expanded = expandedKeys.has(group.key);
            return (
              <tbody key={group.key} className="reference-group-body">
                <tr className="reference-parent-row">
                  <td className="reference-parent-cell" colSpan={6}>
                    <div className="reference-parent-head">
                      <button
                        className="reference-expand-button"
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "收起" : "展开"}引用明细`}
                      >
                        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                        <span>{expanded ? "收起" : "展开"}</span>
                      </button>
                      <div className="reference-parent-main">
                        {group.url ? (
                          <a className="text-link" href={group.url} target="_blank" rel="noreferrer">
                            <strong>{group.title}</strong>
                          </a>
                        ) : (
                          <strong>{group.title}</strong>
                        )}
                        <div className="hint reference-parent-url">{group.url || "未记录链接"}</div>
                        <div className="reference-parent-meta">
                          <span>{group.siteName || group.domain || "未知来源"}</span>
                          <span>{group.sourceType || "未分类"}</span>
                        </div>
                        <div className="reference-inline-tools">
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => setContextModal({ groupKey: group.key, kind: "brand" })}
                          >
                            品牌引用上下文（{referenceContextsForGroup(group, brandTerms).length}）
                          </button>
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => setContextModal({ groupKey: group.key, kind: "competitor" })}
                          >
                            竞品引用上下文（{referenceContextsForGroup(group, competitorTerms).length}）
                          </button>
                          <ReferenceTags tags={referenceTagsForGroup(group, brandTerms, competitorTerms)} />
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => setDetailSource(group.items[0] || null)}
                            disabled={group.items.length === 0}
                          >
                            查看详情
                          </button>
                        </div>
                      </div>
                      <div className="reference-parent-stats">
                        <ReferenceBadge tone={group.citationCount > 1 ? "info" : "neutral"}>引用 {group.citationCount} 次</ReferenceBadge>
                        <div className="reference-platform-counts" aria-label="各平台引用次数">
                          {group.platformCounts.map((item) => (
                            <span key={item.platform}>
                              {item.platform} {item.count} 次
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
                {expanded
                  ? group.items.map((source) => (
                      <tr key={source.id} className="reference-child-row">
                        <td className="reference-child-source-cell">
                          <span className="reference-child-label">引用明细</span>
                          <div className="hint">{source.siteLabel}</div>
                        </td>
                        <td className="reference-cluster-cell">
                          <strong>{source.clusterName}</strong>
                          <div className="hint">{source.clusterIntentType}</div>
                        </td>
                        <td className="reference-query-cell">
                          <strong>{source.queryText}</strong>
                          <div className="hint">{source.queryIntentType}</div>
                        </td>
                        <td>{source.platform}</td>
                        <td>{source.positionLabel}</td>
                        <td className="reference-preview-cell">
                          {source.summary || <span className="hint">未提取到摘要或正文</span>}
                          <div className="hint">Run：{source.runAtText}</div>
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            );
          })}
        </table>
      </div>
      {contextModal && contextGroup ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="reference-context-title">
            <div className="modal-head">
              <div>
                <h2 id="reference-context-title">
                  {contextModal.kind === "competitor" ? "竞品引用上下文" : "品牌引用上下文"}
                </h2>
                <p className="muted reference-detail-subtitle">{contextGroup.title}</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={() => setContextModal(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="hint reference-context-count">共 {contextItems.length} 条上下文</div>
            <ReferenceContextList contexts={contextItems} />
          </div>
        </div>
      ) : null}
      {detailSource ? (
        <ReferenceDetailModal source={detailSource} onClose={() => setDetailSource(null)} />
      ) : null}
    </>
  );
}

function ReferenceContextList({ contexts }: { contexts: ReferenceContext[] }) {
  if (contexts.length === 0) return <div className="hint">未提及</div>;
  return (
    <div className="brand-reference-contexts reference-context-modal-list">
      {contexts.map((context, index) => (
        <div className="brand-reference-context" key={`${context.sourceId}-${context.term}-${context.position}-${index}`}>
          <div className="brand-reference-context-term">
            {context.term} / {context.platform} / {context.queryText}
          </div>
          <div className="hint reference-context-source">{context.sourceTitle}</div>
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

function ReferenceDetailModal({ source, onClose }: { source: ReferenceResultItem; onClose: () => void }) {
  return (
    <div className="modal-backdrop reference-detail-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="reference-detail-title">
        <div className="modal-head">
          <div>
            <h2 id="reference-detail-title">引用详情</h2>
            <p className="muted reference-detail-subtitle">{source.title || "未命名引用"}</p>
          </div>
          <button className="secondary icon-button" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="reference-detail-grid">
          <DetailField label="URL">
            {source.fetchedUrl || source.url ? (
              <a className="text-link" href={source.fetchedUrl || source.url} target="_blank" rel="noreferrer">
                {source.fetchedUrl || source.url}
              </a>
            ) : (
              "未提取到"
            )}
          </DetailField>
          <DetailField label="title">{source.title || "未提取到"}</DetailField>
          <DetailField label="引用项目摘要">{source.summary || "未提取到"}</DetailField>
          <DetailField label="author">{source.author || "未提取到"}</DetailField>
          <DetailField label="published_at">{source.publishedAt || "未提取到"}</DetailField>
          <DetailField label="品牌引用分析">
            <SourceFeatureAnalysis
              analysis={source.referenceFeatureAnalysis}
              analyzedAt={source.referenceFeatureAnalysisAtText}
              error={source.referenceFeatureAnalysisError}
              emptyLabel="未分析品牌引用"
            />
          </DetailField>
          <DetailField label="竞品引用分析">
            <SourceFeatureAnalysis
              analysis={source.competitorReferenceFeatureAnalysis}
              analyzedAt={source.competitorReferenceFeatureAnalysisAtText}
              error={source.competitorReferenceFeatureAnalysisError}
              emptyLabel="未分析竞品引用"
            />
          </DetailField>
          <DetailField label="fetch_mode">{source.fetchMode || "未获取"}</DetailField>
          <DetailField label="fetched_at">{source.fetchedAtText || "未获取"}</DetailField>
        </div>
        {source.fetchError ? <div className="reference-detail-error">抓取失败：{source.fetchError}</div> : null}
        <div className="reference-detail-section">
          <h3>正文文本</h3>
          <div className="reference-detail-text">{source.bodyText || "未获取"}</div>
        </div>
        <div className="reference-detail-section">
          <h3>content</h3>
          <div className="reference-detail-text">{source.content || "未获取"}</div>
        </div>
      </div>
    </div>
  );
}

function SourceFeatureAnalysis({
  analysis,
  analyzedAt,
  error,
  emptyLabel
}: {
  analysis: string;
  analyzedAt: string;
  error: string;
  emptyLabel: string;
}) {
  if (error) return <div className="hint answer-analysis-error">分析失败：{error}</div>;
  if (!analysis) return <span className="hint">{emptyLabel}</span>;
  return (
    <div className="source-feature-analysis">
      <div className="source-feature-analysis-text">{analysis}</div>
      {analyzedAt ? <div className="hint">分析时间：{analyzedAt}</div> : null}
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

function ReferenceTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="hint">无标签</span>;
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

function referenceTagsForGroup(group: ReferenceResultsGroup, brandTerms: string[], competitorTerms: string[]) {
  const tags = new Set<string>();
  for (const source of group.items) {
    const detailText = source.bodyText || source.content || "";
    if (containsAnyTerm(detailText, brandTerms)) tags.add("提及品牌");
    if (containsAnyTerm(detailText, competitorTerms)) tags.add("提及竞品");
  }
  return [...tags];
}

function referenceContextsForGroup(group: ReferenceResultsGroup, terms: string[]) {
  return group.items.flatMap((source) => referenceContextsForSource(source, terms));
}

function referenceContextsForSource(source: ReferenceResultItem, terms: string[]) {
  const detailText = normalizeContextText(source.bodyText || source.content || "");
  if (!detailText) return [] as ReferenceContext[];

  const lowerText = detailText.toLocaleLowerCase();
  const contexts: ReferenceContext[] = [];
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
        sourceId: source.id,
        sourceTitle: source.title || source.url || "未命名引用",
        platform: source.platform,
        queryText: source.queryText,
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

function ReferenceBadge({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "bad" | "info";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
