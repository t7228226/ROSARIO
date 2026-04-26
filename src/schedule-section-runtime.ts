function getVisibleManualScheduleSection() {
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && title.includes("站點試排");
  }) || null;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function getButtonText(node: HTMLElement) {
  return normalizeText(node.querySelector("strong")?.textContent || node.textContent || "");
}

function isCandidateButton(node: HTMLElement) {
  const text = getButtonText(node);
  if (!text) return false;
  if (text.includes("自訂人選") || text.includes("需求") || text.includes("已安排") || text.includes("尚未安排")) return false;
  return node.matches(".list-row, .candidate-chip, button") || node.className.includes("chip") || node.className.includes("tag") || node.className.includes("pill");
}

function getCandidateButtons(root: Element) {
  return Array.from(root.querySelectorAll<HTMLElement>(".list-row, .candidate-chip, button, .chip, .tag, .pill")).filter(isCandidateButton);
}

function isStationPanel(panel: Element) {
  const text = panel.textContent || "";
  if (!text.includes("自訂人選")) return false;
  if (!text.includes("需求")) return false;
  return getCandidateButtons(panel).length > 0;
}

function getStationPanels(section: Element) {
  return Array.from(section.querySelectorAll(".panel")).filter(isStationPanel);
}

const summaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數"];

function hasManualScheduleSummaryText(node: Element) {
  const text = node.textContent || "";
  return summaryLabels.filter((label) => text.includes(label)).length >= 3;
}

function hideSummaryBlocks(section: Element) {
  const blocks = new Set<HTMLElement>();
  section.querySelectorAll<HTMLElement>(".detail-grid, .compact-info-grid, .summary-strip").forEach((node) => {
    if (hasManualScheduleSummaryText(node)) blocks.add(node);
  });

  section.querySelectorAll<HTMLElement>(".info-item, .stat-card, [class*='card']").forEach((node) => {
    const text = normalizeText(node.textContent || "");
    if (summaryLabels.some((label) => text.includes(normalizeText(label)))) {
      const parent = node.parentElement;
      if (parent && hasManualScheduleSummaryText(parent)) blocks.add(parent);
    }
  });

  blocks.forEach((block) => {
    block.classList.add("safe-schedule-summary-hidden");
    const parent = block.parentElement;
    if (!parent || parent.classList.contains("page-section")) return;
    const parentText = normalizeText(parent.textContent || "");
    if (summaryLabels.some((label) => parentText.includes(normalizeText(label))) && parent.querySelectorAll("select, button.primary, h2, h3").length === 0) {
      parent.classList.add("safe-schedule-empty-panel-hidden");
    }
  });
}

function findCandidateContainer(panel: Element) {
  const preferred = panel.querySelector<HTMLElement>(".list-scroll.short");
  if (preferred && getCandidateButtons(preferred).length > 0) return preferred;

  const buttons = getCandidateButtons(panel);
  if (buttons.length === 0) return null;

  const candidates = Array.from(panel.querySelectorAll<HTMLElement>("div, section, article"));
  let best: HTMLElement | null = null;
  let bestScore = 0;

  candidates.forEach((node) => {
    if (node.querySelector("h2, h3, h4")) return;
    if ((node.textContent || "").includes("自訂人選")) return;
    const count = getCandidateButtons(node).length;
    if (count > bestScore) {
      best = node;
      bestScore = count;
    }
  });

  return best || buttons[0].parentElement;
}

function getMainButtonNames(list: HTMLElement) {
  const names = new Set<string>();
  getCandidateButtons(list).forEach((button) => {
    const name = getButtonText(button);
    if (name) names.add(name);
  });
  return names;
}

function hideDuplicateMiniLabels(panel: Element, list: HTMLElement) {
  const mainNames = getMainButtonNames(list);
  if (mainNames.size === 0) return;

  const allButtons = getCandidateButtons(panel);
  const byName = new Map<string, HTMLElement[]>();
  allButtons.forEach((button) => {
    const text = getButtonText(button);
    if (!text) return;
    byName.set(text, [...(byName.get(text) || []), button]);
  });

  byName.forEach((buttons, name) => {
    if (!mainNames.has(name) || buttons.length <= 1) return;
    const visibleButtons = buttons.filter((button) => !button.classList.contains("safe-schedule-mini-hidden"));
    if (visibleButtons.length <= 1) return;

    const keep = visibleButtons.reduce((best, current) => {
      const bestRect = best.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      const bestScore = bestRect.width * bestRect.height;
      const currentScore = currentRect.width * currentRect.height;
      return currentScore >= bestScore ? current : best;
    }, visibleButtons[0]);

    buttons.forEach((button) => {
      if (button === keep) return;
      button.classList.add("safe-schedule-mini-hidden");
    });
  });
}

