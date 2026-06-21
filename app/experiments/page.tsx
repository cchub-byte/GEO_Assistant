import { Badge, Bar, Empty, Section } from "@/components/ui";
import { getDashboard } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有实验" body="请先运行 demo pipeline。" />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>实验管理与策略库</h1>
          <p className="muted">实验和 strategy card 均支持新增、修改、删除。</p>
        </div>
      </div>

      <Section title="新增实验">
        <form action="/api/experiments/create" method="post" className="grid">
          <input type="hidden" name="projectId" value={data.project.id} />
          <div className="form-grid">
            <label>
              实验名称
              <input name="name" placeholder="例如：补充价格与限制条件模块" required />
            </label>
            <label>
              Query集
              <select name="clusterId">
                <option value="">不绑定</option>
                {data.project.queryClusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>{cluster.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            假设
            <textarea name="hypothesis" placeholder="例如：增加价格和限制条件模块可提升比较类 Query 的吸收得分。" />
          </label>
          <div className="form-grid">
            <label>
              主指标
              <input name="targetMetric" defaultValue="absorptionScore" />
            </label>
            <label>
              护栏指标
              <input name="guardrailMetrics" defaultValue="errorDescriptionRate,negativeImpactRate" />
            </label>
          </div>
          <button type="submit">新增实验</button>
        </form>
      </Section>

      <Section title="实验">
        <div className="grid">
          {data.project.experiments.map((experiment) => (
            <div className="card" key={experiment.id}>
              <form action="/api/experiments/update" method="post" className="grid">
                <input type="hidden" name="experimentId" value={experiment.id} />
                <div className="section-head">
                  <h3>{experiment.name}</h3>
                  <Badge tone={experiment.status === "completed" ? "good" : "warn"}>{experiment.status}</Badge>
                </div>
                <div className="form-grid">
                  <label>
                    实验名称
                    <input name="name" defaultValue={experiment.name} />
                  </label>
                  <label>
                    Query集
                    <select name="clusterId" defaultValue={experiment.clusterId || ""}>
                      <option value="">不绑定</option>
                      {data.project.queryClusters.map((cluster) => (
                        <option key={cluster.id} value={cluster.id}>{cluster.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  假设
                  <textarea name="hypothesis" defaultValue={experiment.hypothesis} />
                </label>
                <div className="form-grid">
                  <label>
                    主指标
                    <input name="targetMetric" defaultValue={experiment.targetMetric} />
                  </label>
                  <label>
                    护栏指标
                    <input name="guardrailMetrics" defaultValue={experiment.guardrailMetrics} />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    状态
                    <select name="status" defaultValue={experiment.status}>
                      <option value="draft">draft</option>
                      <option value="baseline_running">baseline_running</option>
                      <option value="ready_for_change">ready_for_change</option>
                      <option value="posttest_running">posttest_running</option>
                      <option value="completed">completed</option>
                      <option value="inconclusive">inconclusive</option>
                    </select>
                  </label>
                  <label>
                    最小重复
                    <input name="minimumRepeats" type="number" min="1" defaultValue={experiment.minimumRepeats} />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    前测窗口
                    <input name="baselineWindow" defaultValue={experiment.baselineWindow} />
                  </label>
                  <label>
                    后测窗口
                    <input name="posttestWindow" defaultValue={experiment.posttestWindow} />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    成功阈值
                    <input name="successThreshold" type="number" step="0.01" defaultValue={experiment.successThreshold} />
                  </label>
                  <label>
                    负向影响阈值
                    <input name="negativeImpactThreshold" type="number" step="0.01" defaultValue={experiment.negativeImpactThreshold} />
                  </label>
                </div>
                <label>
                  结果摘要
                  <textarea name="resultSummary" defaultValue={experiment.resultSummary || ""} />
                </label>
                <button type="submit">保存实验</button>
              </form>
              <form action="/api/experiments/delete" method="post" style={{ marginTop: 10 }}>
                <input type="hidden" name="experimentId" value={experiment.id} />
                <button className="secondary" type="submit">删除实验</button>
              </form>
            </div>
          ))}
        </div>
      </Section>

      <Section title="新增策略卡片">
        <form action="/api/strategies/create" method="post" className="grid">
          <input type="hidden" name="projectId" value={data.project.id} />
          <div className="form-grid">
            <label>
              策略名称
              <input name="strategyName" required />
            </label>
            <label>
              关联实验
              <select name="experimentId">
                <option value="">不绑定</option>
                {data.project.experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.id}>{experiment.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            改动模式
            <textarea name="changePattern" />
          </label>
          <div className="form-grid">
            <label>
              适用意图
              <input name="applicableIntents" placeholder="comparison,recommendation" />
            </label>
            <label>
              适用资产
              <input name="assetTypes" placeholder="product_page,comparison_page" />
            </label>
          </div>
          <button type="submit">新增策略</button>
        </form>
      </Section>

      <Section title="策略卡片">
        <div className="grid grid-2">
          {data.project.strategyCards.map((card) => (
            <div className="card" key={card.id}>
              <form action="/api/strategies/update" method="post" className="grid">
                <input type="hidden" name="strategyId" value={card.id} />
                <div className="section-head">
                  <h3>{card.strategyName}</h3>
                  <Badge tone="good">uplift {Math.round(card.observedUplift * 100)}%</Badge>
                </div>
                <label>
                  策略名称
                  <input name="strategyName" defaultValue={card.strategyName} />
                </label>
                <label>
                  关联实验
                  <select name="experimentId" defaultValue={card.experimentId || ""}>
                    <option value="">不绑定</option>
                    {data.project.experiments.map((experiment) => (
                      <option key={experiment.id} value={experiment.id}>{experiment.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  改动模式
                  <textarea name="changePattern" defaultValue={card.changePattern} />
                </label>
                <div className="form-grid">
                  <label>
                    适用意图
                    <input name="applicableIntents" defaultValue={card.applicableIntents} />
                  </label>
                  <label>
                    适用资产
                    <input name="assetTypes" defaultValue={card.assetTypes} />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    历史提升
                    <input name="observedUplift" type="number" step="0.01" defaultValue={card.observedUplift} />
                  </label>
                  <label>
                    状态
                    <select name="status" defaultValue={card.status}>
                      <option value="draft">draft</option>
                      <option value="published">published</option>
                      <option value="archived">archived</option>
                    </select>
                  </label>
                </div>
                <label>
                  风险说明
                  <textarea name="riskNotes" defaultValue={card.riskNotes} />
                </label>
                <label>
                  不适用条件
                  <textarea name="doNotUseWhen" defaultValue={card.doNotUseWhen} />
                </label>
                <Bar value={card.observedUplift} label={`历史提升 ${Math.round(card.observedUplift * 100)}%`} />
                <button type="submit">保存策略</button>
              </form>
              <form action="/api/strategies/delete" method="post" style={{ marginTop: 10 }}>
                <input type="hidden" name="strategyId" value={card.id} />
                <button className="secondary" type="submit">删除策略</button>
              </form>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
