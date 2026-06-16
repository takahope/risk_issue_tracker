/**
 * authsetting.js — 一次觸發所有 OAuth 授權
 *
 * 使用方式：
 *   在 Apps Script 編輯器選擇「requestAllPermissions」函式 → 點「執行」。
 *   Google 會彈出授權對話框，列出本專案需要的所有 scope，點「允許」即完成。
 *
 * 為什麼需要這個函式：
 *   GAS 的 OAuth scope 是「按需觸發」的。appsscript.json 只是宣告，
 *   必須在程式實際呼叫服務時 Google 才會要求使用者授權。
 *   此函式對每個服務做一次最小讀取，確保所有 scope 在部署前一次授權完畢，
 *   避免上線後第一位使用者觸發未授權錯誤。
 *
 * 注意：此函式只需執行一次（部署前由管理者操作），不提供給使用者呼叫。
 */
function requestAllPermissions() {
  const results = {};

  // scope: spreadsheets — 讀取目前綁定的試算表名稱
  results.spreadsheet = SpreadsheetApp.getActiveSpreadsheet().getName();

  // scope: drive — 讀取 Drive 根目錄名稱（不會移動或修改任何檔案）
  results.drive = DriveApp.getRootFolder().getName();

  // scope: userinfo.email — 取得目前執行者 email
  results.executorEmail = Session.getActiveUser().getEmail();

  // scope: script.scriptapp — 讀取本專案的 Script ID
  results.scriptId = ScriptApp.getScriptId();

  // 將結果印到執行紀錄，方便確認各服務都正常授權
  const lines = Object.entries(results).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  console.log('授權觸發成功，各服務回應如下：\n' + lines);

  SpreadsheetApp.getUi().alert(
    '✅ 授權完成',
    '所有必要服務已成功授權：\n\n' +
      `📊 試算表：${results.spreadsheet}\n` +
      `📁 Drive：${results.drive}\n` +
      `👤 執行者：${results.executorEmail}\n` +
      `🔑 Script ID：${results.scriptId}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
