"use client";

import React, { useState } from "react";

export type AdvancedFeatureItem = {
  id: string;
  queryText: string;
  content: string;
  targetName?: string;
};

export type AdvancedCountItem = {
  label: string;
  count: number;
};

export type AdvancedReferenceSourceItem = {
  id: string;
  title: string;
  url: string;
  siteName: string;
};

export type AdvancedLinkedCountItem = AdvancedCountItem & {
  sources: AdvancedReferenceSourceItem[];
};

export type AdvancedFeatureCountItem = AdvancedCountItem & {
  items: AdvancedFeatureItem[];
};

export type AdvancedPlatformAnalytics = {
  platformId: string;
  platformName: string;
  answerAdvantageSites: AdvancedLinkedCountItem[];
  answerDisadvantageSites: AdvancedLinkedCountItem[];
  referenceAdvantages: AdvancedFeatureItem[];
  referenceDisadvantages: AdvancedFeatureItem[];
  competitorReferenceAdvantages: AdvancedFeatureItem[];
  competitorReferenceDisadvantages: AdvancedFeatureItem[];
  competitorReferenceAdvantageCounts: AdvancedFeatureCountItem[];
  competitorReferenceDisadvantageCounts: AdvancedFeatureCountItem[];
  referenceMentionNames: AdvancedLinkedCountItem[];
};

export type AdvancedFeatureExportKind = "advantage" | "disadvantage";
export type AdvancedFeatureExportScope = "brand" | "competitor";

export type AdvancedFeatureExportRow = {
  platformName: string;
  targetName: string;
  platformFeatureCount: number;
  platformItemIndex: number;
  queryText: string;
  content: string;
};

type ModalState =
  | {
      kind: "features";
      title: string;
      items: AdvancedFeatureItem[];
    }
  | {
      kind: "referenceSources";
      title: string;
      items: AdvancedReferenceSourceItem[];
    }
  | null;

