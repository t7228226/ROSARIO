import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

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

window.addEventListener("error", (event) => {
  showFatalError("系統載入失敗", `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const detail = typeof reason === "object" ? JSON.stringify(reason, null, 2) : String(reason);
  showFatalError("系統載入失敗", detail);
});

function toNumber(text: string | null | undefined) {
  const match = String(text || "").match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function setText(node: Element | null | undefined, text: string) {
  if (node && node.textContent !== text) {
    node.textContent = text;
  }
}

function readStrong(card: Element | undefined) {
  return toNumber(card?.querySelector("strong")?.textContent);
}

function getVisibleStationPageRoot(summaryStrip: Element) {
  return summaryStrip.closest(".page-section") || document.getElementById("root") || document.body;
}

function getSupportPeopleCount(summaryStrip: Element, fallback: number) {
  const root = getVisibleStationPageRoot(summaryStrip);
  const people = new Set<string>();
  root.querySelectorAll(".list-row, .candidate-chip, tr, .info-item").forEach((node) => {
    const text = node.textContent || "";
    if (!text.includes("支援")) return;
    const strong = node.querySelector("strong")?.textContent?.trim();
    const normalized = (strong || text.replace(/支援|來源|本班|合格|訓練中|不可排|[:：｜|]/g, " ").trim().split(/\s+/)[0] || "").trim();
    if (normalized) people.add(normalized);
  });
  return people.size > 0 ? people.size : fallback;
}

function isVisible(node: Element) {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function ensureFloatingScheduleTip() {
  let tip = document.querySelector<HTMLElement>(".floating-schedule-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "floating-schedule-tip";
    tip.setAttribute("aria-live", "polite");
    document.body.appendChild(tip);
  }
  return tip;
}

function patchScheduleSummaryUi() {
  const summaries: Array<{ assigned: number; pending: number; strip: Element }> = [];

  document.querySelectorAll(".summary-strip").forEach((strip) => {
    const cards = Array.from(strip.querySelectorAll(":scope > .summary-card"));
    if (cards.length < 5) return;

    const labels = cards.map((card) => card.querySelector("span")?.textContent?.trim() || "");
    const isScheduleSummary =
      labels.includes("需排總人數") ||
      labels.includes("唯一人數") ||
      labels.includes("重複安排") ||
      labels.includes("出勤總人數") ||
      labels.includes("尚未安排人數") ||
      labels.includes("支援人數");

    if (!isScheduleSummary) return;

    const total = readStrong(cards[0]);
    const assigned = readStrong(cards[1]);
    const pending = Math.max(0, total - assigned);
    const support = getSupportPeopleCount(strip, readStrong(cards[3]));

    setText(cards[0].querySelector("span"), "出勤總人數");
    setText(cards[2].querySelector("span"), "尚未安排人數");
    setText(cards[2].querySelector("strong"), String(pending));
    setText(cards[3].querySelector("span"), "支援人數");
    setText(cards[3].querySelector("strong"), String(support));

    if (isVisible(strip)) {
      summaries.push({ assigned, pending, strip });
    }
  });

  const tip = ensureFloatingScheduleTip();
  const active = summaries.find((item) => item.assigned > 0);
  if (!active) {
    tip.classList.remove("show");
    tip.innerHTML = "";
    return;
  }

  tip.innerHTML = `<div>已排:${active.assigned}</div><div>待排:${active.pending}</div>`;
  tip.classList.add("show");
}

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

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(patchScheduleSummaryUi);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  window.requestAnimationFrame(patchScheduleSummaryUi);
} catch (error) {
  showFatalError("系統載入失敗", error instanceof Error ? error.stack || error.message : String(error));
}
