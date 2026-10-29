# 2026-10-29-014 本機驗證紀錄

狀態：`local-validation`。本次沒有 push、正式部署、改寫雲端資料、重設真實密碼或清理 Git 歷史。

## 資料核對

- 原檔：使用者提供的 `站點管理App_原檔評估_含資格明細.xlsx`，180 名人員、20 個站點、矩陣 637 筆有效資格。
- 原始資格明細有 618 個人員／站點配對；與矩陣有 36 項差異及 2 筆找不到主檔人員的明細。工號前導零不會自動移除或合併。
- 另外產出 `private-backups/upgrade-014/站點管理App_原檔評估_含資格明細_矩陣核對版_014.xlsx`。以矩陣核對明細、保留仍存在配對的原有明細欄位，重開核對結果為 637 筆、零差異、零孤立及重複配對。
- 原檔 SHA-256：`c971d043adaad627b66f3ceba5e25e9368dfb76ea156c6ec1511f68bc8ffdeb5`，工作結束再次核對未變。
- 核對版 SHA-256：`20fc015e36de96c6bce4786ca7053ff3967ffe0312034007289e7edd23661f6e`。
- 核對版只變更 XLSX 封裝中的 `xl/worksheets/sheet5.xml`，其餘封裝項目逐位元組相同。沒有重算 Excel 公式，也未進行原生 Excel 操作驗收。
- 20 筆離職日期均保留，其中 19 人在職、1 人留停。日期為未來情境，不自動變更在職狀態或帳號。
- 原始檔、衍生檔、五張非帳號資料表快照及畫面證據均留在忽略追蹤的私人資料夾。未將 `07_帳號管理` 匯出為 JSON 測試資料，也沒有把個資加入 Git。

## 完成項目與修改位置

| 範圍 | 檔案 | 與問題的關聯 |
| --- | --- | --- |
| 離職情境 | `src/domain/workforce/departures.ts`、`src/features/gap-analysis/DepartureScenarioPanel.tsx`、`src/types.ts`、`src/App.tsx` | 個別／截至日期批次選取；僅列目前班別與日別的有效出勤候選；與缺勤去重；顯示情境前後及逐站差異。 |
| 交叉覆蓋 | `src/lib/selectors.ts`、`src/domain/workforce/selectors.test.ts` | 每人容量一、最大可覆蓋量及支援優先；保留指定站位、不可排優先與訓練限制；大需求不按缺額建立巨量物件；資格站點數去重。 |
| 分析連動 | `src/App.tsx`、`src/features/gap-analysis/ResilienceInsights.tsx` | 離職與缺勤一併送入風險、補訓、幹部及出勤顯示；不把離職前的補訓效益混入異動後建議。全勤基準獨立保留。 |
| 資料來源 | `gas-login-fallback-2026-07-01.js`、`src/domain/bootstrap/sanitizeBootstrap.ts` | bootstrap 以矩陣唯讀投影，矩陣空白不被舊明細補回；導師視為合格並保留原始狀態；缺矩陣才以明細降級並附診斷。備註中的一般說明不誤刪整筆資料。 |
| 編輯與草稿 | `src/components/ui/ConfirmedField.tsx`、`src/App.tsx`、`src/lib/gasClient.ts` | 取消／失敗回復已提交值，顯示儲存中與錯誤；只送變更欄位並保留確認前 revision；草稿使用 `assignments`，後端相容舊 `details`。 |
| 響應式 | `src/features/gap-analysis/CoverageConfigurationOverview.tsx`、`src/scenario-analysis.css`、`src/main.tsx` | 手機用逐站展開，桌機保留完整表格；摘要優先，基準可展開；姓名標籤置中、增加展開箭頭及手機輔助字級。 |
| 權限與容量 | GAS 原始碼、`scripts/gas-backend-regressions.test.mjs`、`scripts/gas-schema-receipts.test.mjs`、`scripts/gas-login-capacity-regressions.test.mjs` | 按權限投影 bootstrap；班別／職務變更限最高權限；防資料偽裝標題列；登入與 session 隔離；操作收據及恢復容量保護。 |
| 契約與工具 | `src/config/environment.ts`、`src/config/writeActions.ts`、`scripts/check-contracts.mjs`、QA／資料核對腳本 | 測試版未指定 API 時不回落正式 GAS；前端須讀到相符後端版本才可寫入；版本統一為 014。 |

## 安全性修正細節

