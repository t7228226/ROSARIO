import { useEffect, useId } from "react";
import type { PageKey } from "../types";
import type { UiThemeKey } from "../domain/preferences/uiTheme";
import ThemePicker from "./ThemePicker";

interface MobileCommandMenuProps {
  open: boolean;
  page: PageKey;
  items: Array<{ key: PageKey; label: string }>;
  theme: UiThemeKey;
  onToggle: () => void;
  onNavigate: (page: PageKey) => void;
  onThemeChange: (theme: UiThemeKey) => void;
  onTop: () => void;
}

export default function MobileCommandMenu({
  open,
  page,
  items,
  theme,
  onToggle,
  onNavigate,
  onThemeChange,
  onTop,
}: MobileCommandMenuProps) {
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggle();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onToggle, open]);

  return (
    <div className={`mobile-command-center${open ? " is-open" : ""}`}>
      {open ? (
        <aside id={menuId} className="mobile-command-panel" aria-label="快速選單">
          <div className="mobile-command-heading">
            <div>
              <strong>快速選單</strong>
              <span>{items.find((item) => item.key === page)?.label || "目前功能"}</span>
            </div>
            <button type="button" className="mobile-command-collapse" onClick={onToggle}>收合</button>
          </div>
          <nav className="mobile-command-nav" aria-label="功能切換">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={page === item.key ? "is-active" : ""}
                aria-current={page === item.key ? "page" : undefined}
                onClick={() => {
                  onNavigate(item.key);
                  onToggle();
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mobile-command-actions">
            <button type="button" onClick={() => { onTop(); onToggle(); }}>回到頁面頂部</button>
          </div>
          <ThemePicker value={theme} onChange={onThemeChange} compact />
        </aside>
      ) : null}
      <button
        type="button"
        className="mobile-command-trigger"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "收合快速選單" : "開啟快速選單"}
        onClick={onToggle}
      >
        <span aria-hidden="true">{open ? "收合" : "功能"}</span>
      </button>
    </div>
  );
}
