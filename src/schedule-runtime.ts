let observerStarted = false;

const summaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "出勤總人數", "尚未安排人數", "支援人數"];

function hasScheduleSummaryText(node: Element) {
  const text = node.textContent || "";
  return summaryLabels.filter((label) => text.includes(label)).length >= 3;
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
    (row as HTMLElement).style.display = "none";
    row.setAttribute("data-schedule-summary-removed", "true");
  });
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
