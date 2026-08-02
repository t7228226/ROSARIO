import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [frontendSource, appSource, gasSource] = await Promise.all([
  readFile(path.join(root, "src/config/writeActions.ts"), "utf8"),
  readFile(path.join(root, "src/App.tsx"), "utf8"),
  readFile(path.join(root, "gas-login-fallback-2026-07-01.js"), "utf8"),
]);

const frontendActions = [...frontendSource.matchAll(/^\s+"([A-Za-z][A-Za-z0-9]+)",$/gm)]
  .map((match) => match[1]);
const doPostStart = gasSource.indexOf("function doPost(e)");
const doPostEnd = gasSource.indexOf("function buildBootstrap_()", doPostStart);
assert.ok(doPostStart >= 0 && doPostEnd > doPostStart, "找不到 GAS doPost 區塊");
const doPostSource = gasSource.slice(doPostStart, doPostEnd);
const gasPostActions = new Set(
  [...doPostSource.matchAll(/^\s+case '([A-Za-z][A-Za-z0-9]+)':$/gm)]
    .map((match) => match[1])
);

assert.ok(frontendActions.length > 0, "找不到前端寫入動作清單");
const missingActions = frontendActions.filter((action) => !gasPostActions.has(action));
assert.deepEqual(missingActions, [], `GAS doPost 缺少動作：${missingActions.join(", ")}`);

const mergeAccountsStart = gasSource.indexOf("function mergeAccountFieldsIntoPeople_");
const loginStart = gasSource.indexOf("function login_", mergeAccountsStart);
assert.ok(mergeAccountsStart >= 0 && loginStart > mergeAccountsStart, "找不到帳號欄位合併區塊");
const bootstrapAccountMergeSource = gasSource.slice(mergeAccountsStart, loginStart);
assert.doesNotMatch(bootstrapAccountMergeSource, /loginPassword\s*:|password\s*:/, "bootstrap 不可回傳密碼欄位");
assert.match(appSource, /delete sanitized\.password;/, "前端 bootstrap 清理必須移除 password");
assert.match(appSource, /delete sanitized\.loginPassword;/, "前端 bootstrap 清理必須移除 loginPassword");

const createPersonStart = gasSource.indexOf("function createPerson_");
const validateOnlyIndex = gasSource.indexOf("validatedOnly: true", createPersonStart);
const appendPersonIndex = gasSource.indexOf("peopleSheet.appendRow", createPersonStart);
assert.ok(
  createPersonStart >= 0 && validateOnlyIndex > createPersonStart && appendPersonIndex > validateOnlyIndex,
  "createPerson 必須在寫入前支援 validateOnly 驗證"
);

assert.match(doPostSource, /case 'operationStatus':/, "GAS 必須提供 operationStatus 查詢");
assert.match(gasSource, /function executeReliableWrite_\(/, "GAS 必須具備防重複寫入流程");
assert.match(gasSource, /PropertiesService\.getScriptProperties\(\)/, "GAS 必須保存操作執行結果");
assert.match(gasSource, /function withDocumentWriteLock_\(/, "GAS 寫入必須使用文件鎖");
assert.match(gasSource, /MIN_WRITE_VERSION: '2026-08-02-003'/, "舊版前端不得繞過可靠寫入");
assert.match(appSource, /operationId/, "前端寫入必須傳送 operationId");
assert.match(appSource, /pollGasOperation/, "前端逾時後必須查詢操作結果");
assert.match(appSource, /inFlightWriteRequests/, "前端必須阻擋相同內容的重複送出");

console.log(`契約檢查通過：${frontendActions.length} 個寫入動作、密碼防護、validateOnly 與可靠寫入皆正常。`);
