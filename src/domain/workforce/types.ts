import type {
  AppBootstrap,
  ShiftMode,
  TeamName,
} from "../../types";
import type {
  CoverageAnalysisResult,
  CoverageStationRow,
} from "../../lib/selectors";

export type ScenarioAssignmentSource = "manual" | "training" | "officer";

export interface ScenarioAssignment {
  employeeId: string;
  stationId: string;
  source: ScenarioAssignmentSource;
}

export interface WorkforceScenario {
  team: TeamName;
  mode: ShiftMode;
  unavailableIds?: string[];
  assignments?: ScenarioAssignment[];
}

export type WorkforceViolationCode =
  | "UNKNOWN_PERSON"
  | "UNKNOWN_STATION"
  | "OUTSIDE_ATTENDANCE"
  | "ABSENT_ASSIGNMENT"
  | "DUPLICATE_ASSIGNMENT"
  | "QUALIFICATION_REQUIRED"
  | "BLOCKED_QUALIFICATION"
  | "OFFICER_SOURCE_REQUIRED"
  | "INVALID_OFFICER_ASSIGNMENT";

export interface WorkforceViolation {
  code: WorkforceViolationCode;
  message: string;
  employeeId?: string;
  stationId?: string;
}

export interface AssignmentReason {
  employeeId: string;
  stationId: string;
  source: ScenarioAssignmentSource | "automatic";
  message: string;
}

export interface WorkforceResult {
  scenario: WorkforceScenario;
  analysis: CoverageAnalysisResult;
  rows: CoverageStationRow[];
  assignments: Record<string, string[]>;
  unassignedIds: string[];
  reasons: AssignmentReason[];
  violations: WorkforceViolation[];
}

export type WorkforceSnapshot = AppBootstrap;
