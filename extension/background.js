const HOST_NAME = 'ai.thehiddendoor.vault';

const CONTENT_ALLOWED_ACTIONS = new Set([
  'status',
  'unlock-biometric',
  'generate',
  'match-logins',
  'autofill-get',
  'autocreate-login',
  'save-login',
  'check-autosave',
  'passkey-candidates',
  'passkey-create',
  'passkey-get',
  'stage-autosave',
  'get-pending-autosave',
  'clear-pending-autosave',
  'never-save-site',
  'stage-username',
  'get-staged-username'
]);

const PENDING_TTL_MS = 3 * 60 * 1000;
const pendingByTab = new Map();
const pendingByHost = new Map();
const usernameByTabHost = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of pendingByTab.entries()) {
    if (now - v.createdAt > PENDING_TTL_MS) pendingByTab.delete(k);
  }
  for (const [k, v] of pendingByHost.entries()) {
    if (now - v.createdAt > PENDING_TTL_MS) pendingByHost.delete(k);
  }
  for (const [k, v] of usernameByTabHost.entries()) {
    if (now - v.createdAt > PENDING_TTL_MS) usernameByTabHost.delete(k);
  }
}

async function isNeverSaveHost(host) {
  if (!host) return false;
  try {
    const data = await chrome.storage.local.get(['neverSaveHosts']);
    const list = Array.isArray(data?.neverSaveHosts) ? data.neverSaveHosts : [];
    return list.includes(host.toLowerCase());
  } catch {
    return false;
  }
}

async function addNeverSaveHost(host) {
  if (!host) return;
  const norm = host.toLowerCase();
  try {
    const data = await chrome.storage.local.get(['neverSaveHosts']);
    const set = new Set(Array.isArray(data?.neverSaveHosts) ? data.neverSaveHosts : []);
    set.add(norm);
    await chrome.storage.local.set({ neverSaveHosts: [...set] });
  } catch {}
}

function callNativeHost(action, payload = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(HOST_NAME, { action, payload }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || 'Could not reach Hidden Door Vault native host.'));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response?.error || 'Vault request failed.'));
          return;
        }
        resolve(response.result);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function handleAutosaveMessage(action, rawPayload, sender) {
  pruneExpired();
  const tabId = sender.tab?.id ?? rawPayload.tabId ?? null;
  let host = String(rawPayload.host || '').toLowerCase();
  const url = String(rawPayload.url || sender.tab?.url || '');
  if (!host && url) {
    try { host = new URL(url).hostname.toLowerCase(); } catch {}
  }

  if (action === 'stage-username') {
    const username = String(rawPayload.username || '').trim();
    if (host && username) {
      usernameByTabHost.set(`${tabId || 'popup'}:${host}`, { username, host, createdAt: Date.now() });
    }
    return { staged: Boolean(username) };
  }

  if (action === 'get-staged-username') {
    const entry = usernameByTabHost.get(`${tabId || 'popup'}:${host}`);
    return { username: entry ? entry.username : '' };
  }

  if (action === 'never-save-site') {
    await addNeverSaveHost(host);
    if (tabId !== null) pendingByTab.delete(tabId);
    if (host) pendingByHost.delete(host);
    return { ignored: true, host };
  }

  if (action === 'clear-pending-autosave') {
    if (tabId !== null) pendingByTab.delete(tabId);
    if (host) pendingByHost.delete(host);
    return { cleared: true };
  }

  if (action === 'get-pending-autosave') {
    let entry = (tabId !== null ? pendingByTab.get(tabId) : null) || (host ? pendingByHost.get(host) : null);
    if (!entry) return { pending: null };
    if ( await isNeverSaveHost(entry.host) ) {
      if (tabId !== null) pendingByTab.delete(tabId);
      pendingByHost.delete(entry.host);
      return { pending: null };
    }
    // Re-check against the native bridge in case the item was just saved or vault unlocked
    try {
      const check = await callNativeHost('check-autosave', {
        url: entry.url,
        host: entry.host,
        title: entry.title,
        username: entry.username,
        password: entry.password
      });
      if (check.action !== 'prompt') {
        if (tabId !== null) pendingByTab.delete(tabId);
        pendingByHost.delete(entry.host);
        return { pending: null };
      }
      entry = {
        ...entry,
        mode: check.mode || entry.mode,
        locked: Boolean(check.locked),
        biometricEnabled: Boolean(check.biometricEnabled),
        existingId: check.existingId || entry.existingId || '',
        existingTitle: check.existingTitle || entry.existingTitle || '',
        suggestedTitle: check.suggestedTitle || entry.title || entry.host
      };
    } catch {}
    return { pending: entry };
  }

  if (action === 'stage-autosave') {
    const password = String(rawPayload.password || '');
    let username = String(rawPayload.username || '').trim();
    if (!username && host) {
      const prevUser = usernameByTabHost.get(`${tabId || 'popup'}:${host}`);
      if (prevUser?.username) username = prevUser.username;
    }
    if (!host || !password) return { action: 'ignore', staged: false };
    if (await isNeverSaveHost(host)) return { action: 'ignore', reason: 'never-save', staged: false };

    let check = {
      action: 'prompt',
      mode: 'create',
      locked: false,
      host,
      suggestedTitle: String(rawPayload.title || host).slice(0, 120),
      username
    };
    try {
      check = await callNativeHost('check-autosave', {
        url,
        host,
        title: rawPayload.title || host,
        username,
        password
      });
    } catch {
      // If bridge is temporarily unreachable, don't stage
      return { action: 'ignore', staged: false };
    }

    if (check.action !== 'prompt') {
      if (tabId !== null) pendingByTab.delete(tabId);
      pendingByHost.delete(host);
      return { ...check, staged: false };
    }

    const entry = {
      url,
      host,
      title: check.suggestedTitle || String(rawPayload.title || host).slice(0, 120),
      username: check.username || username,
      password,
      mode: check.mode || 'create',
      locked: Boolean(check.locked),
      biometricEnabled: Boolean(check.biometricEnabled),
      existingId: check.existingId || '',
      existingTitle: check.existingTitle || '',
      createdAt: Date.now()
    };
    if (tabId !== null) pendingByTab.set(tabId, entry);
    pendingByHost.set(host, entry);
    return { ...check, pending: entry, staged: true };
  }

  return null;
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  pendingByTab.delete(tabId);
});

