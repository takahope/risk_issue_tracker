/**
 * ImportExportService.gs — 匯入（CSV/Excel）與匯出（CSV）
 *
 * 匯入流程分三步，各步驟單一職責：
 *   1) 解析檔案為「表格列陣列」（CSV 直接解析；Excel 透過 Drive 轉檔）
 *   2) 依 ImportRegistry 的 adapter 把外部欄位對應成系統欄位
 *   3) 交給 RiskService / CorrectiveService 寫入
 *
 * 新增匯入格式（不同欄位結構）只需在 ImportRegistry 註冊 adapter。
 */

const ImportExportService = (function () {
  /**
   * 匯入一個檔案。
   *
   * @param {Object} payload
   * @param {string} payload.source - 發現來源（決定使用哪個 adapter）
   * @param {string} payload.fileName - 含副檔名，用以判斷 CSV / Excel
   * @param {string} payload.mimeType
   * @param {string} payload.base64 - 檔案內容
   * @param {Object} [payload.riskMeta] - grouped 來源建立主表風險時的共通欄位
   * @returns {{importedRisks:number, importedItems:number}}
   */
  function importFile(payload) {
    if (!payload || !payload.base64) throw new Error('未收到檔案內容。');
    if (!payload.source) throw new Error('請先選擇匯入的發現來源。');

    const table = parseToTable_(payload);
    const rowObjects = mapColumns_(table, getImportAdapter(payload.source));
    return writeRows_(payload.source, rowObjects, payload.riskMeta || {});
  }

  /**
   * 匯出全部風險為 CSV 字串（主表）。
   * @returns {string} CSV 內容
   */
  function exportRisksCsv() {
    const sheet = SheetRepo.getMainSheet();
    const values = sheet.getDataRange().getValues();
    return values.map(toCsvLine_).join('\n');
  }

  /**
   * 匯出某風險的子表項次為 CSV。
   * @param {string} riskId
   * @returns {string}
   */
  function exportItemsCsv(riskId) {
    const items = CorrectiveService.listItems(riskId);
    const header = CONFIG.SUB_HEADERS;
    const lines = [header].concat(items.map((item) => header.map((h) => item[h])));
    return lines.map(toCsvLine_).join('\n');
  }

  // ── 步驟 1：解析為表格列陣列 ──

  /**
   * 依副檔名分派解析器（Map 取代分支）。
   * @returns {Array<Array<string>>} 含標題列的二維陣列
   */
  function parseToTable_(payload) {
    const ext = String(payload.fileName || '').split('.').pop().toLowerCase();
    const parser = TABLE_PARSERS[ext] || TABLE_PARSERS['csv'];
    return parser(payload);
  }

  const TABLE_PARSERS = {
    csv: function (payload) {
      const text = Utilities.newBlob(Utilities.base64Decode(payload.base64)).getDataAsString('UTF-8');
      return Utilities.parseCsv(text);
    },
    // Excel 需透過 Drive 進階服務轉成 Google Sheet 再讀取
    xlsx: function (payload) {
      return parseExcelViaDrive_(payload);
    },
    xls: function (payload) {
      return parseExcelViaDrive_(payload);
    },
  };

  /**
   * 將上傳的 Excel 透過 Drive API 轉為 Google Sheet，讀取後刪除暫存檔。
   */
  function parseExcelViaDrive_(payload) {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(payload.base64),
      payload.mimeType || MimeType.MICROSOFT_EXCEL,
      payload.fileName
    );
    const resource = { title: 'temp_import_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS };
    const created = Drive.Files.insert(resource, blob, { convert: true });
    try {
      const ss = SpreadsheetApp.openById(created.id);
      return ss.getSheets()[0].getDataRange().getValues();
    } finally {
      Drive.Files.remove(created.id); // 清理暫存，避免堆積
    }
  }

  // ── 步驟 2：依 adapter 對應欄位 ──

  /**
   * 將二維表格依 adapter.columns 對應成系統欄位物件陣列。
   * 未在對應表中的外部欄位會被忽略。
   */
  function mapColumns_(table, adapter) {
    if (table.length < 2) return [];
    const externalHeaders = table[0].map((h) => String(h).trim());
    return table.slice(1)
      .filter((row) => row.some((cell) => String(cell).trim() !== '')) // 跳過空列
      .map((row) => {
        const obj = {};
        externalHeaders.forEach((extHeader, i) => {
          const systemField = adapter.columns[extHeader];
          if (systemField) obj[systemField] = row[i];
        });
        return obj;
      });
  }

  // ── 步驟 3：寫入資料庫 ──

  /**
   * 依 adapter 型態寫入：grouped → 一筆風險含多項次；否則 → 多筆風險。
   */
  function writeRows_(source, rowObjects, riskMeta) {
    const adapter = getImportAdapter(source);
    if (rowObjects.length === 0) return { importedRisks: 0, importedItems: 0 };

    if (adapter.grouped) return writeGrouped_(source, adapter, rowObjects, riskMeta);
    return writeFlat_(source, adapter, rowObjects);
  }

  /**
   * grouped 來源：整份檔案為同一風險的多個項次。
   * 先用 riskMeta 建立主表風險，再寫入項次。
   */
  function writeGrouped_(source, adapter, rowObjects, riskMeta) {
    const items = adapter.toItems ? adapter.toItems(rowObjects) : rowObjects;
    const risk = RiskService.createRisk({
      發現來源: source,
      風險標題: riskMeta.風險標題 || (source + ' 匯入'),
      風險描述: riskMeta.風險描述 || '',
      風險等級: riskMeta.風險等級 || '',
      處理方式: riskMeta.處理方式 || '',
      當前狀態: riskMeta.當前狀態 || CONFIG.OPTIONS.STATUSES[0],
      處理人: riskMeta.處理人 || '',
      預計完成日: riskMeta.預計完成日 || '',
      items: items,
    });
    return { importedRisks: 1, importedItems: items.length, riskId: risk['風險ID'] };
  }

  /**
   * 一般來源：每列一筆風險。
   */
  function writeFlat_(source, adapter, rowObjects) {
    let count = 0;
    rowObjects.forEach((rowObject) => {
      const data = adapter.toRisk ? adapter.toRisk(rowObject) : rowObject;
      data.發現來源 = data.發現來源 || source;
      RiskService.createRisk(data);
      count++;
    });
    return { importedRisks: count, importedItems: 0 };
  }

  // ── CSV 輸出輔助 ──

  function toCsvLine_(row) {
    return row.map(escapeCsvCell_).join(',');
  }

  function escapeCsvCell_(cell) {
    const text = String(cell ?? '');
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  return { importFile, exportRisksCsv, exportItemsCsv };
})();
