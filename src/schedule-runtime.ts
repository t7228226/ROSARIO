import { fetchBootstrapData } from "./lib/api";
import { DAY_OPTIONS, getAttendanceForTeam, TEAM_OPTIONS } from "./lib/selectors";
import type { AppBootstrap, ShiftMode, TeamName } from "./types";

let cachedData: AppBootstrap | null = null;
let loadingData: Promise<AppBootstrap> | null = null;
let observerStarted = false;

const teamSet = new Set<string>(TEAM_OPTIONS);
const daySet = new Set<string>(DAY_OPTIONS);

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

async function getBootstrapData() {
  if (cachedData) return cachedData;
  if (!loadingData) {
    loadingData = fetchBootstrapData().then((data) => {
      cachedData = data;
      return data;
    });
  }
  return loadingData;
}

function getScheduleSummaryStrips() {
  return Array.from(document.querySelectorAll(".summary-strip")).filter((strip) => {
    const section = strip.closest(".page-section") || strip.parentElement;
    const title = section?.querySelector("h2")?.textContent || "";
    const labels = Array.from(strip.querySelectorAll(":scope > .summary-card span")).map((span) => span.textContent?.trim() || "");
    const hasScheduleLabels = labels.some((label) => ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"].includes(label));
    return title.includes("站點試排") || title.includes("智能試排") || hasScheduleLabels;
  });
}

function getSelectedScheduleMode(strip: Element) {
  const section = strip.closest(".page-section") || strip.parentElement || document.body;
  const values = Array.from(section.querySelectorAll("select")).map((select) => (select as HTMLSelectElement).value);
  const team = values.find((value) => teamSet.has(value)) as TeamName | undefined;
  const day = values.find((value) => daySet.has(value)) as ShiftMode | undefined;
  if (!team || !day) return null;
  return { team, day };
}

function getAssignedCount(cards: Element[], strip: Element) {
  const section = strip.closest(".page-section") || strip.parentElement || document.body;
  const assignedCard = cards.find((card) => {
    const label = card.querySelector("span")?.textContent?.trim();
    return label === "已排總人數" || label === "已排人數";
  });
  if (assignedCard) return readStrong(assignedCard);

  const stored = cards[0]?.getAttribute("data-schedule-assigned");
  if (stored !== null && stored !== undefined) return Number(stored) || 0;

  const activePeople = new Set<string>();
  section.querySelectorAll(".list-scroll.short .list-row.active strong").forEach((node) => {
    const name = node.textContent?.trim();
    if (name) activePeople.add(name);
  });
  return activePeople.size;
}

function writeSummaryCards(cards: Element[], total: number, pending: number, support: number, assigned: number) {
  if (cards.length < 4) return;
  cards[0].setAttribute("data-schedule-assigned", String(assigned));

  setText(cards[0].querySelector("span"), "出勤總人數");
  setText(cards[0].querySelector("strong"), String(total));

  // 第 2 張卡保留「已排總人數」。使用者要求修改的是原第 3 張「唯一人數」。
  setText(cards[2].querySelector("span"), "尚未安排人數");
  setText(cards[2].querySelector("strong"), String(pending));

  setText(cards[3].querySelector("span"), "支援人數");
  setText(cards[3].querySelector("strong"), String(support));
}

function ensureFloatingTip() {
  let tip = document.querySelector<HTMLElement>(".floating-schedule-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "floating-schedule-tip";
    tip.setAttribute("aria-live", "polite");
    document.body.appendChild(tip);
  }
  return tip;
}

function updateFloatingTip(assigned: number, pending: number) {
  const tip = ensureFloatingTip();
  if (assigned <= 0) {
    tip.classList.remove("show");
    tip.innerHTML = "";
    return;
  }
  tip.innerHTML = `<div>已排:${assigned}</div><div>待排:${pending}</div>`;
  tip.classList.add("show");
}

function syncLabelsImmediately() {
  for (const strip of getScheduleSummaryStrips()) {
    const cards = Array.from(strip.querySelectorAll(":scope > .summary-card"));
    if (cards.length < 4) continue;
    const total = readStrong(cards[0]);
    const assigned = getAssignedCount(cards, strip);
    const pending = Math.max(0, total - assigned);
    const supportFallback = readStrong(cards[3]);
    writeSummaryCards(cards, total, pending, supportFallback, assigned);
  }
}

async function syncScheduleSummary() {
  syncLabelsImmediately();

  let data: AppBootstrap | null = null;
  try {
    data = await getBootstrapData();
  } catch {
    data = null;
  }

  let activeAssigned = 0;
  let activePending = 0;

  for (const strip of getScheduleSummaryStrips()) {
    const cards = Array.from(strip.querySelectorAll(":scope > .summary-card"));
    if (cards.length < 4) continue;

    const mode = getSelectedScheduleMode(strip);
    const assigned = getAssignedCount(cards, strip);
    const currentTotal = readStrong(cards[0]);
    const attendance = data && mode ? getAttendanceForTeam(data.people, mode.team, mode.day) : null;
    const total = attendance ? attendance.all.length : currentTotal;
    const support = attendance ? attendance.support.length : readStrong(cards[3]);
    const pending = Math.max(0, total - assigned);

    writeSummaryCards(cards, total, pending, support, assigned);

    const rect = strip.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0;
    if (isVisible && assigned > 0) {
      activeAssigned = assigned;
      activePending = pending;
    }
  }

  updateFloatingTip(activeAssigned, activePending);
}

function scheduleSync() {
  syncLabelsImmediately();
  window.requestAnimationFrame(() => {
    syncScheduleSummary().catch(() => undefined);
  });
}

export function installScheduleRuntime() {
  if (observerStarted || typeof window === "undefined") return;
  observerStarted = true;

  window.addEventListener("click", scheduleSync, true);
  window.addEventListener("change", scheduleSync, true);
  window.addEventListener("resize", scheduleSync);

  const root = document.getElementById("root");
  if (root) {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  scheduleSync();
  window.setTimeout(scheduleSync, 250);
  window.setTimeout(scheduleSync, 1000);
}
