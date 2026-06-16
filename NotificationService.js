/**
 * NotificationService.gs — 風險處理通知（Email）
 *
 * 當風險尚未結案時，管理者可寄信通知處理人。寄信服務以「依賴注入」傳入，
 * 讓核心邏輯（決定收件人、組信件內容）與寄信實作（GmailApp）解耦，
 * 便於日後替換寄信管道或測試。
 */

/**
 * 預設寄信服務：封裝 GmailApp，作為依賴注入的具體實作。
 */
const GmailNotificationService = {
  send: function (recipient, subject, htmlBody) {
    GmailApp.sendEmail(recipient, subject, '', { htmlBody: htmlBody, name: '高風險追蹤系統' });
  },
};

const NotificationService = (function () {
  /**
   * 通知某風險的處理人（主表處理人，可選擇是否含各項次處理人）。
   *
   * @param {string} riskId
   * @param {Object} [options]
   * @param {boolean} [options.includeItemHandlers=true] - 是否一併通知項次處理人
   * @param {Object} [emailService=GmailNotificationService] - 寄信服務（依賴注入）
   * @returns {{notified: string[], skipped: string[]}}
   */
  function notifyRisk(riskId, options, emailService) {
    const service = emailService || GmailNotificationService;
    const opts = options || {};
    const includeItems = opts.includeItemHandlers !== false;

    const risk = RiskService.getRisk(riskId);
    if (!risk) throw new Error('找不到此風險ID：' + riskId);
    if (risk['當前狀態'] === CONFIG.CLOSED_STATUS) throw new Error('此風險已結案，無需通知。');

    const names = collectHandlerNames_(risk, includeItems);
    return dispatch_(risk, names, service);
  }

  /**
   * 批次通知多筆未結案風險。
   * @param {string[]} riskIds
   * @param {Object} [options]
   * @param {Object} [emailService]
   * @returns {Array<Object>}
   */
  function notifyRisks(riskIds, options, emailService) {
    return riskIds.map((id) => ({ riskId: id, result: notifyRisk(id, options, emailService) }));
  }

  // ── 內部輔助 ──

  /**
   * 收集處理人姓名（去重）。主表處理人必含，項次處理人視選項決定。
   */
  function collectHandlerNames_(risk, includeItems) {
    const names = splitNames_(risk['處理人']);
    if (includeItems) {
      (risk.items || []).forEach((item) => splitNames_(item['處理人']).forEach((n) => names.push(n)));
    }
    return [...new Set(names)];
  }

  /**
   * 將姓名解析為 email 後逐一寄信；查無 email 者記入 skipped。
   */
  function dispatch_(risk, names, service) {
    const notified = [];
    const skipped = [];
    names.forEach((name) => {
      const email = HrService.findEmailByName(name);
      if (!email) {
        skipped.push(name);
        return;
      }
      service.send(email, buildSubject_(risk), buildHtmlBody_(risk, name));
      notified.push(name + ' <' + email + '>');
    });
    return { notified, skipped };
  }

  function buildSubject_(risk) {
    return '【高風險追蹤】待處理風險通知：' + risk['風險標題'];
  }

  /**
   * 組信件內容。文案說明「為什麼收到信」與「下一步」，而非僅羅列欄位。
   */
  function buildHtmlBody_(risk, recipientName) {
    const due = risk['預計完成日'] || '（未設定）';
    return [
      '<div style="font-family:\'Noto Sans TC\',sans-serif;color:#17211d;line-height:1.7;">',
      '<p>' + escapeHtml_(recipientName) + ' 您好，</p>',
      '<p>您被指派處理下列尚未結案的風險，請於期限前完成並更新處理進度：</p>',
      '<table style="border-collapse:collapse;margin:12px 0;">',
      row_('風險ID', risk['風險ID']),
      row_('風險標題', risk['風險標題']),
      row_('風險等級', risk['風險等級']),
      row_('當前狀態', risk['當前狀態']),
      row_('預計完成日', due),
      '</table>',
      '<p style="color:#5f6d66;font-size:13px;">此信由「高風險追蹤系統」自動發送，請勿直接回覆。</p>',
      '</div>',
    ].join('');
  }

  function row_(label, value) {
    return (
      '<tr>' +
      '<td style="padding:4px 12px;background:#f6f8f5;color:#5f6d66;">' + escapeHtml_(label) + '</td>' +
      '<td style="padding:4px 12px;">' + escapeHtml_(String(value || '')) + '</td>' +
      '</tr>'
    );
  }

  function splitNames_(cellValue) {
    if (!cellValue) return [];
    return String(cellValue).split(CONFIG.PEOPLE_DELIMITER).map((n) => n.trim()).filter((n) => n);
  }

  function escapeHtml_(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { notifyRisk, notifyRisks };
})();
