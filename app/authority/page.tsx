import { Badge, Empty, Section } from "@/components/ui";
import { getDashboard } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function AuthorityPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有外部权威数据" body="请先运行采样。" />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>外部权威来源</h1>
          <p className="muted">识别 AI 频繁引用但本品牌缺失的第三方来源，形成 earned media 机会。</p>
        </div>
      </div>
      <div className="grid grid-2">
        <Section title="Top 来源">
          <table className="table">
            <tbody>
              {data.project.authoritySources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.domain}</strong>
                    <div className="hint">{source.topicCoverage}</div>
                  </td>
                  <td>{source.sourceType}</td>
                  <td>{source.citationCount} 次</td>
                  <td>
                    <Badge tone={source.brandCovered ? "good" : "warn"}>{source.brandCovered ? "已覆盖" : "缺失"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="机会清单">
          <table className="table">
            <tbody>
              {data.project.authorityOpportunities.map((opportunity) => (
                <tr key={opportunity.id}>
                  <td>
                    <strong>{opportunity.sourceDomain}</strong>
                    <div className="hint">{opportunity.reason}</div>
                  </td>
                  <td>{opportunity.opportunityType}</td>
                  <td>{opportunity.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </>
  );
}

