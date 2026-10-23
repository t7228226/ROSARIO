import { getCoverageQualificationStatus } from "../../lib/selectors";
import type { Person, Qualification, StationRule } from "../../types";
import type { WorkforceViolation } from "./types";

export interface ScheduleExtraWork {
  id: string;
  workName: string;
  personIds: string[];
}

export interface ScheduleTrainingAssignment {
  employeeId: string;
  stationId: string;
}

export type ScheduleSafetyRule = Pick<StationRule, "stationId" | "minRequired"> &
  Partial<Pick<StationRule, "reliefMinPerBatch" | "trainingCanFill">>;

export interface ScheduleSafetyInput {
  assignments: Record<string, string[]>;
  rules: ScheduleSafetyRule[];
  officerStations?: Record<string, string>;
  sensitiveSupportIds?: string[];
  extraWorks?: ScheduleExtraWork[];
  trainingAssignments?: ScheduleTrainingAssignment[];
  attendanceIds?: string[];
  reservedDutyIds?: string[];
  qualifications?: Qualification[];
  unavailableIds?: string[];
  people?: Array<Pick<Person, "id" | "role" | "employmentStatus">>;
}

export interface ScheduleStationCheck {
  stationId: string;
  required: number;
  assigned: number;
  qualified: number;
  training: number;
  eligibleTraining: number;
  covered: number;
  shortage: number;
}

export interface ScheduleDuplicatePerson {
  employeeId: string;
  placements: string[];
}

export interface ScheduleSafetyResult {
  stationChecks: ScheduleStationCheck[];
  duplicatePeople: ScheduleDuplicatePerson[];
  unknownStationIds: string[];
  unassignedIds: string[];
  trainingAssignments: ScheduleTrainingAssignment[];
  officerAssignments: ScheduleTrainingAssignment[];
  assignedStationSlots: number;
  requiredStationSlots: number;
  totalShortage: number;
  blockingIssues: string[];
  warnings: string[];
  canPreview: boolean;
  requiresAcknowledgement: boolean;
  invalidAssignments: WorkforceViolation[];
  qualificationVerified: boolean;
  attendanceVerified: boolean;
}