- 零功能權限不能取得整份 bootstrap；單一功能只取得必要資料集合，非管理員不回傳帳號管理欄位。
- 不再靠前端指定工號判定最高權限。一般人員資料編輯不能修改實際班別／職務以取得主任規則管理能力。
- 標題固定為首個非空白列，不再由前 20 列內容競分；重複命名欄位拒絕解析。既有新檔案格式已驗證相容；有額外封面標題列的其他工作簿需先確認結構。
- 每帳號最多 8 個有效 session，不因其他帳號達容量而淘汰合法 session；憑證版本失效的 session 會先清除。
- 未知帳號共用有限的失敗紀錄；已知帳號各自冷卻，不會因其他帳號的失敗紀錄滿額而阻擋未受限制的正確登入。
- 非最高權限的 owner 每 60 秒最多 30 次新寫入，跨 session 共用；既有操作重播及狀態查詢不受此限制。
- 成功／失敗／已人工核對的收據移至 `13_操作收據`，保留 24 小時；未確認操作不自動丟棄，普通操作池滿時仍保留管理員核對通道。
- 一般寫入 payload 上限 6000 UTF-8 bytes；草稿因明細不回傳收據，另限 200000 bytes。過長請求在保留 receipt 及業務寫入前拒絕，個人／規則回應不再回傳任意額外欄位。
- 需求人數必須是有限的非負整數，上限 1000；過大、負數或小數不進入寫入與分析配置。

## 實際驗證

- `npm test`：219 項、12 個 suite，全部通過，無跳過。包含四人三站圖的獨立窮舉對照、指定站位／缺勤／衝突資格及巨大需求。
- `npm run typecheck`：app、node、tests 三個設定通過。
- `npm run check:contracts`：12 個寫入動作與授權、版本、草稿契約通過。
- `npm run build`、`npm run build:qa` 通過，沒有新增 production dependency。
- 使用實際新檔案的五張資料表與真正 GAS 原始碼，在記憶體版 Google 服務中完成四班乘三日別的 12 組分析。驗證指派不重複、資格正確、未自動使用幹部、缺口總和一致、選定離職者不再被安排。
- 新資料的正常最低需求合計為 27，三種日別維持同一需求，不改用輪休需求。
- 瀏覽器測試：320／390／1440px、離職個別與日期批次選取、清除回復基準、手機逐站展開、Escape 與焦點回復、編輯取消／成功／拒絕過長資料、前端草稿儲存再載入及安全檢核。測試資料只在本機記憶體。
- 具體案例：婷芬班當班，選定名單後缺口由 2 變 3，JB 安裝由 0 變 1；清除選取回到 2。這是目前資料與條件下的一份最大覆蓋指派，不代表所有等價排法都會在同一站呈現缺口。
- 獨立畫面審閱已完成；其範圍是截圖，不是獨立操作驗收。輔助字級、展開箭頭及標籤置中由主工作者修正後重新確認。

## 尚未完成與正式前提

1. 沒有將核對版匯入正式 Google 試算表，也沒有覆蓋現有雲端人工資料。
2. GAS 與前端尚未正式部署。正式升級時須先備份並核對雲端差異，再部署相符的 014 後端及前端；不能只更新其中一端。GAS 文字檔另存於私人資料夾供部署使用。
3. `13_操作收據` 會在未來實際寫入時建立；本次只在本機 fixture 測試，未在正式試算表建立新表。
4. Google 真實配額、多人雲端同時寫入、網路斷線及 iOS／Android 實機，仍需正式環境前的驗收。自動化合成測試不等於這些驗收已通過。
5. Script Lock 不會鎖住人在 Google Sheets 直接編輯；版本與指紋可拒絕已偵測的衝突，但不宣稱 Google Sheets 人工修改與 App 寫入具有資料庫交易隔離。
6. 沒有完整全域／每日限額；管理員、查詢、多帳號及持續低速操作仍可能耗用 Google 配額。已知帳號冷卻紀錄仍受 Script Properties 實體配額限制。
7. 跨班共用輪休最低人數的既有規則未另立新政策；本次不擅自更動此業務範圍。
8. 這是資格／出勤／人數限制模型，不推定個人能力、實際操作適任性、工時、疲勞或現場產能，也不自動決定人員去留。
9. 既有密碼重設、公開 Git 歷史清理及完整五主題全站實機驗收，未列為本次完成項目。

## 本機測試

網址：`http://127.0.0.1:5182/ROSARIO/?page=gap-analysis`。這個執行個體已登入合成測試帳號，不使用正式密碼。

重新啟動可執行：

```powershell
npm run build:qa
node scripts/serve-integration-qa.mjs --port 5182 --workbook private-backups/upgrade-014/workbook-snapshot.json
```

資料核對及覆蓋驗證輸出位於 `private-backups/upgrade-014/` 與 `private-backups/upgrade-014-verified/`；不得將含人員資料的目錄上傳公開儲存庫。
