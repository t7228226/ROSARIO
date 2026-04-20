import type { Person, Qualification, ShiftMode, Station, StationRule, TeamName } from "../types";

export const TEAM_OPTIONS: TeamName[] = ["婷芬班", "美香班", "俊志班", "翊展班"];
export const REVIEW_TEAM_OPTIONS = ["全部班別", ...TEAM_OPTIONS] as const;

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

export function getTeamOfPerson(person: Person): string {
  return String(person.shift || "").trim();
}

function getOwnDayValue(person: Person, team: TeamName, mode: Exclude<ShiftMode, "當班">): string {
  const group = TEAM_FIELD_GROUP[team];
  if (group === "A") {
    return mode === "第一天" ? String(person.aDay1 || person.day1 || "") : String(person.aDay2 || person.day2 || "");
  }
  return mode === "第一天" ? String(person.bDay1 || person.day1 || "") : String(person.bDay2 || person.day2 || "");
}

export function isPersonActiveInMode(person: Person, mode: ShiftMode): boolean {
  if (person.employmentStatus !== "在職" || person.role === "主任") {
    return false;
  }
  if (mode === "當班") {
    return true;
  }
  if (mode === "第一天") {
    return String(person.day1 || "") === "Y";
  }
  return String(person.day2 || "") === "Y";
}

export function getAttendanceForTeam(
  people: Person[],
  selectedTeam: TeamName,
  mode: ShiftMode
) {
  const ownDuty = TEAM_DUTY_MAP[selectedTeam];
  const supportTeam = TEAM_SUPPORT_MAP[selectedTeam];
  const supportDuty = TEAM_DUTY_MAP[supportTeam];

  const baseActive = people.filter((person) => person.employmentStatus === "在職" && person.role !== "主任");

  if (mode === "當班") {
    const own = baseActive.filter((person) => getTeamOfPerson(person) === selectedTeam);
    return {
      own,
      support: [] as Person[],
      all: own,
      supportTeam,
      ownDuty,
      supportDuty,
    };
  }

  const own = baseActive.filter(
    (person) => getTeamOfPerson(person) === selectedTeam && getOwnDayValue(person, selectedTeam, mode) === ownDuty
  );

  const support = baseActive.filter(
    (person) => getTeamOfPerson(person) === supportTeam && getOwnDayValue(person, supportTeam, mode) === supportDuty
  );

  return {
    own,
    support,
    all: [...own, ...support],
    supportTeam,
    ownDuty,
    supportDuty,
  };
}

export function getRuleDayKey(team: TeamName, mode: ShiftMode): string {
  if (mode === "當班") return "當班";
  return `${TEAM_DUTY_MAP[team]}${mode}`;
}

export function getApplicableRules(
  team: TeamName,
  mode: ShiftMode,
  stationRules: StationRule[],
  stations: Station[]
): StationRule[] {
  const targetKey = getRuleDayKey(team, mode);
  const matched = stationRules.filter(
    (rule) => rule.team === team && rule.dayKey === targetKey && rule.enabled !== false
  );

  if (matched.length) {
    return [...matched].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }

  return stations.map((station) => ({
    id: station.id,
    team,
    dayKey: targetKey,
    stationId: station.id,
    minRequired: station.normalMin,
    backupTarget: station.backupTarget ?? 0,
    priority: station.priority ?? 999,
    isMandatory: station.isMandatory ?? false,
    trainingCanFill: false,
    qualificationLimit: "不限",
    canShare: true,
    enabled: true,
    note: station.note,
  }));
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
  const qualified = related.filter((item) => item.status === "合格").length;
  const training = related.filter((item) => item.status === "訓練中").length;
  const blocked = related.filter((item) => item.status === "不可排").length;
  const supportQualifiedIds = qualifications
    .filter((item) => item.stationId === stationId && item.status === "合格" && supportIds.has(item.employeeId))
    .map((item) => item.employeeId);
  const shortage = Math.max(0, minimumNeed - qualified);

  return {
    related,
    qualified,
    training,
    blocked,
    shortage,
    supportQualifiedIds,
  };
}

export function searchText(values: Array<string | undefined | null>, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(normalized));
}

export function buildSmartAssignments(
  team: TeamName,
  mode: ShiftMode,
  stations: Station[],
  stationRules: StationRule[],
  people: Person[],
  qualifications: Qualification[]
) {
  const attendance = getAttendanceForTeam(people, team, mode);
  const rules = getApplicableRules(team, mode, stationRules, stations);
  const activePeople = attendance.all;
  const ownIds = new Set(attendance.own.map((person) => person.id));

  const qualificationMap = new Map<string, Qualification[]>();
  for (const q of qualifications) {
    if (!qualificationMap.has(q.employeeId)) qualificationMap.set(q.employeeId, []);
    qualificationMap.get(q.employeeId)!.push(q);
  }

  const flexibility = new Map<string, number>();
  for (const person of activePeople) {
    const count = (qualificationMap.get(person.id) || []).filter((q) => q.status === "合格").length;
    flexibility.set(person.id, count);
  }

  const used = new Set<string>();

  return rules.map((rule) => {
    const candidates = activePeople
      .filter((person) =>
        (qualificationMap.get(person.id) || []).some(
          (q) => q.stationId === rule.stationId && q.status === "合格"
        )
      )
      .sort((a, b) => {
        const ownScore = Number(ownIds.has(b.id)) - Number(ownIds.has(a.id));
        if (ownScore !== 0) return ownScore;
        const flex = (flexibility.get(a.id) || 0) - (flexibility.get(b.id) || 0);
        return flex || a.name.localeCompare(b.name, "zh-Hant");
      });

    const assigned: Person[] = [];
    for (const person of candidates) {
      if (used.has(person.id)) continue;
      assigned.push(person);
      used.add(person.id);
      if (assigned.length >= rule.minRequired) break;
    }

    return {
      stationId: rule.stationId,
      assigned,
      shortage: Math.max(0, rule.minRequired - assigned.length),
      source: assigned.map((person) => (ownIds.has(person.id) ? "當班" : "支援")),
    };
  });
}
