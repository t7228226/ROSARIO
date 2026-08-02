import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [frontendSource, gasSource] = await Promise.all([
  readFile(path.join(root, "src/config/writeActions.ts"), "utf8"),
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

console.log(`契約檢查通過：${frontendActions.length} 個前端寫入動作皆存在於 GAS doPost。`);
