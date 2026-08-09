# GAS 版本寫入防護

前端的更新提示只能阻止新版程式之後的操作；如果使用者已經開著舊版 JavaScript，真正能阻止舊版寫入的是 GAS 後端。

建議在 GAS 寫入入口統一檢查 `appVersion`，低於 `MIN_WRITE_VERSION` 就直接拒絕。

```js
const LATEST_VERSION = "2026-05-03-004";
const MIN_WRITE_VERSION = "2026-05-03-004";

function compareVersion(a, b) {
  return String(a || "").localeCompare(String(b || ""), "en", { numeric: true });
}

function versionStatus(appVersion) {
  const current = String(appVersion || "");
  const outdated = !current || compareVersion(current, LATEST_VERSION) < 0;
  const writeBlocked = !current || compareVersion(current, MIN_WRITE_VERSION) < 0;
  return {
    ok: true,
    latestVersion: LATEST_VERSION,
    minWriteVersion: MIN_WRITE_VERSION,
    outdated,
    writeBlocked,
    message: writeBlocked
      ? "系統已有新版，請重新整理後繼續操作。"
      : outdated
        ? "系統已有新版，請重新整理後繼續使用。"
        : "",
  };
}

function rejectIfOldVersion_(appVersion) {
  const status = versionStatus(appVersion);
  if (status.writeBlocked) {
    throw new Error(status.message);
  }
}

function doGet(e) {
  const action = String(e.parameter.action || "");
  if (action === "version") {
    return json_(versionStatus(e.parameter.appVersion));
  }

  // 其他讀取 action...
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  const action = String(body.action || "");
  const appVersion = String(body.appVersion || "");

  const writeActions = new Set([
    "upsertQualification",
    "deleteQualification",
    "updateStationRule",
    "updatePerson",
    "updatePermissionItem",
    "updateRolePermission",
    "upsertPersonalPermissionException",
    "deletePersonalPermissionException",
    "saveScheduleDraft",
  ]);

  if (writeActions.has(action)) {
    rejectIfOldVersion_(appVersion);
  }

  // 原本寫入流程...
}
```

每次前端發布新版時，同步調整：

- `.env.production` 與 `src/config/environment.ts` 的 `VITE_APP_VERSION`／備援版本
- `public/version.json` 的 `version`
- GAS 的 `APP_VERSION` / `MIN_WRITE_VERSION`
