import {
  getOwnAttendanceLabel,
  getOwnGroupDutyDisplay,
  getTeamOfPerson,
  qualificationBadge,
} from "../lib/selectors";
import type { Person, Qualification, QualificationStatus } from "../types";

export function Info({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div className={compact ? "info-item compact" : "info-item"}><span>{label}</span><strong>{value || "-"}</strong></div>;
}

export function PersonDetailView({ person, qualifications, compact = false }: { person: Person; qualifications: Qualification[]; compact?: boolean }) {
  const duty = getOwnGroupDutyDisplay(person);
  if (compact) {
    return (
      <>
        <div className="compact-info-grid five-up">
          <Info compact label="工號" value={person.id} />
          <Info compact label="姓名" value={person.name} />
          <Info compact label="職務" value={person.role} />
          <Info compact label="班別" value={String(getTeamOfPerson(person))} />
          <Info compact label="國籍" value={person.nationality} />
        </div>
        <div className="compact-info-grid five-up">
          <Info compact label="第一天" value={duty.firstDay} />
          <Info compact label="第二天" value={duty.secondDay} />
          <Info compact label="資格數" value={String(qualifications.length)} />
          <Info compact label="在職狀態" value={person.employmentStatus} />
          <Info compact label="備註" value={person.note || "-"} />
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
        <Info label="國籍" value={person.nationality} />
        <Info label="第一天" value={duty.firstDay} />
        <Info label="第二天" value={duty.secondDay} />
        <Info label="在職狀態" value={person.employmentStatus} />
        <Info label="備註" value={person.note || "-"} />
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
  compact = false,
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
  };
  qualifications: Qualification[];
  people: Person[];
  compact?: boolean;
}) {
  const ownLabel = getOwnAttendanceLabel(day as "當班" | "第一天" | "第二天");
  const supportTeamLabel = day === "當班" || attendance.support.length === 0 ? "-" : attendance.supportTeam || "-";

  if (compact) {
    return (
      <>
        <div className="compact-info-grid five-up">
          <Info compact label="站點代碼" value={station.id} />
          <Info compact label="站點名稱" value={station.name} />
          <Info compact label="班別" value={team} />
          <Info compact label="日別" value={day} />
          <Info compact label="總出勤" value={String(attendance.totalCount)} />
        </div>
        <div className="compact-info-grid five-up">
          <Info compact label="本籍出勤" value={String(attendance.localCount)} />
          <Info compact label="菲籍出勤" value={String(attendance.filipinoCount)} />
          <Info compact label="越籍出勤" value={String(attendance.vietnamCount)} />
          <Info compact label={ownLabel} value={String(attendance.own.length)} />
          <Info compact label="支援人力" value={String(attendance.support.length)} />
        </div>
        <div className="compact-info-grid five-up">
          <Info compact label="支援對班" value={supportTeamLabel} />
          <Info compact label="本班名單" value={String(attendance.own.length)} />
          <Info compact label="支援名單" value={String(attendance.support.length)} />
          <Info compact label="候選總數" value={String(qualifications.length)} />
          <Info compact label="來源口徑" value="本班 / 支援" />
        </div>
        <table className="table compact-table">
          <thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>來源</th><th>資格</th></tr></thead>
          <tbody>
            {qualifications.map((item) => {
              const person = people.find((p) => p.id === item.employeeId);
              return (
                <tr key={`${item.employeeId}-${item.stationId}`}>
                  <td>{item.employeeId}</td>
                  <td>{person?.name || item.employeeName || "-"}</td>
                  <td>{person ? String(getTeamOfPerson(person)) : "-"}</td>
                  <td>{attendance.own.some((p) => p.id === item.employeeId) ? "本班" : "支援"}</td>
                  <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }

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
        <Info label={ownLabel} value={String(attendance.own.length)} />
        <Info label="支援人力" value={String(attendance.support.length)} />
        <Info label="支援對班" value={supportTeamLabel} />
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
                <td>{attendance.own.some((p) => p.id === item.employeeId) ? "本班" : "支援"}</td>
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
  const duty = getOwnGroupDutyDisplay(person);
  return (
    <>
      <div className={compact ? "compact-info-grid five-up" : "detail-grid"}>
        <Info compact={compact} label="工號" value={person.id} />
        <Info compact={compact} label="姓名" value={person.name} />
        <Info compact={compact} label="班別" value={String(getTeamOfPerson(person))} />
        <Info compact={compact} label="職務" value={person.role} />
        <Info compact={compact} label="系統權限" value={permission} />
      </div>
      <div className={compact ? "compact-info-grid five-up" : "detail-grid"}>
        <Info compact={compact} label="第一天" value={duty.firstDay} />
        <Info compact={compact} label="第二天" value={duty.secondDay} />
        <Info compact={compact} label="資格數" value={String(qualifications.length)} />
        <Info compact={compact} label="在職狀態" value={person.employmentStatus} />
        <Info compact={compact} label="備註" value={person.note || "-"} />
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
