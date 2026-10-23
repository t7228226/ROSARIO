import { useEffect, useRef, useState } from "react";
import AppDialog from "./AppDialog";

type Action = { kind: "confirm" | "text"; message: string };

export function useActionDialog(identity: string) {
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState("");
  const pending = useRef<((value: string | boolean | null) => void) | null>(null);
  function finish(value: string | boolean | null) {
    const resolve = pending.current;
    pending.current = null; setAction(null); setText(""); resolve?.(value);
  }
  useEffect(() => {
    setAction(null); setText("");
    return () => { pending.current?.(null); pending.current = null; };
  }, [identity]);
  function ask(kind: Action["kind"], message: string) {
    if (pending.current) return Promise.resolve(null);
    return new Promise<string | boolean | null>((resolve) => { pending.current = resolve; setAction({ kind, message }); });
  }
  return {
    confirmAction: async (message: string) => await ask("confirm", message) === true,
    requestText: async (message: string) => { const result = await ask("text", message); return typeof result === "string" ? result : null; },
    actionDialog: <AppDialog open={Boolean(action)} title={action?.kind === "text" ? "自訂人選" : "確認變更"} onClose={() => finish(null)} footer={<>
      <button type="button" className="ghost" onClick={() => finish(null)}>取消</button>
      <button type="button" className="primary" disabled={action?.kind === "text" && !text.trim()} onClick={() => finish(action?.kind === "text" ? text.trim() : true)}>確認</button>
    </>}>
      {action?.kind === "text" ? <label className="action-dialog-input">{action.message}<input autoFocus value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && text.trim()) { event.preventDefault(); finish(text.trim()); } }} /></label> : <p>{action?.message}</p>}
    </AppDialog>,
  };
}
