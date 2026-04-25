function getVisibleManualScheduleSection() {
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && title.includes("站點試排");
  }) || null;
}

function getStationPanels(section: Element) {
  return Array.from(section.querySelectorAll(".panel")).filter((panel) => {
    return Boolean(panel.querySelector(".list-scroll.short .list-row, .candidate-chip"));
  });
}

function ensureSectionStyle() {
  if (document.getElementById("safe-schedule-section-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "safe-schedule-section-runtime-style";
  style.textContent = `
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
    .safe-schedule-partition-list .candidate-chip {
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 92px !important;
      max-width: 100% !important;
      margin: 0 !important;
    }
    .safe-schedule-partition-list .list-row.active,
    .safe-schedule-partition-list .candidate-chip.active,
    .safe-schedule-partition-list .schedule-tag-selected {
      order: 10 !important;
    }
    .safe-schedule-partition-list .list-row:not(.active),
    .safe-schedule-partition-list .candidate-chip:not(.active) {
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
    note.textContent = "尚未安排";
    list.appendChild(note);
  }
}

function updateSections() {
  const section = getVisibleManualScheduleSection();
  if (!section) return;
  ensureSectionStyle();

  getStationPanels(section).forEach((panel) => {
    const list = panel.querySelector<HTMLElement>(".list-scroll.short");
    if (!list) return;
    list.classList.add("safe-schedule-partition-list");

    const candidateButtons = Array.from(list.querySelectorAll<HTMLElement>(".list-row, .candidate-chip"));
    const hasAssigned = candidateButtons.some((button) => button.classList.contains("active") || button.classList.contains("schedule-tag-selected"));

    ensureTitle(list, "assigned", "已安排");
    ensureEmptyNote(list, hasAssigned);
    ensureTitle(list, "pending", "尚未安排");
  });
}

export function installScheduleSectionRuntime() {
  let timer: number | null = null;
  const scheduleUpdate = () => {
    if (Date.now() < ((window as Window & { __scheduleRuntimePausedUntil?: number }).__scheduleRuntimePausedUntil || 0)) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      updateSections();
    }, 100);
  };

  document.addEventListener("click", scheduleUpdate, true);
  document.addEventListener("change", scheduleUpdate, true);
  window.addEventListener("resize", scheduleUpdate);

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  scheduleUpdate();
}