export function AdvancedAnalyticsSection({
  items,
  filterSummary,
  title = "高级数据分析",
  embedded = false
}: {
  items: AdvancedPlatformAnalytics[];
  filterSummary: string;
  title?: string;
  embedded?: boolean;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const containerClassName = embedded ? "panel-subsection" : "section";
  const brandAdvantageExportRows = buildFeatureExportRows(items, "brand", "advantage");
  const brandDisadvantageExportRows = buildFeatureExportRows(items, "brand", "disadvantage");
  const competitorAdvantageExportRows = buildFeatureExportRows(items, "competitor", "advantage");
  const competitorDisadvantageExportRows = buildFeatureExportRows(items, "competitor", "disadvantage");

  return (
    <>
      <div className={containerClassName}>
        <div className="section-head">
          <div>
            <h2>{title}</h2>
            <div className="hint">当前筛选：{filterSummary}</div>
          </div>
          {!embedded ? (
            <div className="actions">
              <button
                className="secondary"
                type="button"
                onClick={() => downloadFeatureExport(items, "brand", "advantage")}
                disabled={brandAdvantageExportRows.length === 0}
              >
                导出所有品牌优势
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => downloadFeatureExport(items, "brand", "disadvantage")}
                disabled={brandDisadvantageExportRows.length === 0}
              >
                导出所有品牌劣势
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => downloadFeatureExport(items, "competitor", "advantage")}
                disabled={competitorAdvantageExportRows.length === 0}
              >
                导出竞品所有优势
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => downloadFeatureExport(items, "competitor", "disadvantage")}
                disabled={competitorDisadvantageExportRows.length === 0}
              >
                导出竞品所有劣势
              </button>
            </div>
          ) : null}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>平台名称</th>
                <th>回答优势引用来源</th>
                <th>回答劣势引用来源</th>
                <th>品牌累计引用优势数</th>
                <th>品牌累计引用劣势数</th>
                <th>竞品累计引用优势数</th>
                <th>竞品累计引用劣势数</th>
                <th>引用提及名称</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="hint">暂无高级分析数据</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.platformId}>
                    <td>{item.platformName}</td>
                    <td>
                      <LinkedSiteCountList
                        sites={item.answerAdvantageSites}
                        emptyText="暂无"
                        onOpenSources={(label, sources) =>
                          setModal({ kind: "referenceSources", title: `${item.platformName} - 回答优势引用来源 - ${label}`, items: sources })
                        }
                      />
                    </td>
                    <td>
                      <LinkedSiteCountList
                        sites={item.answerDisadvantageSites}
                        emptyText="暂无"
                        onOpenSources={(label, sources) =>
                          setModal({ kind: "referenceSources", title: `${item.platformName} - 回答劣势引用来源 - ${label}`, items: sources })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() =>
                          setModal({ kind: "features", title: `${item.platformName} - 品牌累计引用优势`, items: item.referenceAdvantages })
                        }
                        disabled={item.referenceAdvantages.length === 0}
                      >
                        {item.referenceAdvantages.length}
                      </button>
                    </td>
                    <td>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() =>
                          setModal({
                            kind: "features",
                            title: `${item.platformName} - 品牌累计引用劣势`,
                            items: item.referenceDisadvantages
                          })
                        }
                        disabled={item.referenceDisadvantages.length === 0}
                      >
                        {item.referenceDisadvantages.length}
                      </button>
                    </td>
                    <td>
                      <FeatureCountList
                        counts={item.competitorReferenceAdvantageCounts}
                        emptyText="暂无"
                        onOpenFeatures={(label, features) =>
                          setModal({ kind: "features", title: `${item.platformName} - ${label} - 竞品累计引用优势`, items: features })
                        }
                      />
                    </td>
                    <td>
                      <FeatureCountList
                        counts={item.competitorReferenceDisadvantageCounts}
                        emptyText="暂无"
                        onOpenFeatures={(label, features) =>
                          setModal({ kind: "features", title: `${item.platformName} - ${label} - 竞品累计引用劣势`, items: features })
                        }
                      />
                    </td>
                    <td>
                      <LinkedCountList
                        counts={item.referenceMentionNames}
                        emptyText="暂无"
                        onOpenSources={(label, sources) =>
                          setModal({ kind: "referenceSources", title: `${item.platformName} - 引用提及名称 - ${label}`, items: sources })
                        }
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="advanced-analysis-title">
            <div className="modal-head">
              <div>
                <h2 id="advanced-analysis-title">{modal.title}</h2>
                <p className="muted">共 {modal.items.length} 条</p>
              </div>
              <button className="secondary icon-button" type="button" onClick={() => setModal(null)} aria-label="关闭">
                ×
              </button>
            </div>
            {modal.kind === "features" ? <FeatureModalBody items={modal.items} /> : <ReferenceSourceModalBody items={modal.items} />}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function buildFeatureExportRows(
  items: AdvancedPlatformAnalytics[],
  scope: AdvancedFeatureExportScope,
  kind: AdvancedFeatureExportKind
): AdvancedFeatureExportRow[] {
  return items.flatMap((item) => {
    const features =
      scope === "brand"
        ? kind === "advantage"
          ? item.referenceAdvantages
          : item.referenceDisadvantages
        : kind === "advantage"
          ? item.competitorReferenceAdvantages
          : item.competitorReferenceDisadvantages;
    return features.map((feature, index) => ({
      platformName: item.platformName,
      targetName: feature.targetName || (scope === "brand" ? "品牌" : "未识别竞品"),
      platformFeatureCount: features.length,
      platformItemIndex: index + 1,
      queryText: feature.queryText,
      content: feature.content
    }));
  });
}

export function buildFeatureExportCsv(rows: AdvancedFeatureExportRow[]) {
  const header = ["平台名称", "对象名称", "平台累计引用数", "平台内序号", "Query", "引用内容"];
  return [header, ...rows.map((row) => [
    row.platformName,
    row.targetName,
    String(row.platformFeatureCount),
    String(row.platformItemIndex),
    row.queryText,
    row.content
  ])]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}

