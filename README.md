# 高風險追蹤系統（Google Apps Script Web App）

以 Google Sheet 為後端、GAS 為後端邏輯、HTML Service 為前端的資安風險追蹤應用。
支援多種「發現來源」表單、指派多位處理人（來自人員主檔單一事實來源）、佐證上傳、
未結案通知、以及可擴充的匯入匯出。

## 檔案結構

| 檔案 | 職責 |
| --- | --- |
| `appsscript.json` | manifest：scopes、Drive 進階服務、Web App 設定 |
| `Config.gs` | 單一真實來源：工作表名稱、欄位、選項、Property 鍵 |
| `FormRegistry.gs` | ★ 發現來源 → 表單 schema 註冊表（多表單擴充點） |
| `ImportRegistry.gs` | ★ 發現來源 → 匯入欄位對應註冊表（匯入格式擴充點） |
| `SheetRepo.gs` | 持久層：工作表存取、列↔物件轉換 |
| `RiskService.gs` | 主表（資安風險追蹤表）CRUD |
| `CorrectiveService.gs` | 子表（矯正缺失單）一對多 CRUD |
| `HrService.gs` | 讀取人員主檔（含快取） |
| `AuthService.gs` | 角色判定與權限守門 |
| `NotificationService.gs` | 未結案風險 Email 通知（依賴注入） |
| `FileService.gs` | 佐證上傳至 Drive 指定資料夾 |
| `ImportExportService.gs` | CSV/Excel 匯入、CSV 匯出 |
| `SettingsService.gs` | 讀寫 Script Properties |
| `WebApp.gs` | doGet / include / setup 與前端 API（薄路由層） |
| `index.html` / `styles.html` / `app.html` | 前端單頁、樣式、邏輯 |

## 部署步驟

1. **建立試算表**：新建一份 Google 試算表作為風險資料庫（本系統會綁定於此）。
2. **建立 Apps Script 專案**：在該試算表「擴充功能 → Apps Script」開啟編輯器，
   或用 [clasp](https://github.com/google/clasp) `clasp push` 上傳本資料夾所有 `.gs` 與 `.html`。
   - 用 clasp 時，`.html` 檔需與此處同名（`index.html`/`styles.html`/`app.html`）。
3. **啟用進階服務**：編輯器左側「服務」→ 新增 **Drive API**（供 Excel 匯入轉檔）。
   `appsscript.json` 已宣告，clasp 推送後仍需在 UI 確認啟用一次。
4. **初始化資料表**：在編輯器選擇函式 `setup` 並執行，會建立
   `資安風險追蹤表` 與 `矯正缺失單` 兩個工作表（含標題列）。首次執行會要求授權。
5. **部署為 Web App**：「部署 → 新增部署 → 類型：網頁應用程式」。
   - 執行身分：**部署我（USER_DEPLOYING）**（讓所有使用者共用後端存取權）
   - 存取對象：**機構內任何人**（已於 manifest 設為 `DOMAIN`）
6. **首次設定**：以部署者身分開啟 Web App（初始狀態下任何登入者皆為管理者）。
   進入「設定」填入：
   - HR 人員主檔**試算表 ID** 與工作表名稱（預設「人員主檔」）
   - 佐證上傳的 **Drive 資料夾 ID**
   - **管理者 email 清單**（設定後僅清單內者為管理者，其餘為處理者）

## 角色與權限

- **管理者**：新增/編輯/刪除風險、寄送通知、匯入匯出、修改設定。
- **處理者**：僅能查看與更新「被指派給自己」的風險（狀態與項次進度）、上傳佐證。
- 判定方式：以登入 email 比對設定中的管理者清單（清單為空時為「設定模式」，當前使用者即管理者）。

## 如何擴充

### 新增一種發現來源表單
於 `FormRegistry.gs` 的 `FORM_SCHEMAS` 註冊一筆物件即可，前後端會自動依 schema 渲染與寫入：

```javascript
'委外廠商稽核': {
  base: 'default',
  baseFields: BASE_FIELDS,
  subTable: {                       // 不需要子表則設為 null
    sheet: '委外缺失單',            // 需在 Config.gs 增加對應 SHEET/HEADERS
    label: '委外缺失單',
    itemFields: [
      { key: 'finding', header: '缺失項目', label: '缺失項目', type: 'textarea', required: true },
      { key: 'handlers', header: '處理人', label: '處理人', type: 'people', multiple: true },
    ],
  },
}
```

### 新增一種匯入格式
於 `ImportRegistry.gs` 的 `IMPORT_ADAPTERS` 註冊一筆 adapter（外部欄名 → 系統欄位）即可，
CSV/Excel 解析主流程不需改動。

## 驗證清單

部署後依下列流程測試：
- 新增「上級機關稽核」風險 → 出現可多項次的矯正缺失單（每項次含處理人選擇器）。
- 新增其他來源 → 使用預設表單。
- 主表與某項次各指派多位處理人 → 確認以「、」儲存。
- 上傳佐證 → 檔案進入 Drive 指定資料夾的風險ID子資料夾，連結回寫主表。
- 對未結案風險寄通知 → 處理人收到信。
- 匯入 CSV 與 .xlsx、匯出 CSV → 格式正確。
- 以非管理者帳號登入 → 僅見被指派風險。
