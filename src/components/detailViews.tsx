import {
  getPersonDutyDisplay,
  getTeamOfPerson,
  qualificationBadge,
} from "../lib/selectors";
import type { Person, Qualification, QualificationStatus } from "../types";

export function Info({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div className={compact ? "info-item compact" : "info-item"}><span>{label}</span><strong>{value || "-"}</strong></div>;
}

export function PersonDetailView({ person, qualifications, compact = false }: { person: Person; qualifications: Qualification[]; compact?: boolean }) {
  const duty = getPersonDutyDisplay(person);
  if (compact) {
    return (
      <>
        <div className="section-title">人員資訊</div>
        <div className="compact-info-grid four-up">
          <Info compact label="工號" value={person.id} />
          <Info compact label="姓名" value={person.name} />
          <Info compact label="職務" value={person.role} />
          <Info compact label="班別" value={String(getTeamOfPerson(person))} />
        </div>
        <div className="section-title">出勤資訊</div>
        <div className="compact-info-grid five-up">
          <Info compact label="國籍" value={person.nationality} />
          <Info compact label="(A)第一天" value={duty.aDay1} />
          <Info compact label="(A)第二天" value={duty.aDay2} />
          <Info compact label="(B)第一天" value={duty.bDay1} />
          <Info compact label="(B)第二天" value={duty.bDay2} />
        </div>
        <table className="table compact-table">
          <thead><tr><th>站點</th><th>狀態</th></tr></thead>
          <tbody>
            {qualifications.map((item) => (
              <tr key={`${item.employeeId}-${item.stationId}`}>
                <td>{item.stationId}</td>
                <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <>
      <div className="detail-grid">
        <Info label="工號" value={person.id} />
        <Info label="姓名" value={person.name} />
        <Info label="職務" value={person.role} />
        <Info label="班別" value={String(getTeamOfPerson(person))} />
        <Info label="(A)第一天" value={duty.aDay1} />
        <Info label="(A)第二天" value={duty.aDay2} />
        <Info label="國籍" value={person.nationality} />
        <Info label="(B)第一天" value={duty.bDay1} />
        <Info label="(B)第二天" value={duty.bDay2} />
      </div>
      <table className="table">
        <thead><tr><th>站點</th><th>狀態</th></tr></thead>
        <tbody>
          {qualifications.map((item) => (
            <tr key={`${item.employeeId}-${item.stationId}`}>
              <td>{item.stationId}</td>
              <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function StationDetailView({
  station,
  team,
  day,
  attendance,
  qualifications,
  people,
}: {
  station: { id: string; name: string };
  team: string;
  day: string;
  attendance: {
    localCount: number;
    filipinoCount: number;
    vietnamCount: number;
    totalCount: number;
    own: Person[];
    support: Person[];
    supportTeam?: string;
    supportDuty?: string;
  };
  qualifications: Qualification[];
  people: Person[];
}) {
  return (
    <>
      <div className="detail-grid">
        <Info label="站點代碼" value={station.id} />
        <Info label="站點名稱" value={station.name} />
        <Info label="班別" value={team} />
        <Info label="日別" value={day} />
        <Info label="本籍出勤" value={String(attendance.localCount)} />
        <Info label="菲籍出勤" value={String(attendance.filipinoCount)} />
        <Info label="越籍出勤" value={String(attendance.vietnamCount)} />
        <Info label="總出勤" value={String(attendance.totalCount)} />
        <Info label="當班人力" value={String(attendance.own.length)} />
        <Info label="支援人力" value={String(attendance.support.length)} />
        <Info label="支援對班" value={day === "當班" ? "-" : attendance.supportTeam || "-"} />
        <Info label="支援代號" value={day === "當班" ? "-" : attendance.supportDuty || "-"} />
      </div>
      <table className="table">
        <thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>來源</th><th>資格</th></tr></thead>
        <tbody>
          {qualifications.map((item) => {
            const person = people.find((p) => p.id === item.employeeId);
            return (
              <tr key={`${item.employeeId}-${item.stationId}`}>
                <td>{item.employeeId}</td>
                <td>{person?.name || item.employeeName || "-"}</td>
                <td>{person ? String(getTeamOfPerson(person)) : "-"}</td>
                <td>{attendance.own.some((p) => p.id === item.employeeId) ? "當班" : "支援"}</td>
                <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function ReviewDetailView({
  person,
  permission,
  qualifications,
  stationId,
  reviewStatus,
  setStationId,
  setReviewStatus,
  stations,
  onSave,
  onDelete,
  compact = false,
}: {
  person: Person;
  permission: string;
  qualifications: Qualification[];
  stationId: string;
  reviewStatus: QualificationStatus;
  setStationId: (value: string) => void;
  setReviewStatus: (value: QualificationStatus) => void;
  stations: Array<{ id: string; name: string }>;
  onSave: () => void;
  onDelete: (employeeId: string, stationId: string) => void;
  compact?: boolean;
}) {
  const duty = getPersonDutyDisplay(person);
  return (
    <>
      <div className={compact ? "compact-info-grid five-up" : "detail-grid"}>
        <Info compact={compact} label="工號" value={person.id} />
        <Info compact={compact} label="姓名" value={person.name} />
        <Info compact={compact} label="班別" value={String(getTeamOfPerson(person))} />
        <Info compact={compact} label="職務" value={person.role} />
        <Info compact={compact} label="系統權限" value={permission} />
      </div>
      <div className={compact ? "compact-info-grid four-up" : "detail-grid"}>
        <Info compact={compact} label="(A)第一天" value={duty.aDay1} />
        <Info compact={compact} label="(A)第二天" value={duty.aDay2} />
        <Info compact={compact} label="(B)第一天" value={duty.bDay1} />
        <Info compact={compact} label="(B)第二天" value={duty.bDay2} />
      </div>
      <div className="form-grid compact-form">
        <div>
          <label className="field-label">站點</label>
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">請選擇站點</option>
            {stations.map((station) => <option key={station.id} value={station.id}>{station.id}｜{station.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">狀態</label>
          <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as QualificationStatus)}>
            {(["合格", "訓練中", "不可排", ""] as QualificationStatus[]).map((item) => (
              <option key={item || "blank"} value={item}>{item || "空白"}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="toolbar"><button className="primary" type="button" onClick={onSave}>確認並儲存</button></div>
      <table className={compact ? "table compact-table" : "table"}>
        <thead><tr><th>站點</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>
          {qualifications.map((item) => (
            <tr key={`${item.employeeId}-${item.stationId}`}>
              <td>{item.stationId}</td>
              <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
              <td><button className="danger" type="button" onClick={() => onDelete(item.employeeId, item.stationId)}>刪除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
