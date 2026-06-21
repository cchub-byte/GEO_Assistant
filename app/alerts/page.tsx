import { Badge, Empty, Section } from "@/components/ui";
import { getDashboard } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有告警报告" body="请先运行 demo pipeline。" />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>告警、风险与报告</h1>
          <p className="muted">监控 VAIR、错误描述、竞品替代和核心来源变化，并生成周报/月报。</p>
        </div>
        <form action="/api/reports/generate" method="post">
          <button type="submit">生成周报</button>
        </form>
      </div>
      <div className="grid grid-2">
        <Section title="告警">
          <table className="table">
            <tbody>
              {data.project.alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>
                    <Badge tone={alert.severity === "P0" ? "bad" : "warn"}>{alert.severity}</Badge>
                  </td>
                  <td>
                    <strong>{alert.title}</strong>
                    <div className="hint">{alert.message}</div>
                  </td>
                  <td>{alert.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="报告">
          {data.project.reports.map((report) => (
            <div className="card" key={report.id} style={{ marginBottom: 12 }}>
              <h3>{report.title}</h3>
              <pre className="mono">{report.markdown.slice(0, 1200)}</pre>
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

