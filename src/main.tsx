import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./schedule-candidate-fix.css";

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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeScheduleCandidateCards() {
  document.querySelectorAll<HTMLButtonElement>(".list-scroll.short .list-row").forEach((button) => {
    const meta = button.querySelector<HTMLSpanElement>("span");
    if (!meta || meta.dataset.cleaned === "true") return;

    const raw = meta.textContent || "";
    const parts = raw.split("｜").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return;

    meta.dataset.cleaned = "true";
    meta.innerHTML = `<span class="candidate-code">${escapeHtml(parts[0])}</span><span class="candidate-team">${escapeHtml(parts[1])}</span>`;
  });
}

function getSummaryCards() {
  return [...document.querySelectorAll<HTMLElement>(".summary-card")].map((card) => {
    const label = card.querySelector<HTMLSpanElement>("span");
    const value = card.querySelector<HTMLElement>("strong");
    return { card, label, value, labelText: label?.textContent?.trim() || "", valueNumber: Number(value?.textContent?.trim() || 0) };
  });
}

function normalizeScheduleSummaryAndFloatingStatus() {
  const cards = getSummaryCards();
  if (!cards.length) return;

  const valueOf = (...labels: string[]) => {
    const found = cards.find((item) => labels.includes(item.labelText));
    return Number.isFinite(found?.valueNumber) ? Number(found?.valueNumber) : 0;
  };

  const supportCount = valueOf("支援人力", "支援人數");
  const requiredCount = valueOf("需排總人數", "出勤總人數");
  const assignedCount = valueOf("已排總人數");
  const pendingCount = Math.max(0, requiredCount - assignedCount);

  cards.forEach((item) => {
    if (!item.label || !item.value) return;
    if (item.labelText === "需排總人數" || item.labelText === "出勤總人數") {
      item.label.textContent = "出勤總人數";
    }
    if (item.labelText === "唯一人數" || item.labelText === "尚未安排人數") {
      item.label.textContent = "尚未安排人數";
      item.value.textContent = String(pendingCount);
    }
    if (item.labelText === "重複安排" || item.labelText === "支援人數") {
      item.label.textContent = "支援人數";
      item.value.textContent = String(supportCount);
    }
  });

  let floating = document.getElementById("schedule-floating-status");
  if (!floating) {
    floating = document.createElement("div");
    floating.id = "schedule-floating-status";
    document.body.appendChild(floating);
  }

  if (assignedCount > 0) {
    floating.innerHTML = `<div>已排:${assignedCount}</div><div>待排:${pendingCount}</div>`;
    floating.classList.add("show");
  } else {
    floating.classList.remove("show");
    floating.innerHTML = "";
  }
}

function normalizeScheduleUi() {
  normalizeScheduleCandidateCards();
  normalizeScheduleSummaryAndFloatingStatus();
}

window.addEventListener("error", (event) => {
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

  let raf = 0;
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => normalizeScheduleUi());
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  requestAnimationFrame(() => normalizeScheduleUi());
} catch (error) {
  showFatalError("系統載入失敗", error instanceof Error ? error.stack || error.message : String(error));
}
