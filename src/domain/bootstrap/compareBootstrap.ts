import type { AppBootstrap } from "../../types";

export interface SnapshotChange { record: string; field: string; before: string; after: string }
export function compareBootstrap(before: AppBootstrap, after: AppBootstrap): SnapshotChange[] {
  const result: SnapshotChange[] = [];
  const fields = { name: "姓名", shift: "班別", role: "職務", employmentStatus: "在職狀態", nationality: "國籍", note: "備註", aDay1: "A 第一天", aDay2: "A 第二天", bDay1: "B 第一天", bDay2: "B 第二天" } as const;
  const oldPeople = new Map(before.people.map((person) => [person.id, person]));
  const newPeople = new Map(after.people.map((person) => [person.id, person]));
  for (const id of new Set([...oldPeople.keys(), ...newPeople.keys()])) {
    const previous = oldPeople.get(id), current = newPeople.get(id);
    if (!previous || !current) result.push({ record: id, field: "人員", before: previous?.name || "無資料", after: current?.name || "無資料" });
    else for (const [key, label] of Object.entries(fields)) {
      const field = key as keyof typeof fields;
      if (String(previous[field] || "") !== String(current[field] || "")) result.push({ record: `${id} ${current.name}`, field: label, before: String(previous[field] || "-"), after: String(current[field] || "-") });
    }
  }
  function compareRecords(oldRows: Map<string, string>, newRows: Map<string, string>, field: string) {
    for (const record of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const previous = oldRows.get(record) || "無資料", current = newRows.get(record) || "無資料";
      if (previous !== current) result.push({ record, field, before: previous, after: current });
    }
  }
  const qualifications = (data: AppBootstrap) => {
    const groups = new Map<string, string[]>();
    for (const row of data.qualifications) { const id = `${row.employeeId} / ${row.stationId}`; groups.set(id, [...(groups.get(id) || []), row.status || "空白"]); }
    return new Map([...groups].map(([id, statuses]) => [id, statuses.sort().join("、")]));
  };
  compareRecords(qualifications(before), qualifications(after), "站點資格");
  const rules = (data: AppBootstrap) => new Map((data.stationRules || []).map((row) => [
    `${row.team} / ${row.stationId} / ${row.dayKey || "當班"}`,
    `正班 ${row.minRequired}；輪休 ${row.reliefMinPerBatch ?? "未設定"}；上限 ${row.maxAssignable ?? 0}；訓練補位 ${row.trainingCanFill === true ? "是" : "否"}；${row.enabled === false ? "停用" : "啟用"}`,
  ]));
  compareRecords(rules(before), rules(after), "站點規則");
  return result;
}
