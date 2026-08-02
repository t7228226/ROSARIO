import {
  analyzeStationCoverage,
  getApplicableRules,
  getAttendanceForTeam,
} from "../../lib/selectors";
import type { Person, Qualification } from "../../types";
import type {
  AssignmentReason,
  ScenarioAssignment,
  WorkforceResult,
  WorkforceScenario,
  WorkforceSnapshot,
  WorkforceViolation,
} from "./types";

const officerRoles = new Set(["領班", "組長", "主任"]);

function isOfficer(person: Person) {
  return officerRoles.has(String(person.role || "").trim());
}

function getQualificationStatus(
  qualifications: Qualification[],
  employeeId: string,
  stationId: string
) {
  return qualifications.find(
    (item) => item.employeeId === employeeId && item.stationId === stationId
  )?.status || "";
}

function addSimulatedQualification(
  qualifications: Qualification[],
  assignment: ScenarioAssignment,
  employeeName: string
) {
  return [
    ...qualifications.filter(
      (item) =>
        item.employeeId !== assignment.employeeId ||
        item.stationId !== assignment.stationId
    ),
    {
      employeeId: assignment.employeeId,
      employeeName,
      stationId: assignment.stationId,
      status: "合格" as const,
      rawStatus: "情境補訓",
    },
  ];
}

function reasonFor(source: ScenarioAssignment["source"]) {
  if (source === "training") return "情境補訓後由使用者指定至此站點";
  if (source === "officer") return "領班／組長／主任由使用者指定緊急支援";
  return "使用者手動鎖定此站點";
}

export function evaluateWorkforceScenario(
  snapshot: WorkforceSnapshot,
  scenario: WorkforceScenario
): WorkforceResult {
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const attendance = getAttendanceForTeam(snapshot.people, scenario.team, scenario.mode);
  const activeIds = new Set(attendance.all.map((person) => person.id));
  const unavailableIds = new Set(scenario.unavailableIds || []);
  const applicableRules = getApplicableRules(
    scenario.team,
    scenario.mode,
    snapshot.stationRules || []
  );
  const applicableStationIds = new Set(applicableRules.map((rule) => rule.stationId));
  const violations: WorkforceViolation[] = [];
  const forcedAssignments = new Map<string, string>();
  const validSources = new Map<string, ScenarioAssignment["source"]>();
  let simulatedQualifications = [...snapshot.qualifications];

  for (const assignment of scenario.assignments || []) {
    const person = peopleById.get(assignment.employeeId);
    if (!person) {
      violations.push({
        code: "UNKNOWN_PERSON",
        message: `找不到人員 ${assignment.employeeId}`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (!applicableStationIds.has(assignment.stationId)) {
      violations.push({
        code: "UNKNOWN_STATION",
        message: `站點 ${assignment.stationId} 不在目前班別與日別規則中`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (unavailableIds.has(assignment.employeeId)) {
      violations.push({
        code: "ABSENT_ASSIGNMENT",
        message: `${person.name} 已設定缺勤，不能再指派站點`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (!activeIds.has(assignment.employeeId)) {
      violations.push({
        code: "OUTSIDE_ATTENDANCE",
        message: `${person.name} 不在目前班別與日別的出勤名單`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (forcedAssignments.has(assignment.employeeId)) {
      violations.push({
        code: "DUPLICATE_ASSIGNMENT",
        message: `${person.name} 同時被指定到多個站點`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }

    const officer = isOfficer(person);
    if (officer && assignment.source !== "officer") {
      violations.push({
        code: "OFFICER_SOURCE_REQUIRED",
        message: `${person.name} 是領班／組長／主任，必須以幹部支援方式指派`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (!officer && assignment.source === "officer") {
      violations.push({
        code: "INVALID_OFFICER_ASSIGNMENT",
        message: `${person.name} 不是領班／組長／主任，不能標記為幹部支援`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }

    const qualificationStatus = getQualificationStatus(
      snapshot.qualifications,
      assignment.employeeId,
      assignment.stationId
    );
    if (qualificationStatus === "不可排") {
      violations.push({
        code: "BLOCKED_QUALIFICATION",
        message: `${person.name} 在此站點標記為不可排`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (assignment.source !== "training" && qualificationStatus !== "合格") {
      violations.push({
        code: "QUALIFICATION_REQUIRED",
        message: `${person.name} 尚未具備此站點正式資格`,
        employeeId: assignment.employeeId,
        stationId: assignment.stationId,
      });
      continue;
    }
    if (assignment.source === "training") {
      simulatedQualifications = addSimulatedQualification(
        simulatedQualifications,
        assignment,
        person.name
      );
    }

    forcedAssignments.set(assignment.employeeId, assignment.stationId);
    validSources.set(assignment.employeeId, assignment.source);
  }

  const analysis = analyzeStationCoverage(
    scenario.team,
    scenario.mode,
    snapshot.stationRules || [],
    snapshot.people,
    simulatedQualifications,
    unavailableIds,
    forcedAssignments,
    { excludeOfficersFromCoverage: true }
  );
  const assignments = Object.fromEntries(
    analysis.rows.map((row) => [row.stationId, row.assignedIds])
  );
  const assignedIds = new Set(analysis.rows.flatMap((row) => row.assignedIds));
  const unassignedIds = attendance.all
    .filter((person) => !unavailableIds.has(person.id))
    .filter((person) => !isOfficer(person))
    .filter((person) => !assignedIds.has(person.id))
    .map((person) => person.id);
  const reasons: AssignmentReason[] = analysis.rows.flatMap((row) =>
    row.assignedIds.map((employeeId) => {
      const source = validSources.get(employeeId) || "automatic";
      return {
        employeeId,
        stationId: row.stationId,
        source,
        message: source === "automatic" ? "系統依資格與全站最大覆蓋自動安排" : reasonFor(source),
      };
    })
  );

  return {
    scenario,
    analysis,
    rows: analysis.rows,
    assignments,
    unassignedIds,
    reasons,
    violations,
  };
}
