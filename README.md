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

## API 設定

`.env` 可加入：

```bash
VITE_GAS_API_URL=https://script.google.com/macros/s/AKfycbwsqvP9ogL4v81T3luON_43aHt1Vdz-e3bT--sEH2n56eKj11z05FPhkCC4rFouwt4w_A/exec
VITE_USE_MOCK=false
```

若未設定或無法連線，系統會自動退回 mock 資料模式，方便先把前端畫面與邏輯確認好。

若你只想先測手機畫面，不測後端，可設：

```bash
VITE_USE_MOCK=true
```

## 建議的 GAS 回傳格式

### 1. 取得初始化資料
`GET ?action=bootstrap`

```json
{
  "people": [],
  "stations": [],
  "qualifications": [],
  "stationRules": []
}
```

### 2. 新增 / 更新資格
`POST`

```json
{
  "action": "upsertQualification",
  "payload": {
    "employeeId": "P0001",
    "stationId": "STR",
    "status": "合格"
  }
}
```

### 3. 刪除資格
`POST`

```json
{
  "action": "deleteQualification",
  "payload": {
    "employeeId": "P0001",
    "stationId": "STR"
  }
}
```

### 4. 更新站點規則
`POST`

```json
{
  "action": "updateStationRule",
  "payload": {
    "id": "STR",
    "team": "婷芬班",
    "dayKey": "第一天",
    "stationId": "STR",
    "minRequired": 4,
    "backupTarget": 2,
    "priority": 1,
    "isMandatory": true
  }
}
```

### 5. 更新人員主檔
`POST`

```json
{
  "action": "updatePerson",
  "payload": {
    "id": "P0001",
    "name": "王小明",
    "shift": "婷芬班",
    "role": "作業員",
    "nationality": "台籍",
    "aDay1": "日A",
    "aDay2": "日A",
    "bDay1": "",
    "bDay2": "",
    "employmentStatus": "在職"
  }
}
```

## 注意

目前我無法直接驗證你的 Google Apps Script 實際回傳格式，所以我已把所有後端串接集中在 `src/lib/api.ts`。
只要你的 GAS 欄位命名不一樣，優先改這個檔案即可，不需要整個前端重寫。
