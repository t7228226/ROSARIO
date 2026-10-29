import type { Person, Qualification, ShiftMode, StationRule, TeamName } from "../../types";
import { getApplicableRules, getAttendanceForTeam, getCoverageQualificationStatus } from "../../lib/selectors";

export interface PlanningRule {
  employeeId: string;
  mode: "fixed" | "allowed" | "preferred";
  stationIds: string[];
}

export interface PlanningRuleWarning {
  code: "INVALID_RULE" | "DUPLICATE_RULE" | "UNKNOWN_PERSON" | "UNKNOWN_STATION" | "OUTSIDE_ATTENDANCE"
    | "ABSENT_RULE" | "QUALIFICATION_REQUIRED" | "BLOCKED_QUALIFICATION" | "RULE_OVERRIDDEN" | "RESERVED_DUTY" | "SUPERVISORY_DUTY";
  employeeId: string;
  stationId?: string;
  message: string;
}

export interface PlanningRulesInput {
  people: Person[];
  qualifications: Qualification[];
  stationRules?: StationRule[];
  // Omit team/mode only when people and stationRules already describe the attendance pool.
  team?: TeamName;
  mode?: ShiftMode;
  planningRules?: PlanningRule[];
  unavailableIds?: string[];
  overrideEmployeeIds?: string[];
  reservedEmployeeIds?: string[];
}

export interface PlanningRuleResolution {
  validRules: PlanningRule[];
  fixedAssignments: Map<string, string>;
  warnings: PlanningRuleWarning[];
}

export function resolvePlanningRules(input: PlanningRulesInput): PlanningRuleResolution {
  const validRules: PlanningRule[] = [];
  const fixedAssignments = new Map<string, string>();
  const warnings: PlanningRuleWarning[] = [];
  if (!input.planningRules?.length) return { validRules, fixedAssignments, warnings };
  const people = new Map(input.people.map((person) => [person.id, person]));
  const attendance = input.team ? getAttendanceForTeam(input.people, input.team, input.mode || "當班").all
    : input.people.filter((person) => person.employmentStatus === "在職");
  const attendanceIds = new Set(attendance.map((person) => person.id));
  const rules = input.team ? getApplicableRules(input.team, input.mode || "當班", input.stationRules || [])
    : (input.stationRules || []).filter((rule) => rule.enabled !== false);
  const stationIds = new Set(rules.map((rule) => rule.stationId));
  const unavailable = new Set(input.unavailableIds);
  const overrides = new Set(input.overrideEmployeeIds);
  const reserved = new Set(input.reservedEmployeeIds);
  const seen = new Set<string>();

  for (const raw of input.planningRules) {
    const employeeId = typeof raw?.employeeId === "string" ? raw.employeeId.trim() : "";
    const warn = (code: PlanningRuleWarning["code"], message: string, stationId?: string) => {
      warnings.push({ code, employeeId, stationId, message });
    };
    if (!employeeId || !["fixed", "allowed", "preferred"].includes(raw?.mode) || !Array.isArray(raw.stationIds)
      || raw.stationIds.some((id) => typeof id !== "string" || !id.trim())) {
      warn("INVALID_RULE", `${employeeId || "未指定人員"}：人員規劃格式無效，已略過`);
      continue;
    }
    if (seen.has(employeeId)) { warn("DUPLICATE_RULE", `${employeeId}：同人重複規劃，保留第一筆`); continue; }
    seen.add(employeeId);
    const person = people.get(employeeId);
    const name = person?.name || employeeId;
    if (reserved.has(employeeId)) { warn("RESERVED_DUTY", `${name}：臨時勤務優先，已略過人員規劃`); continue; }
    if (overrides.has(employeeId)) { warn("RULE_OVERRIDDEN", `${name}：本次明確指派優先，已覆蓋人員規劃`); continue; }
    if (!person) { warn("UNKNOWN_PERSON", `${name}：找不到人員，已略過人員規劃`); continue; }
    if (unavailable.has(employeeId)) { warn("ABSENT_RULE", `${name}：缺勤或離職情境中，暫不套用人員規劃`); continue; }
    if (!attendanceIds.has(employeeId)) { warn("OUTSIDE_ATTENDANCE", `${name}：不在有效出勤名單，暫不套用人員規劃`); continue; }
    const requested = [...new Set(raw.stationIds.map((id) => id.trim()))];
    if (raw.mode === "fixed" && requested.length !== 1) {
      warn("INVALID_RULE", `${name}：固定規劃必須且只能指定一站，已略過`);
      continue;
    }
    const existing = requested.filter((stationId) => {
      if (stationIds.has(stationId)) return true;
      warn("UNKNOWN_STATION", `${name}：站點 ${stationId} 不在目前有效規則內`, stationId);
      return false;
    });
    let fixedQualified = true;
    for (const stationId of existing) {
      const status = getCoverageQualificationStatus(input.qualifications, employeeId, stationId);
      if (status !== "合格") {
        warn(status === "不可排" ? "BLOCKED_QUALIFICATION" : "QUALIFICATION_REQUIRED",
          `${name}：${stationId} ${status === "不可排" ? "標記不可排" : "尚無正式資格"}，不會自動配置`, stationId);
        fixedQualified = false;
      }
    }
    if (raw.mode === "fixed" && (!existing.length || !fixedQualified)) continue;
    // An empty allowed list still forbids all edges; stale IDs must not broaden permission.
    validRules.push({ employeeId, mode: raw.mode, stationIds: existing });
    if (raw.mode === "fixed") fixedAssignments.set(employeeId, existing[0]);
  }
  return { validRules, fixedAssignments, warnings };
}

export function isPlanningStationAllowed(rules: PlanningRule[], employeeId: string, stationId: string) {
  const rule = rules.find((item) => item.employeeId === employeeId);
  return !rule || rule.mode === "preferred" || rule.stationIds.includes(stationId);
}
