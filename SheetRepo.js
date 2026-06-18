/**
 * SheetRepo.gs — 風險資料庫的持久層（Data Access Layer）
 *
 * 集中處理「本專案綁定試算表」的工作表存取與「列 ↔ 物件」轉換，
 * 讓上層 Service（RiskService / CorrectiveService）專注於業務邏輯，
 * 不必各自重複 getDataRange()/索引欄號等樣板程式。
 */

const SheetRepo = (function () {
  /**
   * 取得（必要時建立）指定名稱的工作表，並確保標題列正確。
   * @param {string} sheetName
   * @param {string[]} headers
   * @returns {GoogleAppsScript.Spreadsheet.Sheet}
   */
  function ensureSheet(sheetName, headers) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    const lastCol = sheet.getLastColumn();
    const current = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const isEmpty = current.join('') === '';

    if (isEmpty) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else if (current.length < headers.length && current.every((h, i) => h === headers[i])) {
      // 既有表頭是新表頭的前綴 → 安全地把新增欄位補在尾端（不動既有資料列）。
      // 讓 SUB_HEADERS 之類的欄位演進可自動遷移，免去手動改表頭。
      sheet.getRange(1, current.length + 1, 1, headers.length - current.length)
        .setValues([headers.slice(current.length)]);
    }
    return sheet;
  }

  /** 取得主表（資安風險追蹤表）。 */
  function getMainSheet() {
    return ensureSheet(CONFIG.MAIN_SHEET, CONFIG.MAIN_HEADERS);
  }

  /** 取得子表（矯正缺失單）。 */
  function getSubSheet() {
    return ensureSheet(CONFIG.SUB_SHEET, CONFIG.SUB_HEADERS);
  }

  /**
   * 將工作表全部資料讀為物件陣列（依標題列為鍵）。
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @returns {Array<Object>}
   */
  function readAll(sheet) {
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    const headers = values[0];
    return values.slice(1).map((row) => rowToObject_(headers, row));
  }

  /**
   * 依某欄值找出符合的「列號」（1-based，含標題列）。
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string} headerName - 比對欄位標題
   * @param {string} value - 目標值
   * @returns {number} 找到回傳列號，否則 -1
   */
  function findRowNumber(sheet, headerName, value) {
    const values = sheet.getDataRange().getValues();
    const colIndex = values[0].indexOf(headerName);
    if (colIndex === -1) return -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][colIndex]) === String(value)) return i + 1;
    }
    return -1;
  }

  /**
   * 依標題順序把物件轉成列陣列後 append。
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string[]} headers
   * @param {Object} obj
   */
  function appendObject(sheet, headers, obj) {
    sheet.appendRow(objectToRow_(headers, obj));
  }

  /**
   * 更新指定列（以標題對齊欄位）。
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {number} rowNumber - 1-based 列號
   * @param {string[]} headers
   * @param {Object} obj
   */
  function updateRow(sheet, rowNumber, headers, obj) {
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([objectToRow_(headers, obj)]);
  }

  // ── 內部輔助 ──

  function rowToObject_(headers, row) {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = toSerializableCell_(row[i]);
    });
    return obj;
  }

  /**
   * 序列化保護：把 getValues() 可能讀出的 Date 物件轉成字串，
   * 避免後端把 Sheets 的 Date 直接回傳給前端造成序列化失敗或前端
   * 對其呼叫字串方法（如 split）而中斷。
   *
   * 規則：純日期（時分秒皆為 0）輸出 yyyy-MM-dd；帶時間者輸出
   * yyyy-MM-dd HH:mm:ss。非 Date 值原樣回傳。
   *
   * @param {*} value - 單一儲存格值
   * @returns {*} 可安全序列化的值
   */
  function toSerializableCell_(value) {
    if (Object.prototype.toString.call(value) !== '[object Date]') return value;
    if (isNaN(value.getTime())) return '';
    const tz = 'Asia/Taipei';
    const hasTime = value.getHours() + value.getMinutes() + value.getSeconds() > 0;
    return Utilities.formatDate(value, tz, hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }

  function objectToRow_(headers, obj) {
    return headers.map((header) => (obj[header] !== undefined ? obj[header] : ''));
  }

  return {
    ensureSheet,
    getMainSheet,
    getSubSheet,
    readAll,
    findRowNumber,
    appendObject,
    updateRow,
  };
})();
