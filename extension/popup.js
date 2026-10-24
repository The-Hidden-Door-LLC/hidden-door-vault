const EXPECTED_EXTENSION_VERSION = '0.3.3';
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get('autoreload') === '1' || chrome.runtime.getManifest?.()?.version !== EXPECTED_EXTENSION_VERSION) {
    chrome.runtime.reload();
  }
} catch (_) {}

function askBackground(action, payload = {}) {
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

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
  });
}

async function ensureTabContentScript(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (_) {}
}

function sendToTab(tabId, action, payload = {}) {
  const msg = { type: action, action, payload, ...(typeof payload === 'object' ? payload : {}) };
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, async (res) => {
      if (chrome.runtime.lastError || (res && res.version && res.version !== EXPECTED_EXTENSION_VERSION)) {
        await ensureTabContentScript(tabId);
        chrome.tabs.sendMessage(tabId, msg, (retryRes) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(retryRes);
        });
        return;
      }
      resolve(res);
    });
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  login: { vb: '0 0 512 512', d: 'M192 176c0-79.5 64.5-144 144-144s144 64.5 144 144-64.5 144-144 144c-11.1 0-22-1.3-32.4-3.6l-8.6-2-6.3 6.3-31.4 31.4-65.4 0 0 64-64 0 0 64-96 0 0-81.4 162.8-162.8 6.9-6.9-2.9-9.3c-4.4-13.8-6.7-28.4-6.7-43.7zM336 0c-97.2 0-176 78.8-176 176 0 15.1 1.9 29.8 5.5 43.9l-160.8 160.8-4.7 4.7 0 126.6 160 0 0-64 64 0 0-64 46.6 0 4.7-4.7 30-30c10 1.8 20.2 2.7 30.7 2.7 97.2 0 176-78.8 176-176S433.2 0 336 0zm32 168a24 24 0 1 0 0-48 24 24 0 1 0 0 48z' },
  starSolid: { vb: '0 0 576 512', d: 'M288.2-52.8l-92.6 181.4-201.1 32 143.9 144.1-31.7 201.2 181.5-92.3 181.5 92.3-31.7-201.2 143.9-144.1-201.1-32-92.6-181.4z' },
  external: { vb: '0 0 24 24', d: 'M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z' },
  bolt: { vb: '0 0 24 24', d: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z' },
  user: { vb: '0 0 24 24', d: 'M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 9c4.42 0 8 2.24 8 5v2H4v-2c0-2.76 3.58-5 8-5Zm0 2c-3.36 0-6 1.46-6 3h12c0-1.54-2.64-3-6-3Z' },
  key: { vb: '0 0 24 24', d: 'M15.5 3a6.5 6.5 0 0 1 5.08 10.56l-.15.18A6.5 6.5 0 0 1 11.1 15l-2.1 2.1H7v2H5v2H2v-4.41l7.26-7.26A6.5 6.5 0 0 1 15.5 3Zm0 2a4.5 4.5 0 0 0-4.18 6.16l.28.7-.53.53L4 19.41V20h1v-2h2v-2h1.59l2.68-2.68.53-.53.7.28A4.5 4.5 0 1 0 15.5 5Zm1 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z' },
  totp: { vb: '0 0 24 24', d: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 3h2v5.17l3.24 3.24-1.41 1.41L11 13V7Z' }
};

function makeIcon(name, cls = '') {
  const def = ICONS[name] || ICONS.login;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', def.vb);
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', def.d);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

const statusText = document.getElementById('status-text');
const statusOrb = document.getElementById('status-orb');
const brandOpen = document.getElementById('brand-open');
const openAppBtn = document.getElementById('open-app-btn');
const lockBtn = document.getElementById('lock-btn');
const unlockPanel = document.getElementById('unlock-panel');
const vaultPanel = document.getElementById('vault-panel');
const masterInput = document.getElementById('master-input');
const unlockBtn = document.getElementById('unlock-btn');
const unlockLabel = document.getElementById('unlock-label');
const biometricBtn = document.getElementById('biometric-btn');
const biometricLabel = document.getElementById('biometric-label');
const searchInput = document.getElementById('search-input');
const autocreateBtn = document.getElementById('autocreate-btn');
const toggleSaveBtn = document.getElementById('toggle-save-btn');
const saveCard = document.getElementById('save-card');
const saveCardEyebrow = document.getElementById('save-card-eyebrow');
const saveCardDismiss = document.getElementById('save-card-dismiss');
const saveTitleInput = document.getElementById('save-title-input');
const saveUserInput = document.getElementById('save-user-input');
const savePassInput = document.getElementById('save-pass-input');
const saveSubmitBtn = document.getElementById('save-submit-btn');
const sectionLabel = document.getElementById('section-label');
const itemsList = document.getElementById('items-list');
const toastEl = document.getElementById('toast');

let activeTab = null;
let pendingOverwriteId = '';
let pendingMode = 'create';

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  setTimeout(() => { toastEl.hidden = true; }, 3500);
}

async function openInDesktopVault(id = '') {
  try {
    await askBackground('open-in-app', { id, mode: 'browse' });
    window.close();
  } catch (err) {
    showToast(err.message);
  }
}

function getCleanTabHost() {
  const tabUrl = activeTab?.url || '';
  if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) return '';
  try {
    return new URL(tabUrl).hostname;
  } catch {
    return '';
  }
}

