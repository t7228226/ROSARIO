import { clearGasSessionToken, fetchWithTimeout } from "./gasClient";

export type LoginKeepKey = "8h" | "12h" | "24h" | "7d";

export type StoredLoginSession = {
  userId: string;
  sessionToken: string;
  expiresAt: number;
};

export const loginKeepOptions: Array<{ key: LoginKeepKey; label: string; ms: number }> = [
  { key: "8h", label: "8小時", ms: 8 * 60 * 60 * 1000 },
  { key: "12h", label: "12小時", ms: 12 * 60 * 60 * 1000 },
  { key: "24h", label: "24小時", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7天", ms: 7 * 24 * 60 * 60 * 1000 },
];

export const loginKeepStorageKey = "stationAppLoginKeep";
export const appVersionStorageKey = "stationAppVersion";
const loginSessionStorageKey = "stationAppLoginSession";

export function compareAppVersion(a: string | null | undefined, b: string | null | undefined) {
  const parse = (value: string | null | undefined) => {
    const text = String(value || "").trim();
    const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!dateMatch) return null;
    const revisionMatch = text.match(/(?:-v\d+)?-(\d+)$/);
    return {
      date: Number(`${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}`),
      revision: Number(revisionMatch?.[1] || 0),
    };
  };
  const left = parse(a);
  const right = parse(b);
  if (left && right) {
    if (left.date !== right.date) return left.date - right.date;
    if (left.revision !== right.revision) return left.revision - right.revision;
  }
  return String(a || "").localeCompare(String(b || ""), "en", { numeric: true });
}

export async function fetchDeployedFrontendVersion(): Promise<string | null> {
  const base = import.meta.env.BASE_URL || "/";
  const response = await fetchWithTimeout(`${base}version.json?t=${Date.now()}`, { cache: "no-store" }, 8_000);
  if (!response.ok) return null;
  const result = (await response.json()) as { version?: string };
  return result.version ? String(result.version) : null;
}

export function getStoredLoginKeep(): LoginKeepKey {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem(loginKeepStorageKey) : "";
  return loginKeepOptions.some((item) => item.key === stored) ? (stored as LoginKeepKey) : "12h";
}

export function getLoginKeepMs(key: LoginKeepKey) {
  return loginKeepOptions.find((item) => item.key === key)?.ms || loginKeepOptions[1].ms;
}

export function readStoredLoginSession(): StoredLoginSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(loginSessionStorageKey);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<StoredLoginSession>;
    if (!session.userId || !session.sessionToken || !session.expiresAt || Date.now() >= session.expiresAt) return null;
    return session as StoredLoginSession;
  } catch {
    return null;
  }
}

export function saveStoredLoginSession(session: StoredLoginSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(loginSessionStorageKey, JSON.stringify(session));
}

export function clearStoredLoginSession() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(loginSessionStorageKey);
  }
  clearGasSessionToken();
}
