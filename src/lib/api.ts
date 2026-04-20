import type { AppBootstrap, Person, Qualification, Station, StationRule } from "../types";
import { mockBootstrap } from "./mockData";

const API_URL =
  import.meta.env.VITE_GAS_API_URL ||
  "https://script.google.com/macros/s/AKfycbwsqvP9ogL4v81T3luON_43aHt1Vdz-e3bT--sEH2n56eKj11z05FPhkCC4rFouwt4w_A/exec";

const USE_MOCK = String(import.meta.env.VITE_USE_MOCK || "false") !== "false";

let localCache: AppBootstrap = structuredClone(mockBootstrap);

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toBool(value: unknown) {
  return String(value ?? "").toUpperCase() === "Y" || String(value ?? "") === "啟用";
}

function normalizePeople(rows: unknown[]): Person[] {
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? item["工號"] ?? "").trim(),
        name: String(item.name ?? item["姓名"] ?? item["正式姓名"] ?? "").trim(),
        shift: String(item.shift ?? item["班別"] ?? "").trim(),
        role: String(item.role ?? item["職務"] ?? "").trim(),
        nationality: String(item.nationality ?? item["國籍"] ?? "").trim(),
        day1: String(item.day1 ?? item["第一天"] ?? item["(A)第一天"] ?? "").trim(),
        day2: String(item.day2 ?? item["第二天"] ?? item["(A)第二天"] ?? "").trim(),
        aDay1: String(item.aDay1 ?? item["(A)第一天"] ?? "").trim(),
        aDay2: String(item.aDay2 ?? item["(A)第二天"] ?? "").trim(),
        bDay1: String(item.bDay1 ?? item["(B)第一天"] ?? "").trim(),
        bDay2: String(item.bDay2 ?? item["(B)第二天"] ?? "").trim(),
        employmentStatus: String(item.employmentStatus ?? item["在職狀態"] ?? "").trim(),
        note: String(item.note ?? item["備註"] ?? "").trim(),
      } as Person;
    })
    .filter((item) => item.id && item.name);
}

function normalizeStations(rows: unknown[]): Station[] {
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? item["站點代碼"] ?? "").trim(),
        name: String(item.name ?? item["站點名稱"] ?? item["規則ID"] ?? "").trim(),
        normalMin: Number(item.normalMin ?? item["最低需求"] ?? 0),
        reliefMinPerBatch: Number(item.reliefMinPerBatch ?? item["備援目標"] ?? 0),
        priority: Number(item.priority ?? item["排班優先順序"] ?? 999),
        isMandatory: toBool(item.isMandatory ?? item["是否必站"]),
        backupTarget: Number(item.backupTarget ?? item["備援目標"] ?? 0),
        description: String(item.description ?? item["說明"] ?? "").trim(),
        note: String(item.note ?? item["備註"] ?? "").trim(),
      } as Station;
    })
    .filter((item) => item.id);
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
    .filter((item) => item.employeeId && item.stationId);
}

function normalizeRules(rows: unknown[]): StationRule[] {
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? item["規則ID"] ?? item["唯一主鍵"] ?? "").trim(),
        team: String(item.team ?? item["班別"] ?? "").trim(),
        dayKey: String(item.dayKey ?? item["日別"] ?? "").trim(),
        stationId: String(item.stationId ?? item["站點代碼"] ?? item["對應 02_站點主表"] ?? "").trim(),
        minRequired: Number(item.minRequired ?? item["最低需求"] ?? 0),
        backupTarget: Number(item.backupTarget ?? item["備援目標"] ?? 0),
        priority: Number(item.priority ?? item["排班優先順序"] ?? 999),
        isMandatory: toBool(item.isMandatory ?? item["是否必站"]),
        trainingCanFill: toBool(item.trainingCanFill ?? item["訓練中可補位"]),
        qualificationLimit: String(item.qualificationLimit ?? item["資格限制"] ?? "不限").trim(),
        canShare: toBool(item.canShare ?? item["可否共用人力"]),
        enabled: String(item.enabled ?? item["啟用狀態"] ?? "") !== "停用",
        note: String(item.note ?? item["備註"] ?? "").trim(),
      } as StationRule;
    })
    .filter((item) => item.stationId && item.team && item.dayKey);
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
  if (USE_MOCK) {
    throw new Error("mock mode");
  }

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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload }),
  });

  if (!response.ok) {
    throw new Error(`API failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchBootstrapData(): Promise<AppBootstrap> {
  try {
    const raw = await request<unknown>("bootstrap", undefined, "GET");
    const data = normalizeBootstrap(raw);

    if (!data.people.length && !data.stations.length && !data.qualifications.length) {
      return structuredClone(localCache);
    }

    localCache = data;
    return data;
  } catch {
    return structuredClone(localCache);
  }
}

export async function upsertQualification(payload: Qualification): Promise<Qualification> {
  try {
    await request("upsertQualification", payload, "POST");
  } catch {
    const index = localCache.qualifications.findIndex(
      (item) => item.employeeId === payload.employeeId && item.stationId === payload.stationId
    );
    if (index >= 0) {
      localCache.qualifications[index] = payload;
    } else {
      localCache.qualifications.push(payload);
    }
  }
  return payload;
}

export async function deleteQualification(payload: Pick<Qualification, "employeeId" | "stationId">): Promise<void> {
  try {
    await request("deleteQualification", payload, "POST");
  } catch {
    localCache.qualifications = localCache.qualifications.filter(
      (item) => !(item.employeeId === payload.employeeId && item.stationId === payload.stationId)
    );
  }
}

export async function updateStationRule(payload: Station): Promise<Station> {
  try {
    await request("updateStationRule", payload, "POST");
  } catch {
    const exists = localCache.stations.some((station) => station.id === payload.id);
    localCache.stations = exists
      ? localCache.stations.map((station) => (station.id === payload.id ? payload : station))
      : [...localCache.stations, payload];
  }
  return payload;
}

export async function updatePerson(payload: Person): Promise<Person> {
  try {
    await request("updatePerson", payload, "POST");
  } catch {
    const exists = localCache.people.some((person) => person.id === payload.id);
    localCache.people = exists
      ? localCache.people.map((person) => (person.id === payload.id ? payload : person))
      : [...localCache.people, payload];
  }
  return payload;
}
