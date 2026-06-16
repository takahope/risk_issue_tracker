/**
 * CorrectiveService.gs — 子表（矯正缺失單）業務邏輯
 *
 * 子表與主表為一對多關係（以「風險ID」關聯），每一列是一個「項次」。
 * 此服務以「整批取代」(replaceItems) 的方式維護某風險的所有項次，
 * 讓前端可一次送出完整項次清單，後端負責同步，邏輯單純可預期。
 */

const CorrectiveService = (function () {
  /**
   * 取得某風險的所有項次（依項次序號排序）。
   * @param {string} riskId
   * @returns {Array<Object>}
   */
  function listItems(riskId) {
    return readAll_()
      .filter((item) => String(item['風險ID']) === String(riskId))
      .sort((a, b) => Number(a['項次']) - Number(b['項次']));
  }

  /**
   * 以風險ID分組，供清單頁一次帶回所有風險的項次（避免 N+1 讀取）。
   * @returns {Object<string, Array<Object>>}
   */
  function groupByRiskId() {
    const grouped = {};
    readAll_().forEach((item) => {
      const key = String(item['風險ID']);
      (grouped[key] = grouped[key] || []).push(item);
    });
    Object.values(grouped).forEach((list) => list.sort((a, b) => Number(a['項次']) - Number(b['項次'])));
    return grouped;
  }

  /**
   * 以新清單整批取代某風險的所有項次。
   *
   * 先刪除既有項次，再依序寫入新項次；項次序號未提供時自動由 1 編號。
   * 每個項次各自擁有「處理人」，序列化方式與主表一致。
   *
   * @param {string} riskId
   * @param {string} source - 發現來源（用以取得子表 schema 的欄位定義）
   * @param {Array<Object>} items - 前端送出的項次資料
   */
  function replaceItems(riskId, source, items) {
    deleteByRiskId(riskId);
    if (!Array.isArray(items) || items.length === 0) return;

    const schema = getFormSchema(source);
    if (!schema.subTable) return; // 此來源無子表則略過

    const sheet = SheetRepo.getSubSheet();
    items.forEach((item, index) => {
      const record = toSubRecord_(riskId, item, index + 1);
      SheetRepo.appendObject(sheet, CONFIG.SUB_HEADERS, record);
    });
  }

  /**
   * 刪除某風險的所有項次。由後往前刪避免列號位移。
   * @param {string} riskId
   */
  function deleteByRiskId(riskId) {
    const sheet = SheetRepo.getSubSheet();
    const values = sheet.getDataRange().getValues();
    const idCol = values[0].indexOf('風險ID');
    if (idCol === -1) return;
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][idCol]) === String(riskId)) sheet.deleteRow(i + 1);
    }
  }

  // ── 內部輔助 ──

  function readAll_() {
    return SheetRepo.readAll(SheetRepo.getSubSheet());
  }

  /**
   * 將前端項次物件轉為子表列物件（鍵對齊 CONFIG.SUB_HEADERS）。
   * 前端 itemFields 使用語意化 key（suggestion/cause...），此處對應成中文欄名。
   */
  function toSubRecord_(riskId, item, defaultSeq) {
    return {
      '風險ID': riskId,
      '項次': item.項次 || item.seq || defaultSeq,
      '建議改善事項': item.suggestion || item['建議改善事項'] || '',
      '發生原因': item.cause || item['發生原因'] || '',
      '改善措施': item.action || item['改善措施'] || '',
      '預定完成時間': item.dueDate || item['預定完成時間'] || '',
      '執行進度': item.progress || item['執行進度'] || '',
      '處理人': RiskService.serializePeople_(item.handlers || item['處理人']),
    };
  }

  return { listItems, groupByRiskId, replaceItems, deleteByRiskId };
})();
