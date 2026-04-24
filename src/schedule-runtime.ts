import { fetchBootstrapData } from "./lib/api";
import { DAY_OPTIONS, getAttendanceForTeam, TEAM_OPTIONS } from "./lib/selectors";
import type { AppBootstrap, ShiftMode, TeamName } from "./types";

let observerStarted = false;
let cachedData: AppBootstrap | null = null;
let loadingData: Promise<AppBootstrap> | null = null;

const teamSet = new Set<string>(TEAM_OPTIONS);
const daySet = new Set<string>(DAY_OPTIONS);
const summaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"];
const removablePanelSelectors = ".panel, .stat-card, .summary-panel, .card, [class*='panel'], [class*='card']";

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

function hasScheduleSummaryText(node: Element) {
  const text = node.textContent || "";
  return summaryLabels.filter((label) => text.includes(label)).length >= 3;
}

function hasVisibleContent(node: Element) {
  const text = (node.textContent || "").replace(/\s+/g, "").trim();
  if (text.length > 0) return true;
  return Array.from(node.children).some((child) => {
    const element = child as HTMLElement;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && element.getBoundingClientRect().height > 0;
  });
}

function findSummaryRowFromLabel(labelNode: Element) {
  const card = labelNode.closest(".summary-card, .info-item, [class*='card']") || labelNode.parentElement;
  let current = card?.parentElement || null;

  while (current && current !== document.body) {
    if (hasScheduleSummaryText(current)) return current;
    current = current.parentElement;
  }

  return card?.parentElement || card || null;
}

function removeEmptyWrappers(start: Element | null) {
  let current = start;
  while (current && current !== document.body && !current.classList.contains("page-section")) {
    const parent = current.parentElement;
    const isKnownPanel = current.matches(removablePanelSelectors);
    const isEmpty = !hasVisibleContent(current);
    if (isKnownPanel && isEmpty) {
      current.remove();
      current = parent;
      continue;
    }
    break;
  }
}

function removeScheduleSummaryRows() {
  const rows = new Set<Element>();

  document.querySelectorAll(".summary-strip, .compact-info-grid, .detail-grid").forEach((node) => {
    if (hasScheduleSummaryText(node)) rows.add(node);
  });

  document.querySelectorAll("span, strong, div").forEach((node) => {
    const text = node.textContent?.trim() || "";
    if (!summaryLabels.includes(text)) return;
    const row = findSummaryRowFromLabel(node);
    if (row) rows.add(row);
  });

  rows.forEach((row) => {
    const parent = row.parentElement;
    const panel = row.closest(removablePanelSelectors);
    row.remove();
    removeEmptyWrappers(panel || parent);
  });

  document.querySelectorAll(removablePanelSelectors).forEach((node) => {
    if (!hasVisibleContent(node)) node.remove();
  });
}

function getVisibleScheduleSection() {
  const sections = Array.from(document.querySelectorAll(".page-section"));
  return sections.find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (title.includes("站點試排") || title.includes("智能試排"));
  }) || null;
}

function getSelectedScheduleMode(section: Element) {
  const values = Array.from(section.querySelectorAll("select")).map((select) => (select as HTMLSelectElement).value);
  const team = values.find((value) => teamSet.has(value)) as TeamName | undefined;
  const day = values.find((value) => daySet.has(value)) as ShiftMode | undefined;
  if (!team || !day) return null;
  return { team, day };
}

function countAssignedPeople(section: Element) {
  const names = new Set<string>();
  section.querySelectorAll(".list-scroll.short .list-row.active strong, .candidate-chip.active strong, .candidate-chip.active").forEach((node) => {
    const text = node.textContent?.trim();
    if (text) names.add(text);
  });
  return names.size;
}

function ensureScheduleTip() {
  let tip = document.querySelector<HTMLElement>(".floating-schedule-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "floating-schedule-tip square-schedule-tip";
    tip.setAttribute("aria-live", "polite");
    document.body.appendChild(tip);
  }
  tip.classList.add("square-schedule-tip");
  return tip;
}

function hideScheduleTip() {
  document.querySelectorAll(".floating-schedule-tip").forEach((node) => {
    node.classList.remove("show");
    node.innerHTML = "";
  });
}

async function getAttendanceTotal(section: Element) {
  const mode = getSelectedScheduleMode(section);
  if (!mode) return 0;

  try {
    const data = await getBootstrapData();
    return getAttendanceForTeam(data.people, mode.team, mode.day).all.length;
  } catch {
    return 0;
  }
}

async function updateScheduleTip() {
  const section = getVisibleScheduleSection();
  if (!section) {
    hideScheduleTip();
    return;
  }

  const assigned = countAssignedPeople(section);
  if (assigned <= 0) {
    hideScheduleTip();
    return;
  }

  let attendanceTotal = await getAttendanceTotal(section);
  if (attendanceTotal <= 0) {
    attendanceTotal = section.querySelectorAll(".list-scroll.short .list-row, .candidate-chip").length;
  }

  const pending = Math.max(0, attendanceTotal - assigned);
  const tip = ensureScheduleTip();
  tip.innerHTML = `<div>已排:${assigned}</div><div>待排:${pending}</div>`;
  tip.classList.add("show");
}

function scheduleRuntime() {
  removeScheduleSummaryRows();
  window.requestAnimationFrame(() => {
    removeScheduleSummaryRows();
    updateScheduleTip().catch(() => undefined);
  });
}

export function installScheduleRuntime() {
  if (observerStarted || typeof window === "undefined") return;
  observerStarted = true;

  window.addEventListener("click", scheduleRuntime, true);
  window.addEventListener("change", scheduleRuntime, true);
  window.addEventListener("resize", scheduleRuntime);

  const root = document.getElementById("root");
  if (root) {
    const observer = new MutationObserver(scheduleRuntime);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  scheduleRuntime();
  window.setTimeout(scheduleRuntime, 100);
  window.setTimeout(scheduleRuntime, 500);
  window.setTimeout(scheduleRuntime, 1500);
}
