# 013 升級與發布紀錄

版本：`2026-10-24-013`。本文件接續 `LOCAL_UPGRADE_012.md`，不以歷史紀錄代替現況驗證。

## 架構決定

採用現有 React/Vite + GAS + Sheets 架構，不另建佇列主機、資料庫或付費服務。
GAS 為網站唯一寫入端；script lock、資料 revision、內容指紋與 durable operation receipt 共同處理多端寫入。
這是可靠寫入機制，不是可離線接單的背景中繼站。伺服器尚未收到的操作不保證保存。

- 同一內容同時送出共用操作；重送沿用原操作編號及原資料版本。
- 回應遺失先查回條，不將超時直接視為未寫入。
- 部分寫入或無法確認的操作停止自動重做，顯示待確認。
- 最高權限可標記已人工核對；此動作不宣稱原操作成功、不重做原修改。
- 新增人員後核對主表及站點矩陣工號、姓名；批次更新相鄰欄位，不覆蓋中間公式或資格。
- 僅在單一請求內重用資料讀取，避免跨使用者快取敏感資料。
- 回條僅顯示必要 metadata，不回傳 payload、密碼或資料摘要雜湊。完成、失敗及人工核對紀錄保留 24 小時；未確認者保留供查核。

## 修改點

| 檔案 | 與本次需求的關聯 |
|---|---|
| `gas-login-fallback-2026-07-01.js` | 可靠寫入、人工核對、回條查詢、請求快取、批次儲存及新增人員雙表核對。012 的鎖定、授權、文字安全與版本衝突修正一併發布。 |
| `src/lib/gasClient.ts`、`src/types.ts` | SHA-256 pending key、同時送出去重、session 回應競態防護、回條核對與可見進度。 |
| `src/features/operations/OperationCenter.tsx` | 自己／管理員操作、狀態篩選、分頁、重新讀取與待確認人工結案。 |
| `src/components/ui/useActionDialog.tsx`、`AppDialog.tsx`、`src/App.tsx` | 將原生 confirm/prompt 改為一致視窗；巢狀 Escape 只關最上層。試排不再暗中新增正式資格，同名時要求工號。 |
| `src/domain/workforce/conclusion.ts`、`WorkforceWorkbench.tsx` | 需求未設定與載入失敗不再顯示為健康的零缺口。 |
| `src/precision-ui.css`、`PagedList.tsx` | 進度、回條狀態、真正置中視窗標題與窄螢幕可操作版面；保留五主題及既有姓名對齊規則。 |
| `scripts/check-types.mjs`、三份 tsconfig、`package.json` | 明確檢查 app、Vite 設定與測試。新增開發用 Node 型別，未新增 production dependency。 |
| `scripts/helpers/gasFixture.mjs`、`serve-integration-qa.mjs`、`build-qa.mjs`、測試檔 | 實際 GAS 來源搭配合成 Google 服務做隔離整合驗證，不連接真實 Sheets。 |
| `.github/workflows`、敏感檔 guard、版本檔 | CI 執行真實型別檢查、測試及建置；阻止工作簿與完整私密快照重新進版控。 |

## 型別檢查更正

012 曾記錄 `npm run typecheck` 指令成功，但舊命令只檢查 `files: []` 的 root config，未完整檢查 app。
013 改成分別執行三份設定，並修正實際查出的型別錯誤；不能將 012 的成功命令當成完整型別驗證。

## 本機驗證

2026-10-24 實際執行：

- `npm test`：161 項、12 suites，全數通過，0 skip。
- `npm run typecheck`：app、node、tests 皆通過。
- `npm run check:contracts`：11 個寫入動作通過。
- `node --check gas-login-fallback-2026-07-01.js`、敏感檔 guard 通過。
- `npm run build` 與 `npm run build:qa` 通過。
- npm 官方 audit：0 個已知漏洞；不是所有資安風險均為零的保證。
- 既有容量一人一站、固定配置、支援優先、缺勤反事實、訓練與輪休測試，以及 4,096 個小圖窮舉對照仍納入上述測試。

瀏覽器實測使用實際 GAS 來源的本機 VM 服務，所有人員均為合成資料：

- Enter 登入及處理中按鈕、自己／全部操作、篩選與焦點還原。
- 送出已完成但回應丟失：前端查回條成功，沒有重做新增。
- 主表已寫入而矩陣及回滾失敗：顯示待確認；重新讀取可看見差異。
- 管理員人工核對後顯示「已人工核對」，原回條不冒充「已完成」。
- 巢狀確認 Escape 留下人員表單。
- 桌機 1440x900、手機 390x844、窄版 320x740 的代表性視窗檢查；無整頁水平溢位，底部操作可到達。
- 截圖置於本機專用證據目錄，不將真實人員截圖放入公開版本庫。

## 正式切換與復原

授權範圍：使用者明確解除先前不動正式 GAS 的限制；不包含密碼重設及不可逆 Git 歷史清理。
雲端原始碼更新前已備份，並核對與原 Git HEAD 完全一致；儲存新版後透過編輯器讀回逐字比對一致。
切換前既有部署為 GAS 第 29 版、標示 `2026-08-11-011`。沿用同一 `/exec` 網址，不更動所有人／以擁有者執行的既有部署權限。

發布時先保留可回復的 Git 提交，再更新既有 GAS 部署及 Pages。013 會阻止舊前端寫入，因此版本不一致期間可能暫停寫入；不要只替換一端就宣稱可用。
若正式驗證失敗，GAS 可回選第 29 版，前端以普通 revert 還原；不得 force push 或清除歷史。資料 revision、receipt 與使用者真實資料不因程式復原而任意刪除。

正式驗證結果另記於 `DEPLOYMENT_013.md`；沒有記錄的流程不視為已驗證。

## 剩餘限制

1. 公開工作簿的歷史版本及已下載副本不會因目前分支移除而消失。密碼重設須本人完成；不可逆歷史清理未獲授權。
2. script lock 不能鎖住人直接操作 Sheet；不是跨人工操作的完整交易。
3. 真實多裝置併發、Google 配額壓力與逾時故障不能以 VM 代替。指紋全表讀取仍有成本，未宣稱速度提升百分比。
4. 未做同源 HttpOnly session 架構、完整 legacy CSS 拆分、實體 iPhone/Android 與完整 WCAG 驗收。
5. 沒有 PHP 執行路徑；本次 React/Vite/GAS 更新不等於其他未提供主機的 PHP 審查。

參考：[GAS 批次操作建議](https://developers.google.com/apps-script/guides/support/best-practices)、[GAS 配額](https://developers.google.com/apps-script/guides/services/quotas)、[W3C 狀態訊息](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)。