async function populateSaveCardIfPending() {
  if (!saveCard) return;
  const host = getCleanTabHost();
  if (!host) return;

  try {
    const res = await askBackground('get-pending-autosave', { tabId: activeTab?.id, host, url: activeTab?.url || '' });
    if (res && res.pending && res.pending.password) {
      const p = res.pending;
      pendingOverwriteId = p.existingId || '';
      pendingMode = p.mode || 'create';
      if (saveCardEyebrow) {
        saveCardEyebrow.textContent = pendingMode === 'update' ? 'UPDATE PASSWORD DETECTED' : 'UNSAVED LOGIN DETECTED';
      }
      if (saveSubmitBtn) {
        saveSubmitBtn.textContent = pendingMode === 'update' ? 'Update in Vault' : 'Save to Vault';
      }
      saveTitleInput.value = p.existingTitle || p.title || host;
      saveUserInput.value = p.username || '';
      savePassInput.value = p.password || '';
      saveCard.hidden = false;
      return;
    }
  } catch {}

  if (activeTab?.id) {
    try {
      const pageCreds = await sendToTab(activeTab.id, 'get-page-credentials', {});
      if (pageCreds && pageCreds.password) {
        const check = await askBackground('check-autosave', {
          url: activeTab.url,
          host,
          title: activeTab.title || host,
          username: pageCreds.username || '',
          password: pageCreds.password
        });
        if (check && check.action === 'prompt') {
          pendingOverwriteId = check.existingId || '';
          pendingMode = check.mode || 'create';
          if (saveCardEyebrow) {
            saveCardEyebrow.textContent = pendingMode === 'update' ? 'UPDATE PAGE PASSWORD' : 'SAVE PAGE LOGIN';
          }
          if (saveSubmitBtn) {
            saveSubmitBtn.textContent = pendingMode === 'update' ? 'Update in Vault' : 'Save to Vault';
          }
          saveTitleInput.value = check.existingTitle || check.suggestedTitle || host;
          saveUserInput.value = check.username || pageCreds.username || '';
          savePassInput.value = pageCreds.password;
          saveCard.hidden = false;
        }
      }
    } catch {}
  }
}

