/**
 * FileService.gs — 佐證資料上傳（Google Drive）
 *
 * 佐證檔案統一存入「設定」指定的 Drive 資料夾，並以風險ID建立子資料夾歸檔，
 * 方便日後依風險檢視所有佐證。上傳後回傳檔案連結，由 RiskService 回寫主表。
 */

const FileService = (function () {
  /**
   * 上傳一個佐證檔案至該風險的子資料夾。
   *
   * @param {string} riskId
   * @param {Object} file - 前端傳來的檔案 { name, mimeType, base64 }
   * @returns {{name:string, url:string, id:string}}
   */
  function uploadEvidence(riskId, file) {
    if (!riskId) throw new Error('缺少風險ID，無法上傳佐證。');
    if (!file || !file.base64) throw new Error('檔案內容為空，請重新選擇檔案。');

    const folder = getRiskFolder_(riskId);
    const bytes = Utilities.base64Decode(file.base64);
    const blob = Utilities.newBlob(bytes, file.mimeType || 'application/octet-stream', file.name || 'evidence');
    const created = folder.createFile(blob);
    created.setDescription('風險佐證：' + riskId);

    appendLinkToRisk_(riskId, created);
    return { name: created.getName(), url: created.getUrl(), id: created.getId() };
  }

  /**
   * 一次上傳多個佐證檔案。
   * @param {string} riskId
   * @param {Array<Object>} files
   * @returns {Array<Object>}
   */
  function uploadEvidences(riskId, files) {
    if (!Array.isArray(files)) return [];
    return files.map((file) => uploadEvidence(riskId, file));
  }

  // ── 內部輔助 ──

  /**
   * 取得（必要時建立）某風險的佐證子資料夾。
   */
  function getRiskFolder_(riskId) {
    const root = DriveApp.getFolderById(SettingsService.getEvidenceFolderId());
    const existing = root.getFoldersByName(riskId);
    return existing.hasNext() ? existing.next() : root.createFolder(riskId);
  }

  /**
   * 將新佐證連結附加到主表「佐證連結」欄（以換行串接多個連結）。
   */
  function appendLinkToRisk_(riskId, file) {
    const sheet = SheetRepo.getMainSheet();
    const rowNumber = SheetRepo.findRowNumber(sheet, '風險ID', riskId);
    if (rowNumber === -1) return;

    const colIndex = CONFIG.MAIN_HEADERS.indexOf('佐證連結') + 1;
    const cell = sheet.getRange(rowNumber, colIndex);
    const existing = cell.getValue();
    const entry = file.getName() + ' ' + file.getUrl();
    cell.setValue(existing ? existing + '\n' + entry : entry);
  }

  return { uploadEvidence, uploadEvidences };
})();
