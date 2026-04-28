import type { AppBootstrap, Person, Qualification, Station, StationRule } from "../types";

const API_URL =
  import.meta.env.VITE_GAS_API_URL ||
  "https://script.google.com/macros/s/AKfycby5fl0fRqY7gPjLSaVlyEGBkAYUMd0CgF8-WwWkwpALYJhTESryOE-Jdbh2SbarF1OD8A/exec";

export interface LoginPayload {
  account: string;
  password: string;
}

export interface LoginResult {
  ok: boolean;
  message: string;
  user?: Person;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toBool(value: unknown) {
  return String(value ?? "").toUpperCase() === "Y" || String(value ?? "") === "啟用" || value === true;
}

function normalizePermissionValue(item: Record<string, unknown>) {
  return String(item.systemPermission ?? item.permissionLevel ?? item["系統權限"] ?? "").trim();
}

function normalizePerson(item: Record<string, unknown>): Person {
  const explicitPermission = normalizePermissionValue(item);
  const permission = explicitPermission || "技術員";

  return {
    id: String(item.id ?? item["工號"] ?? "").trim(),
    name: String(item.name ?? item["姓名"] ?? "").trim(),
    shift: String(item.shift ?? item["班別"] ?? "").trim(),
    role: String(item.role ?? item["職務"] ?? "").trim(),
    nationality: String(item.nationality ?? item["國籍"] ?? "").trim(),
    aDay1: String(item.aDay1 ?? item["(A)第一天"] ?? "").trim(),
    aDay2: String(item.aDay2 ?? item["(A)第二天"] ?? "").trim(),
    bDay1: String(item.bDay1 ?? item["(B)第一天"] ?? "").trim(),
    bDay2: String(item.bDay2 ?? item["(B)第二天"] ?? "").trim(),
    employmentStatus: String(item.employmentStatus ?? item["在職狀態"] ?? "").trim(),
    note: String(item.note ?? item["備註"] ?? "").trim(),
    systemPermission: permission,
    permissionLevel: permission,
    isSuperAdmin: toBool(item.isSuperAdmin ?? item["是否最高權限"]),
    account: String(item.account ?? item["登入帳號"] ?? "").trim(),
    loginPassword: String(item.loginPassword ?? item.password ?? item["登入密碼"] ?? "").trim(),
    password: String(item.password ?? item.loginPassword ?? item["登入密碼"] ?? "").trim(),
    accountEnabled: String(item.accountEnabled ?? item.accountStatus ?? item.enabled ?? item["啟用狀態"] ?? "").trim(),
    accountStatus: String(item.accountStatus ?? item.accountEnabled ?? item.enabled ?? item["啟用狀態"] ?? "").trim(),
  } as Person;
}

function normalizePeople(rows: unknown[]): Person[] {
  return rows
    .map((row) => normalizePerson(row as Record<string, unknown>))
    .filter((item) => {
      if (!item.id || !item.name) return false;
      if (item.id.includes("唯一主鍵") || item.name.includes("正式姓名") || item.shift.includes("下拉選單")) {
        return false;
      }
      return true;
    });
}

function normalizeStations(rows: unknown[]): Station[] {
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? item["站點代碼"] ?? "").trim(),
        name: String(item.name ?? item["站點名稱"] ?? "").trim(),
        normalMin: Number(item.normalMin ?? item["正班最低人數"] ?? item["最低需求"] ?? 0),
        reliefMinPerBatch: Number(item.reliefMinPerBatch ?? item["輪休最低人數"] ?? item["輪休單批最低"] ?? 0),
        priority: Number(item.priority ?? item["排班優先順序"] ?? 999),
        isMandatory: toBool(item.isMandatory ?? item["是否必站"]),
        backupTarget: Number(item.backupTarget ?? item["備援目標人數"] ?? item["備援目標"] ?? 0),
        description: String(item.description ?? item["站點群組"] ?? item["說明"] ?? "").trim(),
        note: String(item.note ?? item["備註"] ?? "").trim(),
      } as Station;
    })
    .filter((item) => item.id && !item.id.includes("唯一主鍵"));
}

