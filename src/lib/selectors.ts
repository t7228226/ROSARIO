import type {
  AssignmentSource,
  AttendanceSummary,
  Person,
  Qualification,
  ShiftMode,
  SmartAssignmentRow,
  SmartScheduleMode,
  StationRule,
  TeamName,
} from "../types";

export const TEAM_OPTIONS: TeamName[] = ["婷芬班", "美香班", "俊志班", "翊展班"];
export const REVIEW_TEAM_OPTIONS = ["全部班別", ...TEAM_OPTIONS] as const;
export const DAY_OPTIONS: ShiftMode[] = ["當班", "第一天", "第二天"];
export const SMART_MODE_OPTIONS: SmartScheduleMode[] = ["當班優先", "支援優先", "資格優先"];

export const TEAM_DUTY_MAP: Record<TeamName, string> = {
  婷芬班: "日A",
  美香班: "日B",
  俊志班: "夜A",
  翊展班: "夜B",
};

export const TEAM_SUPPORT_MAP: Record<TeamName, TeamName> = {
  婷芬班: "美香班",
  美香班: "婷芬班",
  俊志班: "翊展班",
  翊展班: "俊志班",
};

const TEAM_FIELD_GROUP: Record<TeamName, "A" | "B"> = {
  婷芬班: "A",
  美香班: "B",
  俊志班: "A",
  翊展班: "B",
};

export function getTeamOfPerson(person: Person): TeamName | string {
  return String(person.shift || "").trim();
}

function getGroupOfTeam(team: TeamName): "A" | "B" {
  return TEAM_FIELD_GROUP[team];
}

function getDayValueByGroup(person: Person, group: "A" | "B", mode: Exclude<ShiftMode, "當班">): string {
  if (group === "A") {
    return mode === "第一天" ? String(person.aDay1 || "") : String(person.aDay2 || "");
  }
  return mode === "第一天" ? String(person.bDay1 || "") : String(person.bDay2 || "");
}

export function getOwnGroupDutyDisplay(person: Person) {
  const team = getTeamOfPerson(person);
  if (!TEAM_OPTIONS.includes(team as TeamName)) {
    return { firstDay: "", secondDay: "" };
  }
  const group = getGroupOfTeam(team as TeamName);
  return {
    firstDay: getDayValueByGroup(person, group, "第一天"),
    secondDay: getDayValueByGroup(person, group, "第二天"),
  };
}

export function getDutyCode(_team: TeamName, mode: ShiftMode) {
  return mode;
}

export function getOwnAttendanceLabel(mode: ShiftMode) {
  return mode === "當班" ? "本班人力" : "本班出勤";
}

function isGeneralActivePerson(person: Person) {
  return person.employmentStatus === "在職" && person.role !== "主任";
}

function isOwnShiftPerson(person: Person, selectedTeam: TeamName) {
  return getTeamOfPerson(person) === selectedTeam;
}

function isMatchingSelectedGroupDay(person: Person, selectedTeam: TeamName, mode: Exclude<ShiftMode, "當班">, expectedDuty: string) {
  const selectedGroup = getGroupOfTeam(selectedTeam);
  return getDayValueByGroup(person, selectedGroup, mode) === expectedDuty;
}

export function isPersonActiveInMode(person: Person, team: TeamName, mode: ShiftMode): boolean {
  if (!isGeneralActivePerson(person)) {
    return false;
  }
  if (mode === "當班") {
    return isOwnShiftPerson(person, team);
  }
  return isOwnShiftPerson(person, team) && isMatchingSelectedGroupDay(person, team, mode, TEAM_DUTY_MAP[team]);
}

function countByNationality(people: Person[]) {
  const localCount = people.filter((person) => /本|台/.test(person.nationality)).length;
  const filipinoCount = people.filter((person) => /菲/.test(person.nationality)).length;
  const vietnamCount = people.filter((person) => /越/.test(person.nationality)).length;
  return { localCount, filipinoCount, vietnamCount, totalCount: people.length };
}

