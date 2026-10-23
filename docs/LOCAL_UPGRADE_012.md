# 本機升級驗證紀錄 012

查核日期：2026-10-24。版本：`2026-10-23-012`，保留本次修正開始日期。

## 範圍與結論

本次完成已重現之計算、安全及操作問題的本機修正；不代表正式站已修復。
使用者指定「先完成本機測試，不動正式站」，因此未推送、部署、清理遠端歷史、變更正式資料或重設密碼。
先前審查紀錄中的正式版本為 011；這不是本文件對正式站現況的重新認證。

- 本機唯讀版：`http://127.0.0.1:5178/ROSARIO/`，讀取現有 GAS，前端禁止寫入。
- 隔離 UI 測試：僅合成工號 `QA001` 至 `QA008`，本機記憶體儲存，未送至 Google Sheets。
- 新版 GAS：以實際來源執行離線 VM 測試，尚未部署至獨立或正式 GAS。
- 145 項自動測試通過，型別、契約、正式建置及唯讀建置通過。
- npm 官方 audit 查詢：已知漏洞 0；這不等於所有資安問題均已排除。

## 修正與檔案關聯

| 檔案／模組 | 本次修改及原因 |
|---|---|
| `gas-login-fallback-2026-07-01.js` | 改用 script lock 保護讀取、檢查、寫入及 session 操作，釋放前 flush，修正 Web App document lock 為空時失去互斥的問題。 |
| 同上 | session 綁定帳號目前憑證狀態，新增登入節流；文字 literal 寫入防止公式注入。 |
| 同上 | operationId 綁定 action、payload、revision；保護 processing 紀錄，不確定結果不當成功或盲目重做。 |
| 同上 | bootstrap／寫入加入 revision 與內容、公式指紋；過期編輯拒絕覆寫。區分分析用數值規則與管理可見規則，草稿依班別授權。 |
| `src/lib/gasClient.ts` | 保留不確定寫入的原 operationId 與 revision；衝突不自動改採新版後重送，回報重新核對；非 JSON 服務錯誤不得當成空資料。 |
| `src/domain/bootstrap/compareBootstrap.ts`、`src/App.tsx` | 重讀時提供人員、資格及規則差異；避免使用者不知道雲端資料已改變。不是完整三方合併。 |
| `src/lib/selectors.ts`、`src/domain/workforce/engine.ts` | 各站缺口加總，超排不得抵銷別站缺人；強制配置驗證出勤、資格及不可排狀態。 |
| `src/domain/workforce/resilience.ts` | 缺勤與補訓保留固定站位，標示新增／惡化缺口；完成既有訓練納入建議，受訓者缺勤留在評估分母，抽樣結果明示估算。 |
| `src/domain/workforce/scheduleSafety.ts`、`manualPlan.ts` | 分開實際配置、合格覆蓋、訓練與備援；站長固定站位先保留，臨時勤務不重複占用。訓練補位遵守站點規則。 |
| `src/domain/workforce/rotationGroups.ts`、`ABScheduleMatrix.tsx` | 依畫面實際 A/B 分組逐站檢核輪休需求，不以全勤覆蓋或兩組總人數平衡代替。 |
| `src/features/schedule-preview/previewIdentity.ts`、`src/App.tsx` | 同名異工號不再合併；同名時顯示工號。橫表與 PNG 保留訓練標記、輪休缺口，修正圖片頁尾重疊。 |
| `ScheduleDraftPicker.tsx`、`src/App.tsx` | 增加草稿清單、載入前確認與重新安全檢核；輸出後提供可見 PNG 與再次下載入口。 |
| `CoverageConfigurationOverview.tsx`、`WorkforceWorkbench.tsx` | 先顯示結論，摘要保留四個優先站點；完整站點、人員來源與指派移至詳細視窗；分清缺口與低備援數字。 |
| `PagedList.tsx`、`detailViews.tsx`、`src/App.tsx` | 長名單分頁、筆數、搜尋清除及可及名稱，降低手機長列表負擔。 |
| `MobileCommandMenu.tsx`、`src/precision-ui.css` | 選單採共用 DialogShell，處理焦點、外側關閉與 Escape；拖曳吸附、閒置半隱藏、其他視窗開啟時避讓。修正圓形按鈕被舊 CSS 蓋過。 |
| `src/precision-ui.css`、`src/App.tsx` | 導覽移至主題設定前、外觀預設收折、情境與分析摘要精簡；保留五主題及置中。修正深色選中項目被舊色票覆蓋造成的低對比。 |
| `src/lib/navigation.ts`、`src/App.tsx` | 白名單頁面深連結及返回，保留部署 base；登入後恢復指定頁。 |
| `AppErrorBoundary.tsx`、`src/main.tsx`、`public/boot-status.js`、`index.html` | React 錯誤復原、文字型安全錯誤輸出、外部啟動腳本及 CSP meta；載入失敗不得顯示為正常零缺口。 |
| `package.json`、`package-lock.json`、`vite.config.ts` | 更新開發用 Vite 與 plugin，通過 Node 22 建置；未新增 production dependency。 |
| `release.json`、環境設定、`public/version.json`、契約檢查 | 同步版本與 local-only 狀態，檢查前後端版本一致；唯讀測試環境保持不可寫。 |
| `scripts/run-tests.mjs`、新增／更新測試檔 | 自動收錄 TS/MJS 測試，補上對抗反例、權限、冪等、衝突及身份回歸。 |
| `.gitignore`、`scripts/check-sensitive-files.mjs`、品質 CI | 防止工作簿、日誌、完整 GAS 快照再次進入版本庫。真實工作簿已另存備份並核對 SHA256，僅移除本機受追蹤副本。 |
| `scripts/serve-qa.mjs` | loopback-only 合成 UI 測試服務，僅支援代表性流程；不是 GAS 模擬器，也不驗證真正後端授權。 |