function downloadFeatureExport(items: AdvancedPlatformAnalytics[], scope: AdvancedFeatureExportScope, kind: AdvancedFeatureExportKind) {
  const rows = buildFeatureExportRows(items, scope, kind);
  if (rows.length === 0) return;
  const scopeLabel = scope === "brand" ? "品牌" : "竞品";
  const label = kind === "advantage" ? "优势" : "劣势";
  const csv = buildFeatureExportCsv(rows);
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `高级数据分析-${scopeLabel}累计引用${label}清单-${formatExportDate(new Date())}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatExportDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function LinkedSiteCountList({
  sites,
  emptyText,
  onOpenSources
}: {
  sites: AdvancedLinkedCountItem[];
  emptyText: string;
  onOpenSources: (label: string, sources: AdvancedReferenceSourceItem[]) => void;
}) {
  if (sites.length === 0) return <span className="hint">{emptyText}</span>;
  return (
    <div className="advanced-inline-count-list">
      {sites.map((site) => (
        <span key={site.label}>
          {site.label}[
          <button className="link-button" type="button" onClick={() => onOpenSources(site.label, site.sources)}>
            {site.count}次
          </button>
          ]
        </span>
      ))}
    </div>
  );
}

function FeatureModalBody({ items }: { items: AdvancedFeatureItem[] }) {
  return (
    <div className="advanced-feature-list">
      {items.length === 0 ? (
        <div className="hint">暂无数据</div>
      ) : (
        items.map((item) => (
          <div className="advanced-feature-item" key={item.id}>
            {item.targetName ? <div className="advanced-feature-target">{item.targetName}</div> : null}
            <div className="advanced-feature-query">{item.queryText}</div>
            <div className="advanced-feature-content">{item.content}</div>
          </div>
        ))
      )}
    </div>
  );
}

function FeatureCountList({
  counts,
  emptyText,
  onOpenFeatures
}: {
  counts: AdvancedFeatureCountItem[];
  emptyText: string;
  onOpenFeatures: (label: string, features: AdvancedFeatureItem[]) => void;
}) {
  const visibleCounts = counts.filter((item) => item.count > 0);
  if (visibleCounts.length === 0) return <span className="hint">{emptyText}</span>;
  return (
    <div className="advanced-count-list">
      {visibleCounts.map((item) => (
        <div key={item.label}>
          {item.label}：
          <button className="link-button" type="button" onClick={() => onOpenFeatures(item.label, item.items)}>
            {item.count}
          </button>
        </div>
      ))}
    </div>
  );
}

function ReferenceSourceModalBody({ items }: { items: AdvancedReferenceSourceItem[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>引用项目名称</th>
            <th>引用项目链接</th>
            <th>来源站点名称</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="hint">暂无引用来源</td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td>{item.title || "未命名引用"}</td>
                <td>
                  {item.url ? (
                    <a className="text-link" href={item.url} target="_blank" rel="noreferrer">
                      {item.url}
                    </a>
                  ) : (
                    <span className="hint">无链接</span>
                  )}
                </td>
                <td>{item.siteName || "未知来源"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function LinkedCountList({
  counts,
  emptyText,
  onOpenSources
}: {
  counts: AdvancedLinkedCountItem[];
  emptyText: string;
  onOpenSources: (label: string, sources: AdvancedReferenceSourceItem[]) => void;
}) {
  const visibleCounts = counts.filter((item) => item.count > 0);
  if (visibleCounts.length === 0) return <span className="hint">{emptyText}</span>;
  return (
    <div className="advanced-count-list">
      {visibleCounts.map((item) => (
        <div key={item.label}>
          {item.label}：
          <button className="link-button" type="button" onClick={() => onOpenSources(item.label, item.sources)}>
            {item.count}
          </button>
        </div>
      ))}
    </div>
  );
}
