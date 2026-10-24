(() => {
  const CONTENT_VERSION = '0.3.3';
  if (window.__hdvContentVersion === CONTENT_VERSION) return;
  try { window.__hdvTeardown?.(); } catch {}
  window.__hdvContentVersion = CONTENT_VERSION;
  window.__hdvContentInstalled = true;

  // Clean up any leftover shadow host from an older extension version
  for (const el of document.querySelectorAll('#hdv-autofill-host, #hdv-autofill-root')) {
    try { el.remove(); } catch {}
  }

  const WEBAUTHN_CHANNEL = 'hdv-webauthn-bridge-v1';
  const rootAborter = new AbortController();
  let shadowHost = null;
  let shadowRoot = null;
  let activeMenu = null;
  let activeBanner = null;
  let activeModal = null;
  let activeInput = null;
  let dismissedInputs = new WeakSet();
  let suppressFocusMenuUntil = 0;
  let autofillAborter = null;

  // Track user-typed credentials on this page for Auto-Save & multi-step login flows
  let lastTypedUsername = '';
  let lastTypedPassword = '';
  let lastPasswordTypedAt = 0;
  let lastAutosaveFinger = '';
  let armedConditional = null;

  function bindAction(btn, fn, instantOnDown = false) {
    if (!btn || typeof fn !== 'function') return;
    btn.__hdvAction = fn;
    btn.__hdvInstantDown = Boolean(instantOnDown);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.__hdvLastDownAt && Date.now() - btn.__hdvLastDownAt < 650) return;
      fn(e);
    });
  }

  function ensureShadowRoot() {
    if (shadowRoot && shadowHost && document.documentElement.contains(shadowHost)) {
      return shadowRoot;
    }
    for (const old of document.querySelectorAll('#hdv-autofill-host, #hdv-autofill-root')) {
      try { old.remove(); } catch {}
    }
    shadowHost = document.createElement('div');
    shadowHost.id = 'hdv-autofill-root';
    shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Atkinson Hyperlegible', 'Segoe UI', sans-serif; }
      .hdv-menu {
        position: fixed;
        min-width: 288px;
        max-width: 360px;
        background: #0a0d1a;
        color: #e8ecf7;
        border: 1px solid rgba(231, 198, 106, 0.45);
        border-radius: 10px;
        box-shadow: 0 14px 38px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(223, 230, 255, 0.08);
        padding: 6px;
        pointer-events: auto;
        z-index: 2147483647;
        font-size: 12.5px;
      }
      .hdv-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 6px 6px 8px;
        border-bottom: 1px solid rgba(223, 230, 255, 0.08);
        margin-bottom: 4px;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #e7c66a;
        font-weight: 700;
      }
      .hdv-head-right {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #9ca6c9;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9.5px;
        letter-spacing: 0.04em;
        text-transform: none;
      }
      .hdv-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        text-align: left;
        background: transparent;
        color: #e8ecf7;
        border: 1px solid transparent;
        border-radius: 7px;
        padding: 7px 9px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease;
      }
      .hdv-item:hover {
        background: rgba(223, 230, 255, 0.08);
        border-color: rgba(231, 198, 106, 0.38);
      }
      .hdv-item-main {
        min-width: 0;
        flex: 1;
      }
      .hdv-item-title {
        font-weight: 600;
        font-size: 12.5px;
        color: #e8ecf7;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hdv-item-sub {
        font-size: 11px;
        color: #9ca6c9;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hdv-pill-group {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .hdv-pill {
        font-size: 9.5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 2px 6px;
        border-radius: 5px;
        background: rgba(231, 198, 106, 0.14);
        color: #f4dc95;
        border: 1px solid rgba(231, 198, 106, 0.35);
        flex-shrink: 0;
      }
      .hdv-pill.ok {
        background: rgba(134, 227, 154, 0.14);
        color: #86e39a;
        border-color: rgba(134, 227, 154, 0.38);
      }
      .hdv-gen {
        margin-top: 4px;
        border-top: 1px solid rgba(223, 230, 255, 0.08);
        padding-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .hdv-gen-btn {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        background: rgba(231, 198, 106, 0.1);
        color: #f4dc95;
        border: 1px solid rgba(231, 198, 106, 0.35);
        border-radius: 7px;
        padding: 7px 9px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .hdv-gen-btn:hover {
        background: rgba(231, 198, 106, 0.18);
        border-color: #e7c66a;
      }
      .hdv-gen-opts {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        padding: 0 2px;
      }
      .hdv-gen-rule {
        font-size: 10px;
        color: #9ca6c9;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .hdv-opt-pills {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .hdv-opt-pill {
        background: rgba(223, 230, 255, 0.06);
        color: #9ca6c9;
        border: 1px solid rgba(223, 230, 255, 0.14);
        border-radius: 5px;
        padding: 2px 6px;
        font-size: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        cursor: pointer;
      }
      .hdv-opt-pill:hover {
        color: #e8ecf7;
        border-color: rgba(231, 198, 106, 0.4);
      }
      .hdv-opt-pill.active {
        background: rgba(231, 198, 106, 0.18);
        color: #f4dc95;
        border-color: rgba(231, 198, 106, 0.55);
        font-weight: 700;
      }
      .hdv-banner {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 356px;
        background: #0a0d1a;
        color: #e8ecf7;
        border: 1px solid rgba(231, 198, 106, 0.55);
        border-radius: 12px;
        padding: 14px 15px;
        box-shadow: 0 20px 55px rgba(0, 0, 0, 0.82), 0 0 0 1px rgba(223, 230, 255, 0.08);
        pointer-events: auto;
        z-index: 2147483647;
        animation: hdvSlideIn 160ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes hdvSlideIn {
        from { opacity: 0; transform: translateY(-8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .hdv-banner-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .hdv-eyebrow {
        font-size: 9.5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #e7c66a;
        font-weight: 700;
      }
      .hdv-close-x {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        min-height: 22px;
        background: rgba(223, 230, 255, 0.06);
        border: 1px solid rgba(223, 230, 255, 0.14);
        color: #dfe6ff;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
      }
      .hdv-close-x:hover {
        color: #ffffff;
        background: rgba(231, 198, 106, 0.22);
        border-color: #e7c66a;
      }
      .hdv-banner-title {
        margin: 0 0 4px;
        font-size: 14.5px;
        font-weight: 700;
        color: #e8ecf7;
      }
      .hdv-banner-sub {
        margin: 0 0 10px;
        font-size: 11.5px;
        color: #9ca6c9;
        line-height: 1.4;
      }
      .hdv-field-group {
        display: flex;
        flex-direction: column;
        gap: 7px;
        margin-bottom: 11px;
      }
      .hdv-field-row {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .hdv-field-label {
        font-size: 10px;
        font-weight: 600;
        color: #9ca6c9;
        letter-spacing: 0.03em;
      }
      .hdv-input-wrap {
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .hdv-input {
        width: 100%;
        background: #06070e;
        color: #e8ecf7;
        border: 1px solid rgba(223, 230, 255, 0.18);
        border-radius: 7px;
        padding: 6.5px 9px;
        font-size: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .hdv-input:focus {
        outline: none;
        border-color: #e7c66a;
      }
      .hdv-mini-btn {
        background: #13192e;
        color: #dfe6ff;
        border: 1px solid rgba(223, 230, 255, 0.18);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
      }
      .hdv-mini-btn:hover {
        border-color: #e7c66a;
        color: #ffffff;
      }
      .hdv-banner-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .hdv-modal {
        position: fixed;
        top: 18px;
        right: 18px;
        width: 348px;
        background: #0a0d1a;
        color: #e8ecf7;
        border: 1px solid rgba(231, 198, 106, 0.5);
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.78);
        pointer-events: auto;
        z-index: 2147483647;
      }
      .hdv-modal h3 {
        margin: 0 0 4px;
        font-size: 14px;
        color: #e8ecf7;
      }
      .hdv-modal p {
        margin: 0 0 10px;
        font-size: 12px;
        color: #9ca6c9;
        line-height: 1.45;
      }
      .hdv-modal-meta {
        background: #06070e;
        border: 1px solid rgba(223, 230, 255, 0.12);
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11.5px;
        color: #dfe6ff;
        word-break: break-all;
      }
      .hdv-chooser-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 190px;
        overflow-y: auto;
        margin-bottom: 10px;
      }
      .hdv-modal-actions {
        display: flex;
        gap: 7px;
        justify-content: flex-end;
      }
      .hdv-btn {
        background: #13192e;
        color: #e8ecf7;
        border: 1px solid rgba(223, 230, 255, 0.18);
        border-radius: 7px;
        padding: 6.5px 11px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .hdv-btn:hover {
        border-color: #e7c66a;
      }
      .hdv-btn.subtle {
        background: transparent;
        color: #9ca6c9;
        border-color: transparent;
        padding-left: 6px;
        padding-right: 6px;
      }
      .hdv-btn.subtle:hover {
        color: #e8ecf7;
        border-color: rgba(223, 230, 255, 0.18);
      }
      .hdv-btn.primary {
        background: #dfe6ff;
        color: #06070e;
        border-color: #dfe6ff;
        font-weight: 700;
      }
      .hdv-btn.primary:hover {
        background: #f4dc95;
        border-color: #e7c66a;
      }
      .hdv-toast-notice {
        position: fixed;
        bottom: 18px;
        right: 18px;
        background: #0a0d1a;
        color: #f4dc95;
        border: 1px solid rgba(231, 198, 106, 0.5);
        border-radius: 9px;
        padding: 9px 13px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.72);
        pointer-events: auto;
        z-index: 2147483647;
      }
    `;
    shadowRoot.appendChild(style);
    document.documentElement.appendChild(shadowHost);
    return shadowRoot;
  }

  function showPageToast(text) {
    const root = ensureShadowRoot();
    const n = document.createElement('div');
    n.className = 'hdv-toast-notice';
    n.textContent = text;
    root.appendChild(n);
    setTimeout(() => n.remove(), 3600);
  }

  let menuOpenSeq = 0;

  function dismissFormInputs(anchor) {
    suppressFocusMenuUntil = Date.now() + 2500;
    if (anchor && typeof anchor === 'object') {
      try { dismissedInputs.add(anchor); } catch {}
    }
    try {
      const { usernameInput, passwordInput, newPasswordInput, otpInput, passInputs } = findFormInputs(anchor || activeInput);
      for (const el of [usernameInput, passwordInput, newPasswordInput, otpInput, ...(passInputs || [])]) {
        if (el) dismissedInputs.add(el);
      }
    } catch {}
  }

  function closeMenu(dismissCurrent = false) {
    menuOpenSeq++;
    if (dismissCurrent) {
      dismissFormInputs(activeInput);
    }
    if (autofillAborter) {
      autofillAborter.abort();
      autofillAborter = null;
    }
    if (activeMenu) {
      activeMenu.remove();
      activeMenu = null;
    }
    activeInput = null;
    // Also remove any orphaned/legacy hosts from older content script instances
    try {
      for (const el of document.querySelectorAll('#hdv-autofill-host, #hdv-autofill-root')) {
        if (el !== shadowHost) el.remove();
      }
      if (shadowRoot) {
        for (const el of shadowRoot.querySelectorAll('.hdv-menu, .card')) {
          el.remove();
        }
      }
    } catch {}
  }

  function closeBanner() {
    if (activeBanner) {
      activeBanner.remove();
      activeBanner = null;
    }
  }

  function closeModal() {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  }

  window.__hdvTeardown = () => {
    try { closeMenu(false); } catch {}
    try { closeBanner(); } catch {}
    try { closeModal(); } catch {}
    try { rootAborter.abort(); } catch {}
    try { shadowHost?.remove(); } catch {}
  };

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 12) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0.05;
  }

  function isTotpInput(el) {
    if (!el || el.tagName !== 'INPUT' || el.readOnly || el.disabled) return false;
    const type = (el.type || 'text').toLowerCase();
    if (!['text', 'tel', 'number', 'password'].includes(type)) return false;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac.includes('one-time-code')) return true;
    const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    return /\b(totp|otp|2fa|mfa|two[_\s-]*factor|authenticator|verification[_\s-]*code|security[_\s-]*code)\b/.test(hint);
  }

  function isUsernameLikeInput(el) {
    if (!el || el.tagName !== 'INPUT' || el.readOnly || el.disabled) return false;
    const type = (el.type || 'text').toLowerCase();
    if (!['text', 'email', 'tel', 'search'].includes(type)) return false;
    if (isTotpInput(el)) return false;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac.includes('username') || ac.includes('email') || ac.includes('webauthn')) return true;
    if (type === 'email') return true;
    const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    if (/\b(search|query|coupon|promo|zip|postal|city|state|address|first[_\s-]*name|last[_\s-]*name)\b/.test(hint)) return false;
    return /\b(user|username|login|email|account|identifier|handle|member|apple[_\s-]*id)\b/.test(hint);
  }

  const SITE_PASSWORD_RULES = [
    { match: /(^|\.)tiktok\.com$/i, length: 16, minLength: 8, maxLength: 20, symbols: true, allowedSymbols: '!@#$%^&*?_~-', ruleLabel: '8–20 chars (TikTok)' },
    { match: /(^|\.)paypal\.com$/i, length: 16, minLength: 8, maxLength: 20, symbols: true, allowedSymbols: '!@#$%^&*?_~-', ruleLabel: '8–20 chars (PayPal)' }
  ];

  function detectSitePasswordPolicy(targetInput) {
    const host = (window.location.hostname || '').toLowerCase();
    let minLength = 8;
    let maxLength = 128;
    let length = 20;
    let symbols = true;
    let allowedSymbols = '!@#$%^&*?_~-';
    let ruleLabel = '';

    for (const preset of SITE_PASSWORD_RULES) {
      if (preset.match.test(host)) {
        minLength = preset.minLength;
        maxLength = preset.maxLength;
        length = preset.length;
        symbols = preset.symbols;
        allowedSymbols = preset.allowedSymbols;
        ruleLabel = preset.ruleLabel;
        break;
      }
    }

    if (targetInput) {
      const rawMax = Number(targetInput.getAttribute('maxlength') || targetInput.maxLength);
      if (Number.isInteger(rawMax) && rawMax >= 8 && rawMax <= 64) {
        maxLength = Math.min(maxLength, rawMax);
        if (!ruleLabel) ruleLabel = `max ${maxLength} chars`;
      }
      const rawMin = Number(targetInput.getAttribute('minlength') || targetInput.minLength);
      if (Number.isInteger(rawMin) && rawMin >= 6 && rawMin <= 32) {
        minLength = Math.max(minLength, rawMin);
      }
      const scope = targetInput.closest('form, [role="dialog"], main, section') || targetInput.parentElement;
      if (scope && !ruleLabel) {
        const text = (scope.innerText || scope.textContent || '').slice(0, 2500);
        const rangeMatch = text.match(/\b(\d{1,2})\s*(?:to|[-–—~])\s*(\d{2,3})\s*characters?\b/i);
        if (rangeMatch) {
          const lo = Number(rangeMatch[1]);
          const hi = Number(rangeMatch[2]);
          if (lo >= 6 && hi >= 8 && hi <= 64 && lo <= hi) {
            minLength = lo;
            maxLength = hi;
            ruleLabel = `${lo}–${hi} chars`;
          }
        } else {
          const maxMatch = text.match(/\b(?:max(?:imum)?|up\s+to)\s*(?:of\s*)?(\d{2,3})\s*characters?\b/i);
          if (maxMatch) {
            const hi = Number(maxMatch[1]);
            if (hi >= 8 && hi <= 64) {
              maxLength = hi;
              ruleLabel = `max ${hi} chars`;
            }
          }
        }
      }
    }

    if (maxLength <= 20) {
      length = Math.max(minLength, Math.min(16, maxLength));
    } else if (!ruleLabel) {
      length = 20;
    } else {
      length = Math.max(minLength, Math.min(length, maxLength));
    }

    return { length, minLength, maxLength, symbols, allowedSymbols, ruleLabel };
  }

  function findFormInputs(anchor) {
    const scope = (anchor && anchor.closest('form, [role="dialog"], main, section, body')) || document;
    const allInputs = Array.from(scope.querySelectorAll('input')).filter(isVisible);
    const passInputs = allInputs.filter((i) => (i.type || '').toLowerCase() === 'password' && !i.disabled && !i.readOnly);
    const otpInput = (anchor && isTotpInput(anchor) ? anchor : null) || allInputs.find(isTotpInput) || null;
    const passwordInput = passInputs[0] || null;
    const newPasswordInput = passInputs.length > 1 ? passInputs[passInputs.length - 1] : passwordInput;

    let usernameInput = null;
    const candidates = allInputs.filter((i) => {
      const t = (i.type || 'text').toLowerCase();
      return ['text', 'email', 'tel'].includes(t) && !i.readOnly && !i.disabled && !isTotpInput(i);
    });

    if (passwordInput) {
      for (const c of candidates) {
        if (c.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING) {
          usernameInput = c;
        }
      }
      if (!usernameInput) {
        usernameInput = candidates.find(isUsernameLikeInput) || candidates[0] || null;
      }
    } else if (anchor && isUsernameLikeInput(anchor)) {
      usernameInput = anchor;
    } else {
      usernameInput = candidates.find(isUsernameLikeInput) || null;
    }

    return { usernameInput, passwordInput, newPasswordInput, passInputs, otpInput };
  }

  function setNativeValue(input, value) {
    if (!input || value === undefined || value === null) return;
    suppressFocusMenuUntil = Date.now() + 2000;
    dismissFormInputs(input);
    const prevValue = input.value;
    try { input.focus(); } catch {}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    const tracker = input._valueTracker;
    if (tracker && typeof tracker.setValue === 'function') {
      try { tracker.setValue(prevValue); } catch {}
    }
    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        data: value,
        inputType: 'insertReplacementText'
      }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function sendBg(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, payload }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res || !res.ok) {
          reject(new Error(res?.error || 'Vault error'));
          return;
        }
        resolve(res.result);
      });
    });
  }

  function harvestCurrentCredentials(scopeEl = null) {
    const { usernameInput, passwordInput, newPasswordInput } = findFormInputs(scopeEl || activeInput);
    const pwEl = newPasswordInput || passwordInput;
    const password = (pwEl && pwEl.value ? pwEl.value : '') || lastTypedPassword;
    const username = (usernameInput && usernameInput.value ? usernameInput.value.trim() : '') || lastTypedUsername;
    return { username, password };
  }

  async function maybeStageAutosave(scopeEl = null, showImmediately = true) {
    const { username, password } = harvestCurrentCredentials(scopeEl);
    if (username && !password) {
      sendBg('stage-username', { username }).catch(() => {});
      return;
    }
    if (!password || password.length < 3) return;
    if (Date.now() - lastPasswordTypedAt > 5 * 60 * 1000 && !scopeEl) return;

    const finger = `${window.location.hostname}:${username}:${password}`;
    if (finger === lastAutosaveFinger && activeBanner) return;
    lastAutosaveFinger = finger;

    try {
      const res = await sendBg('stage-autosave', {
        url: window.location.href,
        host: window.location.hostname,
        title: document.title || window.location.hostname,
        username,
        password
      });
      if (res && res.staged && res.pending && showImmediately) {
        setTimeout(() => {
          if (document.visibilityState === 'visible') {
            showAutoSaveBanner(res.pending);
          }
        }, 350);
      }
    } catch {}
  }

  function showAutoSaveBanner(pending) {
    if (!pending || !pending.password) return;
    closeBanner();
    const root = ensureShadowRoot();
    const banner = document.createElement('div');
    banner.className = 'hdv-banner';

    const top = document.createElement('div');
    top.className = 'hdv-banner-top';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'hdv-eyebrow';
    eyebrow.textContent = pending.mode === 'update'
      ? 'HIDDEN DOOR VAULT · UPDATE PASSWORD'
      : 'HIDDEN DOOR VAULT · SAVE LOGIN';
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'hdv-close-x';
    closeX.textContent = '×';
    closeX.title = 'Dismiss';
    bindAction(closeX, () => {
      closeBanner();
      sendBg('clear-pending-autosave', { host: pending.host }).catch(() => {});
    }, true);
    top.append(eyebrow, closeX);

    const h4 = document.createElement('div');
    h4.className = 'hdv-banner-title';
    h4.textContent = pending.mode === 'update'
      ? `Update password for ${pending.existingTitle || pending.host}?`
      : `Save login for ${pending.host}?`;

    const sub = document.createElement('p');
    sub.className = 'hdv-banner-sub';
    sub.textContent = pending.locked
      ? 'Your vault is currently locked. Clicking Save will prompt Touch ID and encrypt this login into your vault.'
      : (pending.mode === 'update'
        ? 'This account already exists in your vault with a different password.'
        : 'Encrypt and store this credential in Google Secret Manager.');

    const group = document.createElement('div');
    group.className = 'hdv-field-group';

    const titleRow = document.createElement('div');
    titleRow.className = 'hdv-field-row';
    const titleLbl = document.createElement('span');
    titleLbl.className = 'hdv-field-label';
    titleLbl.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.className = 'hdv-input';
    titleInput.type = 'text';
    titleInput.value = pending.existingTitle || pending.title || pending.host;
    titleRow.append(titleLbl, titleInput);

    const userRow = document.createElement('div');
    userRow.className = 'hdv-field-row';
    const userLbl = document.createElement('span');
    userLbl.className = 'hdv-field-label';
    userLbl.textContent = 'Username / email';
    const userInput = document.createElement('input');
    userInput.className = 'hdv-input';
    userInput.type = 'text';
    userInput.placeholder = 'username or email';
    userInput.value = pending.username || '';
    userRow.append(userLbl, userInput);

    const passRow = document.createElement('div');
    passRow.className = 'hdv-field-row';
    const passLbl = document.createElement('span');
    passLbl.className = 'hdv-field-label';
    passLbl.textContent = 'Password';
    const passWrap = document.createElement('div');
    passWrap.className = 'hdv-input-wrap';
    const passInput = document.createElement('input');
    passInput.className = 'hdv-input';
    passInput.type = 'password';
    passInput.value = pending.password || '';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'hdv-mini-btn';
    toggleBtn.textContent = 'Show';
    bindAction(toggleBtn, () => {
      const show = passInput.type === 'password';
      passInput.type = show ? 'text' : 'password';
      toggleBtn.textContent = show ? 'Hide' : 'Show';
    }, true);
    passWrap.append(passInput, toggleBtn);
    passRow.append(passLbl, passWrap);

    group.append(titleRow, userRow, passRow);

    const actions = document.createElement('div');
    actions.className = 'hdv-banner-actions';

    const neverBtn = document.createElement('button');
    neverBtn.type = 'button';
    neverBtn.className = 'hdv-btn subtle';
    neverBtn.textContent = 'Never for this site';
    bindAction(neverBtn, () => {
      closeBanner();
      sendBg('never-save-site', { host: pending.host }).catch(() => {});
      showPageToast(`Won't offer to save logins on ${pending.host}.`);
    }, true);

    const rightBtns = document.createElement('div');
    rightBtns.style.cssText = 'display:flex;gap:6px;align-items:center;';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'hdv-btn';
    dismissBtn.textContent = 'Not now';
    bindAction(dismissBtn, () => {
      closeBanner();
      sendBg('clear-pending-autosave', { host: pending.host }).catch(() => {});
    }, true);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'hdv-btn primary';
    saveBtn.textContent = pending.mode === 'update' ? 'Update password' : 'Save to Vault';
    bindAction(saveBtn, async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const saved = await sendBg('save-login', {
          url: pending.url || window.location.href,
          host: pending.host || window.location.hostname,
          title: titleInput.value.trim() || pending.host,
          username: userInput.value.trim(),
          password: passInput.value,
          overwriteId: pending.existingId || undefined,
          updateExisting: pending.mode === 'update'
        });
        closeBanner();
        showPageToast(saved.updated ? `Updated "${saved.title}" in Hidden Door Vault.` : `Saved "${saved.title}" to Hidden Door Vault.`);
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = pending.mode === 'update' ? 'Update password' : 'Save to Vault';
        showPageToast(err?.message || 'Could not save login.');
      }
    }, false);

    rightBtns.append(dismissBtn, saveBtn);
    actions.append(neverBtn, rightBtns);

    banner.append(top, h4, sub, group, actions);
    root.appendChild(banner);
    activeBanner = banner;
  }

  function positionMenu(menu, target) {
    if (!menu || !target || !target.isConnected) return;
    const rect = target.getBoundingClientRect();
    const menuHeight = menu.offsetHeight || 200;
    const menuWidth = menu.offsetWidth || 300;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight + 16 && rect.top > menuHeight + 16
      ? Math.max(8, rect.top - menuHeight - 6)
      : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6);
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  async function openAutofillMenu(targetInput, forceOpen = false) {
    if (!targetInput || !targetInput.isConnected) return;
    if (!forceOpen && dismissedInputs.has(targetInput)) return;

    const { usernameInput, passwordInput, otpInput } = findFormInputs(targetInput);
    const isPasswordFocus = (targetInput.type || '').toLowerCase() === 'password';
    const isOtpFocus = isTotpInput(targetInput);
    if (!usernameInput && !passwordInput && !isOtpFocus) return;

    // If the password field is already filled in, don't pop open the bottom menu over the Log in button
    if (!forceOpen && !isOtpFocus && passwordInput && passwordInput.value && passwordInput.value.length > 0) {
      return;
    }

    const mySeq = ++menuOpenSeq;
    let res;
    try {
      res = await sendBg('match-logins', { url: window.location.href, gracefulLocked: true });
    } catch {
      return;
    }
    if (mySeq !== menuOpenSeq) return;
    if (!forceOpen && dismissedInputs.has(targetInput)) return;

    const items = Array.isArray(res?.items) ? res.items : [];
    const isLocked = Boolean(res?.locked);
    if (!isLocked && items.length === 0 && !isPasswordFocus) return;

    closeMenu(false);
    activeInput = targetInput;
    const root = ensureShadowRoot();
    const menu = document.createElement('div');
    menu.className = 'hdv-menu';

    const head = document.createElement('div');
    head.className = 'hdv-head';
    const headLeft = document.createElement('span');
    headLeft.textContent = 'Hidden Door Vault';
    const headRight = document.createElement('div');
    headRight.className = 'hdv-head-right';
    const hostSpan = document.createElement('span');
    hostSpan.textContent = isLocked ? 'LOCKED' : (res.host || window.location.hostname);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'hdv-close-x';
    closeBtn.title = 'Close menu (Esc)';
    closeBtn.setAttribute('aria-label', 'Close autofill menu');
    closeBtn.textContent = '×';
    bindAction(closeBtn, () => {
      closeMenu(true);
    }, true);
    headRight.append(hostSpan, closeBtn);
    head.append(headLeft, headRight);
    menu.appendChild(head);

    if (isLocked) {
      const unlockBtn = document.createElement('button');
      unlockBtn.type = 'button';
      unlockBtn.className = 'hdv-gen-btn';
      unlockBtn.textContent = res.biometricEnabled
        ? 'Unlock with Touch ID to autofill'
        : 'Unlock Hidden Door Vault to autofill';
      bindAction(unlockBtn, async () => {
        unlockBtn.textContent = res.biometricEnabled ? 'Waiting for Touch ID…' : 'Waiting for Hidden Door Vault…';
        try {
          await sendBg('unlock-biometric', {});
          dismissedInputs = new WeakSet();
          suppressFocusMenuUntil = 0;
          await openAutofillMenu(targetInput, true);
        } catch (err) {
          unlockBtn.textContent = err?.message || 'Open desktop app to unlock';
        }
      }, true);
      menu.appendChild(unlockBtn);
    }

    for (const item of items.slice(0, 6)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'hdv-item';

      const main = document.createElement('div');
      main.className = 'hdv-item-main';
      const title = document.createElement('div');
      title.className = 'hdv-item-title';
      title.textContent = item.title;
      const sub = document.createElement('div');
      sub.className = 'hdv-item-sub';
      sub.textContent = item.username || item.url || 'Saved login';
      main.append(title, sub);

      const pills = document.createElement('div');
      pills.className = 'hdv-pill-group';
      if (item.hasPasskey) {
        const pkPill = document.createElement('span');
        pkPill.className = 'hdv-pill ok';
        pkPill.textContent = 'PASSKEY';
        pills.appendChild(pkPill);
      }
      if (item.hasTotp) {
        const totpPill = document.createElement('span');
        totpPill.className = 'hdv-pill';
        totpPill.textContent = isOtpFocus ? 'FILL 2FA' : '2FA';
        pills.appendChild(totpPill);
      }
      if (!item.hasPasskey && !item.hasTotp) {
        const fillPill = document.createElement('span');
        fillPill.className = 'hdv-pill';
        fillPill.textContent = 'FILL';
        pills.appendChild(fillPill);
      }

      row.append(main, pills);
      bindAction(row, async () => {
        closeMenu(true);
        try {
          if (armedConditional && item.hasPasskey && !item.hasPassword && !isOtpFocus) {
            const cond = armedConditional;
            armedConditional = null;
            const assertion = await sendBg('passkey-get', {
              itemId: item.id,
              credentialId: item.passkeyId,
              rpId: cond.rpId,
              challenge: cond.challenge,
              allowCredentialIds: cond.allowCredentialIds,
              skipConfirm: true
            });
            cond.resolve(assertion);
            return;
          }

          const secret = await sendBg('autofill-get', { id: item.id, url: window.location.href });
          if (isOtpFocus && secret.totp) {
            setNativeValue(targetInput, secret.totp);
          } else {
            if (usernameInput && secret.username) {
              setNativeValue(usernameInput, secret.username);
              lastTypedUsername = secret.username;
              sendBg('stage-username', { username: secret.username }).catch(() => {});
            }
            if (passwordInput && secret.password) {
              setNativeValue(passwordInput, secret.password);
              lastTypedPassword = secret.password;
            }
            if (otpInput && secret.totp) {
              setNativeValue(otpInput, secret.totp);
            } else if (secret.totp) {
              try { await navigator.clipboard.writeText(secret.totp); showPageToast(`Copied 2FA code (${secret.totp}) to clipboard.`); } catch {}
            }
          }
        } catch {}
      }, true);
      menu.appendChild(row);
    }

    if (isPasswordFocus) {
      const policy = detectSitePasswordPolicy(targetInput);
      let selectedLength = policy.length;
      let useSymbols = policy.symbols;

      const genWrap = document.createElement('div');
      genWrap.className = 'hdv-gen';

      const optsRow = document.createElement('div');
      optsRow.className = 'hdv-gen-opts';
      const ruleText = document.createElement('span');
      ruleText.className = 'hdv-gen-rule';
      ruleText.textContent = policy.ruleLabel ? `Rule: ${policy.ruleLabel}` : 'Password length';

      const optPills = document.createElement('div');
      optPills.className = 'hdv-opt-pills';

      const genBtn = document.createElement('button');
      genBtn.type = 'button';
      genBtn.className = 'hdv-gen-btn';
      const s1 = document.createElement('span');
      s1.textContent = '✦ Generate & save strong password';
      const s2 = document.createElement('span');
      s2.textContent = `${selectedLength} chars`;
      genBtn.append(s1, s2);

      const candidateLengths = Array.from(new Set([12, 16, 20, 32, selectedLength]))
        .filter((n) => n >= policy.minLength && n <= policy.maxLength)
        .sort((a, b) => a - b);

      const lengthButtons = [];
      for (const len of candidateLengths) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `hdv-opt-pill${len === selectedLength ? ' active' : ''}`;
        pill.textContent = String(len);
        pill.title = `Generate ${len}-character password`;
        bindAction(pill, () => {
          selectedLength = len;
          s2.textContent = `${selectedLength} chars`;
          for (const b of lengthButtons) b.classList.toggle('active', b === pill);
        }, true);
        lengthButtons.push(pill);
        optPills.appendChild(pill);
      }

      const symPill = document.createElement('button');
      symPill.type = 'button';
      symPill.className = `hdv-opt-pill${useSymbols ? ' active' : ''}`;
      symPill.textContent = '!@#';
      symPill.title = 'Include special characters (!@#$%^&*?_~-)';
      bindAction(symPill, () => {
        useSymbols = !useSymbols;
        symPill.classList.toggle('active', useSymbols);
      }, true);
      optPills.appendChild(symPill);

      optsRow.append(ruleText, optPills);

      bindAction(genBtn, async () => {
        closeMenu(true);
        try {
          const usernameVal = (usernameInput && usernameInput.value ? usernameInput.value.trim() : '') || lastTypedUsername;
          const created = await sendBg('autocreate-login', {
            url: window.location.href,
            title: document.title || window.location.hostname,
            username: usernameVal,
            length: selectedLength,
            symbols: useSymbols,
            allowedSymbols: policy.allowedSymbols,
            updateExisting: true
          });
          if (created && created.password) {
            const { passInputs } = findFormInputs(targetInput);
            for (const p of passInputs) setNativeValue(p, created.password);
            lastTypedPassword = created.password;
            lastAutosaveFinger = `${window.location.hostname}:${usernameVal}:${created.password}`;
            showPageToast(`Generated & saved ${created.password.length}-char password for ${window.location.hostname}.`);
          }
        } catch (err) {
          showPageToast(err?.message || 'Could not generate password.');
        }
      }, true);
      genWrap.append(genBtn, optsRow);
      menu.appendChild(genWrap);
    }

    root.appendChild(menu);
    activeMenu = menu;
    positionMenu(menu, targetInput);

    autofillAborter = new AbortController();
    const sig = autofillAborter.signal;
    window.addEventListener('scroll', () => positionMenu(activeMenu, activeInput), { passive: true, capture: true, signal: sig });
    window.addEventListener('resize', () => positionMenu(activeMenu, activeInput), { passive: true, signal: sig });
  }

  function isEventInsideHost(event) {
    if (!shadowHost) return false;
    if (event.target === shadowHost) return true;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(shadowHost) || (shadowRoot ? path.includes(shadowRoot) : false);
  }

  function findShadowActionTarget(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      if (node && typeof node.__hdvAction === 'function') {
        return node;
      }
    }
    return null;
  }

  // Register on window in capture phase at document_start so page/modal scripts
  // (e.g. TikTok login dialog focus-trap / outside-click handlers) never intercept our UI clicks.
  const rootSignal = rootAborter.signal;

  for (const evtName of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    window.addEventListener(evtName, (event) => {
      if (isEventInsideHost(event)) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const innerTarget = path[0];
        const isEditable = innerTarget && (innerTarget.tagName === 'INPUT' || innerTarget.tagName === 'SELECT' || innerTarget.tagName === 'TEXTAREA');
        if (!isEditable && (evtName === 'pointerdown' || evtName === 'mousedown')) {
          event.preventDefault();
        }
        const actionBtn = findShadowActionTarget(event);
        if (actionBtn) {
          if (evtName === 'pointerdown' && actionBtn.__hdvInstantDown) {
            event.preventDefault();
            actionBtn.__hdvAction(event);
          } else if (evtName === 'click') {
            event.preventDefault();
            actionBtn.__hdvAction(event);
          }
        }
        return;
      }

      if (evtName === 'pointerdown') {
        const t = event.target;
        if (activeMenu && t !== activeInput) {
          closeMenu(false);
        }
        if (!activeMenu && t && t.tagName === 'INPUT' && dismissedInputs.has(t)) {
          // User explicitly clicked an already-dismissed empty input to re-open
          const { passwordInput } = findFormInputs(t);
          const pwFilled = passwordInput && passwordInput.value && passwordInput.value.length > 0;
          if (!pwFilled) {
            dismissedInputs.delete(t);
            suppressFocusMenuUntil = 0;
            openAutofillMenu(t, true);
          }
        }
      }

      if (evtName === 'click') {
        const t = event.target;
        if (activeMenu && t !== activeInput) {
          closeMenu(false);
        }
        if (t instanceof Element) {
          const btn = t.closest('button, input[type="submit"], [role="button"]');
          if (btn) {
            const bType = (btn.getAttribute('type') || '').toLowerCase();
            const label = `${btn.textContent || ''} ${btn.getAttribute('value') || ''} ${btn.getAttribute('aria-label') || ''}`.trim();
            if (bType === 'submit' || /\b(sign\s*in|log\s*in|sign\s*up|register|create\s*account|continue|next|save|update\s*password|change\s*password|submit)\b/i.test(label)) {
              closeMenu(true);
              maybeStageAutosave(btn, true);
            }
          }
        }
      }
    }, { capture: true, signal: rootSignal });
  }

  window.addEventListener('focusin', (event) => {
    if (isEventInsideHost(event)) return;
    const t = event.target;
    if (!t || t.tagName !== 'INPUT' || t.readOnly || t.disabled) return;
    if (Date.now() < suppressFocusMenuUntil || dismissedInputs.has(t)) return;
    if (activeMenu && activeInput === t) return;
    const type = (t.type || 'text').toLowerCase();
    if (type === 'password' || isTotpInput(t) || isUsernameLikeInput(t)) {
      openAutofillMenu(t);
      return;
    }
    const { usernameInput } = findFormInputs(t);
    if (t === usernameInput) openAutofillMenu(t);
  }, { capture: true, signal: rootSignal });

  window.addEventListener('input', (event) => {
    if (isEventInsideHost(event)) return;
    const t = event.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (activeMenu && event.isTrusted) {
      closeMenu(true);
    }
    const type = (t.type || 'text').toLowerCase();
    if (type === 'password') {
      if (t.value) {
        lastTypedPassword = t.value;
        lastPasswordTypedAt = Date.now();
      }
      const { usernameInput } = findFormInputs(t);
      if (usernameInput && usernameInput.value.trim()) {
        lastTypedUsername = usernameInput.value.trim();
      }
    } else if (isUsernameLikeInput(t)) {
      if (t.value.trim()) {
        lastTypedUsername = t.value.trim();
      }
    }
  }, { capture: true, signal: rootSignal });

  // Detect form submissions for Auto-Save
  window.addEventListener('submit', (event) => {
    const form = event.target;
    if (form instanceof HTMLElement) {
      closeMenu(true);
      maybeStageAutosave(form, true);
    }
  }, { capture: true, signal: rootSignal });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activeMenu) {
        closeMenu(true);
      }
      return;
    }
    if (isEventInsideHost(event)) return;
    const t = event.target;
    if (t && t.tagName === 'INPUT') {
      if (event.key === 'Enter') {
        const type = (t.type || 'text').toLowerCase();
        if (type === 'password' || isUsernameLikeInput(t)) {
          closeMenu(true);
          maybeStageAutosave(t, true);
        }
        return;
      }
      // Dismiss popover as soon as the user starts typing characters into the input
      if (activeMenu && typeof event.key === 'string' && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        closeMenu(true);
      }
    }
  }, { capture: true, signal: rootSignal });

  window.addEventListener('pagehide', () => {
    if (lastTypedPassword && Date.now() - lastPasswordTypedAt < 60000) {
      maybeStageAutosave(null, false);
    }
  }, { signal: rootSignal });

  async function checkPendingAutosaveOnLoad() {
    try {
      const stagedUser = await sendBg('get-staged-username', { host: window.location.hostname });
      if (stagedUser?.username && !lastTypedUsername) {
        lastTypedUsername = stagedUser.username;
      }
      const res = await sendBg('get-pending-autosave', { host: window.location.hostname });
      if (res && res.pending && res.pending.password) {
        showAutoSaveBanner(res.pending);
      }
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingAutosaveOnLoad, { once: true, signal: rootSignal });
  } else {
    setTimeout(checkPendingAutosaveOnLoad, 150);
  }

  function showPasskeyModal({ title, description, metaLines, candidates, confirmLabel, fallbackLabel }) {
    return new Promise((resolve) => {
      closeModal();
      const root = ensureShadowRoot();
      const modal = document.createElement('div');
      modal.className = 'hdv-modal';

      const eyebrow = document.createElement('div');
      eyebrow.className = 'hdv-eyebrow';
      eyebrow.style.marginBottom = '4px';
      eyebrow.textContent = 'THE HIDDEN DOOR · PASSKEY';

      const h3 = document.createElement('h3');
      h3.textContent = title;
      const p = document.createElement('p');
      p.textContent = description;
      modal.append(eyebrow, h3, p);

      if (Array.isArray(candidates) && candidates.length > 1) {
        const list = document.createElement('div');
        list.className = 'hdv-chooser-list';
        for (const cand of candidates) {
          const itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          itemBtn.className = 'hdv-item';
          const main = document.createElement('div');
          main.className = 'hdv-item-main';
          const t = document.createElement('div');
          t.className = 'hdv-item-title';
          t.textContent = cand.title || cand.passkeyRpId;
          const s = document.createElement('div');
          s.className = 'hdv-item-sub';
          s.textContent = `${cand.passkeyUserName || cand.username || 'Account'} · ${cand.passkeyAlgorithm || 'ES256'}`;
          main.append(t, s);
          const pill = document.createElement('span');
          pill.className = 'hdv-pill ok';
          pill.textContent = 'SIGN IN';
          itemBtn.append(main, pill);
          bindAction(itemBtn, () => {
            closeModal();
            resolve({ choice: 'confirm', candidate: cand });
          }, true);
          list.appendChild(itemBtn);
        }
        modal.appendChild(list);
      } else if (Array.isArray(metaLines) && metaLines.length) {
        const meta = document.createElement('div');
        meta.className = 'hdv-modal-meta';
        meta.textContent = metaLines.filter(Boolean).join('\n');
        modal.appendChild(meta);
      }

      const actions = document.createElement('div');
      actions.className = 'hdv-modal-actions';
      const fallbackBtn = document.createElement('button');
      fallbackBtn.type = 'button';
      fallbackBtn.className = 'hdv-btn';
      fallbackBtn.textContent = fallbackLabel || 'Use system passkey / security key';
      bindAction(fallbackBtn, () => {
        closeModal();
        resolve({ choice: 'fallback' });
      }, true);
      actions.appendChild(fallbackBtn);

      if (!Array.isArray(candidates) || candidates.length <= 1) {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'hdv-btn primary';
        confirmBtn.textContent = confirmLabel || 'Continue';
        bindAction(confirmBtn, () => {
          closeModal();
          resolve({ choice: 'confirm', candidate: candidates?.[0] || null });
        }, true);
        actions.appendChild(confirmBtn);
      }

      modal.appendChild(actions);
      root.appendChild(modal);
      activeModal = modal;
    });
  }

  async function handleWebAuthnCreate(payload) {
    let check = { locked: false, excludedMatches: [] };
    try {
      check = await sendBg('passkey-candidates', {
        rpId: payload.rpId,
        excludeCredentialIds: payload.excludeCredentialIds,
        gracefulLocked: true
      });
    } catch {}

    const alreadyExcluded = Array.isArray(check?.excludedMatches) && check.excludedMatches.length > 0;
    const { choice } = await showPasskeyModal({
      title: alreadyExcluded ? 'Replace Passkey in Hidden Door Vault?' : 'Save Passkey in Hidden Door Vault?',
      description: alreadyExcluded
        ? `${payload.rpName || payload.rpId} already has a passkey registered for this account in your vault.`
        : `Store a new WebAuthn passkey for ${payload.rpName || payload.rpId} in your encrypted Google Secret Manager vault.`,
      metaLines: [
        `Relying Party: ${payload.rpId}`,
        `Account: ${payload.userName || payload.userDisplayName || 'user'}`,
        check?.locked ? 'Status: Vault locked (Hidden Door Vault will prompt to unlock)' : null
      ],
      confirmLabel: alreadyExcluded ? 'Replace in Vault' : 'Save in Vault',
      fallbackLabel: 'Use system passkey / security key'
    });
    if (choice !== 'confirm') return { fallback: true };

    return sendBg('passkey-create', {
      ...payload,
      replaceExisting: true,
      skipConfirm: true
    });
  }

  async function handleWebAuthnGet(payload) {
    let candRes = await sendBg('passkey-candidates', {
      rpId: payload.rpId,
      allowCredentialIds: payload.allowCredentialIds,
      gracefulLocked: true
    });

    if (candRes && candRes.locked) {
      const { choice } = await showPasskeyModal({
        title: 'Unlock Hidden Door Vault for Passkey?',
        description: `${payload.rpId} is requesting a WebAuthn passkey. Unlock your vault to check for matching passkeys.`,
        metaLines: [`Relying Party: ${payload.rpId}`],
        confirmLabel: 'Unlock & Check',
        fallbackLabel: 'Use system passkey / security key'
      });
      if (choice !== 'confirm') return { fallback: true };
      candRes = await sendBg('passkey-candidates', {
        rpId: payload.rpId,
        allowCredentialIds: payload.allowCredentialIds,
        autoUnlock: true
      });
    }

    const candidates = Array.isArray(candRes?.candidates) ? candRes.candidates : [];
    if (candidates.length === 0) {
      return { fallback: true };
    }

    const { choice, candidate } = await showPasskeyModal({
      title: candidates.length > 1 ? `Choose a Passkey (${candidates.length})` : 'Sign in with Passkey?',
      description: candidates.length > 1
        ? `Select which Hidden Door Vault passkey to use for ${payload.rpId}:`
        : `Use your Hidden Door Vault passkey for ${payload.rpId}.`,
      metaLines: candidates.length === 1
        ? [
            `Item: ${candidates[0].title}`,
            `Account: ${candidates[0].passkeyUserName || candidates[0].username || payload.rpId}`
          ]
        : [],
      candidates,
      confirmLabel: 'Sign in',
      fallbackLabel: 'Use system passkey / security key'
    });
    if (choice !== 'confirm' || !candidate) return { fallback: true };

    return sendBg('passkey-get', {
      ...payload,
      itemId: candidate.id,
      credentialId: candidate.passkeyId,
      skipConfirm: true
    });
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.channel !== WEBAUTHN_CHANNEL || event.data.direction !== 'from-page') {
      return;
    }
    const { requestId, type, payload } = event.data;

    if (type === 'credential-store') {
      if (payload?.password) {
        lastTypedUsername = payload.username || lastTypedUsername;
        lastTypedPassword = payload.password;
        lastPasswordTypedAt = Date.now();
        maybeStageAutosave(null, true);
      }
      return;
    }

    if (type === 'webauthn-conditional-abort') {
      if (armedConditional) {
        armedConditional.reject(new Error('Conditional request aborted'));
        armedConditional = null;
      }
      return;
    }

    if (type === 'webauthn-conditional') {
      armedConditional = {
        ...payload,
        requestId,
        resolve: (result) => {
          window.postMessage({
            channel: WEBAUTHN_CHANNEL,
            direction: 'to-page',
            requestId,
            ok: true,
            result
          }, window.location.origin);
        },
        reject: (err) => {
          window.postMessage({
            channel: WEBAUTHN_CHANNEL,
            direction: 'to-page',
            requestId,
            ok: false,
            error: err?.message || 'Aborted'
          }, window.location.origin);
        }
      };
      return;
    }

    try {
      let result;
      if (type === 'webauthn-create') {
        result = await handleWebAuthnCreate(payload);
      } else if (type === 'webauthn-get') {
        result = await handleWebAuthnGet(payload);
      } else {
        throw new Error('Unsupported WebAuthn request');
      }
      window.postMessage({
        channel: WEBAUTHN_CHANNEL,
        direction: 'to-page',
        requestId,
        ok: true,
        result
      }, window.location.origin);
    } catch (err) {
      window.postMessage({
        channel: WEBAUTHN_CHANNEL,
        direction: 'to-page',
        requestId,
        ok: false,
        error: err?.message || 'Passkey operation failed'
      }, window.location.origin);
    }
  }, { signal: rootSignal });

  const messageListener = (msg, _sender, sendResponse) => {
    if (!msg) return false;
    const msgType = msg.type || msg.action;
    const data = (msg.payload && typeof msg.payload === 'object') ? msg.payload : msg;
    if (msgType === 'ping-version') {
      sendResponse({ ok: true, version: CONTENT_VERSION });
      return false;
    }
    if (msgType === 'fill-credentials') {
      closeMenu(true);
      const { usernameInput, passwordInput, otpInput } = findFormInputs(activeInput);
      if (usernameInput && data.username) {
        setNativeValue(usernameInput, data.username);
        lastTypedUsername = data.username;
      }
      if (passwordInput && data.password) {
        setNativeValue(passwordInput, data.password);
        lastTypedPassword = data.password;
      }
      if (otpInput && data.totp) {
        setNativeValue(otpInput, data.totp);
      }
      sendResponse({ ok: true, filled: Boolean(usernameInput || passwordInput || otpInput) });
      return false;
    }
    if (msgType === 'fill-totp') {
      closeMenu(true);
      const { otpInput } = findFormInputs(activeInput);
      const target = otpInput || (activeInput && isTotpInput(activeInput) ? activeInput : null);
      if (target && data.totp) {
        setNativeValue(target, data.totp);
        sendResponse({ ok: true, filled: true });
      } else {
        sendResponse({ ok: true, filled: false });
      }
      return false;
    }
    if (msgType === 'get-page-credentials') {
      const { username, password } = harvestCurrentCredentials(null);
      sendResponse({
        ok: true,
        url: window.location.href,
        host: window.location.hostname,
        title: document.title || window.location.hostname,
        username,
        password
      });
      return false;
    }
    if (msgType === 'autocreate-login') {
      closeMenu(true);
      const { usernameInput, passwordInput, passInputs } = findFormInputs(activeInput);
      const usernameVal = (usernameInput && usernameInput.value ? usernameInput.value.trim() : '') || lastTypedUsername;
      const sitePolicy = detectSitePasswordPolicy(passwordInput || activeInput);
      sendBg('autocreate-login', {
        url: window.location.href,
        title: document.title || window.location.hostname,
        username: usernameVal,
        length: Number(data.length) || sitePolicy.length,
        symbols: data.symbols !== undefined ? Boolean(data.symbols) : sitePolicy.symbols,
        allowedSymbols: data.allowedSymbols || sitePolicy.allowedSymbols,
        updateExisting: true
      })
        .then((created) => {
          if (created && created.password) {
            for (const p of passInputs) setNativeValue(p, created.password);
            lastTypedPassword = created.password;
          }
          sendResponse({ ok: true, result: created });
        })
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Auto-create failed' }));
      return true;
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(messageListener);
  rootSignal.addEventListener('abort', () => {
    try { chrome.runtime.onMessage.removeListener(messageListener); } catch {}
  }, { once: true });
})();