type Placement = { employeeId: string; key: string; label: string; stationId?: string; officer?: boolean };

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function auditScheduleSafety(input: ScheduleSafetyInput): ScheduleSafetyResult {
  const officerStations = input.officerStations || {};
  const activeOfficerStations = Object.entries(officerStations).filter(([, stationId]) => Boolean(stationId));
  const extraWorks = input.extraWorks || [];
  const ruleIds = new Set(input.rules.map((rule) => rule.stationId));
  const placements: Placement[] = [];

  Object.entries(input.assignments).forEach(([stationId, employeeIds]) => {
    employeeIds.forEach((employeeId) => {
      placements.push({ employeeId, key: `station:${stationId}`, label: `站點:${stationId}`, stationId });
    });
  });
  activeOfficerStations.forEach(([employeeId, stationId]) => {
    placements.push({ employeeId, key: `officer:${stationId}`, label: `補充站位:${stationId}`, stationId, officer: true });
  });
  extraWorks.forEach((work) => {
    const label = work.workName.trim() || work.id;
    work.personIds.forEach((employeeId) => {
      placements.push({ employeeId, key: `extra:${work.id}`, label: `臨時勤務:${label}` });
    });
  });

  const placementsByPerson = new Map<string, Placement[]>();
  placements.forEach((placement) => {
    const current = placementsByPerson.get(placement.employeeId) || [];
    current.push(placement);
    placementsByPerson.set(placement.employeeId, current);
  });

  const duplicatePeople = [...placementsByPerson.entries()]
    .filter(([, personPlacements]) => personPlacements.length > 1)
    .map(([employeeId, personPlacements]) => ({
      employeeId,
      placements: unique(personPlacements.map((placement) => placement.label)),
    }));

  const assignedByStation = new Map<string, Set<string>>();
  input.rules.forEach((rule) => assignedByStation.set(rule.stationId, new Set()));
  Object.entries(input.assignments).forEach(([stationId, employeeIds]) => {
    const stationPeople = assignedByStation.get(stationId) || new Set<string>();
    employeeIds.forEach((employeeId) => stationPeople.add(employeeId));
    assignedByStation.set(stationId, stationPeople);
  });
  activeOfficerStations.forEach(([employeeId, stationId]) => {
    const stationPeople = assignedByStation.get(stationId) || new Set<string>();
    stationPeople.add(employeeId);
    assignedByStation.set(stationId, stationPeople);
  });

  const qualificationVerified = input.qualifications !== undefined;
  const attendanceVerified = input.attendanceIds !== undefined;
  const attendanceIds = new Set(input.attendanceIds || []);
  const unavailableIds = new Set(input.unavailableIds || []);
  const peopleById = new Map(input.people?.map((person) => [person.id, person]));
  const ruleByStation = new Map(input.rules.map((rule) => [rule.stationId, rule]));
  const labeledTraining = new Set((input.trainingAssignments || []).map((item) => JSON.stringify([item.employeeId, item.stationId])));
  const statusFor = (employeeId: string, stationId: string) => qualificationVerified
    ? getCoverageQualificationStatus(input.qualifications!, employeeId, stationId)
    : labeledTraining.has(JSON.stringify([employeeId, stationId])) ? "訓練中" : "合格";
  const invalidAssignments: WorkforceViolation[] = [];
  const qualifiedByStation = new Map<string, Set<string>>();
  const eligibleTrainingByStation = new Map<string, Set<string>>();

  placements.forEach((placement) => {
    const { employeeId, stationId } = placement;
    const person = peopleById.get(employeeId);
    let code: WorkforceViolation["code"] | undefined;
    if (input.people && !person) code = "UNKNOWN_PERSON";
    else if (unavailableIds.has(employeeId)) code = "ABSENT_ASSIGNMENT";
    else if ((attendanceVerified && !attendanceIds.has(employeeId)) || (person && person.employmentStatus !== "在職")) code = "OUTSIDE_ATTENDANCE";
    else if (stationId && !ruleIds.has(stationId)) code = "UNKNOWN_STATION";
    else if (stationId && person && ["領班", "組長", "主任"].includes(person.role.trim()) && !placement.officer) code = "OFFICER_SOURCE_REQUIRED";
    else if (stationId) {
      const status = statusFor(employeeId, stationId);
      if (status === "不可排") code = "BLOCKED_QUALIFICATION";
      else if (status === "訓練中" && ruleByStation.get(stationId)?.trainingCanFill !== true) code = "TRAINING_NOT_ALLOWED";
      else if (status !== "合格" && status !== "訓練中") code = "QUALIFICATION_REQUIRED";
      if (!code) {
        const coverage = status === "合格" ? qualifiedByStation : eligibleTrainingByStation;
        const ids = coverage.get(stationId) || new Set<string>();
        ids.add(employeeId);
        coverage.set(stationId, ids);
      }
    }
    if (code) invalidAssignments.push({ code, employeeId, stationId, message: `${employeeId} 的${placement.label}未通過檢核（${code}）` });
  });

  const stationChecks = input.rules.map((rule) => {
    const required = Math.max(0, Number(rule.minRequired || 0));
    const assigned = assignedByStation.get(rule.stationId)?.size || 0;
    const qualified = qualifiedByStation.get(rule.stationId)?.size || 0;
    const training = [...(assignedByStation.get(rule.stationId) || [])].filter((id) => statusFor(id, rule.stationId) === "訓練中").length;
    const eligibleTraining = eligibleTrainingByStation.get(rule.stationId)?.size || 0;
    const covered = qualified + eligibleTraining;
    return {
      stationId: rule.stationId,
      required,
      assigned,
      qualified,
      training,
      eligibleTraining,
      covered,
      shortage: Math.max(0, required - covered),
    };
  });
  const unknownStationIds = unique([
    ...Object.keys(input.assignments).filter((stationId) => !ruleIds.has(stationId) && (input.assignments[stationId]?.length || 0) > 0),
    ...activeOfficerStations.map(([, stationId]) => stationId).filter((stationId) => !ruleIds.has(stationId)),
  ]);

  const usedIds = new Set(placements.map((placement) => placement.employeeId));
  (input.reservedDutyIds || []).forEach((employeeId) => usedIds.add(employeeId));
  const unassignedIds = unique(input.attendanceIds || []).filter((employeeId) =>
    !usedIds.has(employeeId) && !unavailableIds.has(employeeId) && (!input.people || peopleById.get(employeeId)?.employmentStatus === "在職")
  );
  const trainingAssignments = [...assignedByStation].flatMap(([stationId, ids]) => [...ids]
    .filter((employeeId) => statusFor(employeeId, stationId) === "訓練中")
    .map((employeeId) => ({ employeeId, stationId })));
  const sensitiveSupportIds = new Set([
    ...(input.sensitiveSupportIds || []),
    ...(input.people || []).filter((person) => ["領班", "組長", "主任"].includes(person.role.trim())).map((person) => person.id),
  ]);
  const officerAssignments = activeOfficerStations
    .filter(([employeeId]) => sensitiveSupportIds.has(employeeId))
    .map(([employeeId, stationId]) => ({ employeeId, stationId }));
  const totalShortage = stationChecks.reduce((sum, item) => sum + item.shortage, 0);
  const requiredStationSlots = stationChecks.reduce((sum, item) => sum + item.required, 0);
  const assignedStationSlots = stationChecks.reduce((sum, item) => sum + item.assigned, 0);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (duplicatePeople.length) blockingIssues.push(`${duplicatePeople.length} 人出現重複指派`);
  if (totalShortage) blockingIssues.push(`${stationChecks.filter((item) => item.shortage > 0).length} 個站點仍缺 ${totalShortage} 人`);
  if (unknownStationIds.length) blockingIssues.push(`${unknownStationIds.length} 個指派不在目前站點規則內`);
  if (invalidAssignments.length) blockingIssues.push(`${invalidAssignments.length} 個指派未通過出勤、資格或人員檢核`);
  if (trainingAssignments.length) warnings.push(`${trainingAssignments.length} 位訓練人員已安排至站點`);
  if (officerAssignments.length) warnings.push(`${officerAssignments.length} 位幹部已安排支援站點`);
  if (unassignedIds.length) warnings.push(`${unassignedIds.length} 位出勤人員保留為未指派備援`);

  return {
    stationChecks,
    duplicatePeople,
    unknownStationIds,
    unassignedIds,
    trainingAssignments,
    officerAssignments,
    assignedStationSlots,
    requiredStationSlots,
    totalShortage,
    blockingIssues,
    warnings,
    canPreview: blockingIssues.length === 0,
    requiresAcknowledgement: trainingAssignments.length > 0 || officerAssignments.length > 0,
    invalidAssignments,
    qualificationVerified,
    attendanceVerified,
  };
}
