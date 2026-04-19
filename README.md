# 站點資格管理 App

這是一套依照「B班原始 Excel 升級成通用型系統」思路製作的 React + TypeScript 網頁 App。

## 已完成方向

- 主頁三大常用功能
  - 查詢人員資格
  - 查詢站點人選
  - 考核確認
- 管理區五大功能骨架
  - 站點規則設定
  - 人員名單管理
  - 站點缺口分析
  - 站點試排
  - 智能試排
- 前端權限分層
  - 一般幹部：查詢
  - 領班以上：可用考核確認
  - 組長以上：可看管理功能
- 防呆
  - 避免重複新增同一人同一站點
  - 站點/人員不存在時阻擋送出
- 通用化
  - 不綁死 B 班
  - 以班別 / 第一天 / 第二天模式切換分析

## 技術選型

- Vite
- React 18
- TypeScript

## 本地啟動

```bash
npm install
npm run dev
```

## 打包

```bash
npm run build
```

## API 設定

`.env` 可加入：

```bash
VITE_GAS_API_URL=https://script.google.com/macros/s/AKfycbwsqvP9ogL4v81T3luON_43aHt1Vdz-e3bT--sEH2n56eKj11z05FPhkCC4rFouwt4w_A/exec
VITE_USE_MOCK=false
```

若未設定或無法連線，系統會自動退回 mock 資料模式，方便先把前端畫面與邏輯確認好。

## 建議的 GAS 回傳格式

### 1. 取得初始化資料
`GET ?action=bootstrap`

```json
{
  "people": [],
  "stations": [],
  "qualifications": []
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
    "normalMin": 4,
    "reliefMinPerBatch": 2,
    "priority": 1,
    "isMandatory": true,
    "backupTarget": 4
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
    "shift": "B班",
    "role": "作業員",
    "nationality": "台籍",
    "day1": "Y",
    "day2": "N",
    "employmentStatus": "在職"
  }
}
```

## 注意

目前我無法直接驗證你的 Google Apps Script 實際回傳格式，所以我已把所有後端串接集中在 `src/lib/api.ts`。
只要你的 GAS 欄位命名不一樣，優先改這個檔案即可，不需要整個前端重寫。
