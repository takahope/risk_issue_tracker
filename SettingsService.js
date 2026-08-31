/**
 * SettingsService.gs — 部署設定的讀寫（Script Properties）
 *
 * HR 試算表 ID、佐證 Drive 資料夾 ID、管理者清單等「部署環境相關」設定
 * 不寫死在程式碼，改存於 Script Properties，讓同一份程式碼可在不同環境部署。
 */

const SettingsService = (function () {
  const props = PropertiesService.getScriptProperties();

  /**
   * 讀取單一設定值。
   * @param {string} key - CONFIG.PROP_KEYS 之一
   * @param {string} [fallback] - 找不到時的預設值
   * @returns {string}
   */
  function get(key, fallback) {
    return props.getProperty(key) ?? (fallback ?? '');
  }

  /**
   * 取得 HR 試算表 ID；未設定時拋出明確錯誤，方便排查。
   * @returns {string}
   */
  function getHrSpreadsheetId() {
    const id = get(CONFIG.PROP_KEYS.HR_SPREADSHEET_ID);
    if (!id) throw new Error('尚未設定 HR 人員主檔試算表 ID，請先至「設定」畫面填入。');
    return id;
  }

  /** 取得 HR 工作表名稱，預設「人員主檔」。 */
  function getHrSheetName() {
    return get(CONFIG.PROP_KEYS.HR_SHEET_NAME, CONFIG.HR_DEFAULT_SHEET_NAME);
  }

  /**
   * 取得佐證上傳資料夾 ID；未設定時拋出明確錯誤。
   * @returns {string}
   */
  function getEvidenceFolderId() {
    const id = get(CONFIG.PROP_KEYS.EVIDENCE_FOLDER_ID);
    if (!id) throw new Error('尚未設定佐證上傳的 Drive 資料夾 ID，請先至「設定」畫面填入。');
    return id;
  }

  /**
   * 取得 Gemini API Key；未設定時拋出明確錯誤（供 AI 匯入呼叫前置檢查）。
   * @returns {string}
   */
  function getGeminiApiKey() {
    const key = get(CONFIG.PROP_KEYS.GEMINI_API_KEY);
    if (!key) throw new Error('尚未設定 Gemini API Key，請先至「設定」畫面填入。');
    return key;
  }

  /** 取得 Gemini 模型名稱，預設 CONFIG.GEMINI_DEFAULT_MODEL。 */
  function getGeminiModel() {
    return get(CONFIG.PROP_KEYS.GEMINI_MODEL, CONFIG.GEMINI_DEFAULT_MODEL);
  }

  /**
   * 取得遮罩後的 API Key（僅顯示前 4 碼 + 後 4 碼）。
   * 前端設定頁面使用，避免完整 Key 暴露在瀏覽器中。
   * 以全形圓點作遮罩字元，後端 save() 會據此辨識「未變更」。
   * @returns {string}
   */
  function getMaskedApiKey_() {
    const key = get(CONFIG.PROP_KEYS.GEMINI_API_KEY);
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }

  /**
   * 取得管理者 email 清單（小寫、去空白）。
   * @returns {string[]}
   */
  function getAdminEmails() {
    const raw = get(CONFIG.PROP_KEYS.ADMIN_EMAILS);
    if (!raw) return [];
    return raw
      .split(/[,，\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email !== '');
  }

  /**
   * 供前端設定畫面讀取目前設定（不外洩於程式碼）。
   * @returns {Object}
   */
  function getAll() {
    return {
      hrSpreadsheetId: get(CONFIG.PROP_KEYS.HR_SPREADSHEET_ID),
      hrSheetName: get(CONFIG.PROP_KEYS.HR_SHEET_NAME, CONFIG.HR_DEFAULT_SHEET_NAME),
      evidenceFolderId: get(CONFIG.PROP_KEYS.EVIDENCE_FOLDER_ID),
      adminEmails: get(CONFIG.PROP_KEYS.ADMIN_EMAILS),
      geminiApiKey: getMaskedApiKey_(),                       // 遮罩後的 Key（前端顯示用）
      geminiModel: getGeminiModel(),                          // 當前模型名稱
      hasGeminiKey: !!get(CONFIG.PROP_KEYS.GEMINI_API_KEY),   // 是否已設定（前端判斷 UI 狀態）
    };
  }

  /**
   * 儲存設定（僅管理者可呼叫，權限檢查在 WebApp 入口層完成）。
   * @param {Object} settings
   */
  function save(settings) {
    const map = {};
    if (settings.hrSpreadsheetId !== undefined) map[CONFIG.PROP_KEYS.HR_SPREADSHEET_ID] = settings.hrSpreadsheetId.trim();
    if (settings.hrSheetName !== undefined) map[CONFIG.PROP_KEYS.HR_SHEET_NAME] = settings.hrSheetName.trim();
    if (settings.evidenceFolderId !== undefined) map[CONFIG.PROP_KEYS.EVIDENCE_FOLDER_ID] = settings.evidenceFolderId.trim();
    if (settings.adminEmails !== undefined) map[CONFIG.PROP_KEYS.ADMIN_EMAILS] = settings.adminEmails.trim();
    // API Key 寫入規則：
    //   '____KEEP____' = 前端未修改 → 不覆寫
    //   含遮罩字元 '•' = 前端只是「顯示」遮罩值卻未真正輸入新 Key → 不覆寫（防誤存）
    //   空字串 = 使用者清除 → 清空
    //   其他 = 貼上新 Key → 覆寫
    if (settings.geminiApiKey !== undefined) {
      const raw = String(settings.geminiApiKey);
      if (raw !== '____KEEP____' && raw.indexOf('•') === -1) {
        map[CONFIG.PROP_KEYS.GEMINI_API_KEY] = raw.trim();
      }
    }
    if (settings.geminiModel !== undefined) map[CONFIG.PROP_KEYS.GEMINI_MODEL] = settings.geminiModel.trim();
    props.setProperties(map, false);
  }

  return {
    get,
    getHrSpreadsheetId,
    getHrSheetName,
    getEvidenceFolderId,
    getAdminEmails,
    getGeminiApiKey,
    getGeminiModel,
    getAll,
    save,
  };
})();
