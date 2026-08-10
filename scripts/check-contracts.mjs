import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [frontendSource, appSource, bootstrapSanitizerSource, mainSource, precisionUiSource, gasClientSource, gasSource] = await Promise.all([
  readFile(path.join(root, "src/config/writeActions.ts"), "utf8"),
  readFile(path.join(root, "src/App.tsx"), "utf8"),
  readFile(path.join(root, "src/domain/bootstrap/sanitizeBootstrap.ts"), "utf8"),
  readFile(path.join(root, "src/main.tsx"), "utf8"),
  readFile(path.join(root, "src/precision-ui.css"), "utf8"),
  readFile(path.join(root, "src/lib/gasClient.ts"), "utf8"),
  readFile(path.join(root, "gas-login-fallback-2026-07-01.js"), "utf8"),
]);

const frontendActions = [...frontendSource.matchAll(/^\s+"([A-Za-z][A-Za-z0-9]+)",$/gm)]
  .map((match) => match[1]);
const doPostStart = gasSource.indexOf("function doPost(e)");
const doPostEnd = gasSource.indexOf("function buildBootstrap_()", doPostStart);
assert.ok(doPostStart >= 0 && doPostEnd > doPostStart, "找不到 GAS doPost 區塊");
const doPostSource = gasSource.slice(doPostStart, doPostEnd);
const doGetStart = gasSource.indexOf("function doGet(e)");
assert.ok(doGetStart >= 0 && doGetStart < doPostStart, "找不到 GAS doGet 區塊");
const doGetSource = gasSource.slice(doGetStart, doPostStart);
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
assert.match(bootstrapSanitizerSource, /delete sanitized\.password;/, "前端 bootstrap 清理必須移除 password");
assert.match(bootstrapSanitizerSource, /delete sanitized\.loginPassword;/, "前端 bootstrap 清理必須移除 loginPassword");
assert.doesNotMatch(appSource, /title="目前密碼"|目前密碼會讀取/, "前端不得顯示現有密碼");
assert.match(gasSource, /PASSWORD_HASH_PREFIX = 'rosario-v1\$'/, "GAS 必須以雜湊格式保存新密碼");
assert.match(gasSource, /setCellIfExists_\([^\n]+?'登入密碼', hashPassword_\(nextPassword\)\)/, "密碼更新不可寫入明文");

const createPersonStart = gasSource.indexOf("function createPerson_");
const validateOnlyIndex = gasSource.indexOf("validatedOnly: true", createPersonStart);
const appendPersonIndex = gasSource.indexOf("peopleSheet.appendRow", createPersonStart);
const ensureMatrixIndex = gasSource.indexOf("ensureQualificationMatrixPersonRow_(person)", createPersonStart);
const rollbackPersonIndex = gasSource.indexOf("peopleSheet.deleteRow(personRowNumber)", createPersonStart);
assert.ok(
  createPersonStart >= 0 && validateOnlyIndex > createPersonStart && appendPersonIndex > validateOnlyIndex,
  "createPerson 必須在寫入前支援 validateOnly 驗證"
);
assert.ok(
  ensureMatrixIndex > appendPersonIndex && rollbackPersonIndex > ensureMatrixIndex,
  "createPerson 必須同步建立站點矩陣列，失敗時回滾人員主表"
);

