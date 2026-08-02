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

console.log(`契約檢查通過：${frontendActions.length} 個寫入動作、密碼回傳防護及新增人員安全驗證皆正常。`);
