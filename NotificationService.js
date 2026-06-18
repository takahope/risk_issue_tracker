/**
 * NotificationService.gs — 風險處理通知（Email）
 *
 * 當風險尚未結案時，管理者可寄信通知處理人。寄信服務以「依賴注入」傳入，
 * 讓核心邏輯（決定收件人、組信件內容）與寄信實作（GmailApp）解耦，
 * 便於日後替換寄信管道或測試。
 */

/**
 * 預設寄信服務：封裝 GmailApp，作為依賴注入的具體實作。
 *
 * recipients 可為單一字串或字串陣列。多位收件人時全部放入「To」合併成一封寄出，
 * 讓同組（例如同一項次的多位處理人）能在收件欄互相看到，知道可找誰一起討論；
 * 同時只呼叫一次 GmailApp.sendEmail（節省執行時間，降低撞 6 分鐘上限的風險）。
 * 注意：每日寄信配額以「收件人數」計，合併寄送不影響配額。
 */
const GmailNotificationService = {
  send: function (recipients, subject, htmlBody) {
    const list = (Array.isArray(recipients) ? recipients : [recipients]).filter(function (e) { return e; });
    if (list.length === 0) return;
    GmailApp.sendEmail(list.join(','), subject, '', { htmlBody: htmlBody, name: '風險追蹤管理' });
  },
};

