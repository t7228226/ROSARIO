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

export function getApplicableRules(team: TeamName, mode: ShiftMode, stationRules: StationRule[]): StationRule[] {
  const teamRules = stationRules.filter((rule) => rule.team === team && rule.enabled !== false);
  const exactDayRules = teamRules.filter((rule) => String(rule.dayKey || "當班") === mode);
  const matched = exactDayRules.length
    ? exactDayRules
    : teamRules.filter((rule) => !rule.dayKey || rule.dayKey === "當班");
  return [...matched].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

export function getRuleNeed(rule: StationRule, _mode: ShiftMode) {
  return Math.max(0, Number(rule.minRequired || 0));
}

export function getReliefRuleNeed(rule: StationRule) {
  return Math.max(0, Number(rule.reliefMinPerBatch || 0));
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

export interface CoverageStationRow {
  stationId: string;
  required: number;
  assignedIds: string[];
  shortage: number;
  qualifiedIds: string[];
  trainingIds: string[];
  blockedIds: string[];
  candidateCount: number;
  bottleneck: boolean;
}

export interface CoverageCriticalPerson {
  employeeId: string;
  affectedStationIds: string[];
  shortage: number;
}

export interface CoverageTrainingSuggestion {
  employeeId: string;
  stationId: string;
  impact: number;
  reason: string;
  priority: "補缺口" | "降風險" | "培養" | "備援";
  isOfficer: boolean;
}

export interface CoverageOfficerSuggestion {
  employeeId: string;
  stationId: string;
  shortageReduced: number;
  role: string;
}

export interface CoverageAnalysisResult {
  required: number;
  assigned: number;
  shortage: number;
  fullyCovered: boolean;
  rows: CoverageStationRow[];
  criticalPeople: CoverageCriticalPerson[];
  trainingSuggestions: CoverageTrainingSuggestion[];
  officerSuggestions: CoverageOfficerSuggestion[];
}

function getQualifiedIdsForStation(
  stationId: string,
  activePeople: Person[],
  qualifications: Qualification[],
  allowedStatuses = new Set(["合格"])
) {
  const activeIds = new Set(activePeople.map((person) => person.id));
  return [...new Set(
    qualifications
      .filter((item) => item.stationId === stationId && activeIds.has(item.employeeId) && allowedStatuses.has(item.status))
      .map((item) => item.employeeId)
  )];
}

function isStationOfficer(person: Person) {
  return ["領班", "組長", "主任"].includes(String(person.role || "").trim());
}

function countMatchingShortage(rules: StationRule[], assignedByStation: Map<string, string[]>, mode: ShiftMode) {
  return rules.reduce((sum, rule) => {
    const assignedIds = assignedByStation.get(rule.stationId) || [];
    return sum + Math.max(0, getRuleNeed(rule, mode) - assignedIds.length);
  }, 0);
}

function appendUniqueId(map: Map<string, string[]>, stationId: string, personId: string) {
  const current = map.get(stationId) || [];
  if (current.includes(personId)) return;
  map.set(stationId, [...current, personId]);
}

export function solveCoverageMatching(
  rules: StationRule[],
  activePeople: Person[],
  qualifications: Qualification[],
  mode: ShiftMode,
  unavailableIds = new Set<string>(),
  strategy: SmartScheduleMode = "資格優先",
  ownIds = new Set<string>(),
  supportIds = new Set<string>(),
  forcedAssignments = new Map<string, string>(),
  randomize = false
) {
  const activePersonIds = new Set(activePeople.map((person) => person.id));
  const validForcedAssignments = new Map(
    [...forcedAssignments].filter(([personId]) => activePersonIds.has(personId) && !unavailableIds.has(personId))
  );
  const forcedIds = new Set([...validForcedAssignments.keys()]);
  const forcedCountByStation = new Map<string, number>();
  validForcedAssignments.forEach((stationId) => {
    forcedCountByStation.set(stationId, (forcedCountByStation.get(stationId) || 0) + 1);
  });
  const activeIds = new Set(activePeople.map((person) => person.id).filter((id) => !unavailableIds.has(id) && !forcedIds.has(id)));
  const qualifiedByStation = new Map<string, string[]>();
  const personFlex = new Map<string, number>();

  rules.forEach((rule) => {
    const ids = getQualifiedIdsForStation(
      rule.stationId,
      activePeople.filter((person) => activeIds.has(person.id)),
      qualifications
    );
    qualifiedByStation.set(rule.stationId, ids);
    ids.forEach((id) => personFlex.set(id, (personFlex.get(id) || 0) + 1));
  });

  const slots = rules.flatMap((rule) =>
    Array.from({ length: Math.max(0, getRuleNeed(rule, mode) - (forcedCountByStation.get(rule.stationId) || 0)) }, (_, index) => ({
      key: `${rule.stationId}#${index}`,
      stationId: rule.stationId,
      priority: rule.priority ?? 999,
    }))
  ).sort((a, b) => {
    const aCandidates = qualifiedByStation.get(a.stationId)?.length || 0;
    const bCandidates = qualifiedByStation.get(b.stationId)?.length || 0;
    if (aCandidates !== bCandidates) return aCandidates - bCandidates;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.stationId.localeCompare(b.stationId, "zh-Hant", { numeric: true });
  });

  const personBySlot = new Map<string, string>();
  const slotByPerson = new Map<string, string>();
  const slotStation = new Map(slots.map((slot) => [slot.key, slot.stationId]));
  const candidatesBySlot = new Map<string, string[]>();
  const randomRank = new Map(activePeople.map((person) => [person.id, Math.random()]));

  slots.forEach((slot) => {
    function score(id: string) {
      const flex = personFlex.get(id) || 0;
      const ownScore = ownIds.has(id) ? 0 : 1;
      const supportScore = supportIds.has(id) ? 0 : 1;
      const tieBreaker = randomize ? randomRank.get(id) || 0 : id;
      if (strategy === "當班優先") return [ownScore, flex, tieBreaker];
      if (strategy === "支援優先") return [supportScore, flex, tieBreaker];
      return [flex, supportScore, ownScore, tieBreaker];
    }

    const ids = [...(qualifiedByStation.get(slot.stationId) || [])].sort((a, b) => {
      const left = score(a);
      const right = score(b);
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] === right[index]) continue;
        if (typeof left[index] === "number" && typeof right[index] === "number") {
          return (left[index] as number) - (right[index] as number);
        }
        return String(left[index]).localeCompare(String(right[index]), "zh-Hant", { numeric: true });
      }
      if (randomize) return (randomRank.get(a) || 0) - (randomRank.get(b) || 0);
      return a.localeCompare(b, "zh-Hant", { numeric: true });
    });
    candidatesBySlot.set(slot.key, ids);
  });

  function tryAssign(slotKey: string, visitedPeople: Set<string>): boolean {
    const candidates = candidatesBySlot.get(slotKey) || [];
    for (const personId of candidates) {
      if (visitedPeople.has(personId)) continue;
      visitedPeople.add(personId);
      const previousSlot = slotByPerson.get(personId);
      if (!previousSlot || tryAssign(previousSlot, visitedPeople)) {
        personBySlot.set(slotKey, personId);
        slotByPerson.set(personId, slotKey);
        return true;
      }
    }
    return false;
  }

  slots.forEach((slot) => {
    tryAssign(slot.key, new Set<string>());
  });

  const assignedByStation = new Map<string, string[]>();
  validForcedAssignments.forEach((stationId, personId) => {
    appendUniqueId(assignedByStation, stationId, personId);
  });
  personBySlot.forEach((personId, slotKey) => {
    const stationId = slotStation.get(slotKey);
    if (!stationId) return;
    appendUniqueId(assignedByStation, stationId, personId);
  });

  return { assignedByStation, qualifiedByStation };
}

