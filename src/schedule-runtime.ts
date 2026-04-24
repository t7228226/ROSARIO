import { fetchBootstrapData } from "./lib/api";
import { DAY_OPTIONS, getAttendanceForTeam, TEAM_OPTIONS } from "./lib/selectors";
import type { AppBootstrap, ShiftMode, TeamName } from "./types";

let observerStarted = false;
let cachedData: AppBootstrap | null = null;
let loadingData: Promise<AppBootstrap> | null = null;
let pendingMove: { name: string; toPanel: Element } | null = null;

const teamSet = new Set<string>(TEAM_OPTIONS);
const daySet = new Set<string>(DAY_OPTIONS);
const summaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"];
const removablePanelSelectors = ".panel, .stat-card, .summary-panel, .card, [class*='panel'], [class*='card']";

async function getBootstrapData() {
  if (cachedData) return cachedData;
  if (!loadingData) loadingData = fetchBootstrapData().then((data) => (cachedData = data));
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
    if (current.matches(removablePanelSelectors) && !hasVisibleContent(current)) {
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
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (title.includes("站點試排") || title.includes("智能試排"));
  }) || null;
}

function getStationPanels(section: Element) {
  return Array.from(section.querySelectorAll(".panel")).filter((panel) => panel.querySelector(".list-scroll.short .list-row, .candidate-chip"));
}

function getSelectedScheduleMode(section: Element) {
  const values = Array.from(section.querySelectorAll("select")).map((select) => (select as HTMLSelectElement).value);
  const team = values.find((value) => teamSet.has(value)) as TeamName | undefined;
  const day = values.find((value) => daySet.has(value)) as ShiftMode | undefined;
  if (!team || !day) return null;
  return { team, day };
}

function getTagName(tag: Element) {
  return tag.querySelector("strong")?.textContent?.trim() || tag.textContent?.trim() || "";
}

function getStationTitle(panel: Element) {
  return panel.querySelector("h3")?.textContent?.trim() || "此站點";
}

function getAssignedMap(section: Element) {
  const map = new Map<string, Element>();
  getStationPanels(section).forEach((panel) => {
    panel.querySelectorAll(".list-scroll.short .list-row.active, .candidate-chip.active").forEach((tag) => {
      const name = getTagName(tag);
      if (name) map.set(name, panel);
    });
  });
  return map;
}

