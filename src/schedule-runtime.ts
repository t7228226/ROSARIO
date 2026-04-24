import { fetchBootstrapData } from "./lib/api";
import { DAY_OPTIONS, getAttendanceForTeam, TEAM_OPTIONS } from "./lib/selectors";
import type { AppBootstrap, ShiftMode, TeamName } from "./types";

let cachedData: AppBootstrap | null = null;
let loadingData: Promise<AppBootstrap> | null = null;
let observerStarted = false;

const teamSet = new Set<string>(TEAM_OPTIONS);
const daySet = new Set<string>(DAY_OPTIONS);
const summaryLabels = new Set(["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"]);

function toNumber(text: string | null | undefined) {
  const match = String(text || "").match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function setText(node: Element | null | undefined, text: string) {
  if (node && node.textContent !== text) node.textContent = text;
}

function readNumber(card: Element | undefined) {
  return toNumber(card?.querySelector("strong")?.textContent || card?.textContent);
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

function getCardsFromContainer(container: Element) {
  const directSummaryCards = Array.from(container.querySelectorAll(":scope > .summary-card"));
  if (directSummaryCards.length >= 4) return directSummaryCards;

  const directInfoItems = Array.from(container.querySelectorAll(":scope > .info-item"));
  if (directInfoItems.length >= 4) return directInfoItems;

  return Array.from(container.children).filter((child) => {
    const text = child.textContent || "";
    return Array.from(summaryLabels).some((label) => text.includes(label));
  });
}

function getScheduleSummaryBlocks() {
  const blocks: Array<{ container: Element; cards: Element[] }> = [];
  const seen = new Set<Element>();

  document.querySelectorAll(".summary-strip, .compact-info-grid, .detail-grid").forEach((container) => {
    const cards = getCardsFromContainer(container);
    const labels = cards.map((card) => card.querySelector("span")?.textContent?.trim() || card.textContent?.trim() || "");
    const matchCount = labels.filter((label) => Array.from(summaryLabels).some((item) => label.includes(item))).length;
    if (cards.length >= 4 && matchCount >= 3 && !seen.has(container)) {
      seen.add(container);
      blocks.push({ container, cards });
    }
  });

  // 保底：直接從「需排總人數」的卡片往上找同層 5 張卡。
  document.querySelectorAll("span").forEach((span) => {
    const label = span.textContent?.trim() || "";
    if (!summaryLabels.has(label)) return;
    const card = span.closest(".summary-card, .info-item") || span.parentElement;
    const container = card?.parentElement;
    if (!container || seen.has(container)) return;
    const cards = getCardsFromContainer(container);
    if (cards.length >= 4) {
      seen.add(container);
      blocks.push({ container, cards });
    }
  });

  return blocks;
}

function getSelectedScheduleMode(container: Element) {
  const section = container.closest(".page-section") || container.parentElement || document.body;
  const values = Array.from(section.querySelectorAll("select")).map((select) => (select as HTMLSelectElement).value);
  const team = values.find((value) => teamSet.has(value)) as TeamName | undefined;
  const day = values.find((value) => daySet.has(value)) as ShiftMode | undefined;
  if (!team || !day) return null;
  return { team, day };
}

function findCardValue(cards: Element[], labels: string[]) {
  const card = cards.find((item) => {
    const label = item.querySelector("span")?.textContent?.trim() || item.textContent || "";
    return labels.some((target) => label.includes(target));
  });
  return readNumber(card);
}

function getAssignedCount(cards: Element[], container: Element) {
  const assigned = findCardValue(cards, ["已排總人數", "已排人數"]);
  if (assigned > 0) return assigned;

  const stored = cards[0]?.getAttribute("data-schedule-assigned");
  if (stored !== null && stored !== undefined) return Number(stored) || 0;

  const section = container.closest(".page-section") || container.parentElement || document.body;
  const activePeople = new Set<string>();
  section.querySelectorAll(".list-scroll.short .list-row.active strong").forEach((node) => {
    const name = node.textContent?.trim();
    if (name) activePeople.add(name);
  });
  return activePeople.size;
}

function writeCard(card: Element | undefined, label: string, value: number) {
  if (!card) return;
  setText(card.querySelector("span") || card.firstElementChild, label);
  setText(card.querySelector("strong") || card.lastElementChild, String(value));
}

function writeSummaryCards(cards: Element[], total: number, pending: number, support: number, assigned: number) {
  if (cards.length < 4) return;
  cards[0].setAttribute("data-schedule-assigned", String(assigned));
  writeCard(cards[0], "出勤總人數", total);
  writeCard(cards[2], "尚未安排人數", pending);
  writeCard(cards[3], "支援人數", support);
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
  for (const block of getScheduleSummaryBlocks()) {
    const total = readNumber(block.cards[0]);
    const assigned = getAssignedCount(block.cards, block.container);
    const pending = Math.max(0, total - assigned);
    const supportFallback = readNumber(block.cards[3]);
    writeSummaryCards(block.cards, total, pending, supportFallback, assigned);
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

  for (const block of getScheduleSummaryBlocks()) {
    const mode = getSelectedScheduleMode(block.container);
    const assigned = getAssignedCount(block.cards, block.container);
    const fallbackTotal = readNumber(block.cards[0]);
    const attendance = data && mode ? getAttendanceForTeam(data.people, mode.team, mode.day) : null;
    const total = attendance ? attendance.all.length : fallbackTotal;
    const support = attendance ? attendance.support.length : readNumber(block.cards[3]);
    const pending = Math.max(0, total - assigned);

    writeSummaryCards(block.cards, total, pending, support, assigned);

    const rect = block.container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && assigned > 0) {
      activeAssigned = assigned;
      activePending = pending;
    }
  }

  updateFloatingTip(activeAssigned, activePending);
}

function scheduleSync() {
  syncLabelsImmediately();
  window.requestAnimationFrame(() => syncScheduleSummary().catch(() => undefined));
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
  window.setTimeout(scheduleSync, 100);
  window.setTimeout(scheduleSync, 500);
  window.setTimeout(scheduleSync, 1500);
}
