import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onCommit: (value: string) => unknown | Promise<unknown>;
  disabled?: boolean;
  type?: "text" | "number";
  options?: Array<{ label: string; value: string }>;
}

export default function ConfirmedField({ value, onCommit, disabled = false, type = "text", options }: Props) {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => { setDraft(value); setError(""); }, [value]);
  async function commit(next: string) {
    if (pending || next === latest.current) return;
    setPending(true);
    setError("");
    try { await onCommit(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "儲存失敗，請重新確認。"); }
    finally { setPending(false); setDraft(latest.current); }
  }
  return <span className="confirmed-field" aria-busy={pending}>
    {options ? <select className="cell-input" value={draft} disabled={disabled || pending} onChange={(event) => { setDraft(event.target.value); void commit(event.target.value); }}>
      {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select> : <input className="cell-input" type={type} value={draft} disabled={disabled || pending} aria-invalid={Boolean(error)} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit(draft)} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(latest.current); setError(""); }
      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
    }} />}
    {pending ? <small role="status">儲存中…</small> : error ? <small role="alert">{error}</small> : null}
  </span>;
}
