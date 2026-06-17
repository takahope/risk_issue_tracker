/**
 * GetAuth.js
 * 
 * 由於系統使用 GmailApp 來發送風險追蹤通知信，
 * 若遇到 "Specified permissions are not sufficient..." 錯誤，
 * 請在 Apps Script 編輯器中選擇執行 `triggerGmailAuth` 函式，
 * Google 就會彈出授權視窗，請依照畫面指示完成授權即可。
 */

function triggerGmailAuth() {
  try {
    // 這裡只是做一個簡單的 GmailApp 呼叫，目的是觸發系統的授權檢查
    GmailApp.getAliases();
    console.log("授權成功！現在您可以正常使用寄信功能了。");
  } catch (e) {
    console.error("觸發授權時發生錯誤：", e);
  }
}
