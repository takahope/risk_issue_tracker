/**
 * FormRegistry.gs — 多表單可擴充的核心（資料驅動的表單註冊表）
 *
 * 設計理念：不同「發現來源」需要不同的填寫欄位。若用 if-else 分支處理，
 * 每新增一種來源都要改動前後端邏輯。改以「把表單定義成資料」的方式，
 * 前端依 schema 動態渲染、後端依同一 schema 動態驗證與寫入。
 *
 * 新增一種發現來源表單 = 在 FORM_SCHEMAS 註冊一筆物件，不需改其他程式。
 *
 * 欄位 type 對照前端渲染器：
 *   text / textarea / date / select / people（人員主檔多選）
 */

/**
 * 主表共同欄位（所有來源都會有）。
 * 對應 CONFIG.MAIN_HEADERS，但這裡描述的是「使用者填寫」的欄位，
 * 風險ID、最後更新時間、佐證連結由後端產生，不在表單中。
 */
const BASE_FIELDS = [
  { key: '風險標題', label: '風險標題', type: 'text', required: true },
  { key: '風險描述', label: '風險描述', type: 'textarea', required: true },
  { key: '風險等級', label: '風險等級', type: 'select', required: true, optionsKey: 'LEVELS' },
  { key: '處理方式', label: '處理方式', type: 'select', required: true, optionsKey: 'TREATMENTS' },
  { key: '當前狀態', label: '當前狀態', type: 'select', required: true, optionsKey: 'STATUSES' },
  { key: '處理人', label: '處理人', type: 'people', multiple: true, required: true },
  { key: '預計完成日', label: '預計完成日', type: 'date' },
];

/**
 * 預設表單 schema：除了已註冊的特殊來源外，其餘來源都採用此設定。
 */
const DEFAULT_SCHEMA = {
  base: 'default',
  baseFields: BASE_FIELDS,
  subTable: null,
};

/**
 * 各「發現來源」的專屬 schema。
 * 目前先實作「上級機關稽核 → 矯正缺失單」一對多子表。
 */
const FORM_SCHEMAS = {
  '上級機關稽核': {
    base: 'default',
    baseFields: BASE_FIELDS,
    subTable: {
      sheet: CONFIG.SUB_SHEET,
      label: '矯正缺失單',
      // 每個「項次」一列；項次序號由後端自動建議，故不放在 itemFields
      itemFields: [
        { key: 'suggestion', header: '建議改善事項', label: '建議改善事項', type: 'textarea', required: true },
        { key: 'cause', header: '發生原因', label: '發生原因', type: 'textarea' },
        { key: 'action', header: '改善措施', label: '改善措施', type: 'textarea' },
        { key: 'dueDate', header: '預定完成時間', label: '預定完成時間', type: 'date' },
        { key: 'progress', header: '執行進度', label: '執行進度', type: 'text' },
        { key: 'handlers', header: '處理人', label: '處理人', type: 'people', multiple: true },
      ],
    },
  },
};

/**
 * 取得指定發現來源的表單 schema；未註冊者回傳預設表單。
 *
 * 採用 nullish 合併而非 if-else，符合「Map 取代分支」原則。
 *
 * @param {string} source - 發現來源
 * @returns {Object} 表單 schema
 */
function getFormSchema(source) {
  return FORM_SCHEMAS[source] ?? DEFAULT_SCHEMA;
}

/**
 * 提供前端建立「新增風險」表單所需的完整中繼資料。
 *
 * 一次回傳所有來源的選項、各來源 schema、以及人員清單，
 * 讓前端切換來源時可即時重繪，不需往返後端。
 *
 * @returns {Object} { sources, options, schemas, people }
 */
function getFormMetadata() {
  return {
    sources: CONFIG.OPTIONS.SOURCES,
    options: CONFIG.OPTIONS,
    defaultSchema: DEFAULT_SCHEMA,
    schemas: FORM_SCHEMAS,
    people: HrService.listActivePeople(),
  };
}