function ensureSectionStyle() {
  if (document.getElementById("safe-schedule-section-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "safe-schedule-section-runtime-style";
  style.textContent = `
    .safe-schedule-summary-hidden,
    .safe-schedule-empty-panel-hidden {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      overflow: hidden !important;
    }
    .safe-schedule-mini-hidden {
      display: none !important;
      visibility: hidden !important;
      width: 0 !important;
      height: 0 !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }
    .safe-schedule-partition-list {
      display: flex !important;
      flex-wrap: wrap !important;
      align-items: flex-start !important;
      gap: 10px !important;
      max-height: none !important;
      overflow: visible !important;
    }
    .safe-schedule-partition-title {
      width: 100% !important;
      flex: 0 0 100% !important;
      margin: 6px 0 2px !important;
      color: #0f172a !important;
      font-size: 22px !important;
      font-weight: 950 !important;
      line-height: 1.35 !important;
      letter-spacing: 0.02em !important;
    }
    .safe-schedule-partition-title.assigned-title {
      order: 0 !important;
    }
    .safe-schedule-partition-title.pending-title {
      order: 20 !important;
      margin-top: 18px !important;
    }
    .safe-schedule-partition-list .list-row,
    .safe-schedule-partition-list .candidate-chip,
    .safe-schedule-partition-list button,
    .safe-schedule-partition-list .chip,
    .safe-schedule-partition-list .tag,
    .safe-schedule-partition-list .pill {
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 92px !important;
      max-width: 100% !important;
      margin: 0 !important;
    }
    .safe-schedule-partition-list .list-row.active,
    .safe-schedule-partition-list .candidate-chip.active,
    .safe-schedule-partition-list button.active,
    .safe-schedule-partition-list .schedule-tag-selected {
      order: 10 !important;
    }
    .safe-schedule-partition-list .list-row:not(.active),
    .safe-schedule-partition-list .candidate-chip:not(.active),
    .safe-schedule-partition-list button:not(.active) {
      order: 30 !important;
    }
    .safe-schedule-partition-list .schedule-tag-conflict {
      order: 35 !important;
    }
    .safe-schedule-empty-note {
      order: 11 !important;
      color: #64748b !important;
      font-weight: 800 !important;
      padding: 8px 0 !important;
    }
    @media (max-width: 900px) {
      .safe-schedule-partition-title {
        font-size: 20px !important;
      }
      .safe-schedule-partition-list {
        gap: 8px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureTitle(list: HTMLElement, key: "assigned" | "pending", text: string) {
  const className = key === "assigned" ? "assigned-title" : "pending-title";
  let title = list.querySelector<HTMLElement>(`.safe-schedule-partition-title.${className}`);
  if (!title) {
    title = document.createElement("div");
    title.className = `safe-schedule-partition-title ${className}`;
    title.setAttribute("aria-hidden", "true");
    list.prepend(title);
  }
  title.textContent = text;
  return title;
}

function ensureEmptyNote(list: HTMLElement, hasAssigned: boolean) {
  let note = list.querySelector<HTMLElement>(".safe-schedule-empty-note");
  if (hasAssigned) {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement("div");
    note.className = "safe-schedule-empty-note";
    note.textContent = "-";
    list.appendChild(note);
  }
}

function updateSections() {
  const section = getVisibleManualScheduleSection();
  if (!section) return;
  ensureSectionStyle();
  hideSummaryBlocks(section);

  getStationPanels(section).forEach((panel) => {
    const list = findCandidateContainer(panel);
    if (!list) return;
    list.classList.add("safe-schedule-partition-list");

    const candidateButtons = getCandidateButtons(list);
    const hasAssigned = candidateButtons.some((button) => button.classList.contains("active") || button.classList.contains("schedule-tag-selected"));

    ensureTitle(list, "assigned", "已安排");
    ensureEmptyNote(list, hasAssigned);
    ensureTitle(list, "pending", "尚未安排");
    hideDuplicateMiniLabels(panel, list);
  });
}

function runDelayedInitialPasses() {
  [0, 120, 300, 700, 1200, 2000].forEach((delay) => window.setTimeout(updateSections, delay));
}

export function installScheduleSectionRuntime() {
  let timer: number | null = null;
  const scheduleUpdate = () => {
    if (Date.now() < ((window as Window & { __scheduleRuntimePausedUntil?: number }).__scheduleRuntimePausedUntil || 0)) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      updateSections();
    }, 120);
  };

  document.addEventListener("click", scheduleUpdate, true);
  document.addEventListener("change", scheduleUpdate, true);
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("popstate", runDelayedInitialPasses);

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  runDelayedInitialPasses();
}
