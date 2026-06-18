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
   * 就地更新某風險的單一項次（不重建整批，保留其他項次的狀態與佐證）。
   *
   * 供「逐項次回報」使用：可更新狀態、並把新佐證連結附加到該項次的
   * 「佐證連結」欄（以換行串接多筆）。找不到該項次時拋錯。
   *
   * @param {string} riskId
   * @param {number|string} seq - 項次序號
   * @param {Object} updates - { 狀態?, evidenceLinks?: string[] }
   * @returns {Object} 更新後的項次
   */
  function updateItem(riskId, seq, updates) {
    const sheet = SheetRepo.getSubSheet();
    const rowNumber = findItemRowNumber_(sheet, riskId, seq);
    if (rowNumber === -1) throw new Error('找不到風險 ' + riskId + ' 的項次 ' + seq + '。');

    const current = SheetRepo.readAll(sheet)[rowNumber - 2];
    const merged = { ...current };

    if (updates && updates.狀態) merged['狀態'] = updates.狀態;

    if (updates && Array.isArray(updates.evidenceLinks) && updates.evidenceLinks.length) {
      const existing = current['佐證連結'] || '';
      merged['佐證連結'] = [existing, ...updates.evidenceLinks].filter((s) => s).join('\n');
    }

    SheetRepo.updateRow(sheet, rowNumber, CONFIG.SUB_HEADERS, merged);
    SpreadsheetApp.flush();
    return merged;
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
   * 以「風險ID + 項次」雙鍵定位列號（1-based，含標題列）。找不到回傳 -1。
   */
  function findItemRowNumber_(sheet, riskId, seq) {
    const values = sheet.getDataRange().getValues();
    const idCol = values[0].indexOf('風險ID');
    const seqCol = values[0].indexOf('項次');
    if (idCol === -1 || seqCol === -1) return -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(riskId) && String(values[i][seqCol]) === String(seq)) {
        return i + 1;
      }
    }
    return -1;
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
      // 整批取代時保留既有狀態/佐證（若前端有帶回），否則新項次預設「處理中」
      '狀態': item.狀態 || item.status || CONFIG.ITEM_DEFAULT_STATUS,
      '佐證連結': item['佐證連結'] || item.evidence || '',
    };
  }

  return { listItems, groupByRiskId, replaceItems, updateItem, deleteByRiskId };
})();
