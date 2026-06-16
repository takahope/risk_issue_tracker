/**
 * WebApp.gs — Web App 進入點與前端 API（薄路由層）
 *
 * 本檔只負責「路由派發」與「權限守門」，實際業務邏輯一律委派給 Service，
 * 維持高內聚、低耦合。前端透過 google.script.run 呼叫此處的公開函式。
 */

/**
 * Web App 進入點，回傳單頁應用。
 */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('高風險追蹤系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 供 HTML 模板以 <?!= include('檔名') ?> 內嵌 CSS/JS。
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 一鍵初始化：在目前綁定的試算表建立主表與子表（含標題列）。
 * 部署後由 Script Editor 手動執行一次。
 */
function setup() {
  SheetRepo.getMainSheet();
  SheetRepo.getSubSheet();
  SpreadsheetApp.getActiveSpreadsheet().toast('已建立「資安風險追蹤表」與「矯正缺失單」工作表。', '初始化完成', 5);
}

// ══════════════════════════════════════════════
// 前端 API — 讀取類（所有登入者可用）
// ══════════════════════════════════════════════

/** 取得目前使用者的 session 與角色。 */
function api_getSession() {
  return AuthService.getSessionInfo();
}

/** 取得建立表單所需的中繼資料（來源、選項、schema、人員清單）。 */
function api_getFormMetadata() {
  return getFormMetadata();
}

/**
 * 列出風險。管理者看全部；處理者僅看被指派給自己的。
 */
function api_listRisks() {
  const risks = RiskService.listRisks();
  if (AuthService.isAdmin()) return risks;
  return risks.filter((risk) => AuthService.isAssignedToCurrentUser(risk));
}

/** 取得單一風險（含項次）。 */
function api_getRisk(riskId) {
  return RiskService.getRisk(riskId);
}

/** 取得目前部署設定（管理者用）。 */
function api_getSettings() {
  AuthService.requireAdmin('讀取設定');
  return SettingsService.getAll();
}

// ══════════════════════════════════════════════
// 前端 API — 寫入類（先過權限守門）
// ══════════════════════════════════════════════

/** 新增風險（僅管理者）。 */
function api_createRisk(payload) {
  AuthService.requireAdmin('新增風險');
  return RiskService.createRisk(payload);
}

/**
 * 更新風險。管理者可改全部；處理者僅能更新自己被指派風險的進度欄位。
 */
function api_updateRisk(riskId, updates) {
  if (AuthService.isAdmin()) return RiskService.updateRisk(riskId, updates);

  const risk = RiskService.getRisk(riskId);
  if (!risk || !AuthService.isAssignedToCurrentUser(risk)) {
    throw new Error('權限不足：您只能更新被指派給自己的風險。');
  }
  // 處理者僅允許更新狀態與項次進度，避免越權改動其他欄位
  const allowed = { '當前狀態': updates['當前狀態'] };
  if (Array.isArray(updates.items)) allowed.items = updates.items;
  return RiskService.updateRisk(riskId, allowed);
}

/** 刪除風險（僅管理者，不可逆）。 */
function api_deleteRisk(riskId) {
  AuthService.requireAdmin('刪除風險');
  RiskService.deleteRisk(riskId);
  return { ok: true };
}

/** 上傳佐證（管理者與被指派處理者皆可）。 */
function api_uploadEvidence(riskId, files) {
  const risk = RiskService.getRisk(riskId);
  if (!risk) throw new Error('找不到此風險ID：' + riskId);
  if (!AuthService.isAdmin() && !AuthService.isAssignedToCurrentUser(risk)) {
    throw new Error('權限不足：您只能為被指派的風險上傳佐證。');
  }
  return FileService.uploadEvidences(riskId, files);
}

/** 通知處理人（僅管理者）。 */
function api_notifyRisks(riskIds, options) {
  AuthService.requireAdmin('寄送通知');
  return NotificationService.notifyRisks(riskIds, options);
}

/** 匯入檔案（僅管理者）。 */
function api_importFile(payload) {
  AuthService.requireAdmin('匯入資料');
  return ImportExportService.importFile(payload);
}

/** 匯出主表 CSV（僅管理者）。 */
function api_exportRisksCsv() {
  AuthService.requireAdmin('匯出資料');
  return ImportExportService.exportRisksCsv();
}

/** 儲存設定（僅管理者）。 */
function api_saveSettings(settings) {
  AuthService.requireAdmin('儲存設定');
  SettingsService.save(settings);
  HrService.clearCache(); // 設定變更後清除人員快取
  return SettingsService.getAll();
}
