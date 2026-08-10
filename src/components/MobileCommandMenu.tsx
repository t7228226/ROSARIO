import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PageKey } from "../types";
import type { UiThemeKey } from "../domain/preferences/uiTheme";
import {
  clampMobileCommandPosition,
  readStoredMobileCommandPosition,
  storeMobileCommandPosition,
  type MobileCommandPosition,
} from "../domain/preferences/mobileCommandPosition";
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

function getCurrentViewport() {
  const visualViewport = window.visualViewport;
  return {
    width: Math.floor(visualViewport?.width || document.documentElement.clientWidth || window.innerWidth),
    height: Math.floor(visualViewport?.height || document.documentElement.clientHeight || window.innerHeight),
  };
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
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: MobileCommandPosition;
    current: MobileCommandPosition;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<MobileCommandPosition>(() => {
    if (typeof window === "undefined") return { x: 12, y: 12 };
    return readStoredMobileCommandPosition(window.localStorage, getCurrentViewport());
  });

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggle();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onToggle, open]);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => {
        const next = clampMobileCommandPosition(current, getCurrentViewport());
        storeMobileCommandPosition(next, window.localStorage);
        return next;
      });
    }
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const state = dragState.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const moved = state.moved || Math.hypot(deltaX, deltaY) > 5;
      if (!moved) return;
      event.preventDefault();
      const next = clampMobileCommandPosition({
        x: state.origin.x + deltaX,
        y: state.origin.y + deltaY,
      }, getCurrentViewport());
      state.current = next;
      state.moved = true;
      setDragging(true);
      setPosition(next);
    }

    function finishPointerInteraction(event: PointerEvent) {
      const state = dragState.current;
      if (!state || state.pointerId !== event.pointerId) return;
      if (state.moved) {
        storeMobileCommandPosition(state.current, window.localStorage);
        suppressNextClick();
      }
      dragState.current = null;
      setDragging(false);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishPointerInteraction);
    window.addEventListener("pointercancel", finishPointerInteraction);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerInteraction);
      window.removeEventListener("pointercancel", finishPointerInteraction);
    };
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || open) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: position,
      current: position,
      moved: false,
    };
  }

  function suppressNextClick() {
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function handleTriggerClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onToggle();
  }

  return (
    <>
      {open ? <button type="button" className="mobile-command-dismiss" aria-label="關閉快速選單" onClick={onToggle} /> : null}
      <div
        className={`mobile-command-center${open ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
        style={{ left: position.x, top: position.y }}
      >
        {open ? (
          <aside id={menuId} className="mobile-command-panel" aria-label="快速選單">
            <div className="mobile-command-heading">
              <div>
                <strong>快速選單</strong>
                <span>{items.find((item) => item.key === page)?.label || "目前功能"}</span>
              </div>
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
          aria-label="開啟快速選單，可拖曳移動"
          title="拖曳可移動，點選開啟功能"
          onPointerDown={handlePointerDown}
          onClick={handleTriggerClick}
        >
          <span aria-hidden="true">功能</span>
        </button>
      </div>
    </>
  );
}
