import AppDialog from "../../components/ui/AppDialog";

export type CoverageAssignmentKind = "own" | "support" | "officer";

export interface CoverageConfigurationRow {
  stationId: string;
  stationName: string;
  required: number;
  assigned: Array<{ id: string; name: string; kind: CoverageAssignmentKind }>;
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
}

function AssignmentNames({ row }: { row: CoverageConfigurationRow }) {
  if (!row.assigned.length) return <span>-</span>;
  return (
    <span className="assigned-name-tags">
      {row.assigned.map((person) => (
        <span
          key={person.id}
          className={person.kind === "officer" ? "officer-support-name" : person.kind === "support" ? "support-assignment-name" : ""}
        >
          {person.name}
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
}: CoverageConfigurationOverviewProps) {
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
        <div><dt>瓶頸站點</dt><dd>{bottleneckRows.length}</dd></div>
        <div className={totalShortage ? "is-danger" : "is-success"}><dt>合計缺口</dt><dd>{totalShortage}</dd></div>
      </dl>

      {attentionRows.length ? (
        <div className="coverage-attention-list" aria-label="目前需要關注的站點">
          <div className="coverage-attention-header"><strong>需關注站點</strong><span>僅顯示缺口、瓶頸或模擬變動</span></div>
          {attentionRows.map((row) => (
            <div className={`coverage-attention-row ${row.shortage ? "has-shortage" : "is-bottleneck"}`} key={row.stationId}>
              <div><strong>{row.stationName}</strong><span>需求 {row.required}｜總合格 {row.totalQualified}</span></div>
              <div className="coverage-attention-status"><strong>{row.shortage ? `缺 ${row.shortage}` : row.status}</strong><span>{row.assigned.length}/{row.required}</span></div>
            </div>
          ))}
        </div>
      ) : (
        <p className="coverage-overview-safe">目前沒有缺口或瓶頸；完整人員來源可在詳細資料中核對。</p>
      )}

      <button type="button" className="ghost coverage-details-trigger" onClick={onOpenDetails}>查看全部站點詳細資料</button>

      <AppDialog
        open={detailsOpen}
        title={`${title}：全部站點`}
        description="詳細資料分開呈現本班、支援及訓練人力；此視窗不會改變任何模擬條件。"
        onClose={onCloseDetails}
        size="wide"
        footer={<button type="button" className="primary" onClick={onCloseDetails}>完成核對</button>}
      >
        <div className="coverage-detail-legend" aria-label="人員來源說明">
          <span>一般文字：本班</span><span className="support-assignment-name">藍色：支援</span><span className="officer-support-name">綠色：幹部支援</span>
        </div>
        <div className="table-wrap coverage-detail-table-wrap">
          <table className="table coverage-detail-table">
            <thead>
              <tr>
                <th>站點</th><th>需求</th><th>{assignmentLabel}</th><th>{shortageLabel}</th><th>本班合格</th><th>支援合格</th><th>總合格</th><th>訓練中</th><th>狀態</th><th>支援合格人員</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stationId} className={row.shortage ? "danger-row" : row.status === "瓶頸" || row.changedBySimulation ? "warning-row" : ""}>
                  <td><strong>{row.stationName}</strong></td>
                  <td>{row.required}</td>
                  <td><AssignmentNames row={row} /></td>
                  <td>{row.shortage}</td>
                  <td>{row.ownQualified}</td>
                  <td>{row.supportQualified}</td>
                  <td>{row.totalQualified}</td>
                  <td>{row.training}</td>
                  <td>{row.status}</td>
                  <td>{row.supportQualifiedNames.join("、") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppDialog>
    </section>
  );
}
