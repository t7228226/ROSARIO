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

export function installScheduleTouchRuntime() {
  ensureTouchStyle();
}
