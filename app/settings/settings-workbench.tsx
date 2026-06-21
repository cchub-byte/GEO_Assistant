"use client";

import type { ReactNode } from "react";
import { useState } from "react";

type ScenarioItem = {
  key: string;
  label: string;
  description: string;
};

type BrandProjectItem = {
  projectId: string;
  projectName: string;
  isCurrent: boolean;
  brandProfileId: string;
  brandNames: string;
  productNames: string;
  aliases: string;
  customerGroups: string;
  description: string;
  brandUrls: string;
  forbiddenClaims: string;
  approvedClaims: string;
  competitorsText: string;
  competitorCount: number;
};

type LlmConfigItem = {
  id: string;
  baseUrl: string;
  modelName: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  scenarioModelNames: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

type EngineConfigItem = {
  id: string;
  engineType: string;
  displayName: string;
  connectorType: string;
  baseUrl: string;
  region: string;
  language: string;
  status: string;
  createdAt: string;
};

type SettingsModalState =
  | { type: "brand"; mode: "create" }
  | { type: "brand"; mode: "view"; item: BrandProjectItem }
  | { type: "brand"; mode: "update"; item: BrandProjectItem }
  | { type: "llm"; mode: "create" }
  | { type: "llm"; mode: "view"; item: LlmConfigItem }
  | { type: "llm"; mode: "update"; item: LlmConfigItem }
  | { type: "engine"; mode: "create" }
  | { type: "engine"; mode: "view"; item: EngineConfigItem }
  | { type: "engine"; mode: "update"; item: EngineConfigItem };

export function SettingsWorkbench({
  currentProjectId,
  scenarios,
  brands,
  llmConfig,
  engines
}: {
  currentProjectId: string;
  scenarios: ScenarioItem[];
  brands: BrandProjectItem[];
  llmConfig: LlmConfigItem | null;
  engines: EngineConfigItem[];
}) {
  const [modal, setModal] = useState<SettingsModalState | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>项目设置</h1>
          <p className="muted">每个品牌对应独立项目空间；设置项通过列表查看，并在弹窗中新增或编辑。</p>
        </div>
      </div>

      <SettingsSection title="品牌项目" count={brands.length} actionLabel="新增品牌" onAction={() => setModal({ type: "brand", mode: "create" })}>
        <SettingsTable
          emptyText="暂无品牌项目"
          columns={["品牌", "项目", "竞品数", "状态", "操作"]}
          rows={brands.map((brand) => [
            <strong key="brand">{brand.brandNames || "未设置品牌"}</strong>,
            brand.projectName,
            String(brand.competitorCount),
            brand.isCurrent ? <span className="badge badge-good" key="current">当前项目</span> : <span className="badge badge-neutral" key="other">非当前</span>,
            <RowActions key="actions">
              <button className="secondary compact-button" type="button" onClick={() => setModal({ type: "brand", mode: "view", item: brand })}>查看</button>
              <button className="secondary compact-button" type="button" onClick={() => setModal({ type: "brand", mode: "update", item: brand })}>编辑</button>
              {brand.brandProfileId ? (
                <form
                  action="/api/brand/delete"
                  method="post"
                  onSubmit={(event) => {
                    if (!window.confirm(`确认删除品牌项目“${brand.brandNames || brand.projectName}”？`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="projectId" value={brand.projectId} />
                  <input type="hidden" name="brandProfileId" value={brand.brandProfileId} />
                  <button className="danger secondary compact-button" type="submit">删除</button>
                </form>
              ) : null}
            </RowActions>
          ])}
        />
      </SettingsSection>

      <SettingsSection
        title="LLM 分析配置"
        count={llmConfig ? 1 : 0}
        actionLabel={llmConfig ? undefined : "新增 LLM 配置"}
        onAction={llmConfig ? undefined : () => setModal({ type: "llm", mode: "create" })}
      >
        <SettingsTable
          emptyText="暂无 LLM 配置"
          columns={["Base URL", "默认模型", "状态", "API Key", "操作"]}
          rows={llmConfig ? [[
            llmConfig.baseUrl,
            llmConfig.modelName,
            llmConfig.enabled ? <span className="badge badge-good" key="enabled">enabled</span> : <span className="badge badge-neutral" key="disabled">disabled</span>,
            llmConfig.apiKeyConfigured ? "已配置" : "未配置",
            <RowActions key="actions">
              <button className="secondary compact-button" type="button" onClick={() => setModal({ type: "llm", mode: "view", item: llmConfig })}>查看</button>
              <button className="secondary compact-button" type="button" onClick={() => setModal({ type: "llm", mode: "update", item: llmConfig })}>编辑</button>
              <form
                action="/api/llm-config/delete"
                method="post"
                onSubmit={(event) => {
                  if (!window.confirm("确认删除 LLM 配置？")) event.preventDefault();
                }}
              >
                <input type="hidden" name="llmConfigId" value={llmConfig.id} />
                <button className="danger secondary compact-button" type="submit">删除</button>
              </form>
            </RowActions>
          ]] : []}
        />
      </SettingsSection>

      <SettingsSection title="平台连接器" count={engines.length} actionLabel="新增平台" onAction={() => setModal({ type: "engine", mode: "create" })}>
        <SettingsTable
          emptyText="暂无平台连接器"
          columns={["显示名", "平台类型", "连接器", "状态", "操作"]}
          rows={engines.map((engine) => [
            <strong key="name">{engine.displayName}</strong>,
            engine.engineType,
            engine.connectorType,
            <span className={`badge ${engine.status === "active" ? "badge-good" : "badge-neutral"}`} key="status">{engine.status}</span>,
            <RowActions key="actions">
              <button className="secondary compact-button" type="button" onClick={() => setModal({ type: "engine", mode: "view", item: engine })}>查看</button>
              <button className="secondary compact-button" type="button" onClick={() => setModal({ type: "engine", mode: "update", item: engine })}>编辑</button>
              <form
                action="/api/engines/delete"
                method="post"
                onSubmit={(event) => {
                  if (!window.confirm(`确认删除平台“${engine.displayName}”？`)) event.preventDefault();
                }}
              >
                <input type="hidden" name="engineId" value={engine.id} />
                <button className="danger secondary compact-button" type="submit">删除</button>
              </form>
            </RowActions>
          ])}
        />
      </SettingsSection>

      {modal ? (
        <SettingsModal
          key={modalKey(modal)}
          modal={modal}
          currentProjectId={currentProjectId}
          scenarios={scenarios}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

function SettingsSection({
  title,
  count,
  actionLabel,
  onAction,
  children
}: {
  title: string;
  count: number;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <span className="hint">共 {count} 条</span>
        </div>
        {actionLabel && onAction ? <button type="button" onClick={onAction}>{actionLabel}</button> : null}
      </div>
      {children}
    </section>
  );
}

function SettingsTable({
  columns,
  rows,
  emptyText
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyText: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table settings-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="hint">{emptyText}</td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <div className="actions settings-row-actions">{children}</div>;
}

function SettingsModal({
  modal,
  currentProjectId,
  scenarios,
  onClose
}: {
  modal: SettingsModalState;
  currentProjectId: string;
  scenarios: ScenarioItem[];
  onClose: () => void;
}) {
  if (modal.mode === "view") {
    return <SettingsViewModal modal={modal} scenarios={scenarios} onClose={onClose} />;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="settings-modal-title">{modalTitle(modal)}</h2>
            <div className="hint">填写后保存到当前设置模块。</div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {modal.type === "brand" ? <BrandForm modal={modal} currentProjectId={currentProjectId} onClose={onClose} /> : null}
        {modal.type === "llm" ? <LlmForm modal={modal} currentProjectId={currentProjectId} scenarios={scenarios} onClose={onClose} /> : null}
        {modal.type === "engine" ? <EngineForm modal={modal} currentProjectId={currentProjectId} onClose={onClose} /> : null}
      </div>
    </div>
  );
}

function BrandForm({
  modal,
  currentProjectId,
  onClose
}: {
  modal: Extract<SettingsModalState, { type: "brand"; mode: "create" | "update" }>;
  currentProjectId: string;
  onClose: () => void;
}) {
  const item = modal.mode === "update" ? modal.item : null;
  return (
    <form action={modal.mode === "create" ? "/api/projects/create" : "/api/brand/update"} method="post" className="grid">
      {modal.mode === "create" ? <input type="hidden" name="sourceProjectId" value={currentProjectId} /> : null}
      {item ? <input type="hidden" name="projectId" value={item.projectId} /> : null}
      {item ? <input type="hidden" name="brandProfileId" value={item.brandProfileId} /> : null}
      <div className="form-grid">
        <label>品牌名<input name="brandNames" defaultValue={item?.brandNames || ""} placeholder="品牌名，多个用逗号分隔" required /></label>
        <label>产品名<input name="productNames" defaultValue={item?.productNames || ""} placeholder="产品名，多个用逗号分隔" /></label>
      </div>
      <label>别名<input name="aliases" defaultValue={item?.aliases || ""} placeholder="品牌别名、缩写、英文名" /></label>
      <div className="form-grid">
        <label>品牌客户群<textarea name="customerGroups" defaultValue={item?.customerGroups || ""} /></label>
        <label>品牌介绍<textarea name="description" defaultValue={item?.description || ""} /></label>
      </div>
      <label>品牌域名/地址<textarea name="brandUrls" defaultValue={item?.brandUrls || ""} placeholder="一行一个域名或网页地址" /></label>
      <div className="form-grid">
        <label>禁用表述<textarea name="forbiddenClaims" defaultValue={item?.forbiddenClaims || ""} /></label>
        <label>已批准表述<textarea name="approvedClaims" defaultValue={item?.approvedClaims || ""} /></label>
      </div>
      <label>
        竞品列表
        <textarea
          name="competitors"
          defaultValue={item?.competitorsText || ""}
          placeholder={"一行一个竞品，格式：竞品名称, 客户群, 品牌介绍, 品牌域名"}
        />
      </label>
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={onClose}>取消</button>
        <button type="submit">{modal.mode === "create" ? "新增品牌并切换" : "保存品牌与竞品"}</button>
      </div>
    </form>
  );
}

function LlmForm({
  modal,
  currentProjectId,
  scenarios,
  onClose
}: {
  modal: Extract<SettingsModalState, { type: "llm"; mode: "create" | "update" }>;
  currentProjectId: string;
  scenarios: ScenarioItem[];
  onClose: () => void;
}) {
  const item = modal.mode === "update" ? modal.item : null;
  return (
    <form action="/api/llm-config/upsert" method="post" className="grid">
      <input type="hidden" name="projectId" value={currentProjectId} />
      <div className="form-grid">
        <label>Base URL<input name="baseUrl" defaultValue={item?.baseUrl || ""} placeholder="https://api.openai.com/v1" required /></label>
        <label>默认 Model Name<input name="modelName" defaultValue={item?.modelName || ""} placeholder="gpt-4.1-mini" required /></label>
      </div>
      <div className="grid">
        <div>
          <h3>场景模型</h3>
          <p className="muted">留空时继承默认 Model Name；填写后仅对对应 LLM 调用场景生效。</p>
        </div>
        <div className="form-grid">
          {scenarios.map((scenario) => (
            <label key={scenario.key}>
              {scenario.label}
              <input
                name={`scenarioModelName:${scenario.key}`}
                defaultValue={item?.scenarioModelNames[scenario.key] || ""}
                placeholder={item?.modelName || "继承默认 Model Name"}
              />
              <small className="muted">{scenario.description}</small>
            </label>
          ))}
        </div>
      </div>
      <label>
        API Key
        <input
          name="apiKey"
          type="password"
          placeholder={item?.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入 API Key"}
          required={!item?.apiKeyConfigured}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="enabled" defaultChecked={item?.enabled ?? true} />
        启用回答分析
      </label>
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={onClose}>取消</button>
        <button type="submit">{modal.mode === "create" ? "新增 LLM 配置" : "保存 LLM 配置"}</button>
      </div>
    </form>
  );
}

function EngineForm({
  modal,
  currentProjectId,
  onClose
}: {
  modal: Extract<SettingsModalState, { type: "engine"; mode: "create" | "update" }>;
  currentProjectId: string;
  onClose: () => void;
}) {
  const item = modal.mode === "update" ? modal.item : null;
  return (
    <form action={modal.mode === "create" ? "/api/engines/create" : "/api/engines/update"} method="post" className="grid">
      <input type="hidden" name="projectId" value={currentProjectId} />
      {item ? <input type="hidden" name="engineId" value={item.id} /> : null}
      <div className="form-grid">
        <label>平台类型<input name="engineType" defaultValue={item?.engineType || ""} placeholder="例如：chatgpt" required /></label>
        <label>显示名<input name="displayName" defaultValue={item?.displayName || ""} placeholder="例如：ChatGPT" required /></label>
      </div>
      <label>Base URL<input name="baseUrl" defaultValue={item?.baseUrl || ""} placeholder="https://chatgpt.com/" required /></label>
      <div className="form-grid">
        <label>地区<input name="region" defaultValue={item?.region || "CN"} /></label>
        <label>语言<input name="language" defaultValue={item?.language || "zh-CN"} /></label>
      </div>
      <div className="form-grid">
        <label>
          连接器
          <select name="connectorType" defaultValue={item?.connectorType || "browser"}>
            <option value="browser">browser</option>
            <option value="mock">mock</option>
            <option value="manual">manual</option>
          </select>
        </label>
        <label>
          状态
          <select name="status" defaultValue={item?.status || "active"}>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={onClose}>取消</button>
        <button type="submit">{modal.mode === "create" ? "新增平台" : "保存平台"}</button>
      </div>
    </form>
  );
}

function SettingsViewModal({
  modal,
  scenarios,
  onClose
}: {
  modal: Extract<SettingsModalState, { mode: "view" }>;
  scenarios: ScenarioItem[];
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel-lg" role="dialog" aria-modal="true" aria-labelledby="settings-view-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="settings-view-modal-title">{modalTitle(modal)}</h2>
            <div className="hint">只读模式，展示当前配置详情。</div>
          </div>
          <button className="icon-button secondary" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {modal.type === "brand" ? <BrandDetails item={modal.item} /> : null}
        {modal.type === "llm" ? <LlmDetails item={modal.item} scenarios={scenarios} /> : null}
        {modal.type === "engine" ? <EngineDetails item={modal.item} /> : null}
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function BrandDetails({ item }: { item: BrandProjectItem }) {
  return (
    <div className="settings-detail-grid">
      <Detail label="品牌名" value={item.brandNames} />
      <Detail label="产品名" value={item.productNames} />
      <Detail label="别名" value={item.aliases} />
      <Detail label="项目" value={item.projectName} />
      <Detail label="品牌客户群" value={item.customerGroups} large />
      <Detail label="品牌介绍" value={item.description} large />
      <Detail label="品牌域名/地址" value={item.brandUrls} large />
      <Detail label="禁用表述" value={item.forbiddenClaims} large />
      <Detail label="已批准表述" value={item.approvedClaims} large />
      <Detail label="竞品列表" value={item.competitorsText} large />
    </div>
  );
}

function LlmDetails({ item, scenarios }: { item: LlmConfigItem; scenarios: ScenarioItem[] }) {
  const scenarioText = scenarios
    .map((scenario) => `${scenario.label}: ${item.scenarioModelNames[scenario.key] || "继承默认模型"}`)
    .join("\n");
  return (
    <div className="settings-detail-grid">
      <Detail label="Base URL" value={item.baseUrl} />
      <Detail label="默认 Model Name" value={item.modelName} />
      <Detail label="状态" value={item.enabled ? "enabled" : "disabled"} />
      <Detail label="API Key" value={item.apiKeyConfigured ? "已配置" : "未配置"} />
      <Detail label="场景模型" value={scenarioText} large />
      <Detail label="创建时间" value={formatDateTime(item.createdAt)} />
      <Detail label="更新时间" value={formatDateTime(item.updatedAt)} />
    </div>
  );
}

function EngineDetails({ item }: { item: EngineConfigItem }) {
  return (
    <div className="settings-detail-grid">
      <Detail label="显示名" value={item.displayName} />
      <Detail label="平台类型" value={item.engineType} />
      <Detail label="Base URL" value={item.baseUrl} large />
      <Detail label="连接器" value={item.connectorType} />
      <Detail label="地区" value={item.region} />
      <Detail label="语言" value={item.language} />
      <Detail label="状态" value={item.status} />
      <Detail label="创建时间" value={formatDateTime(item.createdAt)} />
    </div>
  );
}

function Detail({ label, value, large = false }: { label: string; value: string; large?: boolean }) {
  return (
    <div className={large ? "settings-detail-item settings-detail-item-large" : "settings-detail-item"}>
      <span className="hint">{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function modalTitle(modal: SettingsModalState) {
  const action = modal.mode === "create" ? "新增" : modal.mode === "update" ? "编辑" : "查看";
  const target = modal.type === "brand" ? "品牌项目" : modal.type === "llm" ? "LLM 配置" : "平台连接器";
  return `${action}${target}`;
}

function modalKey(modal: SettingsModalState) {
  if (modal.mode === "create") return `${modal.type}-create`;
  const itemId = "projectId" in modal.item ? modal.item.projectId : modal.item.id;
  return `${modal.type}-${modal.mode}-${itemId}`;
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}
