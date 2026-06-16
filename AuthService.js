/**
 * AuthService.gs — 使用者身分與權限判定
 *
 * 兩種角色：
 *   admin   — 管理者，可新增/編輯/刪除/通知/匯入匯出/設定
 *   handler — 處理者，僅能查看與更新「自己被指派」的風險
 *
 * 管理者來源為 Script Properties 的 admin email 清單，與人事資料解耦。
 */

const AuthService = (function () {
  const ROLE = { ADMIN: 'admin', HANDLER: 'handler' };

  /** 取得目前登入者 email（小寫）。 */
  function getCurrentEmail() {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  }

  /**
   * 判定目前使用者角色。
   * 在 admin 清單內即為 admin，否則一律視為 handler。
   * @returns {string} ROLE.ADMIN | ROLE.HANDLER
   */
  function getCurrentRole() {
    const admins = SettingsService.getAdminEmails();
    // 初始部署狀態（尚未設定任何管理者）視為「設定模式」：當前使用者即管理者，
    // 以便完成首次設定並指定正式管理者，避免無人可進入設定畫面的死結。
    if (admins.length === 0) return ROLE.ADMIN;
    return admins.includes(getCurrentEmail()) ? ROLE.ADMIN : ROLE.HANDLER;
  }

  /** 是否為管理者。 */
  function isAdmin() {
    return getCurrentRole() === ROLE.ADMIN;
  }

  /**
   * 守門函式：非管理者則拋出錯誤。用於 WebApp 寫入類入口的第一行。
   * @param {string} [action] - 操作名稱，用於錯誤訊息
   */
  function requireAdmin(action) {
    if (isAdmin()) return;
    throw new Error('權限不足：「' + (action || '此操作') + '」僅限管理者執行。');
  }

  /**
   * 判斷某風險是否由目前使用者處理（用於處理者視角過濾）。
   * 以姓名比對處理人欄位（主表與子表項次皆納入）。
   * @param {Object} risk - 含 處理人 與 items 的風險物件
   * @returns {boolean}
   */
  function isAssignedToCurrentUser(risk) {
    const myName = currentUserName_();
    if (!myName) return false;

    const inMain = String(risk['處理人'] || '').includes(myName);
    const inItems = (risk.items || []).some((item) => String(item['處理人'] || '').includes(myName));
    return inMain || inItems;
  }

  /** 取得目前角色與基本資訊，供前端初始化。 */
  function getSessionInfo() {
    const email = getCurrentEmail();
    return {
      email,
      name: nameOfEmail_(email),
      role: getCurrentRole(),
      isAdmin: isAdmin(),
    };
  }

  // ── 內部輔助 ──

  function currentUserName_() {
    return nameOfEmail_(getCurrentEmail());
  }

  function nameOfEmail_(email) {
    const match = HrService.listPeople().find((person) => person.email === email);
    return match ? match.name : '';
  }

  return {
    ROLE,
    getCurrentEmail,
    getCurrentRole,
    isAdmin,
    requireAdmin,
    isAssignedToCurrentUser,
    getSessionInfo,
  };
})();
