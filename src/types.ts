export type UserRole = "技術員" | "領班" | "組長" | "主任";

export type ShiftMode = "全部在職" | "當班" | "第一天" | "第二天";

export type QualificationStatus = "合格" | "訓練中" | "不可排" | "";

export type TeamName = "婷芬班" | "美香班" | "俊志班" | "翊展班";

export type SmartScheduleMode = "當班優先" | "支援優先" | "資格優先";

export interface Person {
  id: string;
  name: string;
  shift: string;
  role: string;
  nationality: string;
  employmentStatus: string;
  note?: string;
  aDay1?: string;
  aDay2?: string;
  bDay1?: string;
  bDay2?: string;
}

export interface Station {
  id: string;
  name: string;
  normalMin: number;
  reliefMinPerBatch: number;
  priority?: number | null;
  isMandatory?: boolean | null;
  backupTarget?: number | null;
  description?: string;
  note?: string;
}

export interface StationRule {
  id: string;
  team: string;
  dayKey: string;
  stationId: string;
  minRequired: number;
  backupTarget?: number | null;
  priority?: number | null;
  isMandatory?: boolean | null;
  trainingCanFill?: boolean | null;
  qualificationLimit?: string;
  canShare?: boolean | null;
  enabled?: boolean | null;
  note?: string;
}

export interface Qualification {
  employeeId: string;
  employeeName?: string;
  stationId: string;
  status: QualificationStatus;
  rawStatus?: string;
}

export interface AppBootstrap {
  people: Person[];
  stations: Station[];
  qualifications: Qualification[];
  stationRules?: StationRule[];
}

export interface AttendanceSummary {
  own: Person[];
  support: Person[];
  all: Person[];
  ownDuty: string;
  supportDuty: string;
  supportTeam: TeamName;
  localCount: number;
  filipinoCount: number;
  vietnamCount: number;
  totalCount: number;
}

export interface SmartAssignmentRow {
  stationId: string;
  assigned: Person[];
  shortage: number;
  source: string[];
}
