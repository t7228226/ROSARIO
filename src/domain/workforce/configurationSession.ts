import type { ScenarioAssignment } from "./types";
import type { PlanningRule } from "./planningRules";

export interface PlanningConfiguration { assignments: ScenarioAssignment[]; rules: PlanningRule[] }
export interface ConfigurationSession { configuration: PlanningConfiguration; history: PlanningConfiguration[]; enabled: boolean; touched: boolean }
export const emptyPlanningConfiguration: PlanningConfiguration = { assignments: [], rules: [] };
export const emptyConfigurationSession: ConfigurationSession = { configuration: emptyPlanningConfiguration, history: [], enabled: true, touched: false };
export function changeConfiguration(session: ConfigurationSession, configuration: PlanningConfiguration): ConfigurationSession {
  return { configuration, history: [...session.history.slice(-19), session.configuration], enabled: true, touched: true };
}
export function undoConfiguration(session: ConfigurationSession): ConfigurationSession {
  if (!session.history.length) return session;
  return { ...session, configuration: session.history[session.history.length - 1], history: session.history.slice(0, -1), enabled: true, touched: true };
}
export function resetConfiguration(session: ConfigurationSession): ConfigurationSession {
  return changeConfiguration(session, emptyPlanningConfiguration);
}
export function planningPlacementConflicts(rules: PlanningRule[], assignments: Record<string, string[]>) {
  const stationByPerson = new Map(Object.entries(assignments).flatMap(([stationId, ids]) => ids.map((id) => [id, stationId] as const)));
  return rules.filter((rule) => rule.mode !== "preferred" && (rule.mode === "fixed"
    ? stationByPerson.get(rule.employeeId) !== rule.stationIds[0]
    : stationByPerson.has(rule.employeeId) && !rule.stationIds.includes(stationByPerson.get(rule.employeeId)!))).map((rule) => rule.employeeId);
}
export function readPlanningConfiguration(value: unknown): PlanningConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置格式無法辨識。");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.assignments) || !Array.isArray(input.rules) || input.assignments.length > 200 || input.rules.length > 200) throw new Error("配置項目格式或數量不正確。");
  const ids = new Set<string>();
  const id = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || value.length > 80) throw new Error("配置代碼格式不正確。");
    return value.trim();
  };
  const claim = (employeeId: string) => { if (ids.has(employeeId)) throw new Error("配置包含重複人員。"); ids.add(employeeId); };
  const assignments = input.assignments.map((raw): ScenarioAssignment => {
    if (!raw || typeof raw !== "object" || !["manual", "training", "officer"].includes(raw.source)) throw new Error("人員指定格式不正確。");
    const employeeId = id(raw.employeeId); claim(employeeId);
    return { employeeId, stationId: id(raw.stationId), source: raw.source };
  });
  const rules = input.rules.map((raw): PlanningRule => {
    if (!raw || typeof raw !== "object" || !["fixed", "allowed", "preferred"].includes(raw.mode) || !Array.isArray(raw.stationIds) || !raw.stationIds.length || raw.stationIds.length > 20) throw new Error("人員規則格式不正確。");
    const employeeId = id(raw.employeeId); claim(employeeId);
    const stationIds = [...new Set<string>(raw.stationIds.map(id))];
    if (raw.mode === "fixed" && stationIds.length !== 1) throw new Error("固定規則必須指定一站。");
    return { employeeId, mode: raw.mode, stationIds };
  });
  return { assignments, rules };
}
