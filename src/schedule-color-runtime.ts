function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function getVisibleManualScheduleSection() {
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && title.includes("站點試排");
  }) || null;
}

function getStationPanels(section: Element) {
  return Array.from(section.querySelectorAll(".panel")).filter((panel) => {
    return Boolean(panel.querySelector(".list-scroll.short .list-row, .candidate-chip, .chip"));
  });
}

function getTagName(tag: Element) {
  return normalizeText(tag.querySelector("strong")?.textContent || tag.textContent || "");
}

function getStationTitle(panel: Element) {
  const headings = Array.from(panel.querySelectorAll("h3, h4, .panel-title, strong"));
  return headings.map((node) => node.textContent?.trim() || "").find((text) => text && !text.includes("已安排") && !text.includes("尚未安排")) || "此站點";
}

function getCandidateButtons(panel: Element) {
  return Array.from(panel.querySelectorAll<HTMLElement>(".list-scroll.short .list-row, .candidate-chip"));
}

function getAssignedMap(section: Element) {
  const assignedMap = new Map<string, Element>();
  getStationPanels(section).forEach((panel) => {
    getCandidateButtons(panel).forEach((button) => {
      if (!button.classList.contains("active")) return;
      const name = getTagName(button);
      if (name) assignedMap.set(name, panel);
    });
  });
  return assignedMap;
}

function ensureColorStyle() {
  if (document.getElementById("safe-schedule-color-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "safe-schedule-color-runtime-style";
  style.textContent = `
    .list-row.schedule-tag-selected,
    .candidate-chip.schedule-tag-selected {
      background: #2563eb !important;
      border-color: #1d4ed8 !important;
      color: #ffffff !important;
      box-shadow: 0 8px 18px rgba(37, 99, 235, 0.22) !important;
    }
    .list-row.schedule-tag-selected strong,
    .list-row.schedule-tag-selected span,
    .candidate-chip.schedule-tag-selected strong,
    .candidate-chip.schedule-tag-selected span {
      color: #ffffff !important;
    }
    .list-row.schedule-tag-conflict,
    .candidate-chip.schedule-tag-conflict {
      background: #fee2e2 !important;
      border-color: #ef4444 !important;
      color: #991b1b !important;
    }
    .list-row.schedule-tag-pending,
    .candidate-chip.schedule-tag-pending {
      background: #f8fafc;
    }
  `;
  document.head.appendChild(style);
}

function updateColors() {
  const section = getVisibleManualScheduleSection();
  if (!section) return;

  ensureColorStyle();
  const assignedMap = getAssignedMap(section);

  getStationPanels(section).forEach((panel) => {
    getCandidateButtons(panel).forEach((button) => {
      const name = getTagName(button);
      const assignedPanel = name ? assignedMap.get(name) : null;
      button.classList.remove("schedule-tag-selected", "schedule-tag-conflict", "schedule-tag-pending");
      delete button.dataset.assignedStationTitle;

      if (button.classList.contains("active")) {
        button.classList.add("schedule-tag-selected");
        return;
      }

      if (assignedPanel && assignedPanel !== panel) {
        button.classList.add("schedule-tag-conflict");
        button.dataset.assignedStationTitle = getStationTitle(assignedPanel);
        return;
      }

      button.classList.add("schedule-tag-pending");
    });
  });
}

export function installScheduleColorRuntime() {
  let timer: number | null = null;
  const scheduleUpdate = () => {
    if (Date.now() < ((window as Window & { __scheduleRuntimePausedUntil?: number }).__scheduleRuntimePausedUntil || 0)) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      updateColors();
    }, 80);
  };

  document.addEventListener("click", scheduleUpdate, true);
  document.addEventListener("change", scheduleUpdate, true);
  window.addEventListener("resize", scheduleUpdate);

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  scheduleUpdate();
}
