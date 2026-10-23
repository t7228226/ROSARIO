# 013 正式部署驗證

版本：`2026-10-24-013`。

## 切換前

- 本機 161 項測試、三份型別設定、11 個動作契約、敏感檔 guard、GAS 語法及 production/QA 建置通過。
- Google 編輯器已讀取原始碼備份；原版本為 011，與 Git 提交 `862ccfb4b42001bb4441fdae3d5fcd41e3570d6c` 一致。
- 新版來源已儲存雲端並讀回逐字核對一致。
- 既有 `/exec` 部署為 GAS 第 29 版，保留作為回復目標。
- GitHub `main` 與工作分支原先皆指向上述提交；dry-run 可連線，尚未推送。
- 不重設密碼、不 force push、不清除遠端 Git 歷史，不將測試人員寫入正式試算表。

## 正式結果

2026-10-24 正式發布完成：

- 應用程式提交：`79810e43861bd85e88efb009356e5076a9a37c5e`，正常 fast-forward 推送至 `main` 及 `codex/v2-upgrade`，未改寫歷史。
- [Pages workflow](https://github.com/t7228226/ROSARIO/actions/runs/40009197716) 與 [Quality checks](https://github.com/t7228226/ROSARIO/actions/runs/40009197828) 均 completed/success。
- GAS 同一部署作業已更新至第 30 版；Google 編輯器顯示「已成功更新部署作業」。舊第 29 版保留可回復。
- `/exec?action=version&appVersion=2026-10-24-013`：appVersion/latestVersion/minWriteVersion 均為 013，maintenanceMode/outdated/writeBlocked 均 false。
- [正式站](https://t7228226.github.io/ROSARIO/) 的 `version.json` 回傳 013。
- 正式瀏覽器以已授權帳號登入成功；Enter 處理中停用、資料載入、重新開頁恢復登入、操作紀錄查詢均正常。
- 正式第一天情境顯示支援先配置；站點正常需求仍為 39，未混用輪休需求。代表性一人缺勤分析完成 38/38 個完整組合。
- 正式桌機與 390px、320px 代表性版面檢查；詳細表格僅在容器內捲動，無頁級水平溢位。瀏覽器代表性 error/warn 紀錄為空。
- 正式 API 驗證：登入、bootstrap revision/capability、createPerson `validateOnly=true`、同編號回播、operationStatus、管理員紀錄查詢通過。
- 無 session 的 listOperations 回傳 `AUTH_REQUIRED`；登入與 bootstrap 未回傳密碼欄位。
- 無寫入驗證前後 people/qualifications/stationRules 一致，未新增驗證工號；只留下 24 小時操作回條。回條的「新增人員／已完成」代表 validateOnly 驗證完成，不代表建立人員。
- 舊 011 的唯讀版本查詢回傳 `writeBlocked=true`。以舊版號送建立請求的再次測試遭安全審核阻擋，已停止；最終雲端驗證改為唯讀版本查詢。本機實際寫入拒絕反例仍有測試，不能將兩者混為一談。

查核腳本最初曾對 status 與舊版錯誤訊息做錯誤假設，經對照原始碼修正；最終完整安全查核 exit 0。
私密雲端原始碼備份、完整 Git bundle、測試腳本及畫面保存在本機，不在公開版本庫。憑證只透過 stdin 傳入記憶體。

## 實測效能與限制

代表性 bootstrap 單次約 11.3、11.6、14.7 秒，含網路及 GAS 執行；沒有可比的穩定舊版基準，不能宣稱加速比例。
請求內重用讀取與批次儲存已導入，但全表內容／公式指紋、Google 服務往返與鎖等待仍是成本；本次不以降低衝突檢查換取表面速度。
正式實際新增及跨裝置壓力不在上述無寫入驗證範圍內。

未測項目：正式資料實際新增／刪除、真實多裝置併發、人工直接改表同時寫入、Google 配額壓力、實體手機。

公開工作簿僅從目前兩個發布分支移除；其他分支、歷史或已下載副本仍可能存在，不能宣稱曝露已完全消除。密碼重設及不可逆歷史清理未執行。
