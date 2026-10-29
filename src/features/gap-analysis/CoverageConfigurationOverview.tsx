import AppDialog from "../../components/ui/AppDialog";
import { useEffect, useRef } from "react";
import type { ScenarioAssignmentSource } from "../../domain/workforce/types";

export type CoverageAssignmentKind = "own" | "support" | "officer" | "training";

export interface CoverageConfigurationRow {
  stationId: string;
  stationName: string;
  required: number;
  assigned: Array<{ id: string; name: string; kind: CoverageAssignmentKind; locked?: boolean }>;
  candidates: Array<{ id: string; name: string; kind: CoverageAssignmentKind; source: ScenarioAssignmentSource; currentStation?: string }>;
  shortage: number;
  ownQualified: number;
  supportQualified: number;
  totalQualified: number;
  training: number;
  status: "缺口" | "瓶頸" | "穩定";
  supportQualifiedNames: string[];
  changedBySimulation: boolean;
}

interface CoverageConfigurationOverviewProps {
  title: string;
  contextLabel: string;
  description: string;
  assignmentLabel: string;
  shortageLabel: string;
  rows: CoverageConfigurationRow[];
  detailsOpen: boolean;
  onOpenDetails: () => void;
  onCloseDetails: () => void;
  baselineShortage: number;
  editCount: number;
  error: string;
  canUndo: boolean;
  onAssign: (employeeId: string, stationId: string, source: ScenarioAssignmentSource) => void;
  onRelease: (employeeId: string) => void;
  onUndo: () => void;
  onReset: () => void;
  changes: Array<{ name: string; from: string; to: string }>;
}

function AssignmentNames({ row }: { row: CoverageConfigurationRow }) {
  if (!row.assigned.length) return <span>-</span>;
  return (
    <span className="assigned-name-tags">
      {row.assigned.map((person) => (
        <span
          key={person.id}
          className={person.kind === "officer" ? "officer-support-name" : person.kind === "training" ? "training-assumption-name" : person.kind === "support" ? "support-assignment-name" : ""}
        >
          {person.name}
          {person.kind === "training" ? "（補訓假設）" : ""}
        </span>
      ))}
    </span>
  );
}

