import type { AppBootstrap, Person, Qualification, Station } from "../types";
import { mockBootstrap } from "./mockData";

const API_URL =
  import.meta.env.VITE_GAS_API_URL ||
  "https://script.google.com/macros/s/AKfycbwsqvP9ogL4v81T3luON_43aHt1Vdz-e3bT--sEH2n56eKj11z05FPhkCC4rFouwt4w_A/exec";

const USE_MOCK = String(import.meta.env.VITE_USE_MOCK || "false") !== "false";

let localCache: AppBootstrap = structuredClone(mockBootstrap);

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeBootstrap(payload: unknown): AppBootstrap {
  const source =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: unknown }).data
      : payload;

  const obj = source && typeof source === "object" ? (source as Record<string, unknown>) : {};

  const people = ensureArray<Person>(obj.people);
  const stations = ensureArray<Station>(obj.stations);
  const qualifications = ensureArray<Qualification>(obj.qualifications);

  return {
    people,
    stations,
    qualifications,
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
