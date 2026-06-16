/**
 * HrService.gs — 人員主檔（單一事實來源）讀取
 *
 * 人員資料存在「另一份」獨立試算表，作為全組織的單一事實來源。
 * 本服務只負責讀取，不寫入，避免風險資料庫與人事資料耦合。
 * 讀取結果以 CacheService 短期快取，降低跨試算表讀取的延遲。
 */

const HrService = (function () {
  const CACHE_KEY = 'HR_PEOPLE_V1';
  const CACHE_TTL_SECONDS = 300; // 5 分鐘

  /**
   * 讀取人員主檔全部人員。
   *
   * 人員主檔欄位：A 信箱(email)、B 姓名(name)、C 員工狀態(status)。
   * 員工狀態若非合法值，比照範例規則預設為「在勤」。
   *
   * @returns {Array<{email:string, name:string, status:string}>}
   */
  function listPeople() {
    // 尚未設定 HR 試算表時回傳空清單，讓系統仍可開啟並引導至「設定」畫面，
    // 而非整個 Web App 卡在初始化失敗。
    const hrId = SettingsService.get(CONFIG.PROP_KEYS.HR_SPREADSHEET_ID);
    if (!hrId) return [];

    const cached = readCache_();
    if (cached) return cached;

    const ss = SpreadsheetApp.openById(hrId);
    const sheet = ss.getSheetByName(SettingsService.getHrSheetName());
    if (!sheet) throw new Error('找不到人員主檔工作表，請確認 HR 設定的工作表名稱是否正確。');

    const rows = sheet.getDataRange().getValues();
    const people = rows
      .slice(1) // 跳過標題列
      .map(toPerson_)
      .filter((person) => person.email !== '');

    writeCache_(people);
    return people;
  }

  /**
   * 僅回傳「在勤」狀態的人員，供指派處理人時的預設清單。
   * @returns {Array<{email:string, name:string, status:string}>}
   */
  function listActivePeople() {
    return listPeople().filter((person) => person.status === '在勤');
  }

  /**
   * 依姓名反查 email（通知功能用）。找不到回傳 null。
   * 同名情況回傳第一筆；建議實務上以 email 為主鍵指派。
   * @param {string} name
   * @returns {string|null}
   */
  function findEmailByName(name) {
    const target = String(name).trim();
    const match = listPeople().find((person) => person.name === target);
    return match ? match.email : null;
  }

  /** 清除快取（人員主檔更新後可手動呼叫）。 */
  function clearCache() {
    CacheService.getScriptCache().remove(CACHE_KEY);
  }

  // ── 內部輔助函式（降低主流程認知負擔）──

  /**
   * 將試算表單列轉為人員物件，並正規化員工狀態。
   * @param {Array} row - [信箱, 姓名, 員工狀態]
   */
  function toPerson_(row) {
    const email = String(row[0] ?? '').trim().toLowerCase();
    const name = String(row[1] ?? '').trim();
    const rawStatus = String(row[2] ?? '').trim();
    const status = CONFIG.HR_VALID_STATUSES.includes(rawStatus) ? rawStatus : '在勤';
    return { email, name, status };
  }

  function readCache_() {
    const raw = CacheService.getScriptCache().get(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function writeCache_(people) {
    // 快取可能超過 100KB 上限時略過快取，不影響正確性
    try {
      CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(people), CACHE_TTL_SECONDS);
    } catch (err) {
      // 快取失敗僅影響效能，不需中斷
    }
  }

  return { listPeople, listActivePeople, findEmailByName, clearCache };
})();
