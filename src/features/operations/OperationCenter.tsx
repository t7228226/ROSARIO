import { useEffect, useMemo, useRef, useState } from "react";
import AppDialog from "../../components/ui/AppDialog";
import PagedList from "../../components/PagedList";
import { useActionDialog } from "../../components/ui/useActionDialog";
import { fetchGasOperations, postGasAction, type OperationReceipt, type WriteProgress } from "../../lib/gasClient";

const actionLabels: Record<string, string> = {
  createPerson: "新增人員", updatePerson: "更新人員", upsertQualification: "更新資格",
  deleteQualification: "刪除資格", updateStationRule: "更新站點規則", saveScheduleDraft: "儲存班表草稿",
  updatePermissionItem: "更新權限項目", updateRolePermission: "更新角色權限",
  upsertPersonalPermissionException: "更新個人權限", deletePersonalPermissionException: "刪除個人權限",
  syncQualificationsFromMatrix: "同步站點資格",
  acknowledgeOperation: "核對操作紀錄",
};
const statusLabels = { processing: "處理中", success: "已完成", failed: "未完成", unknown: "待確認", reviewed: "已人工核對" };
const emptyReceipts: OperationReceipt[] = [];

export default function OperationCenter({ userId, isAdmin, available, initialReceipts = emptyReceipts, onReload }: {
  userId: string; isAdmin: boolean; available: boolean; initialReceipts?: OperationReceipt[]; onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<OperationReceipt[]>(initialReceipts);
  const [scope, setScope] = useState("own");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const activeRequests = useRef(0);
  const [live, setLive] = useState<WriteProgress | null>(null);
  const { confirmAction, actionDialog } = useActionDialog(userId);

  useEffect(() => { if (scope === "own") setRecords(initialReceipts); }, [initialReceipts, scope]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    function onProgress(event: Event) {
      const detail = (event as CustomEvent<WriteProgress>).detail;
      setLive(detail);
      if (scope !== "own") return;
      setRecords((previous) => [detail, ...previous.filter((item) => item.operationId !== detail.operationId)].slice(0, 160));
    }
    window.addEventListener("rosario:write-progress", onProgress);
    return () => window.removeEventListener("rosario:write-progress", onProgress);
  }, [scope]);

  async function refresh(nextScope = scope) {
    const request = ++generation.current;
    activeRequests.current++;
    setBusy(true); setError("");
    try {
      const next = await fetchGasOperations(nextScope === "all");
      if (request === generation.current) setRecords(next);
    } catch (reason) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : "操作狀態查詢失敗。");
    } finally {
      activeRequests.current--;
      if (request === generation.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!open || !available || !records.some((item) => item.status === "processing")) return;
    const timer = window.setTimeout(() => { if (document.visibilityState !== "hidden" && !activeRequests.current) void refresh(); }, 15000);
    return () => window.clearTimeout(timer);
  }, [open, available, records, scope, busy]);

  const attention = records.filter((item) => item.status !== "success" && item.status !== "reviewed").length;
  const shown = useMemo(() => records.filter((item) => filter === "all" || (item.status !== "success" && item.status !== "reviewed")), [records, filter]);
  function openCenter() { setOpen(true); if (available) void refresh(); }
  async function acknowledge(item: OperationReceipt) {
    if (!await confirmAction("確認已載入最新資料並人工核對此操作？這只結案紀錄，不代表原操作成功，也不會重新寫入原資料。")) return;
    try {
      await postGasAction("acknowledgeOperation", { targetOperationId: item.operationId, confirmedReview: true });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "人工核對紀錄未完成。"); }
  }

  return <>
    {actionDialog}
    <button type="button" className="ghost operation-center-trigger" onClick={openCenter}>
      操作狀態{attention ? <span className="operation-count">{attention}</span> : null}
    </button>
    {live?.status === "processing" ? <div className="operation-live-status" role="status" aria-live="polite">
      <span className="operation-spinner" aria-hidden="true" />
      <span>{actionLabels[live.action] || "資料處理"}・{live.phase === "checking" ? "核對結果中" : live.phase === "retrying" ? "同編號重送中" : "送出中"}</span>
      <button type="button" onClick={openCenter}>查看</button>
    </div> : null}
    <AppDialog open={open} title="操作狀態" onClose={() => setOpen(false)} size="wide" footer={<>
      <button type="button" className="ghost" disabled={busy || !available} onClick={() => { void refresh(); }}>重新查詢</button>
      <button type="button" className="primary" onClick={() => { setOpen(false); onReload(); }}>載入最新資料</button>
    </>}>
      <div className="operation-toolbar">
        {isAdmin ? <label>範圍<select value={scope} onChange={(event) => { const next = event.target.value; setScope(next); setRecords([]); void refresh(next); }} disabled={!available}>
          <option value="own">我的操作</option><option value="all">全部操作</option>
        </select></label> : <span>我的操作</span>}
        <label>狀態<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部狀態</option><option value="attention">未完成與待確認</option></select></label>
        <span role="status">{busy ? "查詢中…" : `${records.length} 筆`}</span>
      </div>
      {!available ? <p className="operation-notice">目前後端尚未提供操作紀錄服務；新功能需與新版 GAS 一起部署。</p> : null}
      {error ? <p role="alert" className="operation-notice">{error}</p> : null}
      <PagedList items={shown} label="操作紀錄分頁" renderItem={(item) => <article className={`operation-record is-${item.status}`} key={item.operationId}>
        <div className="operation-record-heading"><strong>{actionLabels[item.action] || "資料操作"}</strong><span className="operation-state">{item.code === "REVISION_CONFLICT" ? "版本衝突" : statusLabels[item.status] || "待確認"}</span></div>
        <div className="operation-record-meta"><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString("zh-TW", { hour12: false })}</time>{scope === "all" ? <span>操作人 {item.ownerId || userId}</span> : null}{item.revision !== undefined ? <span>資料版本 {item.revision}</span> : null}</div>
        {item.status === "unknown" ? <p>可能已有部分資料寫入，請先核對最新資料；不會自動重新執行。</p> : item.status === "failed" ? <p>{item.code === "REVISION_CONFLICT" ? "資料已更新，請載入最新資料後核對再送出。" : "本次未完成，請核對提示與最新資料。"}</p> : null}
        {item.status === "unknown" && isAdmin && available ? <button type="button" className="ghost" onClick={() => { void acknowledge(item); }}>標記已人工核對</button> : null}
        <details><summary>操作編號</summary><code>{item.operationId}</code></details>
      </article>} />
      <p className="muted operation-retention">已完成與失敗紀錄保留 24 小時；待確認紀錄保留供核對。未顯示紀錄不代表尚未寫入。</p>
    </AppDialog>
  </>;
}
