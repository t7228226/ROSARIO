import { useEffect, useRef, useState } from "react";
import AppDialog from "../../components/ui/AppDialog";
import { useActionDialog } from "../../components/ui/useActionDialog";
import { postGasAction } from "../../lib/gasClient";
import { getCoverageQualificationStatus } from "../../lib/selectors";
import { readPlanningConfiguration, type PlanningConfiguration } from "../../domain/workforce/configurationSession";
import type { PlanningRule } from "../../domain/workforce/planningRules";
import type { Person, Qualification, ShiftMode, TeamName } from "../../types";

interface Preset {
  id: string; name: string; team: TeamName; dayKey: ShiftMode; isDefault: boolean; updatedAt?: number;
  configuration: PlanningConfiguration;
}
interface Props {
  userId: string; team: TeamName; day: ShiftMode; configuration: PlanningConfiguration; enabled: boolean; canUndo: boolean;
  people: Person[]; qualifications: Qualification[]; stations: Array<{ id: string; name: string }>;
  onChange: (next: PlanningConfiguration) => void; onDefault: (next: PlanningConfiguration) => void;
  onEnable: (enabled: boolean) => void; onReset: () => void; onUndo: () => void;
  onCapture?: () => PlanningConfiguration;
}
const modeLabels = { fixed: "固定站點", allowed: "限定站點", preferred: "優先站點" };
function readPresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) throw new Error("預設資料格式無法辨識。");
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.isDefault !== "boolean") throw new Error("預設資料格式無法辨識。");
    return { ...item, configuration: readPlanningConfiguration(item.configuration) } as Preset;
  });
}

