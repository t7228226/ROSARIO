import { Info } from "../../components/detailViews";
import type { CoverageResilienceResult } from "../../domain/workforce/resilience";
import type { Person, Station } from "../../types";

interface ResilienceInsightsProps {
  result: CoverageResilienceResult;
  people: Person[];
  stations: Station[];
}

export default function ResilienceInsights({ result, people, stations }: ResilienceInsightsProps) {
  const personName = (id: string) => people.find((person) => person.id === id)?.name || id;
  const stationName = (id: string) => stations.find((station) => station.id === id)?.name || id;
  const riskCount = result.levels.reduce((sum, item) => sum + item.riskScenarios, 0);

  return (
    <div className="resilience-results">
      <div className={`analysis-confidence ${result.exhaustive ? "is-complete" : "is-estimate"}`} role="status">
        <strong>{result.exhaustive ? "完整排列計算" : "固定抽樣估算"}</strong>
        <span>
          已驗證 {result.testedCombinations.toLocaleString()} / {result.totalCombinations.toLocaleString()} 個缺勤組合。
          {result.exhaustive ? "結果涵蓋本次設定的全部組合。" : "抽樣結果用於風險預警，不代表未抽中的組合必然安全。"}
        </span>
      </div>

      <div className="detail-grid resilience-summary-grid">
        <Info label="分析作業人力" value={String(result.activeWorkerCount)} />
        <Info label="風險組合" value={String(riskCount)} />
        <Info label="風險站點" value={String(result.stationRisks.length)} />
        <Info label="共享瓶頸" value={String(result.sharedBottlenecks.length)} />
      </div>

      <div className="resilience-level-grid" aria-label="各缺勤人數分析結果">
        {result.levels.map((level) => (
          <div className={`resilience-level-item ${level.riskScenarios ? "has-risk" : "is-safe"}`} key={level.absenceCount}>
            <strong>缺勤 {level.absenceCount} 人</strong>
            <span>維持全勤基準 {level.baselineMaintainedRate.toFixed(1)}%</span>
            <small>{level.riskScenarios} 個風險組合｜{level.exhaustive ? "完整排列" : `抽樣 ${level.testedCombinations.toLocaleString()}`}</small>
          </div>
        ))}
      </div>

      {result.sharedBottlenecks.length ? (
        <section className="resilience-insight-section" aria-labelledby="shared-bottleneck-title">
          <div className="resilience-insight-heading">
            <h4 id="shared-bottleneck-title">共享資格瓶頸</h4>
            <p>下列站點共用同一小群合格人員；單站各自看似足夠，同時配置時仍可能缺人。</p>
          </div>
          <div className="table-wrap resilience-table-wrap">
            <table className="table resilience-table">
              <thead><tr><th>共用站點</th><th>合計需求</th><th>共用合格人員</th><th>備援深度</th><th>判定</th></tr></thead>
              <tbody>
                {result.sharedBottlenecks.map((item) => (
                  <tr key={item.stationIds.join("|")}>
                    <td><strong>{item.stationIds.map(stationName).join("、")}</strong></td>
                    <td>{item.requiredSlots}</td>
                    <td>{item.qualifiedPeople}</td>
                    <td>{item.reserveDepth < 0 ? `缺 ${Math.abs(item.reserveDepth)}` : item.reserveDepth}</td>
                    <td><span className={`risk-label ${item.severity === "已缺人" ? "danger" : "warning"}`}>{item.severity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {result.supportDependencies.length ? (
        <section className="resilience-insight-section" aria-labelledby="support-dependency-title">
          <div className="resilience-insight-heading">
            <h4 id="support-dependency-title">支援依賴檢核</h4>
            <p>先配置支援人力後，再模擬支援撤除，確認本班能否重新排列接手。</p>
          </div>
          <div className="table-wrap resilience-table-wrap">
            <table className="table resilience-table">
              <thead><tr><th>站點</th><th>支援配置</th><th>本班可接手</th><th>支援撤除新增缺口</th><th>判定</th></tr></thead>
              <tbody>
                {result.supportDependencies.map((item) => (
                  <tr key={item.stationId}>
                    <td><strong>{stationName(item.stationId)}</strong></td>
                    <td>{item.supportAssigned}</td>
                    <td>{item.recoverableByOwn}</td>
                    <td>{item.addedShortageWithoutSupport}</td>
                    <td>{item.addedShortageWithoutSupport > 0
                      ? <span className="risk-label danger">{item.supportAssigned > 0 ? "直接依賴" : "間接依賴"}</span>
                      : <span className="risk-label success">本班可接手</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {result.stationRisks.length ? (
        <section className="resilience-insight-section" aria-labelledby="station-risk-title">
          <div className="resilience-insight-heading">
            <h4 id="station-risk-title">缺勤風險站點</h4>
            <p>僅列出重新排列全站後仍無法吸收的實際缺口。</p>
          </div>
          <div className="table-wrap resilience-table-wrap">
            <table className="table resilience-table">
              <thead><tr><th>風險站點</th><th>最少缺勤</th><th>風險次數</th><th>最大新增缺口</th><th>關鍵缺勤人員</th></tr></thead>
              <tbody>
                {result.stationRisks.map((risk) => {
                  const criticalNames = risk.criticalCombinations.slice(0, 3).map((ids) => ids.map(personName).join(" + "));
                  return (
                    <tr key={risk.stationId}>
                      <td><strong>{stationName(risk.stationId)}</strong></td>
                      <td>{risk.minAbsenceCount} 人</td>
                      <td>{risk.riskScenarioCount}</td>
                      <td>{risk.maxAddedShortage} 人</td>
                      <td>{criticalNames.join("、") || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="resilience-safe-message">在本次已驗證範圍內，缺勤情境皆可透過全站重新配置維持全勤基準。</p>
      )}

      {result.criticalCombinations.length ? (
        <details className="resilience-critical-details">
          <summary>查看最小關鍵缺勤組合（{result.criticalCombinations.length}）</summary>
          <div className="risk-combination-list">
            {result.criticalCombinations.map((item) => {
              const names = item.absentIds.map(personName).join(" + ");
              const affected = item.affectedStations.map((impact) => `${stationName(impact.stationId)}缺 ${impact.shortage}`).join("、");
              return <div key={item.absentIds.join("|")}><strong>{names}</strong><span>{affected}</span></div>;
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
