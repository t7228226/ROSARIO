function ensureTouchStyle() {
  if (document.getElementById("safe-schedule-touch-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "safe-schedule-touch-runtime-style";
  style.textContent = `
    @media (max-width: 900px) {
      html,
      body,
      #root {
        overscroll-behavior-y: contain;
      }

      .app-shell,
      .page-section,
      .panel,
      .card,
      [class*='panel'],
      [class*='card'] {
        -webkit-tap-highlight-color: transparent !important;
      }

      .page-section select {
        min-height: 54px !important;
        font-size: 18px !important;
        line-height: 1.25 !important;
        touch-action: manipulation !important;
        -webkit-tap-highlight-color: transparent !important;
      }

      .page-section button,
      .page-section .list-row,
      .page-section .candidate-chip,
      .page-section .chip,
      .page-section .tag,
      .page-section .pill {
        min-height: 48px !important;
        min-width: 72px !important;
        padding: 10px 16px !important;
        font-size: 17px !important;
        line-height: 1.25 !important;
        touch-action: manipulation !important;
        -webkit-tap-highlight-color: transparent !important;
        cursor: pointer !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }

      .page-section .list-row,
      .page-section .candidate-chip,
      .page-section .chip,
      .page-section .tag,
      .page-section .pill {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        white-space: nowrap !important;
      }

      .page-section .list-scroll,
      .page-section .list-scroll.short,
      .page-section .panel .list-scroll,
      .page-section .panel .list-scroll.short {
        overflow: visible !important;
        max-height: none !important;
        -webkit-overflow-scrolling: touch !important;
      }

      .page-section .panel,
      .page-section .card,
      .page-section [class*='panel'],
      .page-section [class*='card'] {
        transform: none !important;
        -webkit-transform: none !important;
      }

      .floating-schedule-tip {
        pointer-events: none !important;
      }

      .floating-schedule-tip button,
      .floating-schedule-tip .schedule-complete-button {
        pointer-events: auto !important;
        min-height: 42px !important;
        touch-action: manipulation !important;
      }
    }
  `;
  document.head.appendChild(style);
}

let installed = false;

export function installScheduleTouchRuntime() {
  if (installed) return;
  installed = true;
  ensureTouchStyle();
}
