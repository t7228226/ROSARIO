import { appEnvironment } from "../config/environment";
import { FRONT_WRITE_ACTIONS } from "../config/writeActions";
import type { AppBootstrap, Person } from "../types";

export type GasResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
};

export type GasSessionResponse = GasResponse & {
  user?: Person;
  sessionToken?: string;
  sessionExpiresAt?: number;
};

type PendingWriteOperation = {
  operationId: string;
  createdAt: number;
};

type GasOperationStatus = GasResponse & {
  found?: boolean;
  status?: "processing" | "success" | "failed" | "unknown";
  result?: GasResponse;
};

const GAS_ENDPOINT = appEnvironment.gasEndpoint;
const APP_VERSION = appEnvironment.version;
const GAS_READ_TIMEOUT_MS = 20_000;
const GAS_BOOTSTRAP_TIMEOUT_MS = 60_000;
const GAS_WRITE_TIMEOUT_MS = 60_000;
const GAS_WRITE_STATUS_TIMEOUT_MS = 12_000;
const PENDING_WRITE_TTL_MS = 15 * 60 * 1000;
const pendingWriteStorageKey = "stationAppPendingWrites";
const inFlightWriteRequests = new Map<string, Promise<GasResponse>>();
let activeSessionToken = "";

class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`連線逾時（${Math.round(timeoutMs / 1000)} 秒）。`);
    this.name = "RequestTimeoutError";
  }
}

class GasRequestRejectedError extends Error {
  readonly code: string;

  constructor(message: string, code = "REQUEST_FAILED") {
    super(message);
    this.name = "GasRequestRejectedError";
    this.code = code;
  }
}

export function setGasSessionToken(sessionToken: string) {
  activeSessionToken = String(sessionToken || "").trim();
}

export function clearGasSessionToken() {
  activeSessionToken = "";
}

function notifyExpiredSession(code: string) {
  if (!code.startsWith("AUTH_")) return;
  clearGasSessionToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("rosario:session-expired", { detail: { code } }));
  }
}

