import type { UserRole } from "../../types";

export type PermissionItemDefinition = {
  id: string;
  name: string;
  category: string;
  page: string;
  action: string;
  mobileFirst: string;
  enabled: string;
  note?: string;
};

export type RolePermissionMapDefinition = {
  id: string;
  role: UserRole;
  permissionId: string;
  allowed: string;
  enabled: string;
  note?: string;
};

export const permissionOptions: UserRole[] = ["技術員", "領班", "組長", "主任", "站長", "最高權限"];

export const databasePermissionItems: PermissionItemDefinition[] = [
  { id: "PERM_001", name: "首頁查看", category: "查詢", page: "首頁", action: "查看", mobileFirst: "Y", enabled: "啟用", note: "基本入口" },
  { id: "PERM_002", name: "查詢人員資格查看", category: "查詢", page: "查詢人員資格", action: "查看", mobileFirst: "Y", enabled: "啟用", note: "主功能" },
  { id: "PERM_003", name: "查詢站點人選查看", category: "查詢", page: "查詢站點人選", action: "查看", mobileFirst: "Y", enabled: "啟用", note: "主功能" },
  { id: "PERM_004", name: "站點考核查看", category: "管理", page: "站點考核", action: "查看", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_005", name: "站點考核新增修改刪除", category: "管理", page: "站點考核", action: "修改", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_006", name: "站點缺口分析查看", category: "管理", page: "站點缺口分析", action: "查看", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_007", name: "站點試排查看", category: "管理", page: "站點試排", action: "查看", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_008", name: "站點試排修改", category: "管理", page: "站點試排", action: "修改", mobileFirst: "Y", enabled: "啟用", note: "自訂人選 / 手動試排" },
  { id: "PERM_009", name: "智能試排查看", category: "管理", page: "智能試排", action: "查看", mobileFirst: "Y", enabled: "停用", note: "已關閉，避免干涉站點試排" },
  { id: "PERM_010", name: "智能試排執行", category: "管理", page: "智能試排", action: "指派", mobileFirst: "Y", enabled: "停用", note: "已關閉，避免干涉站點試排" },
  { id: "PERM_011", name: "站點規則設定查看", category: "管理", page: "站點規則設定", action: "查看", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_012", name: "站點規則設定修改", category: "管理", page: "站點規則設定", action: "修改", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_013", name: "人員名單管理查看", category: "管理", page: "人員名單管理", action: "查看", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_014", name: "人員名單管理修改", category: "管理", page: "人員名單管理", action: "修改", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_015", name: "權限管理查看", category: "權限", page: "權限管理", action: "查看", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_016", name: "權限管理修改", category: "權限", page: "權限管理", action: "修改", mobileFirst: "N", enabled: "啟用" },
];

function normalizePermissionEnabled(value?: string) {
  return String(value || "啟用").includes("停") ? "停用" : "啟用";
}

function normalizePermissionAllowed(value?: string) {
  return String(value || "").toUpperCase() === "Y" ? "Y" : "N";
}

export function mergePermissionItemsWithSaved(remoteItems?: PermissionItemDefinition[]): PermissionItemDefinition[] {
  const remoteList = remoteItems || [];
  const remoteMap = new Map(remoteList.map((item) => [item.id, item]));
  const hasSavedPermissionItems = remoteList.length > 0;
  const result = databasePermissionItems.map((base) => {
    const saved = remoteMap.get(base.id);
    if (!hasSavedPermissionItems) return { ...base };
    return {
      ...base,
      ...(saved || {}),
      id: base.id,
      name: saved?.name || base.name,
      category: saved?.category || base.category,
      page: saved?.page || base.page,
      action: saved?.action || base.action,
      mobileFirst: saved?.mobileFirst || base.mobileFirst,
      enabled: saved ? normalizePermissionEnabled(saved.enabled) : "停用",
      note: saved?.note || (saved ? base.note : "尚未由試算表存檔，預設不開放"),
    };
  });

  remoteList.forEach((item) => {
    if (!item.id || result.some((base) => base.id === item.id)) return;
    result.push({
      id: item.id,
      name: item.name || item.id,
      category: item.category || "自訂",
      page: item.page || "",
      action: item.action || "查看",
      mobileFirst: item.mobileFirst || "Y",
      enabled: normalizePermissionEnabled(item.enabled),
      note: item.note || "後端自訂權限項目",
    });
  });

  return result;
}

export function buildRolePermissionMapsFromSaved(
  remoteMaps: RolePermissionMapDefinition[] | undefined,
  permissionItems: PermissionItemDefinition[] = databasePermissionItems
): RolePermissionMapDefinition[] {
  const savedMap = new Map<string, RolePermissionMapDefinition>();
  (remoteMaps || []).forEach((item) => {
    if (!item.role || !item.permissionId) return;
    savedMap.set(`${item.role}||${item.permissionId}`, item);
  });

  return permissionOptions.flatMap((role) =>
    permissionItems.map((permission) => {
      const saved = savedMap.get(`${role}||${permission.id}`);
      const isSuperAdmin = role === "最高權限";
      return {
        id: saved?.id || `ROLEMAP_${role}_${permission.id}`,
        role,
        permissionId: permission.id,
        allowed: isSuperAdmin ? "Y" : normalizePermissionAllowed(saved?.allowed),
        enabled: isSuperAdmin ? "啟用" : normalizePermissionEnabled(saved?.enabled),
        note: saved?.note || (isSuperAdmin ? "最高權限固定開放" : "未存檔，預設不開放"),
      };
    })
  );
}

export const databaseRolePermissionMaps: RolePermissionMapDefinition[] = buildRolePermissionMapsFromSaved(undefined, databasePermissionItems);
