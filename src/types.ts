export type UserRole = "技術員" | "領班" | "組長" | "主任";

export type ShiftMode = "全部在職" | "第一天" | "第二天";

export type QualificationStatus = "合格" | "訓練中" | "不可排" | "";

export interface Person {
  id: string;
  name: string;
  shift: string;
  role: string;
  nationality: string;
  day1: string;
  day2: string;
  employmentStatus: string;
  note?: string;
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
}
