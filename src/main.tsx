import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import "./styles.css";
import "./app-shell.css";
import "./manual-schedule.css";
import "./upgrade.css";
import "./precision-ui.css";
import "./scenario-analysis.css";

declare global {
  interface Window {
    __hideBootStatus?: () => void;
  }
}

function showFatalError(title: string, detail: string) {
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("div");
  panel.className = "fatal-error-panel";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const message = document.createElement("p");
  message.textContent = "頁面載入失敗，請重新整理；若持續發生，請提供下方錯誤資訊。";
  const info = document.createElement("pre");
  info.textContent = detail;
  panel.append(heading, message, info);
  root.replaceChildren(panel);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

window.addEventListener("error", (event) => {
  const message = String(event.message || "");
  const target = String(event.filename || "");
  const isBrowserExtensionOrCrossOriginError = message === "Script error." || message.includes("The object can not be found here") || !target;
  if (isBrowserExtensionOrCrossOriginError) {
    console.warn("非核心腳本錯誤已略過：", message, target);
    event.preventDefault();
    return;
  }
  showFatalError("系統載入失敗", `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("未處理的非同步錯誤：", event.reason);
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
      <AppErrorBoundary><App /></AppErrorBoundary>
    </React.StrictMode>
  );
} catch (error) {
  showFatalError("系統載入失敗", formatError(error));
}
