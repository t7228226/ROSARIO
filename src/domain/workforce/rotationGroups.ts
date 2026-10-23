import { auditScheduleSafety, type ScheduleSafetyInput, type ScheduleSafetyResult } from "./scheduleSafety";

export type AlternatingRotationGroups<T> = {
  groupA: T[];
  groupB: T[];
};

export function splitAlternatingRotationGroups<T>(
  items: readonly T[],
  startingGroup: "A" | "B" = "A",
): AlternatingRotationGroups<T> {
  return items.reduce<AlternatingRotationGroups<T>>(
    (groups, item, index) => {
      const goesToA = startingGroup === "A" ? index % 2 === 0 : index % 2 !== 0;
      if (goesToA) groups.groupA.push(item);
      else groups.groupB.push(item);
      return groups;
    },
    { groupA: [], groupB: [] },
  );
}

export function splitBalancedRotationRows<T>(rows: readonly (readonly T[])[]): AlternatingRotationGroups<T>[] {
  let groupACount = 0;
  let groupBCount = 0;

  return rows.map((items) => {
    const groups = splitAlternatingRotationGroups(items, groupACount <= groupBCount ? "A" : "B");
    groupACount += groups.groupA.length;
    groupBCount += groups.groupB.length;
    return groups;
  });
}

export interface RotationCoverageInput extends ScheduleSafetyInput {
  rows?: Array<{ stationId: string; people: Array<{ employeeId: string }> }>;
}

export interface RotationCoverageResult {
  rows: Array<{ stationId: string; groupA: string[]; groupB: string[] }>;
  groupA: ScheduleSafetyResult;
  groupB: ScheduleSafetyResult;
  requiredPerGroup: number;
  totalShortage: number;
  canRotate: boolean;
  blockingIssues: string[];
}

export function auditRotationCoverage(input: RotationCoverageInput): RotationCoverageResult {
  const officerStations = input.officerStations || {};
  const extras = input.extraWorks || [];
  const extraIds = new Set(extras.map((work) => work.id));
  const ruleIds = new Set(input.rules.map((rule) => rule.stationId));
  const stationOrder = [
    ...input.rules.map((rule) => rule.stationId),
    ...Object.keys(input.assignments).filter((id) => !ruleIds.has(id)),
    ...Object.values(officerStations).filter((id) => id && !ruleIds.has(id) && !(id in input.assignments)),
  ];
  const expectedRows = [...new Set(stationOrder)].map((stationId) => ({
    stationId,
    people: [...new Set([
      ...(input.assignments[stationId] || []),
      ...Object.entries(officerStations).filter(([, id]) => id === stationId).map(([employeeId]) => employeeId),
    ])],
  })).concat(extras.map((work) => ({ stationId: work.id, people: [...new Set(work.personIds)] })));
  const sourceRows = input.rows
    ? input.rows.map((row) => ({ stationId: row.stationId, people: row.people.map((person) => person.employeeId) }))
    : expectedRows;
  const groups = splitBalancedRotationRows(sourceRows.map((row) => row.people));
  const rows = sourceRows.map((row, index) => ({ stationId: row.stationId, ...groups[index] }));
  const reliefRules = input.rules.map((rule) => ({ ...rule, minRequired: Math.max(0, Number(rule.reliefMinPerBatch || 0)) }));
  const attendanceIds = input.attendanceIds === undefined ? undefined : new Set(input.attendanceIds);

  function auditGroup(group: "groupA" | "groupB") {
    const assignments: Record<string, string[]> = {};
    const groupOfficers: Record<string, string> = {};
    const ids = rows.flatMap((row) => row[group]);
    rows.filter((row) => !extraIds.has(row.stationId)).forEach((row) => {
      row[group].forEach((employeeId) => {
        if (officerStations[employeeId] === row.stationId) groupOfficers[employeeId] = row.stationId;
        else assignments[row.stationId] = [...(assignments[row.stationId] || []), employeeId];
      });
    });
    return auditScheduleSafety({
      ...input,
      rules: reliefRules,
      assignments,
      officerStations: groupOfficers,
      attendanceIds: attendanceIds === undefined ? undefined : ids.filter((id) => attendanceIds.has(id)),
      reservedDutyIds: [],
      extraWorks: extras.map((work) => ({
        ...work, personIds: rows.filter((row) => row.stationId === work.id).flatMap((row) => row[group]),
      })),
    });
  }

  const groupA = auditGroup("groupA");
  const groupB = auditGroup("groupB");
  const overall = auditScheduleSafety({ ...input, rules: input.rules.map((rule) => ({ ...rule, minRequired: 0 })) });
  const blockingIssues = [
    ...overall.blockingIssues,
    ...groupA.blockingIssues.map((issue) => `A 組：${issue}`),
    ...groupB.blockingIssues.map((issue) => `B 組：${issue}`),
  ];
  if (!overall.qualificationVerified) blockingIssues.push("缺少正式資格資料，無法證明輪休覆蓋");
  if (!overall.attendanceVerified) blockingIssues.push("缺少出勤名單，無法證明輪休覆蓋");
  const missingRelief = input.rules.filter((rule) => rule.reliefMinPerBatch == null || !Number.isFinite(Number(rule.reliefMinPerBatch)) || Number(rule.reliefMinPerBatch) < 0);
  if (missingRelief.length) blockingIssues.push(`${missingRelief.length} 個站點尚未設定有效輪休需求`);
  const inventory = (items: typeof sourceRows) => JSON.stringify(items
    .map((row) => [row.stationId, [...row.people].sort()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  if (inventory(sourceRows) !== inventory(expectedRows)) blockingIssues.push("預覽人員與原指派資料不一致，無法證明輪休覆蓋");

  return {
    rows, groupA, groupB,
    requiredPerGroup: groupA.requiredStationSlots,
    totalShortage: groupA.totalShortage + groupB.totalShortage,
    canRotate: blockingIssues.length === 0,
    blockingIssues,
  };
}
