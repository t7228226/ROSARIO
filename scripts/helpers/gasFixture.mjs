import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
export const source = await readFile(new URL("../../gas-login-fallback-2026-07-01.js", import.meta.url), "utf8");
export const VERSION = JSON.parse(await readFile(new URL("../../release.json", import.meta.url), "utf8")).version;
const PERMISSIONS = ["PERM_001", "PERM_005", "PERM_006", "PERM_007", "PERM_008", "PERM_011", "PERM_012", "PERM_014"];

// All accounts, sheets and service calls in this suite are synthetic and in memory.
export function fixture({ role = "主任", permissions = PERMISSIONS, exceptions = [], personRole = "技術員", timeZone = "UTC" } = {}) {
  let now = Date.UTC(2026, 9, 23), uuid = 0, operation = 0, locked = false, beforeAcquire;
  const events = [], properties = new Map(), sheets = new Map(), stats = { reads: 0 };
  const faults = { flush: false, finishOperation: false, beforeDataWrite: false, ledgerWrite: false, ledgerFlush: false, ledgerDelete: false, ledgerReadback: false, duringFingerprint: undefined };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function sheet(name, rows = []) {
    const value = {
      rows: rows.map(row => [...row]), formulas: new Map(), failNextWrite: false,
      getLastRow() { return this.rows.length; },
      getLastColumn() { return Math.max(0, ...this.rows.map(row => row.length)); },
      getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); },
      appendRow(row) {
        this.mutate("append", row);
        this.rows.push(row.map(v => typeof v === "string" && v.startsWith("'") ? v.slice(1) : v));
      },
      deleteRow(row) { this.mutate("delete", row); this.rows.splice(row - 1, 1); },
      mutate(kind, data) {
        assert.equal(locked, true, `unlocked ${name} ${kind}`);
        events.push({ kind, name, data });
        if (name === "13_操作收據" && faults.ledgerWrite) throw new Error("synthetic ledger write failure");
        if (this.failNextWrite) { this.failNextWrite = false; throw new Error("synthetic sheet failure"); }
      },
      getRange(row, column, height = 1, width = 1) {
        const range = {
          getValues: () => {
            stats.reads++;
            return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
              const cell = value.rows[row + y - 1]?.[column + x - 1] ?? "";
              return faults.ledgerReadback && name === "13_操作收據" && row + y > 1 && column + x === 2 ? `${cell} ` : cell;
            }));
          },
          getFormulas() {
            if (faults.duringFingerprint) faults.duringFingerprint(name);
            return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => value.formulas.get(`${row + y},${column + x}`) || ""));
          },
          getDisplayValues() { return this.getValues().map(cells => cells.map(v => String(v))); },
          setValue(v) { return this.setValues([[v]]); },
          setValues(values) {
            value.mutate("set", values);
            values.forEach((cells, y) => cells.forEach((v, x) => {
              while (value.rows.length < row + y) value.rows.push([]);
              value.rows[row + y - 1][column + x - 1] = typeof v === "string" && v.startsWith("'") ? v.slice(1) : v;
            }));
            return range;
          },
          clearContent() { return this.setValues(Array.from({ length: height }, () => Array(width).fill(""))); },
          copyTo() {}, getDataValidations() { return []; }, setDataValidations() {},
        };
        return range;
      },
    };
    sheets.set(name, value);
    return value;
  }
  const accounts = sheet("07_帳號管理", [
    ["工號", "登入帳號", "登入密碼", "系統權限", "啟用狀態"],
    ["P1001", "worker", "synthetic-old-password", role, "啟用"],
    ["ROOT", "root", "synthetic-admin-password", "最高權限", "啟用"],
  ]);
  const people = sheet("01_人員主表", [
    ["工號", "姓名", "班別", "職務", "備註"],
    ["P1001", "Synthetic worker", "TEAM_A", personRole, ""],
    ["ROOT", "Synthetic admin", "TEAM_B", "主任", ""],
  ]);
  sheet("02_站點主表", [["站點代碼", "站點名稱"], ["ST01", "Station"]]);
  sheet("03_站點矩陣", [["工號", "姓名", "班別", "職務", "備註", "ST01"], ["P1001", "Synthetic worker", "TEAM_A", personRole, "", "合格"]]);
  sheet("03_資格明細", [["工號", "站點代碼", "資格狀態"], ["P1001", "ST01", "合格"]]);
  const rules = sheet("04_站點規則", [
    ["規則ID", "班別", "站點代碼", "最低需求", "備註"],
    ["INTERNAL_A", "TEAM_A", "ST01", 1, "management-A"],
    ["INTERNAL_B", "TEAM_B", "ST01", 2, "management-B"],
  ]);
  sheet("06_資格異動紀錄", [["異動ID", "工號", "站點代碼", "新狀態", "異動人"]]);
  const catalog = Array.from({ length: 16 }, (_, i) => `PERM_${String(i + 1).padStart(3, "0")}`);
  sheet("08_權限項目", [["權限ID", "啟用狀態"], ...catalog.map(p => [p, "啟用"])]);
  const roleMaps = sheet("09_角色權限設定", [["角色", "權限ID", "允許", "啟用狀態"], ...permissions.map(p => [role, p, "Y", "啟用"])]);
  const exceptionSheet = sheet("10_個人例外權限", [["工號", "權限ID", "效果", "啟用狀態"], ...exceptions.map(e => ["P1001", e.permissionId, e.effect, "啟用"])]);
  const drafts = sheet("11_站點試排紀錄", [
    ["試排ID", "名稱", "班別", "日別", "模式", "狀態", "建立人", "建立時間", "更新時間", "備註"],
    ["D_A", "Draft A", "TEAM_A", "當班", "manual", "草稿", "P1001", "", "", ""],
    ["D_B", "Draft B", "TEAM_B", "當班", "manual", "草稿", "ROOT", "", "", ""],
  ]);
  sheet("12_站點試排明細", [["試排ID", "項目ID", "站點代碼", "工號", "類型", "順序", "備註"], ["D_A", "A1", "ST01", "P1001", "站點", 1, ""], ["D_B", "B1", "ST01", "ROOT", "站點", 1, ""]]);
  const lock = {
    waitLock() {
      assert.equal(locked, false, "nested script lock acquisition");
      if (beforeAcquire) { const callback = beforeAcquire; beforeAcquire = undefined; callback(); }
      locked = true; events.push({ kind: "lock" });
    },
    releaseLock() { assert.equal(locked, true); events.push({ kind: "release" }); locked = false; },
  };
  const propertyStore = {
    getProperty: key => properties.get(key) ?? null,
    getProperties: () => Object.fromEntries(properties),
    setProperty(key, value) {
      assert.equal(locked, true, `unlocked property write ${key}`);
      if (faults.finishOperation && key.startsWith("ROSARIO_OP_") && JSON.parse(value).status === "success") throw new Error("synthetic property quota failure");
      if (faults.beforeDataWrite && key.startsWith("ROSARIO_OP_")) throw new Error("synthetic reservation quota failure");
      properties.set(key, String(value));
    },
    deleteProperty(key) {
      assert.equal(locked, true, `unlocked property delete ${key}`);
      if (faults.ledgerDelete && key.startsWith("ROSARIO_OP_")) throw new Error("synthetic property delete failure");
      properties.delete(key);
    },
  };
  const context = vm.createContext({
    Date: Clock, console,
    LockService: { getDocumentLock() { throw new Error("document lock used in web app"); }, getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => propertyStore },
    SpreadsheetApp: {
      flush() {
        assert.equal(locked, true); events.push({ kind: "flush" });
        if (faults.flush || (faults.ledgerFlush && sheets.has("13_操作收據"))) throw new Error("synthetic flush failure");
      },
      getActiveSpreadsheet: () => ({ getSheetByName: name => sheets.get(name) || null, insertSheet: name => sheet(name) }),
    },
    Session: { getScriptTimeZone: () => timeZone },
    Utilities: {
      Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
      getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
      computeDigest: (_, value) => [...createHash("sha256").update(String(value)).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      formatDate: (date, zone, format) => {
        if (format !== "yyyy-MM-dd") return String(date.getTime());
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map(p => [p.type, p.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
      },
    },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: body => ({ setMimeType: () => body }) },
  });
  vm.runInContext(source, context);
  context.getSystemSettings_ = () => ({});
  function post(action, payload = {}, extra = {}) {
    return JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action, payload, appVersion: VERSION, ...extra }) } }));
  }
  function login(account = "worker", password = "synthetic-old-password") {
    return post("login", { account, password });
  }
  function write(token, action, payload, extra = {}) {
    return post(action, { ...payload, expectedRevision: context.getDataRevision_() }, {
      sessionToken: token, operationId: `OP_security_${String(++operation).padStart(8, "0")}`, ...extra,
    });
  }
  return { context, accounts, people, rules, roleMaps, exceptionSheet, drafts, sheets, properties, events, faults, stats, post, login, write,
    advance: ms => { now += ms; }, beforeAcquire: fn => { beforeAcquire = fn; }, locked: () => locked };
}
