import { appEnvironment } from "../config/environment";
import { FRONT_WRITE_ACTIONS } from "../config/writeActions";
import type { AppBootstrap, Person, OperationReceipt, WriteProgress } from "../types";
export type { OperationReceipt, WriteProgress } from "../types";

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
  expectedRevision: number;
};

type GasOperationStatus = GasResponse & {
  found?: boolean;
  status?: OperationReceipt["status"];
  result?: GasResponse;
};

const GAS_ENDPOINT = appEnvironment.gasEndpoint;
const APP_VERSION = appEnvironment.version;
const GAS_READ_TIMEOUT_MS = 20_000;
const GAS_BOOTSTRAP_TIMEOUT_MS = 60_000;
const GAS_WRITE_TIMEOUT_MS = 60_000;
const GAS_WRITE_STATUS_TIMEOUT_MS = 12_000;
const pendingWriteStorageKey = "stationAppPendingWrites";
const inFlightWriteRequests = new Map<string, Promise<GasResponse>>();
let activeSessionToken = "";
let observedRevision: number | undefined;

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

class ServiceResponseError extends Error {}

export function setGasSessionToken(sessionToken: string) {
  if (activeSessionToken !== String(sessionToken || "").trim()) observedRevision = undefined;
  activeSessionToken = String(sessionToken || "").trim();
}

export function clearGasSessionToken() {
  activeSessionToken = "";
  observedRevision = undefined;
}

function notifyExpiredSession(code: string) {
  if (!code.startsWith("AUTH_")) return;
  clearGasSessionToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("rosario:session-expired", { detail: { code } }));
  }
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

function readPendingWrites(): Record<string, PendingWriteOperation> {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(pendingWriteStorageKey) || "{}") as Record<string, PendingWriteOperation>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, item]) => item?.operationId && Number.isSafeInteger(item.expectedRevision))
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

async function readGasResult(response: Response, fallbackMessage: string, expectedSession?: string) {
  let result: GasResponse;
  const body = await response.text();
  if (expectedSession !== undefined && expectedSession !== activeSessionToken) throw new GasRequestRejectedError("登入狀態已變更，已忽略舊回應。", "SESSION_CHANGED");
  try { result = JSON.parse(body) as GasResponse; }
  catch { throw new ServiceResponseError("資料服務暫時未回傳有效內容。讀取可稍後重試；寫入須以相同操作編號核對結果。"); }
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.ok !== "boolean") throw new ServiceResponseError("資料服務回應格式無法辨識，請稍後重試。");
  if (!response.ok || result.ok === false) {
    const code = String(result.code || "REQUEST_FAILED");
    if (expectedSession !== undefined) notifyExpiredSession(code);
    if (code === "REVISION_CONFLICT" || code === "REVISION_REQUIRED") {
      window.dispatchEvent(new CustomEvent("rosario:data-conflict", { detail: { message: String(result.message || fallbackMessage) } }));
    }
    throw new GasRequestRejectedError(String(result.message || fallbackMessage), code);
  }
  return result;
}

async function sendGasAction(action: string, payload: Record<string, unknown>, operationId?: string, sessionToken = activeSessionToken) {
  if (sessionToken !== activeSessionToken) throw new GasRequestRejectedError("登入狀態已變更，請重新確認操作。", "SESSION_CHANGED");
  const response = await fetchWithTimeout(GAS_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action,
      appVersion: APP_VERSION,
      operationId,
      sessionToken: sessionToken || undefined,
      payload,
    }),
  }, operationId ? GAS_WRITE_TIMEOUT_MS : GAS_READ_TIMEOUT_MS);
  if (sessionToken !== activeSessionToken) throw new GasRequestRejectedError("登入狀態已變更，已停止舊操作的畫面更新。", "SESSION_CHANGED");
  return readGasResult(response, `GAS ${action} 請求失敗`, sessionToken);
}