## 自動驗證

以下於 2026-10-24 本機執行成功：

- `npm test`：145/145，12 suites，0 fail／skip。
- `npm run typecheck`。
- `npm run check:contracts`：10 個寫入動作及相關授權／可靠寫入契約。
- `node --check gas-login-fallback-2026-07-01.js`。
- `node scripts/check-sensitive-files.mjs`。
- `git diff --check`。
- `npm run build`、`npm run build:preview`；交付時 `dist` 最後一次為唯讀 preview build。
- `npm audit --json`：0 個已知漏洞，未安裝額外 production 套件。

代表性反例包含：跨站超排抵銷、無資格強制支援、衝突不可排、缺勤保留鎖定、訓練分母、同名異工號、站長保留、臨時勤務占用、A/B 各組缺站。
另以獨立小圖窮舉最佳解對照 4,096 個資格圖，不只比對同一實作自身輸出。
GAS VM 驗證含缺少身份、跨班草稿、session、節流、公式文字、操作容量、payload 重用、revision 衝突與不確定寫入。

## 實際瀏覽器驗證

### 現有 API 唯讀路徑

- 使用使用者授權帳號登入成功，確認 Enter 送出及處理中停用按鈕。
- 登入後恢復指定分析頁，取得資料；更新後仍顯示「唯讀模式，不會修改正式資料」。
- 代表性單人缺勤分析完成 31/31 個組合；沒有將抽樣當完整排列。
- 完整站點詳細視窗能開啟；代表性瀏覽器主控台未出現錯誤。
- 上述只證明新前端與現有 API 的讀取流程，不證明新版 GAS 真實雲端寫入。

### 合成隔離路徑

- 自動配置不安排訓練中人員；手動安排後維持黃色與「訓練人員」。
- 草稿保存、重新整理、清單載入、替換確認與安全重新檢核可完成。
- 同名不同工號在預覽與圖片均保留。
- A/B 橫表依兩組實際站位檢核，正常需求與各批輪休需求分開呈現。
- PNG 實際產生 2360 × 1256 像素，人工檢視非空白、文字與頁尾沒有重疊。
- 圖片對話框於 320px 窄視窗可完整操作，未有整頁水平溢位。

### 響應式與操作

- 桌機 1440 × 900、手機 390 × 844，以及 320 × 740 窄視窗代表性畫面。
- 五主題均測試手機快速選單切換與寬度；明亮、石墨夜另人工檢視實際截圖。
- 深色選中導覽文字最後量測為 `rgb(217, 228, 255)`，背景 `rgb(41, 58, 90)`，修正原有暗藍字。
- Tab／Shift+Tab 焦點圈限、Escape 關閉及焦點還原，選單外側關閉與拖曳吸附。
- 圓形觸發鈕最後量測 58 × 58px、`border-radius: 50%`。
- 圖片及資源採用紀錄見 `UI_RESOURCE_REVIEW_012.md`。真實人員截圖保留在本機專用目錄，不放入公開版本庫。

## 待處理與限制

1. **正式曝露尚未解除。** 本機移除工作簿與新增 guard 不會清除 GitHub 現有檔案、分支、歷史或已下載副本；正式清理與受影響密碼重設仍待授權及本人操作。
2. **新版 GAS 未雲端驗證。** 真正 Sheets 行為、多裝置同時寫入、鎖等待、配額、延遲及執行期限仍需獨立測試部署。本機 VM 不等於雲端整合測試。
3. **人工編輯邊界。** revision 指紋可偵測先前更動，但 script lock 無法鎖住人直接操作 Sheet 的瞬間；不保證跨人工編輯的完整交易原子性。指紋全表掃描的成本尚未實測。
4. **身份架構仍有限制。** 現有 GAS／localStorage token 未改成同源 HttpOnly cookie；CSP meta 不能實施 `frame-ancestors` 等 HTTP header-only 防護。
5. **未做完整重構。** App 與多份 legacy CSS 仍偏大，採漸進聚焦修正，沒有宣稱全部模組化或消除所有 `!important`。
6. **裝置驗收未完成。** 未用實體 iPhone／Android 測試加入桌面、系統手勢、鍵盤與完整 WCAG；桌面窄視窗不能替代。
7. **下載落地未證實。** 內嵌瀏覽器的 download event 未成功取得完成證據；已驗證可見圖片及取得圖像內容，保留再次下載／長按存圖入口，但不能宣稱實體手機相簿或 Downloads 寫入已驗證。
8. **版本須協同發布。** 012 前端寫入要求匹配新版 GAS 與 revision；未來應以獨立測試環境驗證，再協調前後端發布，不能只替換其中一端便宣稱可寫。
9. **PHP 範圍。** 本專案檢視到的是 React/Vite 靜態前端與 GAS JavaScript，沒有 PHP 執行路徑；其他未提供的主機或 API 不在此結論內。

## 重跑本機唯讀版

在專案目錄執行，僅啟動 loopback，不發布：

```powershell
npm run build:preview
npm run preview -- --host 127.0.0.1 --port 5178 --strictPort
```

若 5178 已被本次預覽占用，直接開啟網址，不另開第二個服務。不要為測試任意設定 `VITE_ENABLE_WRITES=true` 連向正式 GAS。
