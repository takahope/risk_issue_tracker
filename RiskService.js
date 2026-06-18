/**
 * RiskService.gs — 主表（資安風險追蹤表）業務邏輯
 *
 * 負責風險的新增、查詢、更新、刪除，以及風險ID產生。
 * 子表（矯正缺失單）的存取委派給 CorrectiveService，維持單一職責。
 */

const RiskService = (function () {
  /**
   * 新增一筆風險（含其子表項次，若該來源有子表）。
   *
   * 採 Guard Clauses 先驗證必要欄位，避免寫入髒資料。
   *
   * @param {Object} payload - 前端送出的表單資料
   * @param {string} payload.發現來源
   * @param {string} payload.風險標題
   * @param {Array<Object>} payload.處理人 - 人員物件陣列 [{name, email}]
   * @param {Array<Object>} [payload.items] - 子表項次（如矯正缺失單）
   * @returns {Object} 新建立的風險（含風險ID）
   */
  function createRisk(payload) {
    if (!payload || !payload.發現來源) throw new Error('請選擇發現來源。');
    if (!payload.風險標題) throw new Error('請填寫風險標題。');

    const sheet = SheetRepo.getMainSheet();
    const riskId = generateRiskId_();
    const now = nowTimestamp_();

    const hasItems = Array.isArray(payload.items) && payload.items.length > 0;
    const record = {
      '風險ID': riskId,
      '發現來源': payload.發現來源,
      '風險標題': payload.風險標題,
      '風險描述': payload.風險描述 || '',
      '風險等級': payload.風險等級 || '',
      '處理方式': payload.處理方式 || '',
      // 有項次者主狀態改由項次自動推導，避免與逐項回報不一致
      '當前狀態': hasItems
        ? (computeAutoStatusFromItems_(payload.items) || payload.當前狀態 || CONFIG.OPTIONS.STATUSES[0])
        : (payload.當前狀態 || CONFIG.OPTIONS.STATUSES[0]),
      '處理人': serializePeople_(payload.處理人),
      '預計完成日': payload.預計完成日 || '',
      '最後更新時間': now,
      '佐證連結': '',
    };
    SheetRepo.appendObject(sheet, CONFIG.MAIN_HEADERS, record);

    // 若該來源有子表，連同項次一併寫入
    if (hasItems) {
      CorrectiveService.replaceItems(riskId, payload.發現來源, payload.items);
    }

    return getRisk(riskId);
  }

  /**
   * 列出所有風險，並附上各自的子表項次。
   * @returns {Array<Object>}
   */
  function listRisks() {
    const risks = SheetRepo.readAll(SheetRepo.getMainSheet());
    const itemsByRisk = CorrectiveService.groupByRiskId();
    return risks.map((risk) => ({
      ...risk,
      處理人List: deserializePeople_(risk['處理人']),
      items: itemsByRisk[risk['風險ID']] || [],
    }));
  }

  /**
   * 取得單一風險（含子表項次）。
   * @param {string} riskId
   * @returns {Object|null}
   */
  function getRisk(riskId) {
    const sheet = SheetRepo.getMainSheet();
    const rowNumber = SheetRepo.findRowNumber(sheet, '風險ID', riskId);
    if (rowNumber === -1) return null;

    const all = SheetRepo.readAll(sheet);
    const risk = all[rowNumber - 2]; // 扣掉標題列與 0-based
    return {
      ...risk,
      處理人List: deserializePeople_(risk['處理人']),
      items: CorrectiveService.listItems(riskId),
    };
  }

  /**
   * 更新風險主檔欄位（不含子表，子表由 CorrectiveService 處理）。
   * @param {string} riskId
   * @param {Object} updates - 欲更新的欄位（鍵為 MAIN_HEADERS 之一）
   * @returns {Object} 更新後的風險
   */
  function updateRisk(riskId, updates) {
    const sheet = SheetRepo.getMainSheet();
    const rowNumber = SheetRepo.findRowNumber(sheet, '風險ID', riskId);
    if (rowNumber === -1) throw new Error('找不到此風險ID：' + riskId);

    const current = SheetRepo.readAll(sheet)[rowNumber - 2];
    const merged = { ...current, ...sanitizeUpdates_(updates), '最後更新時間': nowTimestamp_() };
    SheetRepo.updateRow(sheet, rowNumber, CONFIG.MAIN_HEADERS, merged);

    if (Array.isArray(updates.items)) {
      CorrectiveService.replaceItems(riskId, merged['發現來源'], updates.items);
      // 項次整批變更後，依完成情形重算主狀態（已結案者於 refreshAutoStatus 內保留）
      refreshAutoStatus(riskId);
    }
    return getRisk(riskId);
  }

  /**
   * 刪除風險（連同其子表項次）。為不可逆操作，呼叫端需先做權限與確認。
   * @param {string} riskId
   */
  function deleteRisk(riskId) {
    const sheet = SheetRepo.getMainSheet();
    const rowNumber = SheetRepo.findRowNumber(sheet, '風險ID', riskId);
    if (rowNumber === -1) throw new Error('找不到此風險ID：' + riskId);
    sheet.deleteRow(rowNumber);
    CorrectiveService.deleteByRiskId(riskId);
  }

  /**
   * 列出尚未結案的風險（供通知功能）。
   * @returns {Array<Object>}
   */
  function listOpenRisks() {
    return listRisks().filter((risk) => risk['當前狀態'] !== CONFIG.CLOSED_STATUS);
  }

  /**
   * 依子項次完成情形重算主風險的「當前狀態」。
   *
   * 規則：有項次時，全部完成 → 待驗證；尚有未完成 → 處理中。
   * 已結案者保持不變（結案為管理者驗證後的單向終態，不被自動拉回）；
   * 無項次者不自動推導（維持手動狀態）。
   *
   * @param {string} riskId
   */
  function refreshAutoStatus(riskId) {
    const risk = getRisk(riskId);
    if (!risk) return;
    if (risk['當前狀態'] === CONFIG.CLOSED_STATUS) return;

    const next = computeAutoStatusFromItems_(risk.items);
    if (next && next !== risk['當前狀態']) updateRisk(riskId, { '當前狀態': next });
  }

  // ── 內部輔助 ──

  /**
   * 由項次清單推導主狀態；無項次回傳 null（表示不自動推導）。
   * @param {Array<Object>} items
   * @returns {string|null}
   */
  function computeAutoStatusFromItems_(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const allDone = items.every((it) => (it['狀態'] || it.status) === CONFIG.ITEM_DONE_STATUS);
    return allDone ? CONFIG.TO_VERIFY_STATUS : CONFIG.IN_PROGRESS_STATUS;
  }

  /**
   * 產生風險ID，格式比照範例：RISK-YYYYMMDD-####（4 位流水）。
   * 流水號取當日已存在筆數 +1，確保同日不重複。
   */
  function generateRiskId_() {
    const datePart = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
    const prefix = 'RISK-' + datePart + '-';
    const existing = SheetRepo.readAll(SheetRepo.getMainSheet())
      .filter((risk) => String(risk['風險ID']).startsWith(prefix)).length;
    const serial = String(existing + 1).padStart(4, '0');
    return prefix + serial;
  }

  function nowTimestamp_() {
    return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  }

  /**
   * 將人員物件陣列序列化為「、」分隔字串（僅存姓名，比照範例顯示）。
   * @param {Array<Object>|string} people
   */
  function serializePeople_(people) {
    if (typeof people === 'string') return people;
    if (!Array.isArray(people)) return '';
    return people
      .map((person) => (typeof person === 'string' ? person : person.name))
      .filter((name) => name)
      .join(CONFIG.PEOPLE_DELIMITER);
  }

  function deserializePeople_(cellValue) {
    if (!cellValue) return [];
    return String(cellValue).split(CONFIG.PEOPLE_DELIMITER).map((name) => name.trim()).filter((name) => name);
  }

  /** 僅保留合法的主表欄位，避免前端塞入未知鍵。 */
  function sanitizeUpdates_(updates) {
    const clean = {};
    CONFIG.MAIN_HEADERS.forEach((header) => {
      if (updates[header] === undefined) return;
      clean[header] = header === '處理人' ? serializePeople_(updates[header]) : updates[header];
    });
    return clean;
  }

  return {
    createRisk,
    listRisks,
    getRisk,
    updateRisk,
    deleteRisk,
    listOpenRisks,
    refreshAutoStatus,
    // 對外暴露序列化工具供匯入服務重用
    serializePeople_,
  };
})();