async function pollGasOperation(operationId: string, delays = [700, 1400, 2500, 4000], sessionToken = activeSessionToken): Promise<GasResponse | null> {
  for (const delay of delays) {
    await wait(delay);
    try {
      const status = await sendGasAction("operationStatus", { operationId }, undefined, sessionToken) as GasOperationStatus;
      if (status.status === "success" && status.operationId === operationId && status.result?.ok === true) return status.result;
      if (status.status === "failed") throw new GasRequestRejectedError(String(status.message || "資料寫入失敗。"), String(status.code || "REQUEST_FAILED"));
      if (status.status === "reviewed") throw new GasRequestRejectedError("原操作已由管理員核對，系統不會重新執行。", "OPERATION_REVIEWED");
      if (status.found && status.status === "unknown") throw new GasRequestRejectedError("先前寫入結果待確認；請核對資料，系統不會重新執行。", "WRITE_OUTCOME_UNKNOWN");
      if (!status.found || status.status === "unknown") return null;
    } catch (error) {
      if (error instanceof GasRequestRejectedError) throw error;
    }
  }
  return null;
}

function isTransientWriteError(error: unknown) {
  return error instanceof RequestTimeoutError ||
    error instanceof ServiceResponseError ||
    error instanceof TypeError ||
    (error instanceof Error && /network|fetch|連線|逾時/i.test(error.message));
}

function assertConfirmedWrite(result: GasResponse, operationId: string) {
  if (result.operationId !== operationId || result.operationStatus !== "success") {
    throw new ServiceResponseError("伺服器未提供相符的完成憑證，請核對操作結果。");
  }
}

async function performReliableGasWrite(
  action: string,
  payload: Record<string, unknown>,
  fingerprint: string,
  operationId: string,
  sessionToken: string
): Promise<GasResponse> {
  rememberPendingWrite(fingerprint, { operationId, createdAt: Date.now(), expectedRevision: Number(payload.expectedRevision) });
  const createdAt = Date.now();
  function progress(status: OperationReceipt["status"], phase: WriteProgress["phase"], code?: string) {
    if (sessionToken !== activeSessionToken) return;
    window.dispatchEvent(new CustomEvent<WriteProgress>("rosario:write-progress", { detail: { operationId, action, status, phase, createdAt, updatedAt: Date.now(), code } }));
  }
  progress("processing", "sending");

  try {
    try {
      const result = await sendGasAction(action, payload, operationId, sessionToken);
      if (!result.pending) {
        assertConfirmedWrite(result, operationId);
        clearPendingWrite(fingerprint);
        if (typeof result.revision === "number") observedRevision = result.revision;
        progress("success", "settled");
        return result;
      }
    } catch (error) {
      if (error instanceof GasRequestRejectedError) {
        if (error.code !== "WRITE_OUTCOME_UNKNOWN") clearPendingWrite(fingerprint);
        else window.dispatchEvent(new CustomEvent("rosario:write-uncertain", { detail: { message: error.message, operationId } }));
        throw error;
      }
      if (!isTransientWriteError(error)) throw error;
    }

    progress("processing", "checking");
    const confirmed = await pollGasOperation(operationId, undefined, sessionToken);
    if (confirmed) {
      clearPendingWrite(fingerprint);
      if (typeof confirmed.revision === "number") observedRevision = confirmed.revision;
      progress("success", "settled");
      return confirmed;
    }

    try {
      progress("processing", "retrying");
      const retried = await sendGasAction(action, payload, operationId, sessionToken);
      if (!retried.pending) {
        assertConfirmedWrite(retried, operationId);
        clearPendingWrite(fingerprint);
        if (typeof retried.revision === "number") observedRevision = retried.revision;
        progress("success", "settled");
        return retried;
      }
    } catch (error) {
      if (error instanceof GasRequestRejectedError) {
        if (error.code !== "WRITE_OUTCOME_UNKNOWN") clearPendingWrite(fingerprint);
        else window.dispatchEvent(new CustomEvent("rosario:write-uncertain", { detail: { message: error.message, operationId } }));
        throw error;
      }
      if (!isTransientWriteError(error)) throw error;
    }

    const retriedConfirmation = await pollGasOperation(operationId, [1000, 2000, 4000, 6000], sessionToken);
    if (retriedConfirmation) {
      clearPendingWrite(fingerprint);
      if (typeof retriedConfirmation.revision === "number") observedRevision = retriedConfirmation.revision;
      progress("success", "settled");
      return retriedConfirmation;
    }

    throw new GasRequestRejectedError(`資料可能仍在處理，請至操作狀態核對。操作編號：${operationId}`, "WRITE_OUTCOME_UNKNOWN");
  } catch (error) {
    const code = error instanceof GasRequestRejectedError ? error.code : "WRITE_OUTCOME_UNKNOWN";
    if (code !== "WRITE_OUTCOME_UNKNOWN" && code !== "SESSION_CHANGED") clearPendingWrite(fingerprint);
    progress(code === "WRITE_OUTCOME_UNKNOWN" ? "unknown" : "failed", "settled", code);
    throw error;
  }
}

