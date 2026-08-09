import type { ReactNode } from "react";
import type { PageKey } from "../types";
import Layout from "./Layout";

type EntranceKey = PageKey | "login-required";

const entranceMeta: Record<EntranceKey, { title: string; subtitle: string }> = {
  home: { title: "今日總覽", subtitle: "查看出勤、站點需求、覆蓋狀態與需要優先處理的風險。" },
  "person-query": { title: "人員資格查詢", subtitle: "依班別、工號或姓名查詢個人資料與站點資格。" },
  "station-query": { title: "站點人選查詢", subtitle: "依班別與日別查看各站點可用的本班及支援人力。" },
  "qualification-review": { title: "資格考核管理", subtitle: "登錄與維護人員的合格、訓練中及不可排狀態。" },
  "gap-analysis": { title: "人力覆蓋分析", subtitle: "以目前出勤與站點規則計算全站覆蓋、缺勤風險及補訓效益。" },
  "manual-schedule": { title: "班表試排", subtitle: "依資格與站點需求安排人員，並在輸出前完成全站安全檢核。" },
  "smart-schedule": { title: "智慧試排", subtitle: "此功能目前停用，所有試排作業統一由班表試排處理。" },
  "station-rules": { title: "站點規則", subtitle: "設定最低需求、可排滿人數、備援目標與排站優先順序。" },
  "people-management": { title: "人員名單", subtitle: "維護人員基本資料與班別；系統權限請至權限設定管理。" },
  "permission-admin": { title: "權限設定", subtitle: "管理角色權限、帳號、功能啟用狀態與個人例外。" },
  "login-required": { title: "需要登入", subtitle: "請先完成帳號登入，系統將依權限顯示可用功能。" },
};

function EntranceHeader({ pageKey }: { pageKey: EntranceKey }) {
  const meta = entranceMeta[pageKey];
  return (
    <div className="entrance-header entrance-layout-marker" data-entrance-key={pageKey}>
      <h1>{meta.title}</h1>
      <p>{meta.subtitle}</p>
    </div>
  );
}

export default function EntranceLayout({ pageKey, children }: { pageKey: EntranceKey; children: ReactNode }) {
  return (
    <Layout title="" subtitle="">
      <EntranceHeader pageKey={pageKey} />
      {children}
    </Layout>
  );
}
