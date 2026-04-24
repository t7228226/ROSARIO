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

function getScheduleSections() {
  return Array.from(document.querySelectorAll(".page-section")).filter((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    return title.includes("站點試排") || title.includes("智能試排");
  });
}

function getSelectedScheduleMode(section: Element) {
  const values = Array.from(section.querySelectorAll("select")).map((select) => (select as HTMLSelectElement).value);
  const team = values.find((value) => teamSet.has(value)) as TeamName | undefined;
  const day = values.find((value) => daySet.has(value)) as ShiftMode | undefined;
  if (!team || !day) return null;
  return { team, day };
}

function getAssignedCount(cards: Element[], section: Element) {
  const labelValues = cards.map((card) => ({
    label: card.querySelector("span")?.textContent?.trim() || "",
    value: readStrong(card),
  }));

  const uniqueCard = labelValues.find((item) => item.label === "唯一人數" || item.label === "已排人數" || item.label === "已排總人數");
  if (uniqueCard) {
    return uniqueCard.value;
  }

  const stored = cards[0]?.getAttribute("data-schedule-assigned");
  if (stored !== null && stored !== undefined) {
    return Number(stored) || 0;
  }

  const activePeople = new Set<string>();
  section.querySelectorAll(".list-scroll.short .list-row.active strong").forEach((node) => {
    const name = node.textContent?.trim();
    if (name) activePeople.add(name);
  });
  return activePeople.size;
}

function writeSummaryCards(cards: Element[], total: number, pending: number, support: number, assigned: number) {
  if (cards.length < 3) return;
  cards[0].setAttribute("data-schedule-assigned", String(assigned));

  setText(cards[0].querySelector("span"), "出勤總人數");
  setText(cards[0].querySelector("strong"), String(total));

  setText(cards[1].querySelector("span"), "尚未安排人數");
  setText(cards[1].querySelector("strong"), String(pending));

  setText(cards[2].querySelector("span"), "支援人數");
  setText(cards[2].querySelector("strong"), String(support));
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

async function syncScheduleSummary() {
  const data = await getBootstrapData();
  let activeAssigned = 0;
  let activePending = 0;

  for (const section of getScheduleSections()) {
    const mode = getSelectedScheduleMode(section);
    const strip = section.querySelector(".summary-strip");
    if (!mode || !strip) continue;

    const cards = Array.from(strip.querySelectorAll(":scope > .summary-card"));
    if (cards.length < 3) continue;

    const attendance = getAttendanceForTeam(data.people, mode.team, mode.day);
    const total = attendance.all.length;
    const support = attendance.support.length;
    const assigned = getAssignedCount(cards, section);
    const pending = Math.max(0, total - assigned);

    writeSummaryCards(cards, total, pending, support, assigned);

    const rect = section.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0;
    if (isVisible && assigned > 0) {
      activeAssigned = assigned;
      activePending = pending;
    }
  }

  updateFloatingTip(activeAssigned, activePending);
}

function scheduleSync() {
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
}