assert.match(doPostSource, /case 'operationStatus':/, "GAS 必須提供 operationStatus 查詢");
assert.match(gasSource, /function executeReliableWrite_\(/, "GAS 必須具備防重複寫入流程");
assert.match(gasSource, /PropertiesService\.getScriptProperties\(\)/, "GAS 必須保存操作執行結果");
assert.match(gasSource, /function withDocumentWriteLock_\(/, "GAS 寫入必須使用文件鎖");
assert.match(gasSource, /MIN_WRITE_VERSION: '2026-08-10-006'/, "舊版前端不得繞過可靠寫入");
assert.match(gasSource, /function authorizeWriteAction_\(/, "GAS 寫入前必須執行伺服器端授權");
assert.match(gasSource, /const session = authorizeWriteAction_\([^;]+;/, "寫入端點不得只依賴前端權限");
assert.match(gasSource, /function requireSession_\(/, "GAS 必須驗證登入工作階段");
assert.match(gasSource, /assertOperationOwner_\(record, session\)/, "寫入結果查詢必須綁定操作人");
assert.match(doGetSource, /action === 'bootstrap'.+POST_REQUIRED/s, "bootstrap 不得透過公開 GET 讀取主檔");
assert.doesNotMatch(doGetSource, /buildBootstrap_\(/, "公開 GET 不得直接建立 bootstrap 資料");
assert.match(doPostSource, /case 'bootstrap':[\s\S]+buildBootstrapForSession_\(requireSession_\(/, "bootstrap POST 必須驗證登入工作階段");
assert.match(gasSource, /assertActionScope_\(session, action, payload\)/, "寫入必須執行資料範圍檢查");
assert.match(gasSource, /if \(action !== 'updateStationRule'\) return true;[\s\S]+ownTeam !== requestedTeam/, "站點規則寫入必須限制在登入者所屬班別");
assert.match(gasClientSource, /sessionToken: activeSessionToken \|\| undefined/, "前端 GAS client 必須附帶 session token");
assert.match(gasClientSource, /action: "bootstrap"[\s\S]+sessionToken: activeSessionToken \|\| undefined/, "前端 bootstrap 必須使用已驗證 POST");
assert.match(gasClientSource, /operationId/, "前端寫入必須傳送 operationId");
assert.match(gasClientSource, /pollGasOperation/, "前端逾時後必須查詢操作結果");
assert.match(gasClientSource, /inFlightWriteRequests/, "前端必須阻擋相同內容的重複送出");
assert.match(appSource, /lazy\(\(\) => import\("\.\/features\/gap-analysis\/ResilienceInsights"\)\)/, "大型分析畫面必須延遲載入");
assert.match(appSource, /import Layout from "\.\/components\/Layout";/, "登入後首頁仍必須使用 Layout 容器");
assert.doesNotMatch(appSource, /<style>\{`/, "App 不得重新放回大段內嵌樣式");
assert.ok(appSource.split(/\r?\n/).length < 5000, "App 主檔應維持在 5000 行以下");
assert.match(mainSource, /import "\.\/app-shell\.css";/, "主應用樣式必須由獨立 CSS 載入");
assert.match(mainSource, /import "\.\/manual-schedule\.css";/, "班表試排樣式必須由獨立 CSS 載入");
assert.match(mainSource, /import "\.\/precision-ui\.css";/, "全域設計系統必須由獨立 CSS 載入");
assert.ok(mainSource.indexOf('import "./precision-ui.css";') > mainSource.indexOf('import "./upgrade.css";'), "全域設計系統必須最後載入，避免舊樣式覆蓋");
assert.match(precisionUiSource, /html,[\s\S]+overflow-x: clip;/, "行動版必須裁切全頁水平溢位且不得建立額外捲動容器");
assert.match(precisionUiSource, /\.mobile-command-center/, "手機必須提供避開底部手勢區的快速選單");
assert.match(appSource, /CoverageConfigurationOverview/, "覆蓋分析必須提供精簡摘要與詳細視窗");
assert.match(appSource, /if \(!currentUser\) return;[\s\S]+fetchGasBootstrapData\(\)/, "未登入時不得載入 bootstrap 主檔");
assert.match(appSource, /setCurrentUser\(null\);[\s\S]{0,160}setData\(emptyBootstrap\);/, "登出或 session 逾時後必須清空主檔資料");
assert.doesNotMatch(appSource, /setPermissionItemStates\(permissionItems\)/, "session 清理不得引用不存在的權限變數");
assert.doesNotMatch(appSource, /setRolePermissionMapStates\(rolePermissionMaps\)/, "session 清理不得引用不存在的角色權限變數");

console.log(`契約檢查通過：${frontendActions.length} 個寫入動作、session 授權、密碼防護、延遲載入與可靠寫入皆正常。`);
