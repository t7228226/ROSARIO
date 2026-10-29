import { useState } from "react";
import AppDialog from "../../components/ui/AppDialog";
import PagedList from "../../components/PagedList";
import { departureIdsThrough, normalizeDepartureDate } from "../../domain/workforce/departures";
import type { Person } from "../../types";

interface Props {
  candidates: Person[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  before: number;
  after: number;
  changes: Array<{ stationId: string; name: string; before: number; after: number }>;
}

export default function DepartureScenarioPanel({ candidates, selectedIds, onChange, before, after, changes }: Props) {
  const [open, setOpen] = useState(false);
  const [cutoff, setCutoff] = useState("");
  const [keyword, setKeyword] = useState("");
  const selected = candidates.filter((person) => selectedIds.includes(person.id));
  const visible = candidates.filter((person) => `${person.id} ${person.name}`.toLowerCase().includes(keyword.trim().toLowerCase()));
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }
  return <section className="panel departure-scenario-panel" aria-label="預計離職情境">
    <div className="panel-header">
      <h3>預計離職情境</h3>
      <span className={`status-pill ${selected.length ? "warning" : ""}`}>{selected.length ? `已選 ${selected.length} 人` : "未套用"}</span>
    </div>
    <div className="departure-scenario-actions">
      <button type="button" className="ghost" onClick={() => setOpen(true)}>選擇人員（{candidates.length}）</button>
      <button type="button" className="ghost" disabled={!selected.length} onClick={() => onChange(selectedIds.filter((id) => !selected.some((person) => person.id === id)))}>清除本情境</button>
    </div>
    {selected.length > 0 && <>
      <div className="departure-impact" role="status"><span>目前缺口 <strong>{before}</strong></span><span>離職後缺口 <strong>{after}</strong></span><span>新增缺口 <strong>{Math.max(0, after - before)}</strong></span></div>
      <details className="departure-comparison"><summary>離職名單與站點差異</summary>
        <ul className="departure-selected-list">{selected.map((person) => <li key={person.id}><strong>{person.name}</strong><span>{normalizeDepartureDate(person.departureDate)}</span></li>)}</ul>
        {changes.length ? <table className="table"><thead><tr><th>站點</th><th>目前缺口</th><th>離職後</th><th>增加</th></tr></thead><tbody>{changes.map((row) => <tr key={row.stationId} className={row.after > row.before ? "danger-row" : ""}><th>{row.name}</th><td>{row.before}</td><td>{row.after}</td><td>{row.after - row.before > 0 ? "+" : ""}{row.after - row.before}</td></tr>)}</tbody></table> : <p className="muted">此情境的站點缺口未增加。</p>}
      </details>
    </>}
    <AppDialog open={open} title="預計離職名單" description="僅影響本次模擬；不會修改在職狀態。" onClose={() => setOpen(false)} footer={<button type="button" className="primary" onClick={() => setOpen(false)}>完成</button>}>
      <div className="departure-cutoff"><label>截至日期<input type="date" value={cutoff} onChange={(event) => setCutoff(event.currentTarget.value)} onInput={(event) => setCutoff(event.currentTarget.value)} onBlur={(event) => setCutoff(event.currentTarget.value)} /></label><button type="button" className="ghost" disabled={!cutoff} onClick={() => onChange([...new Set([...selectedIds, ...departureIdsThrough(candidates, cutoff)])])}>加入到期名單</button></div>
      <label className="departure-search">搜尋人員<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="姓名或工號" /></label>
      <PagedList items={visible} label="離職情境名單分頁" renderItem={(person) => <label className="departure-person" key={person.id}>
        <input type="checkbox" checked={selectedIds.includes(person.id)} onChange={() => toggle(person.id)} />
        <span><strong>{person.name}</strong><small>{person.id} · {person.shift}</small></span><time>{normalizeDepartureDate(person.departureDate)}</time>
      </label>} />
    </AppDialog>
  </section>;
}
