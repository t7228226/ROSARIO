const scheduleSummaryLabels = ["需排總人數", "已排總人數", "唯一人數", "重複安排", "缺口總數", "總出勤", "本籍出勤", "菲籍出勤", "越籍出勤", "本班人力", "本班出勤", "支援人力"];

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
  const normalizedLabel = normalizeText(label);
  const candidates = Array.from(section.querySelectorAll<HTMLElement>(".detail-grid > *, .floating-summary *, .info-item, .stat-card, [class*='info'], [class*='card']"));

  for (const node of candidates) {
    const normalizedText = normalizeText(node.textContent || "");
    if (!normalizedText.includes(normalizedLabel)) continue;
    const afterLabel = normalizedText.slice(normalizedText.indexOf(normalizedLabel) + normalizedLabel.length);
    const directMatch = afterLabel.match(/\d+/);
    if (directMatch) return Number(directMatch[0]);
    const anyMatch = normalizedText.match(/\d+/);
    if (anyMatch) return Number(anyMatch[0]);
  }

  return 0;
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

function getAttendanceTotal(section: Element) {
  return getInfoNumber(section, "總出勤");
}

function getPendingCount(section: Element, assigned: number) {
  const attendanceTotal = getAttendanceTotal(section);
  if (attendanceTotal > 0) return Math.max(0, attendanceTotal - assigned);
  return 0;
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

  const pending = getPendingCount(section, assigned);
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
