import type { BasicPlatformAnalytics } from "@/lib/services/dashboard-analytics";

export function BasicAnalyticsTable({ items }: { items: BasicPlatformAnalytics[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>平台</th>
          <th>当前Query次数</th>
          <th>品牌名出现比例</th>
          <th>品牌域名/地址命中率</th>
          <th>竞品品牌名出现比例</th>
          <th>当前品牌首现位置</th>
          <th>竞品品牌名首现位置</th>
          <th>引用来源前10</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={8} className="hint">暂无可展示平台</td>
          </tr>
        ) : (
          items.map((item) => (
            <tr key={item.platformId}>
              <td>{item.platformName}</td>
              <td>{item.totalQueryCount}</td>
              <td>{formatRatio(item.brandAppearCount, item.totalQueryCount)}</td>
              <td>{formatRatio(item.brandDomainHitCount, item.referenceSourceCount)}</td>
              <td>
                {item.competitorRatios.length === 0 ? <span className="hint">-</span> : null}
                <div>
                  {item.competitorRatios.map((comp) => (
                    <div key={comp.name}>
                      {comp.name}：{formatRatio(comp.count, item.totalQueryCount)}
                    </div>
                  ))}
                </div>
              </td>
              <td>
                <div>{formatAverageBrandFirstPosition(item.brandFirstPosition, item.totalQueryCount)}</div>
                <div>{formatCompetitiveBrandFirstPosition(item.brandCompetitiveFirstPosition)}</div>
                <div>落后竞品次数：{item.brandBehindCompetitorCount}(总{item.brandCompetitorCoAppearCount}次)</div>
                <div>落后竞品率：{formatRatio(item.brandBehindCompetitorCount, item.brandCompetitorCoAppearCount)}</div>
              </td>
              <td>
                <div>
                  {item.competitorFirstPositions.map((comp) => (
                    <div key={comp.name}>
                      {comp.name}平均位于：{formatAveragePosition(comp.averagePosition, item.totalQueryCount)}
                    </div>
                  ))}
                </div>
              </td>
              <td>
                {item.topSources.length === 0 ? <span className="hint">-</span> : null}
                <div>
                  {item.topSources.map((source) => (
                    <div key={source.name}>
                      {source.name}：{source.count}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function formatRatio(hitCount: number, queryCount: number) {
  if (queryCount === 0) return "0/0 (0%)";
  return `${hitCount}/${queryCount} (${percentage(hitCount / queryCount)})`;
}

function formatAverageBrandFirstPosition(brandFirstPosition: number, queryCount: number) {
  if (queryCount === 0) return "平均位于：0.00 %";
  return `平均位于：${(brandFirstPosition * 100).toFixed(2)} %`;
}

function formatCompetitiveBrandFirstPosition(brandCompetitiveFirstPosition: number) {
  return `竞争时位于：${(brandCompetitiveFirstPosition * 100).toFixed(2)} %`;
}

function formatAveragePosition(position: number, queryCount: number) {
  if (queryCount === 0) return "0.00 %";
  return `${(position * 100).toFixed(2)} %`;
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}
