import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./schedule-overrides.css";
// import { installScheduleRuntime } from "./schedule-runtime";
import { installScheduleShareRuntime } from "./schedule-share-runtime";
import { installScheduleTipRuntime } from "./schedule-tip-runtime";

declare global {
  interface Window {
    __hideBootStatus?: () => void;
    __scheduleRuntimePausedUntil?: number;
  }
}

function showFatalError(title: string, detail: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div style="padding:24px;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;background:#fff7f7;color:#7f1d1d;min-height:100vh;box-sizing:border-box;">
      <h1 style="margin:0 0 12px;font-size:24px;">${title}</h1>
      <p style="margin:0 0 12px;line-height:1.7;">頁面載入失敗，請把下方錯誤截圖提供給我。</p>
      <pre style="white-space:pre-wrap;background:#fff;border:1px solid #fecaca;border-radius:12px;padding:12px;color:#991b1b;overflow:auto;">${detail}</pre>
    </div>
  `;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function isOptionalRuntimeDomError(message: string) {
  return (
    message.includes("Failed to execute 'insertBefore'") ||
    message.includes("The node before which the new node is to be inserted is not a child of this node") ||
    message.includes("Failed to execute 'removeChild'") ||
    message.includes("The node to be removed is not a child of this node") ||
    message.includes("Cannot read properties of null") ||
    message.includes("Cannot read properties of undefined")
  );
}

function installOptionalRuntime(name: string, installer: () => void) {
  try {
    installer();
  } catch (error) {
    console.warn(`${name} 載入失敗，已略過，不影響主系統。`, error);
  }
}

function installShareRuntimeWithoutFilterListener() {
  const originalAddEventListener = window.addEventListener.bind(window);
  const patchedAddEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "change") {
      const listenerName = typeof listener === "function" ? listener.name : "";
      if (listenerName === "handleFilterChange") {
        console.warn("已阻止站點分享外掛接管日別切換，避免切換時白畫面。");
        return;
      }
    }
    return originalAddEventListener(type, listener, options);
  }) as typeof window.addEventListener;

  window.addEventListener = patchedAddEventListener;
  try {
    installScheduleShareRuntime();
  } finally {
    window.addEventListener = originalAddEventListener;
  }
}

function installRuntimePauseGate() {
  const originalSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const guardedHandler = typeof handler === "function"
      ? (() => {
          if (Date.now() < (window.__scheduleRuntimePausedUntil || 0)) return;
          try {
            (handler as (...innerArgs: unknown[]) => void)(...args);
          } catch (error) {
            console.warn("runtime timeout 已略過錯誤", error);
          }
        })
      : handler;
    return originalSetTimeout(guardedHandler as TimerHandler, timeout);
  }) as typeof window.setTimeout;
}

window.addEventListener("error", (event) => {
  const message = String(event.message || "");
  const target = String(event.filename || "");
  const isBrowserExtensionOrCrossOriginError = message === "Script error." || message.includes("The object can not be found here") || !target;
  const isOptionalDomError = target.includes("/assets/index-") && isOptionalRuntimeDomError(message);
  if (isBrowserExtensionOrCrossOriginError || isOptionalDomError) {
    console.warn("非核心腳本錯誤已略過：", message, target);
    event.preventDefault();
    return;
  }
  showFatalError("系統載入失敗", `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  console.warn("非核心非同步錯誤已略過：", event.reason);
  event.preventDefault();
});

installRuntimePauseGate();

try {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("找不到 root 容器");
  }

  if (window.__hideBootStatus) {
    window.__hideBootStatus();
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  showFatalError("系統載入失敗", formatError(error));
}

// window.setTimeout(() => installOptionalRuntime("站點試排外掛", installScheduleRuntime), 500);
window.setTimeout(() => installOptionalRuntime("站點浮動提示窗", installScheduleTipRuntime), 550);
window.setTimeout(() => installOptionalRuntime("站點分享外掛", installShareRuntimeWithoutFilterListener), 800);
