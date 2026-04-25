import { fetchBootstrapData, upsertQualification } from "./lib/api";
import { DAY_OPTIONS, getAttendanceForTeam, TEAM_OPTIONS } from "./lib/selectors";
import type { AppBootstrap, Person, ShiftMode, TeamName } from "./types";

let observerStarted = false;
let cachedData: AppBootstrap | null = null;
let loadingData: Promise<AppBootstrap> | null = null;
let runtimeTimer: number | null = null;
let isLayoutRunning = false;
let isReassignModalOpen = false;
let lastConflictClickKey = "";
let lastConflictClickAt = 0;

const teamSet = new Set<string>(TEAM_OPTIONS);
const daySet = new Set<string>(DAY_OPTIONS);
const summaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"];
const removablePanelSelectors = ".panel, .stat-card, .summary-panel, .card, [class*='panel'], [class*='card']";
const runtimeTrainingAssignments = new Map<string, Person>();

async function getBootstrapData() {
  if (cachedData) return cachedData;
  if (!loadingData) loadingData = fetchBootstrapData().then((data) => (cachedData = data));
  return loadingData;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
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
}

function getVisibleScheduleSection() {
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (title.includes("站點試排") || title.includes("智能試排"));
  }) || null;
}

function getStationPanels(section: Element) {
  return Array.from(section.querySelectorAll(".panel")).filter((panel) =>
    panel.querySelector(".list-scroll.short .list-row, .candidate-chip, .assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip")
  );
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

function getAssignedMap(section: Element) {
  const map = new Map<string, Element>();
  getStationPanels(section).forEach((panel) => {
    panel.querySelectorAll(".list-scroll.short .list-row.active, .candidate-chip.active, .assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip").forEach((tag) => {
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
    section.querySelectorAll(".list-scroll.short .list-row, .candidate-chip, .assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip").forEach((tag) => {
      const name = getTagName(tag);
      if (name) allNames.add(name);
    });
    attendanceTotal = allNames.size;
  }
  const pending = Math.max(0, attendanceTotal - assigned);
  const tip = ensureScheduleTip();
  const completeButton = tip.querySelector(".schedule-complete-button");
  tip.innerHTML = `<div>已排:${assigned}</div><div>待排:${pending}</div>`;
  if (completeButton) tip.appendChild(completeButton);
  tip.classList.add("show");
}

function removeOriginalMiniChips(panel: Element, frame: HTMLElement) {
  panel.querySelectorAll<HTMLElement>(".list-scroll.short, .candidate-chip, .list-row").forEach((node) => {
    if (frame.contains(node)) return;
    if (node.matches("button") && node.textContent?.includes("自訂人選")) return;
    node.classList.add("schedule-hidden-duplicate");
  });
}

function findStationIdFromPanel(panel: Element, data: AppBootstrap) {
  const panelText = normalizeText(panel.textContent || "");
  const stations = [...data.stations].sort((a, b) => b.name.length - a.name.length);
  return stations.find((station) => panelText.includes(normalizeText(station.name)) || panelText.includes(normalizeText(station.id)))?.id || "";
}

function getStationTitle(panel: Element) {
  const headings = Array.from(panel.querySelectorAll("h3, h4, .panel-title, strong"));
  return headings.map((node) => node.textContent?.trim() || "").find((text) => text && !text.includes("已安排") && !text.includes("尚未安排")) || "此站點";
}

function ensureRuntimeTrainingTags(panel: Element, frame: HTMLElement, stationId?: string) {
  if (!stationId) return;
  const assignedTags = frame.querySelector(".assigned-tags") as HTMLElement | null;
  if (!assignedTags) return;
  runtimeTrainingAssignments.forEach((person, key) => {
    if (!key.startsWith(`${stationId}::`)) return;
    const exists = Array.from(assignedTags.querySelectorAll<HTMLElement>(".runtime-training-chip, .list-row, .candidate-chip")).some((tag) => normalizeText(getTagName(tag)) === normalizeText(person.name));
    if (exists) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "runtime-training-chip schedule-tag-training";
    chip.dataset.employeeId = person.id;
    chip.innerHTML = `<strong>${person.name}</strong><small>訓練</small>`;
    assignedTags.appendChild(chip);
  });
}

async function forcePanelLayout(panel: Element) {
  panel.querySelectorAll(".schedule-section-headings, .schedule-fixed-title").forEach((node) => node.remove());
  const customButton = Array.from(panel.querySelectorAll("button")).find((button) => button.textContent?.includes("自訂人選")) as HTMLElement | undefined;
  if (customButton) {
    customButton.style.float = "right";
    customButton.style.marginRight = "18px";
  }
  const existingFrame = panel.querySelector(".schedule-two-area-frame") as HTMLElement | null;
  const wrap = existingFrame?.querySelector(".list-scroll.short") as HTMLElement | null || panel.querySelector(".list-scroll.short") as HTMLElement | null;
  let frame = existingFrame;
  if (!frame) {
    frame = document.createElement("div");
    frame.className = "schedule-two-area-frame";
  }
  if (frame.parentElement !== panel) panel.appendChild(frame);
  let assignedArea = frame.querySelector(".schedule-area-assigned") as HTMLElement | null;
  let assignedTags = frame.querySelector(".assigned-tags") as HTMLElement | null;
  let pendingArea = frame.querySelector(".schedule-area-pending") as HTMLElement | null;
  if (!assignedArea) {
    assignedArea = document.createElement("div");
    assignedArea.className = "schedule-area schedule-area-assigned";
    assignedArea.innerHTML = `<div class="schedule-area-title">已安排</div><div class="schedule-area-tags assigned-tags"></div>`;
    frame.appendChild(assignedArea);
  }
  assignedTags = frame.querySelector(".assigned-tags") as HTMLElement | null;
  if (!pendingArea) {
    pendingArea = document.createElement("div");
    pendingArea.className = "schedule-area schedule-area-pending";
    pendingArea.innerHTML = `<div class="schedule-area-title">尚未安排</div>`;
    frame.appendChild(pendingArea);
  }
  if (wrap && pendingArea && wrap.parentElement !== pendingArea) pendingArea.appendChild(wrap);
  if (assignedTags) {
    Array.from((pendingArea || panel).querySelectorAll<HTMLElement>(".list-row.active, .candidate-chip.active")).forEach((tag) => assignedTags?.appendChild(tag));
    Array.from(assignedTags.querySelectorAll<HTMLElement>(".list-row:not(.active), .candidate-chip:not(.active)")).forEach((tag) => wrap?.appendChild(tag));
  }
  try {
    const data = await getBootstrapData();
    ensureRuntimeTrainingTags(panel, frame, findStationIdFromPanel(panel, data));
  } catch {
    // Layout must still work when data cannot be loaded.
  }
  removeOriginalMiniChips(panel, frame);
}

async function classifyScheduleTags(section: Element) {
  if (isLayoutRunning) return;
  isLayoutRunning = true;
  try {
    const assignedMap = getAssignedMap(section);
    for (const panel of getStationPanels(section)) {
      await forcePanelLayout(panel);
      const conflictTags: HTMLElement[] = [];
      Array.from(panel.querySelectorAll<HTMLElement>(".list-row, .candidate-chip, .runtime-training-chip")).forEach((tag) => {
        if (tag.classList.contains("schedule-hidden-duplicate")) return;
        const name = getTagName(tag);
        const assignedPanel = name ? assignedMap.get(name) : null;
        tag.classList.remove("schedule-tag-selected", "schedule-tag-conflict", "schedule-tag-pending", "schedule-tag-training");
        tag.style.marginLeft = "";
        if (tag.classList.contains("runtime-training-chip")) {
          tag.classList.add("schedule-tag-training");
        } else if (tag.classList.contains("active")) {
          tag.classList.add("schedule-tag-selected");
        } else if (assignedPanel && assignedPanel !== panel) {
          tag.classList.add("schedule-tag-conflict");
          tag.dataset.assignedStationTitle = getStationTitle(assignedPanel);
          conflictTags.push(tag);
        } else {
          tag.classList.add("schedule-tag-pending");
          delete tag.dataset.assignedStationTitle;
        }
      });
      const wrap = panel.querySelector(".schedule-two-area-frame .list-scroll.short") as HTMLElement | null;
      if (wrap) conflictTags.forEach((tag) => wrap.appendChild(tag));
    }
  } finally {
    isLayoutRunning = false;
  }
}

function ensureCustomAssignStyles() {
  if (document.getElementById("runtime-custom-assign-style")) return;
  const style = document.createElement("style");
  style.id = "runtime-custom-assign-style";
  style.textContent = `
    .schedule-hidden-duplicate {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }
    .schedule-two-area-frame .list-row,
    .schedule-two-area-frame .candidate-chip,
    .schedule-two-area-frame .runtime-training-chip {
      pointer-events: auto !important;
      touch-action: manipulation !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    .custom-assign-backdrop, .schedule-reassign-backdrop {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(15, 23, 42, 0.42);
    }
    .custom-assign-modal, .schedule-reassign-modal {
      width: min(420px, 100%);
      max-height: 86vh;
      overflow: auto;
      box-sizing: border-box;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 22px 54px rgba(15, 23, 42, 0.32);
      padding: 18px;
      color: #0f172a;
    }
    .custom-assign-modal h3, .schedule-reassign-modal h3 {
      margin: 0 0 12px;
      font-size: 20px;
      font-weight: 900;
    }
    .schedule-reassign-modal p {
      margin: 0 0 12px;
      line-height: 1.65;
      color: #334155;
      font-weight: 800;
    }
    .custom-assign-modal label {
      display: block;
      margin: 10px 0 6px;
      font-weight: 800;
      font-size: 14px;
    }
    .custom-assign-modal input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 12px;
      font-size: 16px;
    }
    .custom-assign-result {
      margin-top: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 12px;
      background: #f8fafc;
      line-height: 1.7;
    }
    .custom-assign-actions, .schedule-reassign-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 16px;
    }
    .custom-assign-actions button,
    .custom-assign-search-button,
    .schedule-reassign-actions button {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      font-weight: 900;
      cursor: pointer;
    }
    .custom-assign-search-button,
    .custom-assign-confirm,
    .schedule-reassign-confirm {
      background: #2563eb;
      color: #ffffff;
    }
    .custom-assign-cancel,
    .schedule-reassign-cancel {
      background: #e2e8f0;
      color: #0f172a;
    }
    .custom-assign-message {
      margin-top: 10px;
      color: #b45309;
      font-weight: 800;
      min-height: 22px;
    }
    .runtime-training-chip,
    .schedule-area-tags .runtime-training-chip {
      min-width: 74px !important;
      min-height: 38px !important;
      padding: 8px 12px !important;
      border-radius: 999px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      background: #facc15 !important;
      border: 2px solid #eab308 !important;
      color: #713f12 !important;
      text-align: center;
      box-shadow: none !important;
    }
    .runtime-training-chip strong {
      color: #713f12 !important;
      white-space: nowrap;
    }
    .runtime-training-chip small {
      display: none !important;
    }
    @media (max-width: 900px) {
      .custom-assign-modal, .schedule-reassign-modal { padding: 16px; }
      .custom-assign-actions, .schedule-reassign-actions { flex-direction: column-reverse; }
      .custom-assign-actions button, .custom-assign-search-button, .schedule-reassign-actions button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function setModalMessage(modal: HTMLElement, message: string) {
  const messageNode = modal.querySelector<HTMLElement>(".custom-assign-message");
  if (messageNode) messageNode.textContent = message;
}

async function openCustomAssignModal(panel: Element) {
  ensureCustomAssignStyles();
  document.querySelector(".custom-assign-backdrop")?.remove();
  const section = panel.closest(".page-section");
  const mode = section ? getSelectedScheduleMode(section) : null;
  const data = await getBootstrapData();
  const stationId = findStationIdFromPanel(panel, data);
  const station = data.stations.find((item) => item.id === stationId);
  if (!section || !mode || !station) return;

  const attendance = getAttendanceForTeam(data.people, mode.team, mode.day).all;
  let selectedPerson: Person | null = null;

  const backdrop = document.createElement("div");
  backdrop.className = "custom-assign-backdrop";
  backdrop.innerHTML = `
    <div class="custom-assign-modal" role="dialog" aria-modal="true" aria-label="自訂人選">
      <h3>自訂人選</h3>
      <label>搜尋姓名或工號</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="custom-assign-input" placeholder="請輸入姓名或工號" autocomplete="off" />
        <button class="custom-assign-search-button" type="button">搜尋</button>
      </div>
      <div class="custom-assign-result">尚未選擇人員</div>
      <div class="custom-assign-message"></div>
      <div class="custom-assign-actions">
        <button class="custom-assign-cancel" type="button">取消</button>
        <button class="custom-assign-confirm" type="button">確認設置為訓練人員</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const modal = backdrop.querySelector<HTMLElement>(".custom-assign-modal");
  const input = backdrop.querySelector<HTMLInputElement>(".custom-assign-input");
  const result = backdrop.querySelector<HTMLElement>(".custom-assign-result");
  if (!modal || !input || !result) return;

  const renderResult = () => {
    const keyword = input.value.trim();
    if (!keyword) {
      selectedPerson = null;
      result.textContent = "請先輸入姓名或工號。";
      return;
    }
    const exact = attendance.find((person) => person.id === keyword || person.name === keyword);
    const partial = attendance.find((person) => person.id.includes(keyword) || person.name.includes(keyword));
    selectedPerson = exact || partial || null;
    if (!selectedPerson) {
      result.textContent = "找不到可用人員，請確認該人員存在於本次出勤池。";
      return;
    }
    const assignedStationId = findAssignedStationFromDom(section, selectedPerson.name);
    if (assignedStationId && assignedStationId !== stationId) {
      const assignedStation = data.stations.find((item) => item.id === assignedStationId);
      result.innerHTML = `<strong>工號：</strong>${selectedPerson.id}<br/><strong>姓名：</strong>${selectedPerson.name}<br/><strong>狀態：</strong>已安排在 ${assignedStation?.name || assignedStationId}，不可重複佔站。`;
      return;
    }
    result.innerHTML = `<strong>工號：</strong>${selectedPerson.id}<br/><strong>姓名：</strong>${selectedPerson.name}<br/><strong>確認：</strong>是否確認設置為訓練人員？`;
  };

  backdrop.querySelector(".custom-assign-search-button")?.addEventListener("click", renderResult);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderResult();
  });
  backdrop.querySelector(".custom-assign-cancel")?.addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  backdrop.querySelector(".custom-assign-confirm")?.addEventListener("click", async () => {
    renderResult();
    if (!selectedPerson) {
      setModalMessage(modal, "請先搜尋並確認人員。 ");
      return;
    }
    const assignedStationId = findAssignedStationFromDom(section, selectedPerson.name);
    if (assignedStationId && assignedStationId !== stationId) {
      setModalMessage(modal, "此人員已安排在其他站點，不可重複佔站。 ");
      return;
    }
    try {
      await upsertQualification({ employeeId: selectedPerson.id, employeeName: selectedPerson.name, stationId, status: "訓練中" });
      runtimeTrainingAssignments.set(`${stationId}::${selectedPerson.id}`, selectedPerson);
      cachedData = {
        ...data,
        qualifications: [
          ...data.qualifications.filter((item) => !(item.employeeId === selectedPerson?.id && item.stationId === stationId)),
          { employeeId: selectedPerson.id, employeeName: selectedPerson.name, stationId, status: "訓練中" },
        ],
      };
      backdrop.remove();
      await forcePanelLayout(panel);
      const activeSection = getVisibleScheduleSection();
      if (activeSection) await updateScheduleTip(activeSection);
    } catch {
      setModalMessage(modal, "訓練人員設定失敗，請確認 GAS upsertQualification 是否正常。 ");
    }
  });
  window.setTimeout(() => input.focus(), 0);
}

function findAssignedStationFromDom(section: Element, personName: string) {
  const targetName = normalizeText(personName);
  let foundStationId = "";
  getStationPanels(section).some((panel) => {
    const hasPerson = Array.from(panel.querySelectorAll<HTMLElement>(".assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip")).some((tag) => normalizeText(getTagName(tag)) === targetName);
    if (!hasPerson) return false;
    const data = cachedData;
    if (!data) return false;
    foundStationId = findStationIdFromPanel(panel, data);
    return true;
  });
  return foundStationId;
}

function openReassignModal(tag: HTMLElement) {
  if (isReassignModalOpen) return;
  const section = tag.closest(".page-section");
  const targetPanel = tag.closest(".panel");
  const assignedTitle = tag.dataset.assignedStationTitle || "其他站點";
  const personName = getTagName(tag);
  if (!section || !targetPanel || !personName) return;
  isReassignModalOpen = true;
  document.querySelector(".schedule-reassign-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "schedule-reassign-backdrop";
  backdrop.innerHTML = `
    <div class="schedule-reassign-modal" role="dialog" aria-modal="true" aria-label="更換站點">
      <h3>更換站點</h3>
      <p><strong>${personName}</strong> 已安排在「${assignedTitle}」。</p>
      <p>是否更換到目前站點「${getStationTitle(targetPanel)}」？</p>
      <div class="schedule-reassign-actions">
        <button class="schedule-reassign-cancel" type="button">取消</button>
        <button class="schedule-reassign-confirm" type="button">確認更換</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    isReassignModalOpen = false;
  };
  backdrop.querySelector(".schedule-reassign-cancel")?.addEventListener("click", close, { once: true });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  }, { once: true });
  backdrop.querySelector(".schedule-reassign-confirm")?.addEventListener("click", () => {
    const oldPanel = Array.from(getStationPanels(section)).find((panel) => {
      if (panel === targetPanel) return false;
      return Array.from(panel.querySelectorAll<HTMLElement>(".assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip")).some((item) => normalizeText(getTagName(item)) === normalizeText(personName));
    });
    oldPanel?.querySelectorAll<HTMLElement>(".assigned-tags .list-row, .assigned-tags .candidate-chip").forEach((item) => {
      if (normalizeText(getTagName(item)) === normalizeText(personName)) item.click();
    });
    close();
    window.setTimeout(() => {
      tag.click();
      scheduleRuntime();
    }, 80);
  }, { once: true });
}

function handleConflictClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const tag = target?.closest(".schedule-tag-conflict") as HTMLElement | null;
  if (!tag) return;
  const personName = getTagName(tag);
  const assignedTitle = tag.dataset.assignedStationTitle || "";
  const clickKey = `${personName}::${assignedTitle}`;
  const now = Date.now();
  if (isReassignModalOpen || (clickKey === lastConflictClickKey && now - lastConflictClickAt < 600)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }
  lastConflictClickKey = clickKey;
  lastConflictClickAt = now;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  openReassignModal(tag);
}

function handleCustomAssignClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const button = target?.closest("button") as HTMLButtonElement | null;
  if (!button || !button.textContent?.includes("自訂人選")) return;
  const section = button.closest(".page-section");
  if (!section) return;
  const title = section.querySelector("h2")?.textContent || "";
  if (!title.includes("站點試排") && !title.includes("智能試排")) return;
  const panel = button.closest(".panel");
  if (!panel) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  openCustomAssignModal(panel).catch(() => undefined);
}

function scheduleRuntime() {
  if (runtimeTimer) window.clearTimeout(runtimeTimer);
  runtimeTimer = window.setTimeout(() => {
    removeScheduleSummaryRows();
    const section = getVisibleScheduleSection();
    if (!section) {
      hideScheduleTip();
      return;
    }
    classifyScheduleTags(section)
      .then(() => updateScheduleTip(section))
      .catch(() => undefined);
  }, 160);
}

export function installScheduleRuntime() {
  if (observerStarted || typeof window === "undefined") return;
  observerStarted = true;
  ensureCustomAssignStyles();
  window.addEventListener("click", handleConflictClick, true);
  window.addEventListener("click", handleCustomAssignClick, true);
  window.addEventListener("click", scheduleRuntime, false);
  window.addEventListener("change", scheduleRuntime, false);
  window.addEventListener("resize", scheduleRuntime);
  const root = document.getElementById("root");
  if (root) {
    const observer = new MutationObserver(scheduleRuntime);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  scheduleRuntime();
  window.setTimeout(scheduleRuntime, 300);
  window.setTimeout(scheduleRuntime, 900);
}