export function analyzeStationCoverage(
  team: TeamName,
  mode: ShiftMode,
  stationRules: StationRule[],
  people: Person[],
  qualifications: Qualification[],
  unavailableIds = new Set<string>(),
  forcedAssignments = new Map<string, string>(),
  options: { excludeOfficersFromCoverage?: boolean } = {}
): CoverageAnalysisResult {
  const attendance = getAttendanceForTeam(people, team, mode);
  const rules = getApplicableRules(team, mode, stationRules);
  const activePeople = attendance.all.filter((person) => !unavailableIds.has(person.id));
  const forcedIds = new Set([...forcedAssignments.keys()]);
  const matchingPeople = options.excludeOfficersFromCoverage
    ? activePeople.filter((person) => !isStationOfficer(person) || forcedIds.has(person.id))
    : activePeople;
  const { assignedByStation, qualifiedByStation } = solveCoverageMatching(rules, matchingPeople, qualifications, mode, new Set<string>(), "資格優先", new Set<string>(), new Set<string>(), forcedAssignments);
  const required = rules.reduce((sum, rule) => sum + getRuleNeed(rule, mode), 0);

  const rows = rules.map((rule) => {
    const assignedIds = [...new Set(assignedByStation.get(rule.stationId) || [])];
    const qualifiedIds = qualifiedByStation.get(rule.stationId) || [];
    const coveragePeople = options.excludeOfficersFromCoverage
      ? activePeople.filter((person) => !isStationOfficer(person))
      : activePeople;
    const supportPeople = options.excludeOfficersFromCoverage
      ? attendance.support.filter((person) => !isStationOfficer(person))
      : attendance.support;
    const coverage = getStationCoverage(rule.stationId, getRuleNeed(rule, mode), coveragePeople, supportPeople, qualifications);
    const requiredForStation = getRuleNeed(rule, mode);
    return {
      stationId: rule.stationId,
      required: requiredForStation,
      assignedIds,
      shortage: Math.max(0, requiredForStation - assignedIds.length),
      qualifiedIds,
      trainingIds: coverage.trainingIds,
      blockedIds: coverage.blockedIds,
      candidateCount: qualifiedIds.length,
      bottleneck: requiredForStation > 0 && qualifiedIds.length <= requiredForStation + 1,
    };
  });

  const assigned = rows.reduce((sum, row) => sum + row.assignedIds.length, 0);
  const shortage = Math.max(0, required - assigned);

  const criticalPeople = matchingPeople
    .map((person) => {
      const next = solveCoverageMatching(rules, matchingPeople, qualifications, mode, new Set([person.id]));
      const affectedStationIds = rules
        .map((rule) => {
          const assignedIds = next.assignedByStation.get(rule.stationId) || [];
          return assignedIds.length < getRuleNeed(rule, mode) ? rule.stationId : "";
        })
        .filter(Boolean);
      const missing = rules.reduce((sum, rule) => {
        const assignedIds = next.assignedByStation.get(rule.stationId) || [];
        return sum + Math.max(0, getRuleNeed(rule, mode) - assignedIds.length);
      }, 0);
      return { employeeId: person.id, affectedStationIds, shortage: missing };
    })
    .filter((item) => item.shortage > shortage)
    .sort((a, b) => b.shortage - a.shortage || b.affectedStationIds.length - a.affectedStationIds.length)
    .slice(0, 8);

  const officerSuggestions = options.excludeOfficersFromCoverage
    ? activePeople
        .filter((person) => isStationOfficer(person))
        .flatMap((person) =>
          rows
            .filter((row) => row.shortage > 0)
            .filter((row) => qualifications.some((item) => item.employeeId === person.id && item.stationId === row.stationId && item.status === "合格"))
            .map((row) => {
              const simulated = solveCoverageMatching(
                rules,
                [...matchingPeople.filter((item) => item.id !== person.id), person],
                qualifications,
                mode,
                new Set<string>(),
                "資格優先",
                new Set<string>(),
                new Set<string>(),
                new Map([[person.id, row.stationId]])
              );
              const simulatedShortage = countMatchingShortage(rules, simulated.assignedByStation, mode);
              return {
                employeeId: person.id,
                stationId: row.stationId,
                shortageReduced: Math.max(0, shortage - simulatedShortage),
                role: person.role || "幹部",
              };
            })
        )
        .filter((item) => item.shortageReduced > 0)
        .sort((a, b) => b.shortageReduced - a.shortageReduced || a.role.localeCompare(b.role, "zh-Hant", { numeric: true }))
        .slice(0, 12)
    : [];

  const qualificationCountMap = getQualificationCountMap(matchingPeople, qualifications);
  const nonOfficerQualificationCounts = matchingPeople
    .filter((person) => !isStationOfficer(person))
    .map((person) => qualificationCountMap.get(person.id) || 0);
  const averageNonOfficerQualificationCount = nonOfficerQualificationCounts.length
    ? nonOfficerQualificationCounts.reduce((sum, count) => sum + count, 0) / nonOfficerQualificationCounts.length
    : 0;
  const shortageStationRows = rows.filter((row) => row.shortage > 0 || row.bottleneck);
  const trainingTargetRows = (shortageStationRows.length ? shortageStationRows : rows.filter((row) => row.required > 0))
    .sort((a, b) => {
      const shortageDiff = b.shortage - a.shortage;
      if (shortageDiff !== 0) return shortageDiff;
      if (a.bottleneck !== b.bottleneck) return a.bottleneck ? -1 : 1;
      const candidatePressure = (a.candidateCount - a.required) - (b.candidateCount - b.required);
      if (candidatePressure !== 0) return candidatePressure;
      return b.required - a.required;
    })
    .slice(0, Math.max(8, rules.length));
  const trainingSuggestionCandidates = matchingPeople
    .flatMap((person) => trainingTargetRows
      .filter((row) => !row.qualifiedIds.includes(person.id) && !row.blockedIds.includes(person.id))
      .map((row) => {
        const simulatedQualifications: Qualification[] = [
          ...qualifications,
          { employeeId: person.id, employeeName: person.name, stationId: row.stationId, status: "合格" },
        ];
        const simulated = solveCoverageMatching(
          rules,
          matchingPeople,
          simulatedQualifications,
          mode,
          new Set<string>(),
          "資格優先",
          new Set<string>(),
          new Set<string>(),
          new Map([[person.id, row.stationId]])
        );
        const simulatedShortage = countMatchingShortage(rules, simulated.assignedByStation, mode);
        const shortageReduced = shortage - simulatedShortage;
        const officer = isStationOfficer(person);
        const bottleneckRelief = row.bottleneck ? Math.max(0, row.required + 2 - (row.candidateCount + 1)) : 0;
        const qualifiedCount = qualificationCountMap.get(person.id) || 0;
        const lowSkillBonus = officer
          ? 0
          : qualifiedCount === 0
            ? 38
            : Math.max(0, Math.ceil(averageNonOfficerQualificationCount - qualifiedCount) * 6);
        const stationPressureBonus = row.shortage > 0 ? 30 : row.bottleneck ? 12 : Math.max(0, row.required + 2 - row.candidateCount);
        const impact = shortageReduced * 100 + stationPressureBonus + lowSkillBonus - (officer ? 20 : 0) - bottleneckRelief;
        const priority: CoverageTrainingSuggestion["priority"] = shortageReduced > 0
          ? "補缺口"
          : row.bottleneck
            ? "降風險"
            : lowSkillBonus > 0
              ? "培養"
              : "備援";
        const reason = shortageReduced > 0
          ? `補訓後全局缺口可少 ${shortageReduced} 人`
          : officer
            ? "領班/組長/主任非必要不優先，缺人時可支援"
            : qualifiedCount === 0
              ? "目前沒有合格站點，可培養成可調度戰力"
              : lowSkillBonus > 0
                ? `合格站點較少（${qualifiedCount} 站），可補足戰力`
                : "可分散關鍵站點風險";
        return {
          employeeId: person.id,
          stationId: row.stationId,
          impact,
          reason,
          priority,
          isOfficer: officer,
        };
      }))
    .filter((item) => item.impact > 0)
    .sort((a, b) => {
      const priorityOrder = { 補缺口: 0, 降風險: 1, 培養: 2, 備援: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      if (a.isOfficer !== b.isOfficer) return a.isOfficer ? 1 : -1;
      return b.impact - a.impact || a.stationId.localeCompare(b.stationId, "zh-Hant", { numeric: true });
    });
  const usedTrainingPeople = new Set<string>();
  const trainingSuggestions = trainingSuggestionCandidates.filter((item) => {
    if (usedTrainingPeople.has(item.employeeId)) return false;
    usedTrainingPeople.add(item.employeeId);
    return true;
  }).slice(0, 10);

  return {
    required,
    assigned,
    shortage,
    fullyCovered: shortage === 0,
    rows,
    criticalPeople,
    trainingSuggestions,
    officerSuggestions,
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
  stationRules: StationRule[],
  people: Person[],
  qualifications: Qualification[],
  strategy: SmartScheduleMode = "當班優先",
  options: { useMinRequired?: boolean; randomize?: boolean } = {}
): SmartAssignmentRow[] {
  const attendance = getAttendanceForTeam(people, team, mode);
  const rules = getApplicableRules(team, mode, stationRules);
  const activePeople = attendance.all;
  const ownIds = new Set(attendance.own.map((person) => person.id));
  const supportIds = new Set(attendance.support.map((person) => person.id));
  const needMode = options.useMinRequired ? "當班" : mode;
  const { assignedByStation } = solveCoverageMatching(rules, activePeople, qualifications, needMode, new Set<string>(), strategy, ownIds, supportIds, new Map<string, string>(), Boolean(options.randomize));
  const assignedIds = new Set([...assignedByStation.values()].flat());
  const stationOrder = new Map(rules.map((rule, index) => [rule.stationId, index]));

  activePeople
    .filter((person) => !assignedIds.has(person.id))
    .forEach((person) => {
      const qualifiedStationIds = qualifications
        .filter((item) => item.employeeId === person.id && item.status === "合格" && stationOrder.has(item.stationId))
        .map((item) => item.stationId)
        .filter((stationId, index, list) => list.indexOf(stationId) === index)
        .filter((stationId) => {
          const rule = rules.find((item) => item.stationId === stationId);
          const maxAssignable = Number(rule?.maxAssignable || 0);
          if (!rule || maxAssignable <= 0) return false;
          const currentCount = assignedByStation.get(stationId)?.length || 0;
          return currentCount < Math.max(getRuleNeed(rule, needMode), maxAssignable);
        });
      if (!qualifiedStationIds.length) return;
      const bestStationId = qualifiedStationIds.sort((a, b) => {
        const ruleA = rules.find((rule) => rule.stationId === a);
        const ruleB = rules.find((rule) => rule.stationId === b);
        const maxA = Math.max(getRuleNeed(ruleA!, needMode), Number(ruleA?.maxAssignable || 0), 1);
        const maxB = Math.max(getRuleNeed(ruleB!, needMode), Number(ruleB?.maxAssignable || 0), 1);
        const loadA = (assignedByStation.get(a)?.length || 0) / maxA;
        const loadB = (assignedByStation.get(b)?.length || 0) / maxB;
        if (loadA !== loadB) return loadA - loadB;
        return (stationOrder.get(a) ?? 999) - (stationOrder.get(b) ?? 999);
      })[0];
      appendUniqueId(assignedByStation, bestStationId, person.id);
      assignedIds.add(person.id);
    });

  return rules.map((rule) => {
    const assignedIds = assignedByStation.get(rule.stationId) || [];
    const assigned = assignedIds
      .map((id) => activePeople.find((person) => person.id === id))
      .filter((person): person is Person => Boolean(person));

    const source: AssignmentSource[] = assigned.map((person) => (ownIds.has(person.id) ? "本班" : "支援"));

    return {
      stationId: rule.stationId,
      assigned,
      shortage: Math.max(0, getRuleNeed(rule, needMode) - assigned.length),
      source,
    };
  });
}
