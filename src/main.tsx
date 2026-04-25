import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./schedule-overrides.css";
import { installScheduleRuntime } from "./schedule-runtime";
import { installScheduleShareRuntime } from "./schedule-share-runtime";

declare global {
  interface Window {
    __hideBootStatus?: () => void;
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

function installOptionalRuntime(name: string, installer: () => void) {
  try {
    installer();
  } catch (error) {
    console.warn(`${name} 載入失敗，已略過，不影響主系統。`, error);
  }
}

window.addEventListener("error", (event) => {
  const target = String(event.filename || "");
  if (target.includes("/assets/index-") && String(event.message || "").includes("The object can not be found here")) {
    console.warn("非核心排班外掛錯誤已略過：", event.message);
    event.preventDefault();
    return;
  }
  showFatalError("系統載入失敗", `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const detail = typeof reason === "object" ? JSON.stringify(reason, null, 2) : String(reason);
  showFatalError("系統載入失敗", detail);
});

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

installOptionalRuntime("站點試排外掛", installScheduleRuntime);
installOptionalRuntime("站點分享外掛", installScheduleShareRuntime);
