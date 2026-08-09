import { useMemo, useState } from "react";
import { evaluateWorkforceScenario } from "../../domain/workforce";
import {
  DAY_OPTIONS,
  getAttendanceForTeam,
  getTeamOfPerson,
  TEAM_OPTIONS,
} from "../../lib/selectors";
import type {
  AppBootstrap,
  Person,
  ShiftMode,
  TeamName,
} from "../../types";

type WorkbenchDestination = "person-query" | "gap-analysis" | "manual-schedule";

interface WorkforceWorkbenchProps {
  data: AppBootstrap;
  currentUser: Person;
  loading: boolean;
  onNavigate: (destination: WorkbenchDestination) => void;
}

function getVisibleTeams(currentUser: Person): TeamName[] {
  const userTeam = getTeamOfPerson(currentUser);
  const canViewAll =
    currentUser.isSuperAdmin ||
    currentUser.systemPermission === "最高權限" ||
    currentUser.permissionLevel === "最高權限";
  if (canViewAll) return TEAM_OPTIONS;
  return TEAM_OPTIONS.includes(userTeam as TeamName)
    ? [userTeam as TeamName]
    : TEAM_OPTIONS;
}

export default function WorkforceWorkbench({
  data,
  currentUser,
  loading,
  onNavigate,
}: WorkforceWorkbenchProps) {
  const visibleTeams = useMemo(() => getVisibleTeams(currentUser), [currentUser]);
  const [team, setTeam] = useState<TeamName>(() => visibleTeams[0] || TEAM_OPTIONS[0]);
  const [mode, setMode] = useState<ShiftMode>("當班");

  const result = useMemo(
    () => evaluateWorkforceScenario(data, { team, mode }),
    [data, mode, team]
  );
  const attendance = useMemo(
    () => getAttendanceForTeam(data.people, team, mode),
    [data.people, mode, team]
  );
  const stationNameById = useMemo(
    () => new Map(data.stations.map((station) => [station.id, station.name])),
    [data.stations]
  );
  const shortageRows = result.rows.filter((row) => row.shortage > 0);
  const attentionRows = shortageRows.length
    ? shortageRows
    : result.rows.filter((row) => row.bottleneck).slice(0, 6);

  return (
    <section className="workforce-workbench" aria-label="今日人力概況">
      <div className="workforce-context-bar">
        <div>
          <span className="workforce-eyebrow">今日人力概況</span>
          <strong>{team}・{mode}</strong>
        </div>
        <div className="workforce-context-controls">
          <label>
            <span>班別</span>
            <select value={team} onChange={(event) => setTeam(event.target.value as TeamName)}>
              {visibleTeams.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>日別</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ShiftMode)}>
              {DAY_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="workforce-metric-strip" aria-label="人力摘要">
        <div><span>總出勤</span><strong>{loading ? "..." : attendance.totalCount}</strong></div>
        <div><span>站點需求</span><strong>{loading ? "..." : result.analysis.required}</strong></div>
        <div><span>作業覆蓋</span><strong>{loading ? "..." : result.analysis.assigned}</strong></div>
        <div className={result.analysis.shortage > 0 ? "is-danger" : "is-success"}>
          <span>全站缺口</span><strong>{loading ? "..." : result.analysis.shortage}</strong>
        </div>
        <div><span>尚未安排</span><strong>{loading ? "..." : result.unassignedIds.length}</strong></div>
        <div><span>瓶頸站點</span><strong>{loading ? "..." : result.rows.filter((row) => row.bottleneck).length}</strong></div>
      </div>

      <div className="workforce-action-row" aria-label="常用操作">
        <button type="button" className="primary" onClick={() => onNavigate("gap-analysis")}>開啟覆蓋分析</button>
        <button type="button" className="ghost" onClick={() => onNavigate("manual-schedule")}>進入班表試排</button>
        <button type="button" className="ghost" onClick={() => onNavigate("person-query")}>查詢人員資格</button>
      </div>

      <section className="workforce-attention-section">
        <div className="workforce-section-heading">
          <div>
            <h3>{shortageRows.length ? "目前站點缺口" : "資格配置瓶頸"}</h3>
            <p>基礎作業人力排除領班、組長與主任；站長依資格正常計入。</p>
          </div>
          <span className={result.analysis.shortage > 0 ? "workforce-status danger" : "workforce-status success"}>
            {result.analysis.shortage > 0 ? `仍缺 ${result.analysis.shortage} 人` : "最低需求已覆蓋"}
          </span>
        </div>

        {attentionRows.length ? (
          <div className="workforce-table-wrap">
            <table className="workforce-table">
              <thead>
                <tr><th>站點</th><th>需求</th><th>已指派</th><th>合格候選</th><th>缺口</th><th>狀態</th></tr>
              </thead>
              <tbody>
                {attentionRows.map((row) => (
                  <tr key={row.stationId} className={row.shortage > 0 ? "has-shortage" : "is-bottleneck"}>
                    <td><strong>{stationNameById.get(row.stationId) || row.stationId}</strong></td>
                    <td>{row.required}</td>
                    <td>{row.assignedIds.length}</td>
                    <td>{row.candidateCount}</td>
                    <td>{row.shortage}</td>
                    <td>{row.shortage > 0 ? "缺口" : "瓶頸"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="workforce-empty">目前沒有設定最低需求的站點，請先確認站點規則。</p>
        )}
      </section>
    </section>
  );
}