async function refreshOpenTabsContentScripts() {
  try {
    if (!chrome.tabs?.query || !chrome.scripting?.executeScript) return;
    const tabs = await chrome.tabs.query({
      url: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']
    });
    for (const tab of tabs) {
      if (!tab?.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      } catch {}
    }
  } catch {}
}

chrome.runtime.onInstalled?.addListener(() => {
  refreshOpenTabsContentScripts();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') return false;
  const action = message.action;
  const rawPayload = message.payload && typeof message.payload === 'object' ? { ...message.payload } : {};

  // Content scripts have sender.tab; popup has no sender.tab.
  if (sender.tab) {
    if (!CONTENT_ALLOWED_ACTIONS.has(action)) {
      sendResponse({ ok: false, error: `Action not permitted from content script: ${action}` });
      return false;
    }
    const tabUrl = sender.tab.url || '';
    try {
      const parsed = new URL(tabUrl);
      // Force origin and URL to the verified sender.tab.url so a compromised page cannot spoof another origin.
      rawPayload.url = tabUrl;
      rawPayload.origin = parsed.origin;
      if (!rawPayload.host) rawPayload.host = parsed.hostname;
      delete rawPayload.allowCrossOrigin;
      if (!rawPayload.rpId) rawPayload.rpId = parsed.hostname;
    } catch {
      sendResponse({ ok: false, error: 'Invalid tab origin.' });
      return false;
    }
  }

  if (['stage-autosave', 'get-pending-autosave', 'clear-pending-autosave', 'never-save-site', 'stage-username', 'get-staged-username'].includes(action)) {
    handleAutosaveMessage(action, rawPayload, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'Autosave error' }));
    return true;
  }

  callNativeHost(action, rawPayload)
    .then((result) => {
      if ((action === 'save-login' || action === 'autocreate-login') && sender.tab?.id !== undefined) {
        pendingByTab.delete(sender.tab.id);
        if (rawPayload.host) pendingByHost.delete(String(rawPayload.host).toLowerCase());
      }
      sendResponse({ ok: true, result });
    })
    .catch((err) => sendResponse({ ok: false, error: err?.message || 'Vault error' }));

  return true;
});

