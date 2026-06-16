/**
 * ImportRegistry.gs — 匯入格式可擴充的核心（資料驅動的匯入轉接器）
 *
 * 不同發現來源的外部檔案（CSV/Excel）欄位命名與結構各異。
 * 將每種來源的「外部欄名 → 系統欄位」對應與轉換邏輯，註冊成一筆 adapter，
 * ImportExportService 只需查表套用，新增格式 = 註冊一筆，不必改解析主流程。
 *
 * adapter 結構：
 *   {
 *     columns: { 外部欄名: 系統欄位, ... },   // 欄位對應
 *     toRisk(rowObj): Object,                  // 將一列轉為主表風險物件（可選）
 *     toItems(rows): Array,                    // 將多列轉為子表項次（子表來源用，可選）
 *     grouped: boolean,                        // true 表示多列屬同一風險（子表型）
 *   }
 */

const IMPORT_ADAPTERS = {
  /**
   * 上級機關稽核：對應「矯正缺失表」格式
   * 外部欄位：項次 / 建議改善事項 / 發生原因 / 改善措施 / 預定完成時間 / 執行進度
   * 此類整份檔案視為「同一筆風險」的多個項次（grouped）。
   */
  '上級機關稽核': {
    grouped: true,
    columns: {
      '項次': '項次',
      '建議改善事項': 'suggestion',
      '發生原因': 'cause',
      '改善措施': 'action',
      '預定完成時間': 'dueDate',
      '執行進度': 'progress',
      '處理人': 'handlers',
    },
    toItems: function (rowObjects) {
      return rowObjects.map(function (row, index) {
        return {
          項次: row['項次'] || index + 1,
          suggestion: row['suggestion'] || '',
          cause: row['cause'] || '',
          action: row['action'] || '',
          dueDate: row['dueDate'] || '',
          progress: row['progress'] || '',
          handlers: row['handlers'] || '',
        };
      });
    },
  },

  /**
   * 預設匯入：直接對應主表欄位，一列一筆風險。
   */
  '__default__': {
    grouped: false,
    columns: {
      '發現來源': '發現來源',
      '風險標題': '風險標題',
      '風險描述': '風險描述',
      '風險等級': '風險等級',
      '處理方式': '處理方式',
      '當前狀態': '當前狀態',
      '處理人': '處理人',
      '預計完成日': '預計完成日',
    },
    toRisk: function (rowObject) {
      return rowObject; // 欄位已對應為系統欄位，直接使用
    },
  },
};

/**
 * 取得指定來源的匯入轉接器；未註冊者回傳預設。
 * @param {string} source
 * @returns {Object}
 */
function getImportAdapter(source) {
  return IMPORT_ADAPTERS[source] ?? IMPORT_ADAPTERS['__default__'];
}