function showGlobalProcessingOverlay(kind: "save" | "delete") {
  if (typeof document === "undefined") return;
  const title = kind === "delete" ? "資料刪除中" : "資料處理中";
  const detail = kind === "delete"
    ? "正在更新系統資料，請勿關閉頁面或重複操作。"
    : "正在寫入系統，請勿關閉頁面或重複操作。";

  let overlay = document.getElementById("global-processing-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "global-processing-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-live", "assertive");
    overlay.innerHTML = `
      <div class="global-processing-card">
        <div class="global-processing-spinner" aria-hidden="true"></div>
        <h2 class="global-processing-title"></h2>
        <p class="global-processing-detail"></p>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  overlay.className = `global-processing-overlay ${kind === "delete" ? "is-delete" : "is-save"}`;
  updateGlobalProcessingOverlay(title, detail);
}

function updateGlobalProcessingOverlay(title: string, detail: string) {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("global-processing-overlay");
  if (!overlay) return;
  const titleEl = overlay.querySelector(".global-processing-title");
  const detailEl = overlay.querySelector(".global-processing-detail");
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
}

function hideGlobalProcessingOverlay() {
  if (typeof document === "undefined") return;
  document.getElementById("global-processing-overlay")?.remove();
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getWriteFingerprint(action: string, payload: Record<string, unknown>) {
  const serialized = stableSerialize(payload);
  return `${action}:${serialized.length}:${hashText(serialized)}`;
}

function readPendingWrites(): Record<string, PendingWriteOperation> {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(pendingWriteStorageKey) || "{}") as Record<string, PendingWriteOperation>;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, item]) => item?.operationId && now - Number(item.createdAt || 0) < PENDING_WRITE_TTL_MS)
    );
  } catch {
    return {};
  }
}

function rememberPendingWrite(fingerprint: string, operation: PendingWriteOperation) {
  try {
    const pending = readPendingWrites();
    pending[fingerprint] = operation;
    window.sessionStorage.setItem(pendingWriteStorageKey, JSON.stringify(pending));
  } catch {
    // The current in-flight request is still deduplicated when storage is unavailable.
  }
}

function clearPendingWrite(fingerprint: string) {
  try {
    const pending = readPendingWrites();
    delete pending[fingerprint];
    window.sessionStorage.setItem(pendingWriteStorageKey, JSON.stringify(pending));
  } catch {
    // Cleanup failure does not change the write result.
  }
}

function createOperationId(action: string) {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2);
  return `OP_${action}_${Date.now()}_${randomPart}`.slice(0, 120);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = GAS_READ_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function readGasResult(response: Response, fallbackMessage: string) {
  return response.json().then((result: GasResponse) => {
    if (!response.ok || result.ok === false) {
      const code = String(result.code || "REQUEST_FAILED");
      notifyExpiredSession(code);
      throw new GasRequestRejectedError(String(result.message || fallbackMessage), code);
    }
    return result;
  });
}

async function sendGasAction(action: string, payload: Record<string, unknown>, operationId?: string) {
  const response = await fetchWithTimeout(GAS_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action,
      appVersion: APP_VERSION,
      operationId,
      sessionToken: activeSessionToken || undefined,
      payload,
    }),
  }, operationId ? GAS_WRITE_TIMEOUT_MS : GAS_READ_TIMEOUT_MS);
  return readGasResult(response, `GAS ${action} 請求失敗`);
}

async function fetchGasOperationStatus(operationId: string): Promise<GasOperationStatus> {
  const result = await sendGasAction("operationStatus", { operationId }) as GasOperationStatus;
  return result;
}

async function pollGasOperation(operationId: string, delays = [700, 1400, 2500, 4000]): Promise<GasResponse | null> {
  for (const delay of delays) {
    await wait(delay);
    try {
      const status = await fetchGasOperationStatus(operationId);
      if (status.status === "success" && status.result) return status.result;
      if (status.status === "failed") throw new GasRequestRejectedError(String(status.message || "資料寫入失敗。"));
      if (!status.found || status.status === "unknown") return null;
    } catch (error) {
      if (error instanceof GasRequestRejectedError) throw error;
    }
  }
  return null;
}

function isTransientWriteError(error: unknown) {
  return error instanceof RequestTimeoutError ||
    error instanceof TypeError ||
    (error instanceof Error && /network|fetch|連線|逾時/i.test(error.message));
}

async function performReliableGasWrite(
  action: string,
  payload: Record<string, unknown>,
  fingerprint: string,
  operationId: string
): Promise<GasResponse> {
  const processingKind = action.toLowerCase().includes("delete") ? "delete" : "save";
  showGlobalProcessingOverlay(processingKind);
  rememberPendingWrite(fingerprint, { operationId, createdAt: Date.now() });

  try {
    try {
      const result = await sendGasAction(action, payload, operationId);
      if (!result.pending) {
        clearPendingWrite(fingerprint);
        return result;
      }
    } catch (error) {
      if (error instanceof GasRequestRejectedError) {
        clearPendingWrite(fingerprint);
        throw error;
      }
      if (!isTransientWriteError(error)) throw error;
    }

    updateGlobalProcessingOverlay("正在確認儲存結果", "連線較慢，系統正在確認資料是否已經寫入，請勿重複操作。");
    const confirmed = await pollGasOperation(operationId);
    if (confirmed) {
      clearPendingWrite(fingerprint);
      return confirmed;
    }

    updateGlobalProcessingOverlay("正在重新送出", "系統將沿用相同操作編號送出，以避免重複新增資料。");
    try {
      const retried = await sendGasAction(action, payload, operationId);
      if (!retried.pending) {
        clearPendingWrite(fingerprint);
        return retried;
      }
    } catch (error) {
      if (error instanceof GasRequestRejectedError) {
        clearPendingWrite(fingerprint);
        throw error;
      }
      if (!isTransientWriteError(error)) throw error;
    }

    updateGlobalProcessingOverlay("仍在確認中", "伺服器仍在處理，系統會再次核對結果。");
    const retriedConfirmation = await pollGasOperation(operationId, [1000, 2000, 4000, 6000]);
    if (retriedConfirmation) {
      clearPendingWrite(fingerprint);
      return retriedConfirmation;
    }

    throw new Error(`資料可能仍在處理，請先重新整理確認；再次操作時系統會沿用同一筆請求。操作編號：${operationId}`);
  } finally {
    hideGlobalProcessingOverlay();
  }
}

export async function postGasAction(action: string, payload: Record<string, unknown>): Promise<GasResponse> {
  if (!FRONT_WRITE_ACTIONS.has(action)) return sendGasAction(action, payload);
  if (!appEnvironment.writesEnabled) throw new Error("升級測試環境目前為唯讀，已阻擋寫入正式資料。");

  const fingerprint = getWriteFingerprint(action, payload);
  const currentRequest = inFlightWriteRequests.get(fingerprint);
  if (currentRequest) return currentRequest;

  const pending = readPendingWrites()[fingerprint];
  const operationId = pending?.operationId || createOperationId(action);
  const request = performReliableGasWrite(action, payload, fingerprint, operationId)
    .finally(() => inFlightWriteRequests.delete(fingerprint));
  inFlightWriteRequests.set(fingerprint, request);
  return request;
}

export async function fetchGasBootstrapData(): Promise<AppBootstrap> {
  const response = await fetchWithTimeout(GAS_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action: "bootstrap",
      appVersion: APP_VERSION,
      sessionToken: activeSessionToken || undefined,
      payload: {},
    }),
  }, GAS_BOOTSTRAP_TIMEOUT_MS);
  return readGasResult(response, "GAS bootstrap 讀取失敗") as Promise<AppBootstrap>;
}

export async function fetchGasPermissionConfig<T>(): Promise<T> {
  return postGasAction("permissionConfig", {}) as Promise<T>;
}

export async function fetchGasVersionStatus(): Promise<{
  latestVersion: string;
  minWriteVersion: string;
  outdated: boolean;
  writeBlocked: boolean;
  message?: string;
}> {
  const response = await fetchWithTimeout(
    `${GAS_ENDPOINT}?action=version&appVersion=${encodeURIComponent(APP_VERSION)}`,
    { cache: "no-store" },
    10_000
  );
  const result = await readGasResult(response, "版本檢查失敗");
  return {
    latestVersion: String(result.latestVersion || APP_VERSION),
    minWriteVersion: String(result.minWriteVersion || result.latestVersion || APP_VERSION),
    outdated: Boolean(result.outdated),
    writeBlocked: Boolean(result.writeBlocked),
    message: typeof result.message === "string" ? result.message : undefined,
  };
}