export default function PlanningPresetBar(props: Props) {
  const { userId, team, day, configuration, people, stations, qualifications } = props;
  const [dialog, setDialog] = useState<"rules" | "presets" | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [mode, setMode] = useState<PlanningRule["mode"]>("allowed");
  const [stationIds, setStationIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const generation = useRef(0);
  const savingRef = useRef(false);
  const pendingSave = useRef<Record<string, unknown> | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const { confirmAction, actionDialog } = useActionDialog(userId);
  const count = configuration.assignments.length + configuration.rules.length;
  const person = people.find((item) => item.id === employeeId);
  const officer = Boolean(person && ["領班", "組長", "主任"].includes(person.role.trim()));

  async function load(auto = false) {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await postGasAction("loadCoveragePresets", { team, dayKey: day });
      if (generation.current !== request) return;
      const next = readPresets(result.presets).filter((item) => item.team === team && item.dayKey === day);
      setPresets(next);
      if (auto) {
        const preferred = next.find((item) => item.isDefault);
        if (preferred) { callbacks.current.onDefault(preferred.configuration); setNotice(`可用預設：${preferred.name}`); }
      }
    } catch (reason) { if (generation.current === request) setError(reason instanceof Error ? reason.message : "預設讀取失敗。"); }
    finally { if (generation.current === request) setLoading(false); }
  }
  useEffect(() => {
    setDialog(null); setPresets([]); setSelectedId(""); setName(""); setIsDefault(false); setNotice(""); setUncertain(false); pendingSave.current = null;
    void load(true);
    return () => { generation.current++; };
  }, [userId, team, day]);

  function selectPreset(id: string) {
    const selected = presets.find((item) => item.id === id);
    setSelectedId(id); setName(selected?.name || ""); setIsDefault(Boolean(selected?.isDefault)); setError("");
  }
  async function save() {
    if (savingRef.current) return;
    if (!name.trim()) { setError("請輸入預設名稱。"); return; }
    if (!pendingSave.current && selectedId && !await confirmAction(`確認以目前配置更新「${name.trim()}」？既有人員資格與出勤資料不會改變。`)) return;
    const request = generation.current;
    savingRef.current = true; setSaving(true); setError("");
    try {
      // Keep an uncertain request byte-for-byte stable so the reliable-write receipt is reused.
      const payload = pendingSave.current || { preset: { ...(selectedId ? { id: selectedId } : {}), name: name.trim(), team, dayKey: day, isDefault, configuration } };
      pendingSave.current = payload;
      const result = await postGasAction("saveCoveragePreset", payload);
      if (request !== generation.current) return;
      pendingSave.current = null; setUncertain(false);
      setSelectedId(String(result.presetId)); setNotice(`已儲存：${name.trim()}`);
      await load();
    } catch (reason) {
      if (request === generation.current) {
        const unknown = Boolean(reason && typeof reason === "object" && "code" in reason && reason.code === "WRITE_OUTCOME_UNKNOWN");
        if (!unknown) pendingSave.current = null;
        setUncertain(unknown); setError(reason instanceof Error ? reason.message : "預設尚未儲存。");
      }
    }
    finally { savingRef.current = false; setSaving(false); }
  }
  function editPerson(id: string) {
    const rule = configuration.rules.find((item) => item.employeeId === id);
    const assigned = configuration.assignments.find((item) => item.employeeId === id);
    setEmployeeId(id); setMode(rule?.mode || (assigned ? "fixed" : "allowed")); setStationIds(rule?.stationIds || (assigned ? [assigned.stationId] : [])); setError("");
  }
  function removePerson(id: string) {
    props.onChange({ assignments: configuration.assignments.filter((item) => item.employeeId !== id), rules: configuration.rules.filter((item) => item.employeeId !== id) });
    if (employeeId === id) setStationIds([]);
  }
  function applyRule() {
    if (!person || !stationIds.length || (mode === "fixed" && stationIds.length !== 1)) { setError("請選擇人員及站點；固定站點只能選一站。"); return; }
    if (officer && mode !== "fixed") { setError("領班、組長與主任只可明確指定固定支援，不會加入自動候補。"); return; }
    if (stationIds.some((id) => getCoverageQualificationStatus(qualifications, employeeId, id) !== "合格")) { setError("只能選擇具有正式資格且非不可排的站點。"); return; }
    props.onChange({ assignments: configuration.assignments.filter((item) => item.employeeId !== employeeId), rules: [...configuration.rules.filter((item) => item.employeeId !== employeeId), { employeeId, mode, stationIds }] });
    setNotice(`已套用 ${person.name} 的配置規則`); setError("");
  }
  const entries = [
    ...configuration.rules.map((rule) => ({ id: rule.employeeId, label: `${modeLabels[rule.mode]}：${rule.stationIds.map((id) => stations.find((item) => item.id === id)?.name || id).join("、")}` })),
    ...configuration.assignments.map((item) => ({ id: item.employeeId, label: `${item.source === "training" ? "補訓假設" : item.source === "officer" ? "幹部支援" : "固定站點"}：${stations.find((station) => station.id === item.stationId)?.name || item.stationId}` })),
  ];
  return <section className="planning-preset-bar" aria-label="配置規則與預設">
    {actionDialog}
    <div className="planning-bar-heading"><strong>配置規則與預設</strong><span role="status">{team}・{day}｜{count ? `${props.enabled ? "套用中" : "已暫停"} · ${count} 項` : "系統配置"}</span></div>
    <div className="planning-bar-actions">
      <button type="button" className="ghost" onClick={() => { setDialog("rules"); setError(""); }}>配置規則</button>
      <button type="button" className="ghost" onClick={() => setDialog("presets")}>我的預設</button>
      <button type="button" className="ghost" disabled={!props.canUndo} onClick={props.onUndo}>復原上一步</button>
      <button type="button" className="ghost" disabled={!count} onClick={() => { props.onReset(); setNotice("已恢復系統配置；雲端預設仍保留。"); }}>恢復系統預設</button>
      <label className="planning-enabled"><input type="checkbox" checked={props.enabled} disabled={!count} onChange={(event) => props.onEnable(event.target.checked)} />套用自訂配置</label>
    </div>
    {loading ? <p role="status" className="muted">正在讀取個人配置預設…</p> : null}
    {!loading && error && !dialog ? <p role="alert">{error}<button type="button" className="ghost" onClick={() => void load()}>重新讀取預設</button></p> : null}
    {notice ? <p className="muted" role="status">{notice}</p> : null}
    <AppDialog open={dialog === "rules"} title="配置規則" description={`${team}・${day}｜關閉視窗會保留目前調整。`} onClose={() => setDialog(null)} size="wide"
      footer={<><button type="button" className="ghost" disabled={!person} onClick={applyRule}>套用人員規則</button><button type="button" className="primary" onClick={() => setDialog(null)}>完成</button></>}>
      <div className="planning-rule-form">
        <label>搜尋人員<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="工號或姓名" /></label>
        <label>人員<select value={employeeId} onChange={(event) => editPerson(event.target.value)}><option value="">請選擇人員</option>{people.filter((item) => !keyword.trim() || `${item.id} ${item.name}`.toLowerCase().includes(keyword.trim().toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}</select></label>
        <div className="planning-mode" role="group" aria-label="配置規則類型">{Object.entries(modeLabels).map(([key, label]) => <button type="button" key={key} aria-pressed={mode === key} onClick={() => { setMode(key as PlanningRule["mode"]); if (key === "fixed") setStationIds(stationIds.slice(0, 1)); }}>{label}</button>)}</div>
        <p className="muted">{mode === "fixed" ? "固定至單一站點；缺勤或資格失效時會提示並排除該指定。" : mode === "allowed" ? "只在勾選的合格站點間配置；可能產生額外缺口。" : "優先考慮勾選站點，仍以全站覆蓋與支援優先為準。"}</p>
        <fieldset className="planning-station-options"><legend>站點</legend>{stations.map((station) => <label key={station.id}><input type="checkbox" checked={stationIds.includes(station.id)} disabled={!person || getCoverageQualificationStatus(qualifications, employeeId, station.id) !== "合格"} onChange={(event) => setStationIds(event.target.checked ? mode === "fixed" ? [station.id] : [...stationIds, station.id] : stationIds.filter((id) => id !== station.id))} />{station.name}</label>)}</fieldset>
      </div>
      {error ? <p role="alert" className="departure-shortage">{error}</p> : null}
      <h3>目前配置規則 · {entries.length} 項</h3>
      <div className="planning-rule-list">{entries.map((entry) => <div key={entry.id}><button type="button" className="planning-rule-entry" onClick={() => editPerson(entry.id)}><strong>{people.find((item) => item.id === entry.id)?.name || entry.id}</strong><span>{entry.label}</span></button><button type="button" className="ghost" aria-label={`移除 ${entry.id} 規則`} onClick={() => removePerson(entry.id)}>移除</button></div>)}{!entries.length ? <p>尚未設定配置規則。</p> : null}</div>
    </AppDialog>
    <AppDialog open={dialog === "presets"} title="我的配置預設" description={`${team}・${day}｜僅保存配置規則，不修改資格或出勤。`} onClose={() => setDialog(null)} footer={<><button type="button" className="ghost" disabled={loading || saving || !selectedId} onClick={() => { const preset = presets.find((item) => item.id === selectedId); if (preset) { props.onChange(preset.configuration); setNotice(`已套用：${preset.name}`); setDialog(null); } }}>套用預設</button><button type="button" className="primary" disabled={saving || loading} onClick={() => void save()}>{saving ? "儲存中…" : "儲存目前配置"}</button></>}>
      <div className="planning-rule-form">
        <label>選擇預設<select value={selectedId} disabled={saving || uncertain} onChange={(event) => selectPreset(event.target.value)}><option value="">新增預設</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.isDefault ? "（預設套用）" : ""}</option>)}</select></label>
        <label>預設名稱<input value={name} maxLength={60} disabled={saving || uncertain} onChange={(event) => setName(event.target.value)} /></label>
        <label className="planning-enabled"><input type="checkbox" checked={isDefault} disabled={saving || uncertain} onChange={(event) => setIsDefault(event.target.checked)} />設為此班別與日別的預設配置</label>
        {uncertain ? <p role="alert">前次儲存結果待確認；再次儲存只會核對相同操作，不會另建預設。請先至操作狀態核對，勿重新新增。</p> : null}
        <p className="muted">目前配置含 {count} 項規則／指定。恢復系統預設不會刪除已儲存的預設。</p>
        {props.onCapture ? <button type="button" className="ghost" disabled={saving || uncertain} onClick={() => { props.onChange(props.onCapture!()); setNotice("已擷取目前試排的合格人員站位；儲存後可再次套用。"); }}>採用目前試排站位</button> : null}
        <button type="button" className="ghost" disabled={loading || saving} onClick={() => void load()}>重新讀取預設</button>
        {error ? <p role="alert" className="departure-shortage">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </AppDialog>
  </section>;
}
