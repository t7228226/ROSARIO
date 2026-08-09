import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface AppDialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "wide";
}

interface DialogShellProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  backdropClassName: string;
  panelClassName: string;
  closeOnBackdrop?: boolean;
}

function useDialogFocusManagement(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && open && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeElement && !panelRef.current?.contains(activeElement)) {
      returnFocusRef.current = activeElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const activeInsideDialog = document.activeElement instanceof HTMLElement
        && panelRef.current?.contains(document.activeElement)
        && document.activeElement !== panelRef.current;
      if (activeInsideDialog) return;
      const first = panelRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (first || panelRef.current)?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  return panelRef;
}

export function DialogShell({
  open,
  title,
  onClose,
  children,
  backdropClassName,
  panelClassName,
  closeOnBackdrop = false,
}: DialogShellProps) {
  const panelRef = useDialogFocusManagement(open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function AppDialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "default",
}: AppDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useDialogFocusManagement(open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className="app-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`app-dialog ${size === "wide" ? "app-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="app-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button type="button" className="app-dialog-close" onClick={onClose} aria-label={`關閉「${title}」`} title="關閉">
            ×
          </button>
        </header>
        <div className="app-dialog-body">{children}</div>
        {footer ? <footer className="app-dialog-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
