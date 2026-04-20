import type { AppBootstrap, Person, Qualification, Station } from "../types";
import { mockBootstrap } from "./mockData";

const API_URL =
  import.meta.env.VITE_GAS_API_URL ||
  "https://script.google.com/macros/s/AKfycbxKRcMC6vplkm34uw2-LDGKm_wY_OxM_UoeIInQOBeJK94VJ8d-40yEov-4sGpLdlV3/exec";

const USE_MOCK = String(import.meta.env.VITE_USE_MOCK || "false") !== "false";

let localCache: AppBootstrap = structuredClone(mockBootstrap);

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
    const data = await request<AppBootstrap>("bootstrap", undefined, "GET");
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
    localCache.stations = localCache.stations.map((station) => (station.id === payload.id ? payload : station));
  }
  return payload;
}

export async function updatePerson(payload: Person): Promise<Person> {
  try {
    await request("updatePerson", payload, "POST");
  } catch {
    localCache.people = localCache.people.map((person) => (person.id === payload.id ? payload : person));
  }
  return payload;
}
