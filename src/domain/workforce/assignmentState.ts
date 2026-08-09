import type { StationRule } from "../../types";

export type AssignmentState = Record<string, string[]>;

export function countAssigned(assignments: AssignmentState) {
  return Object.values(assignments).reduce((sum, list) => sum + list.length, 0);
}

export function countUniqueAssigned(assignments: AssignmentState) {
  return new Set(Object.values(assignments).flat()).size;
}

export function findDuplicateIds(assignments: AssignmentState) {
  const counts = new Map<string, number>();
  Object.values(assignments).flat().forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

export function appendUniqueAssignment(current: AssignmentState, stationId: string, employeeId: string) {
  const currentIds = current[stationId] || [];
  if (currentIds.includes(employeeId) || findAssignedStation(current, employeeId)) return current;
  return {
    ...current,
    [stationId]: [...currentIds, employeeId],
  };
}

export function findAssignedStation(assignments: AssignmentState, employeeId: string) {
  return Object.entries(assignments).find(([, ids]) => ids.includes(employeeId))?.[0] || null;
}

export function getAssignmentSummary(assignments: AssignmentState, rules: StationRule[]) {
  const required = rules.reduce((sum, rule) => sum + rule.minRequired, 0);
  const assigned = countAssigned(assignments);
  const uniqueAssigned = countUniqueAssigned(assignments);
  const duplicates = findDuplicateIds(assignments).length;
  const shortage = rules.reduce((sum, rule) => sum + Math.max(0, rule.minRequired - (assignments[rule.stationId]?.length || 0)), 0);
  return { required, assigned, uniqueAssigned, duplicates, shortage };
}
