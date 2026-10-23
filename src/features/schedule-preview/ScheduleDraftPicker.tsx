import { useState } from "react";
import AppDialog from "../../components/ui/AppDialog";
import { postGasAction } from "../../lib/gasClient";
import type { ShiftMode, SmartScheduleMode, TeamName } from "../../types";

export interface ScheduleDraft {
  id: string;
  name: string;
  team: TeamName;
  dayKey: ShiftMode;
  mode: SmartScheduleMode;
  updatedAt?: string;
}
export interface ScheduleDraftDetail {
  draftId: string;
  stationId: string;
  employeeId: string;
  type: string;
  order?: number;
  note?: string;
}

export default function ScheduleDraftPicker({ team, day, hasChanges, onRestore }: {
  team: TeamName;
  day: ShiftMode;
  hasChanges: boolean;
  onRestore: (draft: ScheduleDraft, details: ScheduleDraftDetail[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  const [details, setDetails] = useState<ScheduleDraftDetail[]>([]);
  const [selected, setSelected] = useState<ScheduleDraft | null>(null);

  async function load() {
    setOpen(true);
    setSelected(null);
    setBusy(true);
    setError("");
    try {
      const result = await postGasAction("loadScheduleDrafts", { team, dayKey: day, includeDetails: true });
      if (!Array.isArray(result.drafts) || !Array.isArray(result.details)) throw new Error("草稿格式無法辨識，請重新讀取。");
      setDrafts((result.drafts as ScheduleDraft[]).filter((item) => item.team === team && item.dayKey === day));
      setDetails(result.details as ScheduleDraftDetail[]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "草稿讀取失敗。"); }
    finally { setBusy(false); }
  }

  return <>
    <button className="ghost" type="button" onClick={() => void load()}>載入草稿</button>
    <AppDialog open={open} title={`${team}・${day}草稿`} onClose={() => setOpen(false)} footer={selected ?
      <button type="button" className="primary" onClick={() => {
        onRestore(selected, details.filter((item) => item.draftId === selected.id));
        setOpen(false);
      }}>確認載入並重新檢核</button> : undefined}>
      {busy ? <p role="status">正在讀取草稿…</p> : error ? <p role="alert">{error}</p> : <>
        {hasChanges ? <p className="muted">載入將取代目前未儲存的試排；可先關閉視窗儲存現有草稿。</p> : null}
        {drafts.length ? <div className="draft-list">{drafts.map((draft) =>
          <button type="button" className="list-row" key={draft.id} aria-pressed={selected?.id === draft.id} onClick={() => setSelected(draft)}>
            <strong>{draft.name}</strong><span>{draft.updatedAt ? new Date(draft.updatedAt).toLocaleString("zh-TW") : draft.id}</span>
          </button>
        )}</div> : <p>此班別與日別尚無已儲存草稿。</p>}
        {selected ? <p role="status">已選擇 {selected.name}。載入後會依目前出勤與資格重新檢核，不代表已核准班表。</p> : null}
      </>}
    </AppDialog>
  </>;
}
