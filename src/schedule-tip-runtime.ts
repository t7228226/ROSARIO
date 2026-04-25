const scheduleSummaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數"];

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function getVisibleScheduleSection() {
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && title.includes("站點試排");
  }) || null;
}

function getInfoNumber(section: Element, label: string) {
  const nodes = Array.from(section.querySelectorAll(".detail-grid *, .floating-summary *"));
  const labelNode = nodes.find((node) => normalizeText(node.textContent || "") === normalizeText(label));
  const card = labelNode?.closest(".info-item, .stat-card, [class*='card'], div");
  const text = card?.textContent || "";
  const match = text.replace(label, "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function getAssignedCount(section: Element) {
  const fromSummary = getInfoNumber(section, "已排總人數");
  if (fromSummary > 0) return fromSummary;

  const names = new Set<string>();
  section.querySelectorAll<HTMLElement>(".list-row.active, .candidate-chip.active, .chip.active, .schedule-tag-selected").forEach((node) => {
    const name = normalizeText(node.querySelector("strong")?.textContent || node.textContent || "");
    if (name && !scheduleSummaryLabels.some((label) => name.includes(normalizeText(label)))) names.add(name);
  });
  return names.size;
}

function getRequiredCount(section: Element) {
  const fromSummary = getInfoNumber(section, "需排總人數");
  if (fromSummary > 0) return fromSummary;

  return Array.from(section.querySelectorAll(".panel-header span")).reduce((sum, node) => {
    const match = (node.textContent || "").match(/需求\s*(\d+)/);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
}

function ensureTip() {
  let tip = document.querySelector<HTMLElement>(".floating-schedule-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "floating-schedule-tip square-schedule-tip";
    tip.setAttribute("aria-live", "polite");
    document.body.appendChild(tip);
  }
  return tip;
}

function hideTip() {
  document.querySelectorAll<HTMLElement>(".floating-schedule-tip").forEach((tip) => {
    tip.classList.remove("show");
    tip.innerHTML = "";
  });
}

function updateTip() {
  const section = getVisibleScheduleSection();
  if (!section) {
    hideTip();
    return;
  }

  const assigned = getAssignedCount(section);
  if (assigned <= 0) {
    hideTip();
    return;
  }

  const required = getRequiredCount(section);
  const pending = Math.max(0, required - assigned);
  const tip = ensureTip();
  tip.innerHTML = `<div>已排:${assigned}</div><div>待排:${pending}</div>`;
  tip.classList.add("show", "square-schedule-tip");
}

export function installScheduleTipRuntime() {
  let timer: number | null = null;
  const scheduleUpdate = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      updateTip();
    }, 80);
  };

  document.addEventListener("click", scheduleUpdate, true);
  document.addEventListener("change", scheduleUpdate, true);
  window.addEventListener("resize", scheduleUpdate);

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  scheduleUpdate();
}
