let observerStarted = false;

const summaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"];
const removablePanelSelectors = ".panel, .stat-card, .summary-panel, .card, [class*='panel'], [class*='card']";

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

  document.querySelectorAll(".floating-schedule-tip").forEach((node) => node.remove());
}

function scheduleRemove() {
  removeScheduleSummaryRows();
  window.requestAnimationFrame(removeScheduleSummaryRows);
}

export function installScheduleRuntime() {
  if (observerStarted || typeof window === "undefined") return;
  observerStarted = true;

  window.addEventListener("click", scheduleRemove, true);
  window.addEventListener("change", scheduleRemove, true);
  window.addEventListener("resize", scheduleRemove);

  const root = document.getElementById("root");
  if (root) {
    const observer = new MutationObserver(scheduleRemove);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  scheduleRemove();
  window.setTimeout(scheduleRemove, 100);
  window.setTimeout(scheduleRemove, 500);
  window.setTimeout(scheduleRemove, 1500);
}