const NotificationService = (function () {
  /**
   * 通知某風險的指定收件人。
   *
   * 收件人由 target 精準描述：可選擇是否通知主表處理人，並指定要通知哪些
   * 子項次（項次）的處理人，達成「全部 / 僅主負責人 / 自訂特定項次」的彈性。
   *
   * @param {Object} target - 收件人描述
   * @param {string} target.riskId - 風險ID
   * @param {boolean} [target.notifyMain=true] - 是否通知主表處理人
   * @param {number[]} [target.itemIndices=[]] - 要通知的子項次索引（risk.items 的 0-based）
   * @param {Object} [emailService=GmailNotificationService] - 寄信服務（依賴注入）
   * @returns {{notified: string[], skipped: string[]}}
   */
  function notifyRisk(target, emailService) {
    const service = emailService || GmailNotificationService;
    const riskId = target && target.riskId;
    if (!riskId) throw new Error('通知對象缺少風險ID。');

    const risk = RiskService.getRisk(riskId);
    if (!risk) throw new Error('找不到此風險ID：' + riskId);
    if (risk['當前狀態'] === CONFIG.CLOSED_STATUS) throw new Error('此風險已結案，無需通知。');

    const contexts = buildRecipientContexts_(risk, target);
    const appUrl = getAppDeepLink_(riskId);
    return dispatch_(risk, contexts, service, appUrl);
  }

  /**
   * 批次通知多筆風險的指定收件人。
   * @param {Array<Object>} targets - 收件人描述陣列（格式見 notifyRisk）
   * @param {Object} [emailService]
   * @returns {Array<Object>} 每筆 { riskId, result }
   */
  function notifyRisks(targets, emailService) {
    return (targets || []).map((target) => ({
      riskId: target.riskId,
      result: notifyRisk(target, emailService),
    }));
  }

  // ── 內部輔助 ──

  /**
   * 依 target 精準建立「每位收件人的處理脈絡」。
   *
   * 回傳以姓名為鍵的物件：{ [name]: { isMain, items } }，讓每位收件人只收到
   * 與自己相關的內容（主表身分 + 自己被指派的項次），避免群發同一封含雜訊的信。
   *
   * notifyMain 為真 → 納入主表處理人並標記 isMain；itemIndices 逐一把對應項次
   * 掛到該項次每位處理人的 items 陣列。預設行為（未指定）等同「僅主負責人」。
   *
   * @returns {Object<string, {isMain: boolean, items: Array<Object>}>}
   */
  function buildRecipientContexts_(risk, target) {
    const contexts = {};
    const ensure = (name) => (contexts[name] || (contexts[name] = { isMain: false, items: [] }));

    if (target.notifyMain !== false) {
      splitNames_(risk['處理人']).forEach((n) => { ensure(n).isMain = true; });
    }

    const items = risk.items || [];
    (target.itemIndices || []).forEach((idx) => {
      const item = items[idx];
      if (!item) return;
      splitNames_(item['處理人']).forEach((n) => ensure(n).items.push(item));
    });
    return contexts;
  }

  /**
   * 將姓名解析為 email 後寄信；查無 email 者記入 skipped。
   *
   * 採「內容簽章分組」：信件內容完全相同的收件人（例如同一項次的多位處理人、
   * 或多位主處理人）合併為一封 BCC 寄出，減少寄信呼叫次數，又不犧牲個人化
   * （不同內容者仍各自分組）。單一收件人時等同一般個別寄送。
   */
  function dispatch_(risk, contexts, service, appUrl) {
    const notified = [];
    const skipped = [];

    // signature -> { context, recipients: [{name, email}] }
    const groups = {};
    Object.keys(contexts).forEach((name) => {
      const email = HrService.findEmailByName(name);
      if (!email) {
        skipped.push(name);
        return;
      }
      const context = contexts[name];
      const sig = contentSignature_(context);
      (groups[sig] || (groups[sig] = { context: context, recipients: [] }))
        .recipients.push({ name: name, email: email });
    });

    Object.keys(groups).forEach((sig) => {
      const group = groups[sig];
      const names = group.recipients.map((r) => r.name);
      const emails = group.recipients.map((r) => r.email);
      const body = buildHtmlBody_(risk, names.join(CONFIG.PEOPLE_DELIMITER), group.context, appUrl);
      service.send(emails, buildSubject_(risk), body);
      group.recipients.forEach((r) => notified.push(r.name + ' <' + r.email + '>'));
    });

    return { notified, skipped };
  }

  /**
   * 內容簽章：信件內容由「是否主處理人 + 負責的項次集合」決定，故以此為鍵。
   * 同一風險內項次序號唯一，故項次序號集合即可代表項次內容，無需比對整列。
   */
  function contentSignature_(context) {
    const itemSeqs = (context.items || []).map((it) => String(it['項次'])).sort();
    return JSON.stringify({ isMain: !!context.isMain, items: itemSeqs });
  }

  /**
   * 取得「直接開啟此風險」的 Web App 深連結。
   *
   * 以 ScriptApp.getService().getUrl()（已宣告 script.scriptapp scope）取得 /exec
   * 網址，附上 ?riskId= 讓前端載入後自動彈出該風險詳情。在編輯器直接執行或尚未
   * 部署時 getUrl() 可能回傳空值，此時回傳空字串，由信件文案降級為純文字指引。
   */
  function getAppDeepLink_(riskId) {
    try {
      const base = ScriptApp.getService().getUrl();
      if (!base) return '';
      return base + '?riskId=' + encodeURIComponent(riskId);
    } catch (e) {
      return '';
    }
  }

  function buildSubject_(risk) {
    return '【高風險追蹤】待處理風險通知：' + risk['風險標題'];
  }

  /**
   * 組信件內容。除了說明「為什麼收到信」，再加上「要處理的風險內容」與
   * 「處理完該怎麼做」，讓收件人不必登入系統就能掌握全貌與下一步。
   *
   * @param {Object} context - 此收件人的脈絡 { isMain, items }
   * @param {string} appUrl - 直達該風險的深連結（可能為空字串）
   */
  function buildHtmlBody_(risk, recipientName, context, appUrl) {
    const due = risk['預計完成日'] || '（未設定）';
    const parts = [
      '<div style="font-family:\'Noto Sans TC\',sans-serif;color:#17211d;line-height:1.7;max-width:640px;">',
      '<p>' + escapeHtml_(recipientName) + ' 您好，</p>',
      '<p>您被指派處理下列尚未結案的風險，請參閱以下內容，於期限前完成處理並更新狀態：</p>',

      // ── 風險主資訊 ──
      '<table style="border-collapse:collapse;margin:12px 0;width:100%;">',
      row_('風險ID', risk['風險ID']),
      row_('風險標題', risk['風險標題']),
      row_('風險等級', risk['風險等級']),
      row_('當前狀態', risk['當前狀態']),
      row_('風險描述', risk['風險描述']),
      row_('處理方式', risk['處理方式']),
      row_('預計完成日', due),
      '</table>',
    ];

    // ── 您負責的項次（僅在有指派項次時呈現）──
    if (context && context.items && context.items.length > 0) {
      parts.push(buildItemsSection_(context.items));
    }

    // ── 如何完成處理 ──
    parts.push(buildHowToSection_(appUrl));

    parts.push('<p style="color:#5f6d66;font-size:13px;margin-top:16px;">此信由「風險追蹤管理」自動發送，請勿直接回覆。</p>');
    parts.push('</div>');
    return parts.join('');
  }

  /**
   * 「您負責的項次」區塊：逐項列出矯正缺失單內容（欄位對齊 CONFIG.SUB_HEADERS）。
   */
  function buildItemsSection_(items) {
    const cards = items.map((item) => [
      '<div style="border:1px solid #e3e9e4;border-radius:8px;padding:10px 14px;margin:8px 0;background:#fbfdfb;">',
      '<div style="font-weight:700;color:#1f6b4f;margin-bottom:6px;">項次 ' + escapeHtml_(String(item['項次'] || '')) + '</div>',
      '<table style="border-collapse:collapse;width:100%;">',
      row_('建議改善事項', item['建議改善事項']),
      row_('發生原因', item['發生原因']),
      row_('改善措施', item['改善措施']),
      row_('預定完成時間', item['預定完成時間']),
      row_('執行進度', item['執行進度']),
      '</table>',
      '</div>',
    ].join('')).join('');

    return (
      '<p style="font-weight:700;color:#17211d;margin:16px 0 4px;">您負責的項次</p>' + cards
    );
  }

  /**
   * 「如何完成處理」區塊：有深連結時提供一鍵直達按鈕，否則退化為純文字指引。
   */
  function buildHowToSection_(appUrl) {
    const steps =
      '<ol style="margin:6px 0;padding-left:20px;color:#3a463f;">' +
      '<li>進入此風險的詳情頁面（下方按鈕可直接開啟）。</li>' +
      '<li>於「更新狀態 / 上傳佐證」區塊上傳處理佐證檔案。</li>' +
      '<li>將「當前狀態」改為「' + escapeHtml_(CONFIG.CLOSED_STATUS) + '」後按「儲存變更」。</li>' +
      '</ol>';

    const action = appUrl
      ? '<p style="margin:12px 0;"><a href="' + escapeHtml_(appUrl) + '" ' +
        'style="display:inline-block;background:#1f6b4f;color:#ffffff;text-decoration:none;' +
        'padding:10px 20px;border-radius:8px;font-weight:700;">前往處理此風險</a></p>'
      : '<p style="margin:12px 0;color:#5f6d66;">請開啟「高風險追蹤系統」，' +
        '於風險清單以上方「風險ID」搜尋並點開該風險後依上述步驟處理。</p>';

    return (
      '<p style="font-weight:700;color:#17211d;margin:16px 0 4px;">如何完成處理</p>' + steps + action
    );
  }

  function row_(label, value) {
    return (
      '<tr>' +
      '<td style="padding:4px 12px;background:#f6f8f5;color:#5f6d66;white-space:nowrap;vertical-align:top;">' + escapeHtml_(label) + '</td>' +
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