function normalizeQualifications(rows: unknown[]): Qualification[] {
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        employeeId: String(item.employeeId ?? item["工號"] ?? "").trim(),
        employeeName: String(item.employeeName ?? item["姓名"] ?? "").trim(),
        stationId: String(item.stationId ?? item["站點代碼"] ?? "").trim(),
        status: String(item.status ?? item["資格狀態"] ?? "") as Qualification["status"],
        rawStatus: String(item.rawStatus ?? item["資格狀態"] ?? "").trim(),
      };
    })
    .filter((item) => item.employeeId && item.stationId && !item.employeeId.includes("唯一主鍵"));
}

function normalizeRules(rows: unknown[]): StationRule[] {
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? item["規則ID"] ?? item["唯一主鍵"] ?? "").trim(),
        team: String(item.team ?? item["班別"] ?? "").trim(),
        dayKey: String(item.dayKey ?? item["日別"] ?? "").trim(),
        stationId: String(item.stationId ?? item["站點代碼"] ?? "").trim(),
        minRequired: Number(item.minRequired ?? item["最低需求"] ?? 0),
        reliefMinPerBatch: Number(item.reliefMinPerBatch ?? item["輪休需求(單批)"] ?? item["輪休需求"] ?? item["輪休單批最低"] ?? 0),
        backupTarget: Number(item.backupTarget ?? item["備援目標"] ?? 0),
        priority: Number(item.priority ?? item["排班優先順序"] ?? 999),
        isMandatory: toBool(item.isMandatory ?? item["必站"] ?? item["是否必站"]),
        trainingCanFill: toBool(item.trainingCanFill ?? item["訓練中"] ?? item["訓練中可補位"]),
        qualificationLimit: String(item.qualificationLimit ?? item["資格限制"] ?? "不限").trim(),
        canShare: toBool(item.canShare ?? item["支援補位"] ?? item["可否共用人力"]),
        enabled: String(item.enabled ?? item["啟用狀態"] ?? "") !== "停用",
        note: String(item.note ?? item["備註"] ?? "").trim(),
      } as StationRule;
    })
    .filter((item) => item.stationId && item.team && !item.id.includes("唯一主鍵"));
}

function normalizeBootstrap(payload: unknown): AppBootstrap {
  const source =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: unknown }).data
      : payload;

  const obj = source && typeof source === "object" ? (source as Record<string, unknown>) : {};

  const people = normalizePeople(ensureArray(obj.people));
  const stations = normalizeStations(ensureArray(obj.stations));
  const qualifications = normalizeQualifications(ensureArray(obj.qualifications));
  const stationRules = normalizeRules(ensureArray(obj.stationRules ?? obj.rules));

  return {
    people,
    stations,
    qualifications,
    stationRules,
  };
}

async function request<T>(action: string, payload?: unknown, method: "GET" | "POST" = "POST"): Promise<T> {
  if (method === "GET") {
    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`API failed: ${response.status}`);
    }
    return response.json();
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ action, payload }),
  });

  if (!response.ok) {
    throw new Error(`API failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchBootstrapData(): Promise<AppBootstrap> {
  const raw = await request<unknown>("bootstrap", undefined, "GET");
  return normalizeBootstrap(raw);
}

export async function loginWithAccount(payload: LoginPayload): Promise<LoginResult> {
  const raw = await request<unknown>("login", payload, "POST");
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ok = Boolean(obj.ok);
  const message = String(obj.message ?? (ok ? "登入成功" : "登入失敗"));
  const user = obj.user && typeof obj.user === "object" ? normalizePerson(obj.user as Record<string, unknown>) : undefined;
  return { ok, message, user };
}

export async function upsertQualification(payload: Qualification): Promise<Qualification> {
  await request("upsertQualification", payload, "POST");
  return payload;
}

export async function deleteQualification(payload: Pick<Qualification, "employeeId" | "stationId">): Promise<void> {
  await request("deleteQualification", payload, "POST");
}

export async function updateStationRule(payload: StationRule): Promise<StationRule> {
  await request("updateStationRule", payload, "POST");
  return payload;
}

export async function updatePerson(payload: Person): Promise<Person> {
  await request("updatePerson", payload, "POST");
  return payload;
}
