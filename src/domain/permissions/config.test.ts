import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRolePermissionMapsFromSaved,
  databasePermissionItems,
  mergePermissionItemsWithSaved,
} from "./config";

describe("permission config", () => {
  it("權限表已有資料時，未存檔的內建項目預設停用", () => {
    const merged = mergePermissionItemsWithSaved([
      { id: "PERM_001", name: "首頁查看", category: "查詢", page: "首頁", action: "查看", mobileFirst: "Y", enabled: "啟用" },
    ]);
    assert.equal(merged.find((item) => item.id === "PERM_001")?.enabled, "啟用");
    assert.equal(merged.find((item) => item.id === "PERM_002")?.enabled, "停用");
  });

  it("最高權限固定開放，其他角色未存檔時預設不開放", () => {
    const maps = buildRolePermissionMapsFromSaved(undefined, databasePermissionItems.slice(0, 1));
    assert.equal(maps.find((item) => item.role === "最高權限")?.allowed, "Y");
    assert.equal(maps.find((item) => item.role === "主任")?.allowed, "N");
  });

  it("保留後端自訂權限項目", () => {
    const merged = mergePermissionItemsWithSaved([
      { id: "CUSTOM_001", name: "自訂報表", category: "自訂", page: "報表", action: "查看", mobileFirst: "N", enabled: "啟用" },
    ]);
    assert.equal(merged.find((item) => item.id === "CUSTOM_001")?.name, "自訂報表");
  });
});