async function renderItems(search = '') {
  itemsList.replaceChildren();
  const tabUrl = activeTab?.url || '';
  let items = [];
  let headerText = 'ALL LOGINS';
  const toArray = (res) => Array.isArray(res) ? res : (res?.items || res?.matches || []);

  if (search.trim()) {
    const res = await askBackground('list', { kind: 'login', search: search.trim() });
    items = toArray(res);
    headerText = `SEARCH RESULTS (${items.length})`;
  } else if (tabUrl.startsWith('http://') || tabUrl.startsWith('https://')) {
    const res = await askBackground('match-logins', { url: tabUrl });
    items = toArray(res);
    if (items.length > 0) {
      let host = 'THIS SITE';
      try { host = new URL(tabUrl).hostname.replace(/^www\./, '').toUpperCase(); } catch (_) {}
      headerText = `MATCHES FOR ${host} (${items.length})`;
    } else {
      const all = await askBackground('list', { kind: 'login' });
      items = toArray(all).slice(0, 8);
      headerText = `RECENT LOGINS (${items.length})`;
    }
  } else {
    const all = await askBackground('list', { kind: 'login' });
    items = toArray(all).slice(0, 8);
    headerText = `LOGINS (${items.length})`;
  }

  if (sectionLabel) sectionLabel.textContent = headerText;

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No matching logins in vault.';
    itemsList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item-card';

    const main = document.createElement('div');
    main.className = 'item-main';
    main.title = `Open "${item.title}" in Hidden Door Vault`;
    main.addEventListener('click', () => {
      openInDesktopVault(item.id);
    });

    const badge = document.createElement('div');
    badge.className = 'item-badge';
    badge.appendChild(makeIcon('login'));
    if (item.favorite) {
      const fav = document.createElement('span');
      fav.className = 'fav-dot';
      fav.appendChild(makeIcon('starSolid'));
      badge.appendChild(fav);
    }

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const titleRow = document.createElement('div');
    titleRow.className = 'item-title-row';

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = item.title;
    titleRow.appendChild(title);

    if (item.hasPasskey) {
      const pk = document.createElement('span');
      pk.className = 'micro-tag';
      pk.textContent = 'PASSKEY';
      titleRow.appendChild(pk);
    }
    if (item.hasRecoveryCodes) {
      const rc = document.createElement('span');
      rc.className = 'micro-tag';
      rc.textContent = 'RECOVERY';
      titleRow.appendChild(rc);
    }

    titleRow.appendChild(makeIcon('external', 'item-open-arrow'));

    const sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = item.username || item.subtitle || item.url || 'Open in Vault';
    meta.append(titleRow, sub);

    main.append(badge, meta);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const fillBtn = document.createElement('button');
    fillBtn.className = 'primary act-btn';
    fillBtn.type = 'button';
    fillBtn.title = 'Fill username & password in active tab';
    fillBtn.append(makeIcon('bolt'), document.createTextNode('Fill'));
    fillBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const creds = await askBackground('autofill-get', { id: item.id, url: tabUrl || item.url, allowCrossOrigin: true });
        if (activeTab?.id) await sendToTab(activeTab.id, 'fill-credentials', creds);
        showToast(`Filled ${item.title}`);
      } catch (err) {
        showToast(err.message);
      }
    });
    actions.appendChild(fillBtn);

    if (item.username) {
      const userBtn = document.createElement('button');
      userBtn.className = 'act-btn icon-only';
      userBtn.type = 'button';
      userBtn.title = `Copy username (${item.username})`;
      userBtn.appendChild(makeIcon('user'));
      userBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(item.username);
          showToast('Username copied.');
        } catch (err) {
          showToast(err.message);
        }
      });
      actions.appendChild(userBtn);
    }

    const copyPwBtn = document.createElement('button');
    copyPwBtn.className = 'act-btn icon-only';
    copyPwBtn.type = 'button';
    copyPwBtn.title = 'Copy password';
    copyPwBtn.appendChild(makeIcon('key'));
    copyPwBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const creds = await askBackground('autofill-get', { id: item.id, url: tabUrl || item.url, allowCrossOrigin: true });
        await navigator.clipboard.writeText(creds.password || '');
        showToast('Password copied.');
      } catch (err) {
        showToast(err.message);
      }
    });
    actions.appendChild(copyPwBtn);

    if (item.hasTotp) {
      const totpBtn = document.createElement('button');
      totpBtn.className = 'act-btn icon-only';
      totpBtn.type = 'button';
      totpBtn.title = 'Copy & fill 2FA verification code';
      totpBtn.appendChild(makeIcon('totp'));
      totpBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const creds = await askBackground('autofill-get', { id: item.id, url: tabUrl || item.url, allowCrossOrigin: true });
          if (!creds.totp) throw new Error('No 2FA code configured on this item.');
          await navigator.clipboard.writeText(creds.totp);
          if (activeTab?.id) await sendToTab(activeTab.id, 'fill-totp', { totp: creds.totp });
          showToast(`2FA code copied (${creds.totp})`);
        } catch (err) {
          showToast(err.message);
        }
      });
      actions.appendChild(totpBtn);
    }

    row.append(main, actions);
    itemsList.appendChild(row);
  }
}

