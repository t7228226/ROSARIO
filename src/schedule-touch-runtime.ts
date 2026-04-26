function isMobileViewport() {
  return window.matchMedia("(max-width: 900px)").matches;
}

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

function isSchedulePersonControl(node: HTMLElement) {
  const text = normalizeText(node.querySelector("strong")?.textContent || node.textContent || "");
  if (!text) return false;
  if (text.includes("自訂人選") || text.includes("一鍵安排") || text.includes("安排完成")) return false;
  if (text.includes("需求") || text.includes("已安排") || text.includes("尚未安排")) return false;
  return node.matches(".list-row, .candidate-chip, .chip, .tag, .pill, button");
}

function findSchedulePersonControl(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null;
  const section = getVisibleManualScheduleSection();
  if (!section || !section.contains(target)) return null;
  const control = target.closest<HTMLElement>(".list-row, .candidate-chip, .chip, .tag, .pill, button");
  if (!control || !section.contains(control)) return null;
  if (!isSchedulePersonControl(control)) return null;
  return control;
}

function ensureTouchStyle() {
  if (document.getElementById("safe-schedule-touch-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "safe-schedule-touch-runtime-style";
  style.textContent = `
    @media (max-width: 900px) {
      .page-section button,
      .page-section .list-row,
      .page-section .candidate-chip,
      .page-section .chip,
      .page-section .tag,
      .page-section .pill,
      .page-section select {
        touch-action: manipulation !important;
        -webkit-tap-highlight-color: transparent !important;
      }

      .page-section button,
      .page-section .list-row,
      .page-section .candidate-chip,
      .page-section .chip,
      .page-section .tag,
      .page-section .pill {
        cursor: pointer !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        position: relative !important;
        z-index: 1 !important;
      }

      .page-section .panel,
      .page-section .card,
      .page-section [class*='panel'],
      .page-section [class*='card'] {
        -webkit-transform: translateZ(0);
        transform: translateZ(0);
      }

      .floating-schedule-tip {
        pointer-events: none !important;
      }

      .floating-schedule-tip button,
      .floating-schedule-tip .schedule-complete-button {
        pointer-events: auto !important;
        touch-action: manipulation !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function installOneTapBridge() {
  let bridgeClickUntil = 0;

  document.addEventListener(
    "pointerup",
    (event) => {
      if (!isMobileViewport()) return;
      if (event.pointerType !== "touch") return;
      const control = findSchedulePersonControl(event.target);
      if (!control) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      bridgeClickUntil = Date.now() + 420;
      control.click();
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!isMobileViewport()) return;
      if (Date.now() > bridgeClickUntil) return;
      if (!findSchedulePersonControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    },
    true
  );
}

let installed = false;

export function installScheduleTouchRuntime() {
  if (installed) return;
  installed = true;
  ensureTouchStyle();
  installOneTapBridge();
}
