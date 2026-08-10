import { splitBalancedRotationRows } from "../../domain/workforce/rotationGroups";

export type ScheduleMatrixPerson = {
  name: string;
  isOfficer?: boolean;
  isTraining?: boolean;
};

export type ScheduleMatrixRow = {
  stationId: string;
  stationName: string;
  people: ScheduleMatrixPerson[];
  required?: number;
};

type ABScheduleMatrixProps = {
  team: string;
  day: string;
  mode: string;
  officers: {
    主任: string[];
    組長: string[];
    領班: string[];
  };
  rows: ScheduleMatrixRow[];
  attendanceCount: number;
  requiredCount: number;
  assignedCount: number;
  shortageCount: number;
  reserveCount: number;
  absentPeople?: ScheduleMatrixPerson[];
};

function splitStationLabel(stationName: string) {
  const text = String(stationName || "").trim();
  const match = text.match(/^(.*?)[（(]([^（）()]+)[）)]$/);
  if (!match) return { name: text || "未命名站點", code: "" };
  return { name: match[1].trim() || text, code: match[2].trim() };
}

function getStationTone(stationName: string, index: number) {
  if (/重工|返修/.test(stationName)) return "yellow";
  if (/初清|正清|背清|組框|JB/.test(stationName)) return "green";
  if (/包裝|物料|備料/.test(stationName)) return "sand";
  if (/管制|臨時勤務/.test(stationName)) return "cyan";
  return index % 3 === 1 ? "blue-soft" : "blue";
}

function OfficerValue({ role, names }: { role: string; names: string[] }) {
  return (
    <div className="schedule-ab-officer">
      <span>{role}</span>
      <strong>{names.join("、") || "-"}</strong>
    </div>
  );
}

function PersonCell({ person }: { person?: ScheduleMatrixPerson }) {
  if (!person) return <span className="schedule-ab-empty" aria-hidden="true">-</span>;
  return (
    <span className={`schedule-ab-person${person.isOfficer ? " officer" : ""}${person.isTraining ? " training" : ""}`}>
      <strong>{person.name}</strong>
      {person.isTraining ? <small>訓練</small> : null}
    </span>
  );
}

export default function ABScheduleMatrix({
  team,
  day,
  mode,
  officers,
  rows,
  attendanceCount,
  requiredCount,
  assignedCount,
  shortageCount,
  reserveCount,
  absentPeople = [],
}: ABScheduleMatrixProps) {
  const balancedGroups = splitBalancedRotationRows(rows.map((row) => row.people));
  const groupedRows = rows.map((row, index) => ({
    ...row,
    groups: balancedGroups[index],
  }));
  const groupDepth = Math.max(
    2,
    ...groupedRows.map((row) => Math.max(row.groups.groupA.length, row.groups.groupB.length)),
  );

  const renderGroupRows = (group: "A" | "B") => Array.from({ length: groupDepth }, (_, slotIndex) => (
    <tr className={`schedule-ab-person-row group-${group.toLowerCase()}`} key={`${group}-${slotIndex}`}>
      {slotIndex === 0 ? (
        <th className="schedule-ab-group-label" scope="rowgroup" rowSpan={groupDepth}>
          <strong>{group}</strong>
          <span>輪休組</span>
        </th>
      ) : null}
      {groupedRows.map((row) => {
        const people = group === "A" ? row.groups.groupA : row.groups.groupB;
        return (
          <td key={`${group}-${row.stationId}-${slotIndex}`}>
            <PersonCell person={people[slotIndex]} />
          </td>
        );
      })}
    </tr>
  ));

  return (
    <div className="schedule-ab-board">
      <div className="schedule-matrix-scroll" tabIndex={0} role="region" aria-label="A、B 輪休橫向班表，可左右滑動查看">
        <div className="schedule-ab-sheet">
          <header className="schedule-ab-summary">
            <div className="schedule-ab-team">
              <span>{day}</span>
              <strong>{team}</strong>
              <small>{mode}試排</small>
            </div>
            <div className="schedule-ab-officers">
              <OfficerValue role="主任" names={officers.主任} />
              <OfficerValue role="組長" names={officers.組長} />
              <OfficerValue role="領班" names={officers.領班} />
            </div>
            <dl className="schedule-ab-metrics">
              <div><dt>應到人數</dt><dd>{attendanceCount}</dd></div>
              <div><dt>站點需求</dt><dd>{requiredCount}</dd></div>
              <div><dt>已配置</dt><dd>{assignedCount}</dd></div>
              <div className={shortageCount > 0 ? "danger" : "success"}><dt>缺口</dt><dd>{shortageCount}</dd></div>
              <div><dt>未配置</dt><dd>{reserveCount}</dd></div>
            </dl>
          </header>

          <table className="schedule-ab-table">
            <caption>各站點 A、B 輪休分組與人員配置</caption>
            <thead>
              <tr>
                <th className="schedule-ab-corner" rowSpan={2} scope="col">
                  <span>工作站點</span>
                  <strong>A / B</strong>
                </th>
                {rows.map((row, index) => {
                  const label = splitStationLabel(row.stationName);
                  return (
                    <th className={`schedule-ab-station tone-${getStationTone(row.stationName, index)}`} key={row.stationId} scope="col">
                      <span>{label.name}</span>
                      {label.code ? <strong>{label.code}</strong> : null}
                    </th>
                  );
                })}
              </tr>
              <tr className="schedule-ab-count-row">
                {rows.map((row) => (
                  <th key={`count-${row.stationId}`} scope="col">
                    <span>需求 {Math.max(0, Number(row.required || 0))}</span>
                    <strong>已排 {row.people.length}</strong>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderGroupRows("A")}
              {renderGroupRows("B")}
            </tbody>
          </table>

          <div className="schedule-ab-absence">
            <strong>請假人員 <span>{absentPeople.length}</span></strong>
            <div>
              {absentPeople.length
                ? absentPeople.map((person) => <PersonCell person={person} key={person.name} />)
                : <span className="schedule-ab-empty">-</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="schedule-ab-legend" aria-label="橫表標示說明">
        <span><i className="normal" />一般人員</span>
        <span><i className="training" />訓練人員</span>
        <span><i className="officer" />幹部支援</span>
        <span className="schedule-ab-rule">依站點順序交錯，並平衡 A、B 組總人數</span>
      </div>
    </div>
  );
}
