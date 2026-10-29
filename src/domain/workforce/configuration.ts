import type { ScenarioAssignment } from "./types";

// Explicit edits replace a person's earlier training/officer placement, never duplicate it.
export function mergeConfigurationAssignments(base: ScenarioAssignment[], edits: ScenarioAssignment[]) {
  const overridden = new Set(edits.map((item) => item.employeeId));
  return [...base.filter((item) => !overridden.has(item.employeeId)), ...edits];
}

export function setConfigurationAssignment(current: ScenarioAssignment[], next: ScenarioAssignment) {
  return [...current.filter((item) => item.employeeId !== next.employeeId), next];
}

export function compareConfigurationAssignments(before: Record<string, string[]>, after: Record<string, string[]>) {
  const stationById = new Map(Object.entries(before).flatMap(([stationId, ids]) => ids.map((id) => [id, stationId] as const)));
  const nextById = new Map(Object.entries(after).flatMap(([stationId, ids]) => ids.map((id) => [id, stationId] as const)));
  return [...new Set([...stationById.keys(), ...nextById.keys()])].flatMap((employeeId) => {
    const from = stationById.get(employeeId);
    const to = nextById.get(employeeId);
    return from === to ? [] : [{ employeeId, from, to }];
  });
}