async function refresh() {
  activeTab = await getActiveTab();
  if (activeTab?.id && /^https?:\/\//i.test(activeTab.url || '')) {
    sendToTab(activeTab.id, 'ping-version', {}).catch(() => {});
  }
  try {
    const st = await askBackground('status');
    statusText.textContent = `${st.vault || 'personal'} · ${st.unlocked ? (st.offline ? 'unlocked (offline)' : 'unlocked') : 'locked'}`;
    statusOrb.className = `status-orb ${st.unlocked ? 'ok' : 'locked'}`;
    lockBtn.hidden = !st.unlocked;
    if (st.unlocked) {
      unlockPanel.hidden = true;
      vaultPanel.hidden = false;
      await populateSaveCardIfPending();
      await renderItems(searchInput.value);
    } else {
      unlockPanel.hidden = false;
      vaultPanel.hidden = true;
      const showBio = Boolean(st.biometricEnabled || st.biometricAvailable !== false);
      biometricBtn.hidden = !showBio;
      if (biometricLabel) biometricLabel.textContent = 'Unlock with Touch ID';
    }
  } catch (err) {
    statusText.textContent = err.message;
    statusOrb.className = 'status-orb err';
    unlockPanel.hidden = true;
    vaultPanel.hidden = true;
  }
}

async function doPasswordUnlock() {
  if (!masterInput.value) {
    showToast('Enter your master password or use Touch ID.');
    return;
  }
  unlockBtn.disabled = true;
  if (unlockLabel) unlockLabel.textContent = 'Unlocking…';
  try {
    await askBackground('unlock', { masterPassword: masterInput.value });
    masterInput.value = '';
    await refresh();
  } catch (err) {
    showToast(err.message);
  } finally {
    unlockBtn.disabled = false;
    if (unlockLabel) unlockLabel.textContent = 'Unlock vault';
  }
}

unlockBtn.addEventListener('click', doPasswordUnlock);

masterInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doPasswordUnlock();
});

biometricBtn.addEventListener('click', async () => {
  biometricBtn.disabled = true;
  if (biometricLabel) biometricLabel.textContent = 'Waiting for Touch ID…';
  try {
    await askBackground('unlock-biometric');
    await refresh();
  } catch (err) {
    showToast(err.message);
  } finally {
    biometricBtn.disabled = false;
    if (biometricLabel) biometricLabel.textContent = 'Unlock with Touch ID';
  }
});

lockBtn.addEventListener('click', async () => {
  try {
    await askBackground('lock');
    await refresh();
  } catch (err) {
    showToast(err.message);
  }
});

openAppBtn.addEventListener('click', () => openInDesktopVault());
if (brandOpen) brandOpen.addEventListener('click', () => openInDesktopVault());

searchInput.addEventListener('input', () => {
  renderItems(searchInput.value).catch((err) => showToast(err.message));
});

