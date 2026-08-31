/**
 * AiImportService.gs — AI 自動匯入（PDF → 風險項目，串接 Gemini API）
 *
 * 上傳的 PDF 經「後端單一入口」送至 Gemini，要求回傳結構化 JSON，解析為
 * 「風險 + 矯正項次」供前端預覽；管理者確認（可修改/移除）後才寫入資料庫。
 *
 * 安全與架構原則（詳見 gas-ai-debug 技能）：
 *   - API 呼叫只在後端：前端永不接觸 API Key，也不直接打 Gemini endpoint
 *   - 需要 appsscript.json 的 script.external_request scope，否則 UrlFetchApp 會被擋
 *   - model 與 endpoint 必須對齊（AI Studio v1beta :generateContent），避免 HTTP 404
 */

const AiImportService = (function () {
  // AI Studio（Google AI Studio）的 generateContent endpoint 前綴
  const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const MAX_PDF_BYTES = 10 * 1024 * 1024; // 與前端一致的 10MB 上限（後端再守一次）

  /**
   * 步驟 1：解析 PDF，回傳預覽用的結構化風險陣列（尚未寫入）。
   * @param {Object} payload - { base64, mimeType?, source? }
   * @returns {{risks: Array<Object>, model: string}}
   */
  function parsePdfWithAi(payload) {
    if (!payload || !payload.base64) throw new Error('未收到檔案內容。');
    assertSizeWithinLimit_(payload.base64);

    const apiKey = SettingsService.getGeminiApiKey(); // 未設定時拋出明確錯誤
    const model = SettingsService.getGeminiModel();
    const prompt = buildPrompt_(payload.source);

    const response = callGeminiApi_(apiKey, model, payload.base64, payload.mimeType || 'application/pdf', prompt);
    const risks = parseGeminiResponse_(response);
    if (risks.length === 0) throw new Error('未偵測到風險資料，請確認文件內容或改用其他文件。');

    // 使用者若在前端指定了發現來源，補進 AI 未判斷出來源的筆數
    if (payload.source) {
      risks.forEach((risk) => { if (!risk['發現來源']) risk['發現來源'] = payload.source; });
    }
    return { risks: risks, model: model };
  }

  /**
   * 步驟 2：寫入前端確認後的風險陣列（逐筆建立主風險與其矯正項次）。
   * @param {Array<Object>} risks - 預覽中（可能經使用者編輯）的風險清單
   * @returns {{importedRisks:number, importedItems:number, failed:Array<{風險標題:string, error:string}>}}
   */
  function confirmAndImport(risks) {
    if (!Array.isArray(risks) || risks.length === 0) throw new Error('沒有可匯入的風險資料。');

    let importedRisks = 0;
    let importedItems = 0;
    const failed = []; // 收集個別失敗者，供前端回報「已成功 N 筆、Y 筆失敗」

    risks.forEach((entry) => {
      const risk = normalizeRisk_(entry);
      if (!risk['風險標題']) { failed.push({ 風險標題: '', error: '缺少風險標題，已略過。' }); return; }

      // 單筆獨立 try/catch：GAS/Sheets 無交易機制，前面已寫入者不可回滾；隔離後才能
      // 精確回報部分成功，避免使用者誤判整批失敗而重送、造成同批風險重複寫入。
      try {
        // 主表先寫入；items 不走 createRisk 的子表路徑（該路徑受來源 schema 守衛限制），
        // 改由 CorrectiveService.importItems 無條件補寫，避免無子表來源（如弱掃）項次遺失。
        const created = RiskService.createRisk({
          發現來源: risk['發現來源'] || CONFIG.OPTIONS.SOURCES[0],
          風險標題: risk['風險標題'],
          風險描述: risk['風險描述'] || '',
          風險等級: risk['風險等級'] || '',
          處理方式: risk['處理方式'] || '',
          當前狀態: risk['當前狀態'] || CONFIG.OPTIONS.STATUSES[0],
          處理人: risk['處理人'] || '',
          預計完成日: risk['預計完成日'] || '',
        });
        importedRisks++;

        const items = Array.isArray(risk.items) ? risk.items : [];
        if (items.length) {
          importedItems += CorrectiveService.importItems(created['風險ID'], items);
          RiskService.refreshAutoStatus(created['風險ID']); // 依項次完成情形推導主狀態
        }
      } catch (e) {
        failed.push({ 風險標題: risk['風險標題'], error: (e && e.message) || String(e) });
      }
    });

    return { importedRisks: importedRisks, importedItems: importedItems, failed: failed };
  }

  /**
   * 測試 Gemini API 連線（管理者設定頁用）。
   * @param {string|null} apiKey - 前端輸入的新 Key；null 表示使用已儲存的 Key
   * @param {string} [model]
   * @returns {{ok: boolean, model: string}}
   */
  function testConnection(apiKey, model) {
    const key = (apiKey && String(apiKey).trim()) || SettingsService.getGeminiApiKey();
    const useModel = (model && String(model).trim()) || SettingsService.getGeminiModel();

    const url = GEMINI_ENDPOINT + encodeURIComponent(useModel) + ':generateContent?key=' + encodeURIComponent(key);
    const body = {
      contents: [{ parts: [{ text: '回覆 OK' }] }],
      // 給足額度：gemini-2.5 系列的 thinking tokens 與輸出共用此上限，設太小（如 10）
      // 會被 thinking 吃光 → HTTP 200 卻無文字，造成「假成功」誤判。
      generationConfig: { maxOutputTokens: 512 },
    };
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('連線失敗：' + extractApiError_(resp));
    }
    // HTTP 200 不等於模型真的回了內容；若仍無 text（例如 thinking 耗盡額度），
    // 不應誤報成功，否則管理者會誤判 Key/Model 正常，之後正式解析才失敗。
    const parsed = JSON.parse(resp.getContentText());
    if (!extractText_(parsed)) {
      const reason = finishReasonOf_(parsed);
      throw new Error('連線可達，但模型未回傳內容' + (reason ? '（' + reason + '）' : '') + '——請改用其他模型或稍後再試。');
    }
    return { ok: true, model: useModel };
  }

  // ── 內部輔助 ──

  /**
   * 後端單一 AI 入口：把 PDF（inlineData）與 prompt 一起送至 Gemini。
   * 強制 JSON 輸出、低溫度以穩定結果。非 200 時拋出可操作的錯誤訊息。
   */
  function callGeminiApi_(apiKey, model, base64, mimeType, prompt) {
    const url = GEMINI_ENDPOINT + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType: mimeType, data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json', // 強制 JSON 輸出
        temperature: 0.1,                     // 低溫度，穩定輸出
        maxOutputTokens: 8192,                // 給足輸出額度（含 thinking），避免多筆風險被截斷
      },
    };
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code !== 200) {
      // 常見對照：404→model 名稱／endpoint 錯；401/403→Key 無效或權限；429→配額用罄
      throw new Error('Gemini API 錯誤（HTTP ' + code + '）：' + extractApiError_(resp));
    }
    return JSON.parse(resp.getContentText());
  }

  /**
   * 結構化 Prompt：列出系統合法選項，要求嚴格 JSON，禁止幻覺。
   * @param {string} [sourceHint] - 前端指定的發現來源（可空，空則由 AI 判斷）
   */
  function buildPrompt_(sourceHint) {
    const o = CONFIG.OPTIONS;
    const sourceLine = sourceHint
      ? '所有風險的「發現來源」一律填：「' + sourceHint + '」。'
      : '「發現來源」請從合法清單擇一最貼近者；無法判斷時填空字串。';

    return [
      '你是資安風險管理助理。請閱讀附件 PDF，擷取其中所有資安風險與對應的矯正缺失項次，',
      '並「嚴格」回傳 JSON 陣列（不得有任何說明文字、不得包 markdown 反引號）。',
      '',
      'JSON 為陣列，每個元素代表一筆風險，結構如下：',
      '{',
      '  "風險標題": "字串",',
      '  "風險描述": "字串",',
      '  "發現來源": "字串",',
      '  "風險等級": "字串（須為合法選項之一）",',
      '  "處理方式": "字串（須為合法選項之一）",',
      '  "預計完成日": "yyyy-MM-dd 或空字串",',
      '  "items": [',
      '    { "建議改善事項": "字串", "發生原因": "字串", "改善措施": "字串", "預定完成時間": "yyyy-MM-dd 或空字串", "執行進度": "字串" }',
      '  ]',
      '}',
      '',
      sourceLine,
      '「合法發現來源」：' + o.SOURCES.join('、'),
      '「合法風險等級」：' + o.LEVELS.join('、'),
      '「合法處理方式」：' + o.TREATMENTS.join('、'),
      '',
      '規則：',
      '1. 風險等級、處理方式必須完全等於上列合法選項字串（含括號與英文）；無法判斷時填空字串，不要自創。',
      '2. 無法從文件辨識的欄位一律填空字串，禁止憑空捏造或臆測數值與日期。',
      '3. 「處理人」一律不要填寫（由人工指派），請勿放入 JSON。',
      '4. 一份報告可能含多筆風險；若整份報告屬同一風險的多個缺失，請放在同一筆的 items 內。',
      '5. 只輸出 JSON 陣列本身，第一個非空白字元必須是 [。',
    ].join('\n');
  }

  /**
   * 解析 Gemini 回應為正規化風險陣列。
   * 取 candidates[0].content.parts[0].text（JSON 字串）→ 容錯解析 → 正規化。
   */
  function parseGeminiResponse_(response) {
    const candidate = response && response.candidates && response.candidates[0];
    const text = extractText_(response);

    if (!text) {
      const reason = finishReasonOf_(response);
      throw new Error('AI 未回傳可用內容' + (reason ? '（' + reason + '）' : '') + '。可能文件無法辨識或觸發內容限制。');
    }
    // text 存在但 finishReason 為 MAX_TOKENS 時，內容極可能是被截斷的不完整 JSON：
    // 直接解析只會落入籠統的「無法解析」訊息，先給出可操作的精確提示。
    if (candidate && candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('AI 回應因長度限制被截斷，請縮減文件內容、分批匯入，或提高輸出上限後再試。');
    }

    const parsed = safeParseJson_(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.risks) ? parsed.risks : [parsed]);
    return arr.filter((x) => x && typeof x === 'object').map(normalizeRisk_);
  }

  /** 從 Gemini 回應安全取出第一個候選的文字（缺失時回空字串）。 */
  function extractText_(response) {
    const candidate = response && response.candidates && response.candidates[0];
    return (candidate && candidate.content && candidate.content.parts &&
      candidate.content.parts[0] && candidate.content.parts[0].text) || '';
  }

  /** 取出 finishReason 或 promptFeedback.blockReason（缺失時回空字串），供診斷訊息使用。 */
  function finishReasonOf_(response) {
    const candidate = response && response.candidates && response.candidates[0];
    return (candidate && candidate.finishReason) ||
      (response && response.promptFeedback && response.promptFeedback.blockReason) || '';
  }

  /** 容錯解析：剝除可能的 markdown 反引號與前後雜訊後再 JSON.parse。 */
  function safeParseJson_(text) {
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(t); } catch (e) { /* 落到下方擷取邏輯 */ }

    // 退而求其次：擷取第一個 [ 或 { 到最後一個 ] 或 }
    const candidates = ['[', '{'].map((c) => t.indexOf(c)).filter((i) => i !== -1);
    const start = candidates.length ? Math.min.apply(null, candidates) : -1;
    const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
    if (start !== -1 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fallthrough */ }
    }
    throw new Error('AI 回傳內容無法解析為 JSON，請重試或更換模型。');
  }

  /**
   * 將 AI／前端送回的單筆資料正規化為統一的中文鍵風險物件。
   * 同時容忍兩種來源形狀：{ risk:{...}, items:[...] } 或扁平的風險物件。
   */
  function normalizeRisk_(entry) {
    const risk = (entry && entry.risk && typeof entry.risk === 'object') ? entry.risk : (entry || {});
    const rawItems = (entry && entry.items) || risk.items || [];
    return {
      發現來源: pick_(risk, ['發現來源', 'source']),
      風險標題: pick_(risk, ['風險標題', 'title']),
      風險描述: pick_(risk, ['風險描述', 'description']),
      風險等級: pick_(risk, ['風險等級', 'level']),
      處理方式: pick_(risk, ['處理方式', 'treatment']),
      當前狀態: pick_(risk, ['當前狀態', 'status']),
      預計完成日: pick_(risk, ['預計完成日', 'dueDate']),
      處理人: risk['處理人'] || risk.handlers || '',
      items: (Array.isArray(rawItems) ? rawItems : []).map(normalizeItem_),
    };
  }

  function normalizeItem_(it) {
    const item = it || {};
    return {
      建議改善事項: pick_(item, ['建議改善事項', 'suggestion']),
      發生原因: pick_(item, ['發生原因', 'cause']),
      改善措施: pick_(item, ['改善措施', 'action']),
      預定完成時間: pick_(item, ['預定完成時間', 'dueDate']),
      執行進度: pick_(item, ['執行進度', 'progress']),
    };
  }

  /** 依鍵名優先序取值並轉為去空白字串；都沒有時回傳空字串。 */
  function pick_(obj, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (v !== undefined && v !== null) return String(v).trim();
    }
    return '';
  }

  /** 後端再守一次大小上限：以 base64 長度估算原始位元組，避免明顯超限的請求白跑。 */
  function assertSizeWithinLimit_(base64) {
    const approxBytes = Math.floor(String(base64).length * 3 / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      throw new Error('檔案過大（約 ' + Math.round(approxBytes / 1024 / 1024) + 'MB），請壓縮在 10MB 以內。');
    }
  }

  /** 從 UrlFetchApp 回應擷取可讀的 API 錯誤訊息（容忍非 JSON 內容）。 */
  function extractApiError_(resp) {
    try {
      const err = JSON.parse(resp.getContentText());
      return (err && err.error && err.error.message) ? err.error.message : resp.getContentText();
    } catch (e) {
      return resp.getContentText() || '未知錯誤';
    }
  }

  return { parsePdfWithAi, confirmAndImport, testConnection };
})();
