/**
 * Config.gs — 單一真實來源 (Single Source of Truth)
 *
 * 全系統的 Sheet 名稱、欄位定義、選項清單與 Script Properties 鍵名都集中在此。
 * 之所以集中管理，是為了讓未來調整欄位或新增選項時只需改一處，避免魔法字串
 * 散落各檔造成「牽一髮動全身」。
 */

const CONFIG = {
  // ── 本專案（風險資料庫）使用的工作表 ──
  MAIN_SHEET: '資安風險追蹤表',
  SUB_SHEET: '矯正缺失單',

  /**
   * 主表欄位。順序即為試算表欄位順序，所有讀寫一律透過此陣列索引，
   * 不在程式中寫死欄號（避免魔法數字）。
   * 註：依需求將原範例「負責人」更名為「處理人」，並新增「佐證連結」。
   */
  MAIN_HEADERS: [
    '風險ID', '發現來源', '風險標題', '風險描述', '風險等級',
    '處理方式', '當前狀態', '處理人', '預計完成日', '最後更新時間', '佐證連結',
  ],

  /**
   * 子表（矯正缺失單）欄位。以「風險ID」與主表一對多關聯，
   * 每一列代表一個「項次」，並各自擁有「處理人」。
   */
  SUB_HEADERS: [
    '風險ID', '項次', '建議改善事項', '發生原因', '改善措施',
    '預定完成時間', '執行進度', '處理人',
  ],

  // ── 預設表單選項（來源：example/option.md）──
  OPTIONS: {
    SOURCES: ['弱點掃描', '滲透測試', '資安健診', '情資通報', '內部稽核', '上級機關稽核', '外部驗證單位', '委外廠商稽核'],
    LEVELS: ['極高 (Critical)', '高 (High)', '中 (Medium)', '低 (Low)'],
    TREATMENTS: ['降低 (Mitigate)', '接受 (Accept)', '轉移 (Transfer)', '避免 (Avoid)'],
    STATUSES: ['待處理 (Open)', '處理中 (In Progress)', '待驗證 (To Verify)', '已結案 (Closed)'],
  },

  // 多人欄位的序列化分隔符（比照範例以「、」分隔）
  PEOPLE_DELIMITER: '、',

  // 視為「已結案」的狀態值（通知功能用以過濾）
  CLOSED_STATUS: '已結案 (Closed)',

  // ── Script Properties 鍵名（部署時於設定畫面填入）──
  PROP_KEYS: {
    HR_SPREADSHEET_ID: 'HR_SPREADSHEET_ID', // 人員主檔所在的試算表 ID（單一事實來源）
    HR_SHEET_NAME: 'HR_SHEET_NAME',         // 人員主檔工作表名稱，預設「人員主檔」
    EVIDENCE_FOLDER_ID: 'EVIDENCE_FOLDER_ID', // 佐證上傳的 Drive 資料夾 ID
    ADMIN_EMAILS: 'ADMIN_EMAILS',           // 管理者 email 清單（以逗號分隔）
  },

  // HR 工作表預設名稱（人員主檔欄位：信箱/姓名/員工狀態）
  HR_DEFAULT_SHEET_NAME: '人員主檔',

  // 人員主檔合法員工狀態（讀取時非合法值預設為「在勤」）
  HR_VALID_STATUSES: ['在勤', '育嬰假', '休假', '留職停薪', '合作單位', '委外廠商', '外派人員', '倫理委員會'],
};