function dedupePeople(people: Person[]) {
  const seen = new Set<string>();
  return people.filter((person) => {
    if (seen.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });
}

export function getAttendanceForTeam(people: Person[], selectedTeam: TeamName, mode: ShiftMode): AttendanceSummary {
  const supportTeam = TEAM_SUPPORT_MAP[selectedTeam];
  const ownDuty = TEAM_DUTY_MAP[selectedTeam];
  const supportDuty = TEAM_DUTY_MAP[supportTeam];
  const baseActive = people.filter(isGeneralActivePerson);

  if (mode === "當班") {
    const own = baseActive.filter((person) => isOwnShiftPerson(person, selectedTeam));
    return {
      own,
      support: [],
      all: own,
      supportTeam,
      ...countByNationality(own),
    };
  }

  const own = baseActive.filter(
    (person) => isOwnShiftPerson(person, selectedTeam) && isMatchingSelectedGroupDay(person, selectedTeam, mode, ownDuty)
  );

  const support = baseActive.filter(
    (person) => getTeamOfPerson(person) === supportTeam && isMatchingSelectedGroupDay(person, selectedTeam, mode, supportDuty)
  );

  const all = dedupePeople([...own, ...support]);

  return {
    own,
    support,
    all,
    supportTeam,
    ...countByNationality(all),
  };
}

export function getRuleDayKey(_team: TeamName, mode: ShiftMode): string {
  return mode;
}

export function getApplicableRules(team: TeamName, mode: ShiftMode, stationRules: StationRule[]): StationRule[] {
  const targetKey = getRuleDayKey(team, mode);
  const matched = stationRules.filter(
    (rule) => rule.team === team && rule.dayKey === targetKey && rule.enabled !== false
  );
  return [...matched].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

export function qualificationBadge(status: string): string {
  if (status === "合格") return "badge badge-pass";
  if (status === "訓練中") return "badge badge-training";
  if (status === "不可排") return "badge badge-blocked";
  return "badge badge-empty";
}

export function getStationCoverage(
  stationId: string,
  minimumNeed: number,
  activePeople: Person[],
  supportPeople: Person[],
  qualifications: Qualification[]
) {
  const activeIds = new Set(activePeople.map((person) => person.id));
  const supportIds = new Set(supportPeople.map((person) => person.id));
  const related = qualifications.filter((item) => item.stationId === stationId && activeIds.has(item.employeeId));
  const qualifiedIds = [...new Set(related.filter((item) => item.status === "合格").map((item) => item.employeeId))];
  const trainingIds = [...new Set(related.filter((item) => item.status === "訓練中").map((item) => item.employeeId))];
  const blockedIds = [...new Set(related.filter((item) => item.status === "不可排").map((item) => item.employeeId))];
  const supportQualifiedIds = qualifiedIds.filter((id) => supportIds.has(id));
  const ownQualifiedIds = qualifiedIds.filter((id) => !supportIds.has(id));
  const shortage = Math.max(0, minimumNeed - qualifiedIds.length);

  return {
    related,
    qualified: qualifiedIds.length,
    qualifiedIds,
    ownQualified: ownQualifiedIds.length,
    ownQualifiedIds,
    supportQualified: supportQualifiedIds.length,
    supportQualifiedIds,
    training: trainingIds.length,
    trainingIds,
    blocked: blockedIds.length,
    blockedIds,
    shortage,
  };
}

export function getQualifiedPeopleForStation(
  stationId: string,
  people: Person[],
  qualifications: Qualification[],
  allowTraining = false
) {
  const activeIds = new Set(people.map((person) => person.id));
  const allowedStatuses = allowTraining ? new Set(["合格", "訓練中"]) : new Set(["合格"]);
  const ids = qualifications
    .filter((item) => item.stationId === stationId && activeIds.has(item.employeeId) && allowedStatuses.has(item.status))
    .map((item) => item.employeeId);
  return people.filter((person) => ids.includes(person.id));
}

export function getQualificationCountMap(people: Person[], qualifications: Qualification[]) {
  const map = new Map<string, number>();
  for (const person of people) {
    map.set(
      person.id,
      qualifications.filter((item) => item.employeeId === person.id && item.status === "合格").length
    );
  }
  return map;
}

export function searchText(values: Array<string | undefined | null>, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(normalized));
}

function compareScore(a: Array<number | string>, b: Array<number | string>) {
  const maxLength = Math.max(a.length, b.length);
  for (let i = 0; i < maxLength; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left ?? "").localeCompare(String(right ?? ""), "zh-Hant", { numeric: true });
  }
  return 0;
}

export function buildSmartAssignments(
  team: TeamName,
  mode: ShiftMode,
  stationRules: StationRule[],
  people: Person[],
  qualifications: Qualification[],
  strategy: SmartScheduleMode = "當班優先"
): SmartAssignmentRow[] {
  const attendance = getAttendanceForTeam(people, team, mode);
  const rules = getApplicableRules(team, mode, stationRules);
  const activePeople = attendance.all;
  const ownIds = new Set(attendance.own.map((person) => person.id));
  const supportIds = new Set(attendance.support.map((person) => person.id));
  const flexMap = getQualificationCountMap(activePeople, qualifications);
  const used = new Set<string>();

  function score(person: Person) {
    const flex = flexMap.get(person.id) || 0;
    const isOwn = ownIds.has(person.id) ? 1 : 0;
    const isSupport = supportIds.has(person.id) ? 1 : 0;

    if (strategy === "當班優先") {
      return [isOwn * -1, flex, person.name];
    }
    if (strategy === "支援優先") {
      return [isSupport * -1, flex, person.name];
    }
    return [flex, isSupport * -1, isOwn * -1, person.name];
  }

  return rules.map((rule) => {
    const candidates = getQualifiedPeopleForStation(rule.stationId, activePeople, qualifications).sort((a, b) =>
      compareScore(score(a), score(b))
    );

    const assigned: Person[] = [];
    for (const person of candidates) {
      if (used.has(person.id)) continue;
      assigned.push(person);
      used.add(person.id);
      if (assigned.length >= rule.minRequired) break;
    }

    const source: AssignmentSource[] = assigned.map((person) => (ownIds.has(person.id) ? "本班" : "支援"));

    return {
      stationId: rule.stationId,
      assigned,
      shortage: Math.max(0, rule.minRequired - assigned.length),
      source,
    };
  });
}