export default function CoverageConfigurationOverview({
  title,
  contextLabel,
  description,
  assignmentLabel,
  shortageLabel,
  rows,
  detailsOpen,
  onOpenDetails,
  onCloseDetails,
  baselineShortage, editCount, error, canUndo, onAssign, onRelease, onUndo, onReset, changes,
}: CoverageConfigurationOverviewProps) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const shortageRows = rows.filter((row) => row.shortage > 0);
  const bottleneckRows = rows.filter((row) => row.status === "瓶頸");
  const attentionRows = rows.filter((row) => row.shortage > 0 || row.status === "瓶頸" || row.changedBySimulation);
  const totalShortage = shortageRows.reduce((sum, row) => sum + row.shortage, 0);

  return (
    <section className="panel coverage-configuration-overview">
      <div className="panel-header coverage-overview-heading">
        <div>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        <span className={totalShortage ? "status-pill danger" : "status-pill success"}>{contextLabel}</span>
      </div>

      <dl className="coverage-overview-metrics" aria-label="全站配置摘要">
        <div><dt>分析站點</dt><dd>{rows.length}</dd></div>
        <div><dt>完整覆蓋</dt><dd>{rows.length - shortageRows.length}</dd></div>
        <div><dt>低備援站</dt><dd>{bottleneckRows.length}</dd></div>
        <div className={totalShortage ? "is-danger" : "is-success"}><dt>合計缺口</dt><dd>{totalShortage}</dd></div>
      </dl>

      {attentionRows.length ? (
        <div className="coverage-attention-list" aria-label="目前需要關注的站點">
          <div className="coverage-attention-header"><strong>需關注站點</strong><span>僅顯示缺口、瓶頸或模擬變動</span></div>
          {attentionRows.slice().sort((a, b) => b.shortage - a.shortage).slice(0, 4).map((row) => (
            <div className={`coverage-attention-row ${row.shortage ? "has-shortage" : "is-bottleneck"}`} key={row.stationId}>
              <div><strong>{row.stationName}</strong><span>需求 {row.required}｜總合格 {row.totalQualified}</span></div>
              <div className="coverage-attention-status"><strong>{row.shortage ? `缺 ${row.shortage}` : row.status}</strong><span>{row.assigned.length}/{row.required}</span></div>
            </div>
          ))}
        </div>
      ) : (
        <p className="coverage-overview-safe">目前沒有缺口或瓶頸；完整人員來源可在詳細資料中核對。</p>
      )}

      <button type="button" className="ghost coverage-details-trigger" onClick={onOpenDetails}>查看全部 {rows.length} 站詳細資料{attentionRows.length > 4 ? `（另有 ${attentionRows.length - 4} 站需關注）` : ""}</button>

      <AppDialog
        open={detailsOpen}
        title={`${title}：全部站點`}
        description="配置模擬不會寫入正式資格或班表。"
        onClose={onCloseDetails}
        size="wide"
        footer={<button type="button" className="primary" onClick={onCloseDetails}>完成核對</button>}
      >
        <div className="coverage-detail-legend" aria-label="人員來源說明">
          <span>一般文字：本班</span><span className="support-assignment-name">藍色：支援</span><span className="officer-support-name">綠色：站長／幹部支援</span><span className="training-assumption-name">黃色：假設補訓完成</span>
        </div>
        <div className="configuration-comparison" aria-label="配置比較" aria-live="polite">
          <div><span>系統原始最佳缺口</span><strong>{baselineShortage}</strong></div>
          <div><span>{editCount ? "固定人選後最佳缺口" : "目前最佳缺口"}</span><strong className={totalShortage ? "departure-shortage" : ""}>{totalShortage}</strong></div>
          <div><span>自訂固定</span><strong>{editCount} 人</strong></div>
        </div>
        <div className="configuration-actions">
          <button type="button" className="ghost" onClick={onUndo} disabled={!canUndo}>復原上一步</button>
          <button type="button" className="ghost" onClick={onReset} disabled={!editCount}>還原系統配置</button>
        </div>
        {error ? <p ref={errorRef} role="alert" tabIndex={-1} className="departure-shortage configuration-impact">{error}</p> : null}
        {editCount ? <div className="configuration-impact" role="status">
          <strong>{totalShortage > baselineShortage ? `固定條件新增 ${totalShortage - baselineShortage} 個缺口` : totalShortage < baselineShortage ? `固定條件減少 ${baselineShortage - totalShortage} 個缺口` : "固定條件未增加全站缺口"}</strong>
          {changes.length ? <details><summary>人員調動 {changes.length} 人</summary><ul>{changes.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}：{item.from} → {item.to}</li>)}</ul></details> : null}
        </div> : null}
        <div className="configuration-station-list">
          {rows.map((row) => <details className={`coverage-mobile-item configuration-station ${row.shortage ? "has-shortage" : ""}`} key={row.stationId}>
            <summary>
              <span className="configuration-station-title"><strong>{row.stationName}</strong><span>需求 {row.required} · 合格 {row.totalQualified}</span></span>
              <span className="configuration-assignment" aria-label={assignmentLabel}><AssignmentNames row={row} /></span>
              <span className={`configuration-station-status${row.shortage ? " departure-shortage" : ""}`}>{row.shortage ? `缺 ${row.shortage} 人` : row.status}</span>
              <span className="coverage-disclosure-arrow" aria-hidden="true">▾</span>
            </summary>
            <div className="configuration-station-body">
            <dl className="coverage-mobile-counts"><div><dt>本班合格</dt><dd>{row.ownQualified}</dd></div><div><dt>支援合格</dt><dd>{row.supportQualified}</dd></div><div><dt>訓練中</dt><dd>{row.training}</dd></div></dl>
            {row.assigned.some((person) => person.locked) ? <div className="configuration-locks">{row.assigned.filter((person) => person.locked).map((person) => <button type="button" key={person.id} className="ghost" onClick={() => onRelease(person.id)}>解除固定：{person.name}</button>)}</div> : null}
            <h4>可調整人選 · {row.candidates.length} 人</h4>
            <div className="configuration-candidates">
              {row.candidates.map((person) => {
                const fixed = row.assigned.some((item) => item.id === person.id && item.locked);
                const currentName = rows.find((item) => item.stationId === person.currentStation)?.stationName;
                return <button type="button" key={person.id} className={`configuration-candidate kind-${person.kind}${fixed ? " is-fixed" : ""}`}
                  disabled={fixed} aria-label={`固定 ${person.name} 至 ${row.stationName}`}
                  onClick={() => onAssign(person.id, row.stationId, person.source)}>
                  <strong>{person.name}</strong><small>{fixed ? "已固定" : currentName ? `目前：${currentName}` : person.source === "officer" ? "可緊急支援" : "尚未配置"}</small>
                </button>;
              })}
              {!row.candidates.length ? <p>目前沒有符合條件的人選。</p> : null}
            </div>
            </div>
          </details>)}
        </div>
      </AppDialog>
    </section>
  );
}
