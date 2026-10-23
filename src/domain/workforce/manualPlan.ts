import type { Person, Qualification, ShiftMode, SmartScheduleMode, StationRule, TeamName } from "../../types";
import { buildSmartAssignments, getApplicableRules, getAttendanceForTeam, getRuleNeed, validateForcedAssignments } from "../../lib/selectors";
import type { AssignmentState } from "./assignmentState";
import type { ScheduleExtraWork } from "./scheduleSafety";
import type { WorkforceViolation } from "./types";

export interface ManualPlanInput {
  team: TeamName;
  day: ShiftMode;
  rules: StationRule[];
  people: Person[];
  qualifications: Qualification[];
  mode?: SmartScheduleMode;
  officerStations?: Record<string, string>;
  extraWorks?: ScheduleExtraWork[];
  options?: { useMinRequired?: boolean; randomize?: boolean };
}

export interface ManualPlanResult {
  assignments: AssignmentState;
  validOfficerStations: Record<string, string>;
  reservedExtraIds: string[];
  violations: WorkforceViolation[];
  shortage: number;
}

function officerRole(person: Person) {
  const role = String(person.role || "").trim();
  return ["主任", "組長", "領班", "站長"].find((value) => role.includes(value));
}

export function buildManualPlan(input: ManualPlanInput): ManualPlanResult {
  const rules = getApplicableRules(input.team, input.day, input.rules);
  const attendance = getAttendanceForTeam(input.people, input.team, input.day);
  const attendanceIds = new Set(attendance.all.map((person) => person.id));
  const reservedExtraIds = [...new Set((input.extraWorks || []).flatMap((work) => work.personIds))]
    .filter((employeeId) => attendanceIds.has(employeeId));
  const reservedIds = new Set(reservedExtraIds);
  const requestedStations = new Map(Object.entries(input.officerStations || {}).filter(([, stationId]) => Boolean(stationId)));
  const peopleById = new Map(input.people.map((person) => [person.id, person]));
  const leaderStations = new Map<string, string>();
  const violations: WorkforceViolation[] = [];

  requestedStations.forEach((stationId, employeeId) => {
    const person = peopleById.get(employeeId);
    if (!person) violations.push({ code: "UNKNOWN_PERSON", employeeId, stationId, message: `找不到固定站長 ${employeeId}` });
    else if (officerRole(person) !== "站長") violations.push({
      code: "INVALID_OFFICER_ASSIGNMENT", employeeId, stationId, message: `${person.name} 不是站長，不能列為固定站長站位`,
    });
    else if (reservedIds.has(employeeId)) violations.push({
      code: "DUPLICATE_ASSIGNMENT", employeeId, stationId, message: `${person.name} 已安排臨時勤務，不能同時列為固定站長站位`,
    });
    else leaderStations.set(employeeId, stationId);
  });

  const validated = validateForcedAssignments(rules, attendance.all, input.qualifications, new Set(), leaderStations);
  violations.push(...validated.violations);
  const validOfficerStations = Object.fromEntries(validated.validAssignments);
  const leaderCountByStation = new Map<string, number>();
  validated.validAssignments.forEach((stationId) => {
    leaderCountByStation.set(stationId, (leaderCountByStation.get(stationId) || 0) + 1);
  });

  // Fixed leaders consume both minimum demand and the original overflow capacity.
  const residualRules = rules.map((rule) => {
    const fixedCount = leaderCountByStation.get(rule.stationId) || 0;
    const need = getRuleNeed(rule, input.day);
    const maxAssignable = Number(rule.maxAssignable || 0);
    return {
      ...rule,
      minRequired: Math.max(0, need - fixedCount),
      maxAssignable: maxAssignable > 0 ? Math.max(0, Math.max(need, maxAssignable) - fixedCount) : rule.maxAssignable,
    };
  });
  const regularPeople = attendance.all.filter((person) =>
    !officerRole(person) && !reservedIds.has(person.id) && !requestedStations.has(person.id)
  );
  const rows = buildSmartAssignments(input.team, input.day, residualRules, regularPeople, input.qualifications,
    input.mode || "當班優先", { ...input.options, useMinRequired: input.options?.useMinRequired ?? true });

  return {
    assignments: Object.fromEntries(rows.map((row) => [row.stationId, row.assigned.map((person) => person.id)])),
    validOfficerStations,
    reservedExtraIds,
    violations,
    shortage: rows.reduce((sum, row) => sum + row.shortage, 0),
  };
}