if (toggleSaveBtn && saveCard) {
  toggleSaveBtn.addEventListener('click', async () => {
    if (!saveCard.hidden) {
      saveCard.hidden = true;
      return;
    }
    const host = getCleanTabHost() || 'login';
    pendingOverwriteId = '';
    pendingMode = 'create';
    if (saveCardEyebrow) saveCardEyebrow.textContent = 'SAVE LOGIN FOR THIS SITE';
    if (saveSubmitBtn) saveSubmitBtn.textContent = 'Save to Vault';
    saveTitleInput.value = host;
    saveUserInput.value = '';
    savePassInput.value = '';
    if (activeTab?.id) {
      const pageCreds = await sendToTab(activeTab.id, 'get-page-credentials', {});
      if (pageCreds) {
        if (pageCreds.username) saveUserInput.value = pageCreds.username;
        if (pageCreds.password) savePassInput.value = pageCreds.password;
      }
    }
    saveCard.hidden = false;
    saveUserInput.focus();
  });
}

if (saveCardDismiss && saveCard) {
  saveCardDismiss.addEventListener('click', () => {
    saveCard.hidden = true;
    const host = getCleanTabHost();
    if (host) askBackground('clear-pending-autosave', { tabId: activeTab?.id, host }).catch(() => {});
  });
}

if (saveSubmitBtn) {
  saveSubmitBtn.addEventListener('click', async () => {
    const tabUrl = activeTab?.url || '';
    const host = getCleanTabHost();
    if (!host && !saveTitleInput.value.trim()) {
      showToast('Enter a title and website or open a website tab first.');
      return;
    }
    if (!savePassInput.value) {
      showToast('Enter a password to save.');
      return;
    }
    saveSubmitBtn.disabled = true;
    const prevLabel = saveSubmitBtn.textContent;
    saveSubmitBtn.textContent = 'Saving…';
    try {
      const saved = await askBackground('save-login', {
        url: tabUrl.startsWith('http') ? tabUrl : `https://${saveTitleInput.value.trim()}`,
        host: host || saveTitleInput.value.trim(),
        title: saveTitleInput.value.trim() || host,
        username: saveUserInput.value.trim(),
        password: savePassInput.value,
        overwriteId: pendingOverwriteId || undefined,
        updateExisting: true
      });
      if (host) await askBackground('clear-pending-autosave', { tabId: activeTab?.id, host }).catch(() => {});
      saveCard.hidden = true;
      savePassInput.value = '';
      showToast(saved.updated ? `Updated "${saved.title}" in Vault.` : `Saved "${saved.title}" to Vault.`);
      await renderItems(searchInput.value);
    } catch (err) {
      showToast(err.message);
    } finally {
      saveSubmitBtn.disabled = false;
      saveSubmitBtn.textContent = prevLabel;
    }
  });
}

autocreateBtn.addEventListener('click', async () => {
  const tabUrl = activeTab?.url || '';
  if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
    showToast('Open an http(s) website tab first.');
    return;
  }
  autocreateBtn.disabled = true;
  try {
    let created = null;
    if (activeTab?.id) {
      const tabRes = await sendToTab(activeTab.id, 'autocreate-login', {});
      if (tabRes?.ok && tabRes.result) created = tabRes.result;
    }
    if (!created) {
      let host = '';
      try { host = new URL(tabUrl).hostname.toLowerCase(); } catch (_) {}
      const isShortPolicy = /(^|\.)(tiktok\.com|paypal\.com)$/.test(host);
      created = await askBackground('autocreate-login', {
        url: tabUrl,
        title: activeTab?.title || host,
        length: isShortPolicy ? 16 : 32,
        allowedSymbols: isShortPolicy ? '!@#$%^&*?_~-' : undefined,
        updateExisting: true
      });
    }
    if (created?.password) {
      await navigator.clipboard.writeText(created.password);
    }
    const genLen = created?.password ? created.password.length : 32;
    showToast(`Saved "${created.title}" & copied ${genLen}-char password.`);
    await renderItems(searchInput.value);
  } catch (err) {
    showToast(err.message);
  } finally {
    autocreateBtn.disabled = false;
  }
});

refresh();