function countAssignedPeople(section: Element) {
  return getAssignedMap(section).size;
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

async function updateScheduleTip(section: Element) {
  const assigned = countAssignedPeople(section);
  if (assigned <= 0) {
    hideScheduleTip();
    return;
  }
  let attendanceTotal = await getAttendanceTotal(section);
  if (attendanceTotal <= 0) {
    const allNames = new Set<string>();
    section.querySelectorAll(".list-scroll.short .list-row, .candidate-chip").forEach((tag) => {
      const name = getTagName(tag);
      if (name) allNames.add(name);
    });
    attendanceTotal = allNames.size;
  }
  const pending = Math.max(0, attendanceTotal - assigned);
  const tip = ensureScheduleTip();
  tip.innerHTML = `<div>已排:${assigned}</div><div>待排:${pending}</div>`;
  tip.classList.add("show");
}

function ensureTagGroups(panel: Element) {
  const oldWrap = panel.querySelector(".list-scroll.short") as HTMLElement | null;
  if (!oldWrap) return null;
  let box = panel.querySelector(".schedule-tag-groups") as HTMLElement | null;
  if (!box) {
    box = document.createElement("div");
    box.className = "schedule-tag-groups";
    box.innerHTML = `<div class="schedule-group schedule-group-assigned"><div class="schedule-group-title">已安排</div><div class="schedule-group-tags"></div></div><div class="schedule-group schedule-group-pending"><div class="schedule-group-title">尚未安排</div><div class="schedule-group-tags"></div></div><div class="schedule-group schedule-group-conflict"><div class="schedule-group-title">其他站已安排</div><div class="schedule-group-tags"></div></div>`;
    oldWrap.parentElement?.insertBefore(box, oldWrap);
    oldWrap.style.display = "none";
  }
  return {
    oldWrap,
    assignedBox: box.querySelector(".schedule-group-assigned .schedule-group-tags") as HTMLElement,
    pendingBox: box.querySelector(".schedule-group-pending .schedule-group-tags") as HTMLElement,
    conflictBox: box.querySelector(".schedule-group-conflict .schedule-group-tags") as HTMLElement,
  };
}

function mirrorButton(source: Element, group: HTMLElement, className: string, name: string) {
  let mirror = group.querySelector<HTMLElement>(`[data-schedule-name="${CSS.escape(name)}"]`);
  if (!mirror) {
    mirror = document.createElement("button");
    mirror.type = "button";
    mirror.className = "schedule-mirror-tag";
    mirror.setAttribute("data-schedule-name", name);
    mirror.addEventListener("click", () => (source as HTMLElement).click());
    group.appendChild(mirror);
  }
  mirror.className = `schedule-mirror-tag ${className}`;
  mirror.textContent = name;
  mirror.style.display = "inline-flex";
}

function classifyScheduleTags(section: Element) {
  const assignedMap = getAssignedMap(section);
  if (pendingMove) {
    const oldPanel = assignedMap.get(pendingMove.name);
    const oldTag = oldPanel?.querySelector<HTMLElement>(`.list-scroll.short .list-row.active, .candidate-chip.active`);
    const newTag = pendingMove.toPanel.querySelector<HTMLElement>(`.list-scroll.short .list-row, .candidate-chip`);
    if (oldTag && getTagName(oldTag) === pendingMove.name) oldTag.click();
    const target = Array.from(pendingMove.toPanel.querySelectorAll<HTMLElement>(".list-scroll.short .list-row, .candidate-chip")).find((tag) => getTagName(tag) === pendingMove?.name);
    window.setTimeout(() => target?.click(), 0);
    pendingMove = null;
  }
  const nextAssignedMap = getAssignedMap(section);
  getStationPanels(section).forEach((panel) => {
    const groups = ensureTagGroups(panel);
    if (!groups) return;
    groups.assignedBox.innerHTML = "";
    groups.pendingBox.innerHTML = "";
    groups.conflictBox.innerHTML = "";
    Array.from(panel.querySelectorAll(".list-scroll.short .list-row, .candidate-chip")).forEach((tag) => {
      const name = getTagName(tag);
      const assignedPanel = name ? nextAssignedMap.get(name) : null;
      tag.classList.remove("schedule-tag-selected", "schedule-tag-conflict", "schedule-tag-pending");
      if (tag.classList.contains("active")) {
        tag.classList.add("schedule-tag-selected");
        mirrorButton(tag, groups.assignedBox, "schedule-tag-selected", name);
      } else if (assignedPanel && assignedPanel !== panel) {
        tag.classList.add("schedule-tag-conflict");
        mirrorButton(tag, groups.conflictBox, "schedule-tag-conflict", name);
      } else {
        tag.classList.add("schedule-tag-pending");
        mirrorButton(tag, groups.pendingBox, "schedule-tag-pending", name);
      }
    });
  });
}

function conflictPromptHandler(event: Event) {
  const target = event.target as Element | null;
  const mirror = target?.closest(".schedule-mirror-tag.schedule-tag-conflict") as HTMLElement | null;
  if (!mirror) return;
  const section = getVisibleScheduleSection();
  const toPanel = mirror.closest(".panel");
  if (!section || !toPanel) return;
  const name = mirror.getAttribute("data-schedule-name") || mirror.textContent?.trim() || "";
  const fromPanel = getAssignedMap(section).get(name);
  if (!name || !fromPanel) return;
  const ok = window.confirm(`${name} 已安排在「${getStationTitle(fromPanel)}」。是否更換到「${getStationTitle(toPanel)}」？`);
  if (!ok) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  pendingMove = { name, toPanel };
  classifyScheduleTags(section);
  window.setTimeout(scheduleRuntime, 30);
}

function scheduleRuntime() {
  removeScheduleSummaryRows();
  const section = getVisibleScheduleSection();
  if (!section) {
    hideScheduleTip();
    return;
  }
  window.setTimeout(() => {
    removeScheduleSummaryRows();
    classifyScheduleTags(section);
    updateScheduleTip(section).catch(() => undefined);
  }, 0);
}

export function installScheduleRuntime() {
  if (observerStarted || typeof window === "undefined") return;
  observerStarted = true;
  window.addEventListener("click", conflictPromptHandler, true);
  window.addEventListener("click", scheduleRuntime, false);
  window.addEventListener("change", scheduleRuntime, false);
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
