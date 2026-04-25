let shareRuntimeStarted = false;

interface PreviewRow {
  station: string;
  people: string[];
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getVisibleScheduleSection() {
  return Array.from(document.querySelectorAll(".page-section")).find((section) => {
    const title = section.querySelector("h2")?.textContent || "";
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (title.includes("站點試排") || title.includes("智能試排"));
  }) as HTMLElement | undefined;
}

function getPageTitle(section: Element) {
  return normalizeText(section.querySelector("h2")?.textContent || "站點試排");
}

function getCurrentFilters(section: Element) {
  const values = Array.from(section.querySelectorAll("select")).map((select) => (select as HTMLSelectElement).value).filter(Boolean);
  return values.slice(0, 3).join("｜");
}

function getStationTitle(panel: Element) {
  const headings = Array.from(panel.querySelectorAll("h3, h4, .panel-title, strong"));
  const title = headings.map((item) => normalizeText(item.textContent || "")).find((text) => text && !text.includes("已安排") && !text.includes("尚未安排"));
  if (title) return title;
  const firstLine = normalizeText((panel.textContent || "").split("\n")[0] || "");
  return firstLine || "未命名站點";
}

function getTagName(tag: Element) {
  return normalizeText(tag.querySelector("strong")?.textContent || tag.textContent || "");
}

function isNoiseName(name: string) {
  return !name || name.includes("自訂人選") || name.includes("已安排") || name.includes("尚未安排") || name.includes("安排完成") || name.includes("一鍵試排") || name.includes("智能試排");
}

function getAssignedTags(section: Element) {
  return Array.from(section.querySelectorAll(".assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip, .list-scroll.short .list-row.active, .candidate-chip.active, .list-row.active"));
}

function getSmartAssignedNames(section: Element) {
  const names = new Set<string>();
  getAssignedTags(section).forEach((tag) => {
    const name = getTagName(tag);
    if (!isNoiseName(name)) names.add(name);
  });
  if (names.size > 0) return names;

  section.querySelectorAll(".panel").forEach((panel) => {
    panel.querySelectorAll("strong").forEach((node) => {
      const name = normalizeText(node.textContent || "");
      if (!isNoiseName(name) && name.length <= 8) names.add(name);
    });
  });
  return names;
}

function getPreviewRows(section: Element): PreviewRow[] {
  const panels = Array.from(section.querySelectorAll(".panel")).filter((panel) =>
    panel.querySelector(".assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip, .list-scroll.short .list-row.active, .candidate-chip.active, .list-row.active")
  );

  return panels.map((panel) => {
    const people = Array.from(panel.querySelectorAll(".assigned-tags .list-row, .assigned-tags .candidate-chip, .runtime-training-chip, .list-scroll.short .list-row.active, .candidate-chip.active, .list-row.active"))
      .map((tag) => {
        const name = getTagName(tag);
        if (!name || isNoiseName(name)) return "";
        return tag.classList.contains("runtime-training-chip") || tag.classList.contains("schedule-tag-training") ? `${name}（訓練）` : name;
      })
      .filter(Boolean);
    return {
      station: getStationTitle(panel),
      people: Array.from(new Set(people)),
    };
  }).filter((row) => row.people.length > 0);
}

function buildShareText(section: Element, rows: PreviewRow[]) {
  const title = getPageTitle(section);
  const filters = getCurrentFilters(section);
  const header = [title, filters, `安排站點：${rows.length}`].filter(Boolean).join("\n");
  const body = rows.map((row, index) => `${index + 1}. ${row.station}：${row.people.join("、")}`).join("\n");
  return `${header}\n\n${body}`.trim();
}

function ensureStyles() {
  if (document.getElementById("schedule-share-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "schedule-share-runtime-style";
  style.textContent = `
    .floating-schedule-tip .schedule-complete-button {
      margin-top: 6px !important;
      border: 0 !important;
      border-radius: 10px !important;
      padding: 7px 9px !important;
      background: #ffffff !important;
      color: #0369a1 !important;
      font-size: 12px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      pointer-events: auto !important;
      cursor: pointer !important;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18) !important;
      touch-action: manipulation !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    .floating-schedule-tip .schedule-complete-button:active {
      transform: translateY(1px);
    }
    .schedule-preview-backdrop {
      position: fixed;
      inset: 0;
      z-index: 360;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(15, 23, 42, 0.48);
    }
    .schedule-preview-modal {
      width: min(560px, 100%);
      max-height: 86vh;
      overflow: auto;
      box-sizing: border-box;
      border-radius: 18px;
      background: #ffffff;
      color: #0f172a;
      box-shadow: 0 22px 58px rgba(15, 23, 42, 0.34);
      padding: 18px;
    }
    .schedule-preview-modal h3 {
      margin: 0 0 6px;
      font-size: 21px;
      font-weight: 900;
    }
    .schedule-preview-subtitle {
      margin: 0 0 12px;
      color: #475569;
      font-size: 13px;
      font-weight: 800;
    }
    .schedule-preview-list {
      display: grid;
      gap: 9px;
      margin: 12px 0;
    }
    .schedule-preview-row {
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .schedule-preview-row strong {
      display: block;
      margin-bottom: 5px;
      color: #0f172a;
      font-size: 15px;
    }
    .schedule-preview-row span {
      color: #334155;
      line-height: 1.6;
      font-weight: 700;
    }
    .schedule-preview-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 16px;
    }
    .schedule-preview-actions button {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      font-weight: 900;
      cursor: pointer;
      touch-action: manipulation;
    }
    .schedule-preview-cancel,
    .schedule-share-close {
      background: #e2e8f0;
      color: #0f172a;
    }
    .schedule-preview-confirm,
    .schedule-share-copy,
    .schedule-share-system {
      background: #2563eb;
      color: #ffffff;
    }
    .schedule-share-textarea {
      width: 100%;
      min-height: 220px;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      padding: 12px;
      font-size: 15px;
      line-height: 1.55;
      resize: vertical;
      white-space: pre-wrap;
    }
    .schedule-share-message {
      min-height: 22px;
      margin-top: 8px;
      color: #166534;
      font-weight: 900;
    }
    @media (max-width: 900px) {
      .floating-schedule-tip .schedule-complete-button {
        width: 100% !important;
        padding: 7px 4px !important;
        font-size: 11px !important;
      }
      .schedule-preview-modal {
        padding: 16px;
      }
      .schedule-preview-actions {
        flex-direction: column-reverse;
      }
      .schedule-preview-actions button {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureScheduleTipForSmartSchedule(force = false) {
  const section = getVisibleScheduleSection();
  if (!section || !getPageTitle(section).includes("智能試排")) return;
  const assignedNames = getSmartAssignedNames(section);
  const assigned = assignedNames.size;
  if (assigned <= 0 && !force) return;
  let tip = document.querySelector<HTMLElement>(".floating-schedule-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "floating-schedule-tip square-schedule-tip";
    tip.setAttribute("aria-live", "polite");
    document.body.appendChild(tip);
  }
  tip.classList.add("square-schedule-tip", "show");
  const completeButton = tip.querySelector(".schedule-complete-button");
  const allCandidateNames = new Set(Array.from(section.querySelectorAll(".list-scroll.short .list-row, .candidate-chip, .list-row")).map((tag) => getTagName(tag)).filter((name) => !isNoiseName(name)));
  const total = Math.max(allCandidateNames.size, assigned);
  const pending = Math.max(0, total - assigned);
  tip.innerHTML = `<div>已排:${assigned}</div><div>待排:${pending}</div>`;
  if (completeButton) tip.appendChild(completeButton);
}

function ensureCompleteButton(forceSmartTip = false) {
  ensureScheduleTipForSmartSchedule(forceSmartTip);
  const tip = document.querySelector<HTMLElement>(".floating-schedule-tip.show");
  if (!tip) return;
  if (tip.querySelector(".schedule-complete-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schedule-complete-button";
  button.textContent = "安排完成";
  tip.appendChild(button);
}

function triggerSmartScheduleTipNow() {
  window.requestAnimationFrame(() => ensureCompleteButton(true));
  window.setTimeout(() => ensureCompleteButton(true), 40);
  window.setTimeout(() => ensureCompleteButton(true), 120);
  window.setTimeout(() => ensureCompleteButton(true), 260);
  window.setTimeout(() => ensureCompleteButton(true), 520);
}

function isSmartScheduleOneClickButton(button: HTMLElement) {
  const section = button.closest(".page-section");
  if (!section || !getPageTitle(section).includes("智能試排")) return false;
  const text = normalizeText(button.textContent || "");
  return text.includes("一鍵試排") || text.includes("智能試排") || text.includes("自動試排");
}

function closePreviewModal() {
  document.querySelector(".schedule-preview-backdrop")?.remove();
}

function openShareModal(section: Element, rows: PreviewRow[]) {
  const shareText = buildShareText(section, rows);
  closePreviewModal();
  const backdrop = document.createElement("div");
  backdrop.className = "schedule-preview-backdrop";
  const canSystemShare = Boolean(navigator.share);
  backdrop.innerHTML = `
    <div class="schedule-preview-modal" role="dialog" aria-modal="true" aria-label="分享站點安排">
      <h3>分享畫面</h3>
      <p class="schedule-preview-subtitle">可複製下方內容，或使用系統分享。</p>
      <textarea class="schedule-share-textarea" readonly></textarea>
      <div class="schedule-share-message"></div>
      <div class="schedule-preview-actions">
        <button class="schedule-share-close" type="button">關閉</button>
        <button class="schedule-share-copy" type="button">複製內容</button>
        ${canSystemShare ? `<button class="schedule-share-system" type="button">系統分享</button>` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const textarea = backdrop.querySelector<HTMLTextAreaElement>(".schedule-share-textarea");
  const message = backdrop.querySelector<HTMLElement>(".schedule-share-message");
  if (textarea) textarea.value = shareText;
  backdrop.querySelector(".schedule-share-close")?.addEventListener("click", closePreviewModal);
  backdrop.querySelector(".schedule-share-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      if (message) message.textContent = "已複製。";
    } catch {
      textarea?.select();
      if (message) message.textContent = "已選取文字，請手動複製。";
    }
  });
  backdrop.querySelector(".schedule-share-system")?.addEventListener("click", async () => {
    try {
      await navigator.share({ title: getPageTitle(section), text: shareText });
    } catch {
      if (message) message.textContent = "已取消系統分享。";
    }
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closePreviewModal();
  });
}

function openPreviewModal() {
  const section = getVisibleScheduleSection();
  if (!section) return;
  const rows = getPreviewRows(section);
  closePreviewModal();
  const backdrop = document.createElement("div");
  backdrop.className = "schedule-preview-backdrop";
  const subtitle = [getCurrentFilters(section), `已安排站點：${rows.length}`].filter(Boolean).join("｜");
  const listHtml = rows.length
    ? rows.map((row) => `<div class="schedule-preview-row"><strong>${row.station}</strong><span>${row.people.join("、")}</span></div>`).join("")
    : `<div class="schedule-preview-row"><strong>尚無安排內容</strong><span>請先點選人員排入站點。</span></div>`;
  backdrop.innerHTML = `
    <div class="schedule-preview-modal" role="dialog" aria-modal="true" aria-label="站點安排總預覽">
      <h3>站點安排總預覽</h3>
      <p class="schedule-preview-subtitle">${subtitle || getPageTitle(section)}</p>
      <div class="schedule-preview-list">${listHtml}</div>
      <div class="schedule-preview-actions">
        <button class="schedule-preview-cancel" type="button">取消</button>
        <button class="schedule-preview-confirm" type="button" ${rows.length ? "" : "disabled"}>確認</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector(".schedule-preview-cancel")?.addEventListener("click", closePreviewModal);
  backdrop.querySelector(".schedule-preview-confirm")?.addEventListener("click", () => openShareModal(section, rows));
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closePreviewModal();
  });
}

function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const button = target?.closest("button") as HTMLElement | null;
  if (button && isSmartScheduleOneClickButton(button)) {
    triggerSmartScheduleTipNow();
  }
  const completeButton = target?.closest(".schedule-complete-button");
  if (!completeButton) return;
  event.preventDefault();
  event.stopPropagation();
  openPreviewModal();
}

function scheduleEnsureCompleteButton() {
  window.requestAnimationFrame(() => {
    ensureCompleteButton();
  });
}

export function installScheduleShareRuntime() {
  if (shareRuntimeStarted || typeof window === "undefined") return;
  shareRuntimeStarted = true;
  ensureStyles();
  window.addEventListener("click", handleClick, true);
  const observer = new MutationObserver(scheduleEnsureCompleteButton);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  ensureCompleteButton();
  window.setInterval(ensureCompleteButton, 150);
}
