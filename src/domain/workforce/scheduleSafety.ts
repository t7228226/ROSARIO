import type { StationRule } from "../../types";

export interface ScheduleExtraWork {
  id: string;
  workName: string;
  personIds: string[];
}

export interface ScheduleTrainingAssignment {
  employeeId: string;
  stationId: string;
}

export interface ScheduleSafetyInput {
  assignments: Record<string, string[]>;
  rules: Array<Pick<StationRule, "stationId" | "minRequired">>;
  officerStations?: Record<string, string>;
  sensitiveSupportIds?: string[];
  extraWorks?: ScheduleExtraWork[];
  trainingAssignments?: ScheduleTrainingAssignment[];
  attendanceIds?: string[];
  reservedDutyIds?: string[];
}

export interface ScheduleStationCheck {
  stationId: string;
  required: number;
  assigned: number;
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
}

type Placement = { employeeId: string; key: string; label: string };

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
      placements.push({ employeeId, key: `station:${stationId}`, label: `站點:${stationId}` });
    });
  });
  activeOfficerStations.forEach(([employeeId, stationId]) => {
    placements.push({ employeeId, key: `officer:${stationId}`, label: `補充站位:${stationId}` });
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

  const stationChecks = input.rules.map((rule) => {
    const required = Math.max(0, Number(rule.minRequired || 0));
    const assigned = assignedByStation.get(rule.stationId)?.size || 0;
    return {
      stationId: rule.stationId,
      required,
      assigned,
      shortage: Math.max(0, required - assigned),
    };
  });
  const unknownStationIds = unique([
    ...Object.keys(input.assignments).filter((stationId) => !ruleIds.has(stationId) && (input.assignments[stationId]?.length || 0) > 0),
    ...activeOfficerStations.map(([, stationId]) => stationId).filter((stationId) => !ruleIds.has(stationId)),
  ]);

  const usedIds = new Set(placements.map((placement) => placement.employeeId));
  (input.reservedDutyIds || []).forEach((employeeId) => usedIds.add(employeeId));
  const unassignedIds = unique(input.attendanceIds || []).filter((employeeId) => !usedIds.has(employeeId));
  const trainingAssignments = (input.trainingAssignments || []).filter((assignment) =>
    assignedByStation.get(assignment.stationId)?.has(assignment.employeeId)
  );
  const sensitiveSupportIds = new Set(input.sensitiveSupportIds || []);
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
  };
}
