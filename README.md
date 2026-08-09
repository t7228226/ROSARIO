# 站點資格管理 App

這是一套依照「站點資格管理通用邏輯」製作的 React + TypeScript 網頁 App。

## 已完成方向

- 主頁三大常用功能
  - 查詢人員資格
  - 查詢站點人選
  - 站點考核
- 管理區五大功能骨架
  - 站點規則設定
  - 人員名單管理
  - 站點缺口分析
  - 站點試排
  - 智能試排
- 前端權限分層
  - 技術員：查詢
  - 領班以上：可用站點考核
  - 組長以上：可看站點缺口分析、站點試排
  - 主任：可看站點規則設定、人員名單管理、智能試排
- 防呆
  - 避免重複新增同一人同一站點
  - 站點/人員不存在時阻擋送出
- 通用化
  - 以四班共用邏輯運作
  - 以班別 / 當班 / 第一天 / 第二天模式切換分析
- 手機測試友善
  - 已加入 GitHub Pages 自動部署 workflow
  - 可部署後直接以手機開網址測試

## 技術選型

- Vite
- React 18
- TypeScript

## 本地啟動

```bash
npm install
npm run dev -- --host
```

## 打包

```bash
npm run build
```

## GitHub Pages 部署

此專案已加入 `.github/workflows/deploy-pages.yml`，推送到 `main` 後可自動部署到 GitHub Pages。

### 你需要在 GitHub 做的設定

1. 進入倉庫 `Settings`
2. 打開 `Pages`
3. `Build and deployment` 選 `GitHub Actions`
4. 回到倉庫首頁，等待 Actions 跑完
5. 部署成功後，網址通常會是：

```text
https://t7228226.github.io/ROSARIO/
```

之後你就可以直接用手機打開這個網址測試，不需要本機電腦常駐。

## API 與安全

- 正式 GAS 來源為 `gas-login-fallback-2026-07-01.js`。
- 前端通訊、逾時重試與防重複寫入集中在 `src/lib/gasClient.ts`。
- 登入成功後由 GAS 核發工作階段 token；重新整理時會重新確認帳號狀態與系統權限。
- 所有寫入都必須通過 GAS 的伺服器端權限判斷，不能只靠前端按鈕隱藏。
- bootstrap、登入與更新回應不回傳密碼；密碼重設後只保存雜湊值。
- 正式部署後需在 Apps Script 編輯器執行一次 `migrateLegacyAccountPasswords()`，將既有明文密碼批次轉換；合法登入也會自動逐筆轉換。
- Apps Script 的 Script Properties 會保存 `ROSARIO_PASSWORD_PEPPER`。請勿刪除或任意重建，否則既有密碼雜湊將無法驗證，只能由最高權限管理員重新設定密碼。
- 預覽環境預設唯讀。若要連接獨立測試 GAS，可在 `.env.preview.local` 設定 `VITE_GAS_API_URL`，並於確認不會寫入正式資料後才啟用 `VITE_ENABLE_WRITES=true`。

## 驗證

```bash
npm run check:contracts
npm run typecheck
npm test
npm run build
```

`check:contracts` 會檢查前後端寫入動作、session 授權、密碼防護、版本門檻與防重複寫入契約；通過建置仍不等於正式 GAS 已部署，發布後仍須執行線上登入與未授權請求測試。