export async function postGasAction(action: string, payload: Record<string, unknown>): Promise<GasResponse> {
  if (!FRONT_WRITE_ACTIONS.has(action)) return sendGasAction(action, payload);
  if (!appEnvironment.writesEnabled) throw new Error("升級測試環境目前為唯讀，已阻擋寫入正式資料。");
  if (observedRevision === undefined) throw new Error("尚未取得可寫入的資料版本，請先重新載入；若仍無法儲存，請確認新版 GAS 已部署。");
  const sessionToken = activeSessionToken;
  const revision = observedRevision;
  payload = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const logicalKey = `${sessionToken}\n${action}\n${stableSerialize(payload)}`;
  const currentRequest = inFlightWriteRequests.get(logicalKey);
  if (currentRequest) return currentRequest;
  const request = (async () => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(logicalKey));
    if (sessionToken !== activeSessionToken) throw new GasRequestRejectedError("登入狀態已變更。", "SESSION_CHANGED");
    const fingerprint = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const pending = readPendingWrites()[fingerprint];
    if (pending && Date.now() - pending.createdAt >= 24 * 3600000) throw new GasRequestRejectedError("先前操作已超過可自動重送期限，請先核對資料，不要直接再次新增。", "WRITE_OUTCOME_UNKNOWN");
    const writePayload = { ...payload, expectedRevision: pending?.expectedRevision ?? revision };
    const operationId = pending?.operationId || createOperationId(action);
    return performReliableGasWrite(action, writePayload, fingerprint, operationId, sessionToken);
  })().finally(() => inFlightWriteRequests.delete(logicalKey));
  inFlightWriteRequests.set(logicalKey, request);
  return request;
}

export async function fetchGasBootstrapData(): Promise<AppBootstrap> {
  const sessionToken = activeSessionToken;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
  const response = await fetchWithTimeout(GAS_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action: "bootstrap",
      appVersion: APP_VERSION,
      sessionToken: sessionToken || undefined,
      payload: {},
    }),
  }, GAS_BOOTSTRAP_TIMEOUT_MS);
  if (sessionToken !== activeSessionToken) throw new GasRequestRejectedError("登入狀態已變更，已忽略舊資料。", "SESSION_CHANGED");
  const result = await readGasResult(response, "GAS bootstrap 讀取失敗", sessionToken);
  observedRevision = typeof result.revision === "number" ? result.revision : undefined;
  return result as unknown as AppBootstrap;
    } catch (error) {
      if (attempt > 0 || !isTransientWriteError(error)) throw error;
      await wait(1200);
    }
  }
  throw new ServiceResponseError("資料讀取失敗，請稍後重新載入。");
}

export async function fetchGasOperations(all = false): Promise<OperationReceipt[]> {
  const result = await postGasAction("listOperations", { all });
  if (!Array.isArray(result.operations)) throw new ServiceResponseError("操作狀態格式不完整，請稍後重新查詢。");
  const records = result.operations as OperationReceipt[];
  if (records.some((item) => !item || typeof item.operationId !== "string" || typeof item.action !== "string" ||
    !["processing", "success", "failed", "unknown", "reviewed"].includes(item.status) || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt))) {
    throw new ServiceResponseError("操作紀錄內容不完整，請重新查詢。");
  }
  return records;
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
