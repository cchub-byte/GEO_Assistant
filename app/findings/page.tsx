import { Badge, Empty, Section } from "@/components/ui";
import { getDashboard } from "@/lib/services/read";
import { stageLabels } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function FindingsPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有 Finding" body="请先运行 demo pipeline。" />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>五阶段诊断与任务流</h1>
          <p className="muted">将低表现归因到可发现、被选择、被吸收、被归因、可稳定五个阶段，并生成跨团队任务。</p>
        </div>
        <form action="/api/findings/refresh" method="post">
          <button type="submit">重新诊断</button>
        </form>
      </div>
      <Section title="Finding 队列">
        <table className="table">
          <thead>
            <tr>
              <th>等级</th>
              <th>阶段</th>
              <th>问题</th>
              <th>责任团队</th>
              <th>任务</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {data.project.findings.map((finding) => (
              <tr key={finding.id}>
                <td>
                  <Badge tone={finding.severity === "P0" ? "bad" : finding.severity === "P1" ? "warn" : "neutral"}>{finding.severity}</Badge>
                </td>
                <td>{stageLabels[finding.stage] || finding.stage}</td>
                <td>
                  <strong>{finding.title}</strong>
                  <div className="hint">{finding.recommendation}</div>
                </td>
                <td>{finding.ownerTeam}</td>
                <td>{finding.tasks.length}</td>
                <td>{finding.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="任务流">
        <table className="table">
          <tbody>
            {data.project.tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <Badge tone={task.status === "done" ? "good" : task.status === "blocked" ? "bad" : "info"}>{task.status}</Badge>
                </td>
                <td>
                  <strong>{task.title}</strong>
                  <div className="hint">{task.description}</div>
                </td>
                <td>{task.ownerTeam}</td>
                <td>{task.expectedMetricImpact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

