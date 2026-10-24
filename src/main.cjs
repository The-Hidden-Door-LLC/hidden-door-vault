'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, safeStorage, shell, dialog, clipboard, ClipboardItem, powerMonitor, globalShortcut, session, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { GoogleAuth } = require('./core/oauth.cjs');
const { SecretManager } = require('./core/gcp.cjs');
const { ProtectedStore, CipherCache, atomicWrite, readLimited } = require('./core/storage.cjs');
const { Vault, readBackup } = require('./core/vault.cjs');
const { contextOf } = require('./core/crypto.cjs');
const { importCSV, importCardsCSV, summary } = require('./core/records.cjs');
const { Documents } = require('./core/documents.cjs');
const { GcsAttachments } = require('./core/gcs-attachments.cjs');
const { validBucket, isDocumentRecord } = require('./core/document-format.cjs');
const generators = require('./core/generators.cjs');
const { BridgeServer } = require('./core/bridge.cjs');
const { SshAgentServer } = require('./core/ssh-agent.cjs');
const { createPasskey } = require('./core/passkeys.cjs');
const { installBrowserIntegration, browserIntegrationStatus, DEFAULT_EXTENSION_ID } = require('./core/browser-host.cjs');
const { inspectLocalSsh, readLocalSshPrivateKey, inspectLocalConfig, readLocalConfigFile, removeKnownHostEntry, removeAuthorizedKeyEntry, removeSshConfigHost, removeLocalSshKey, removeLocalConfigEntry } = require('./core/local-system.cjs');
const linuxIntegration = require('./core/linux-integration.cjs');

app.setName('Hidden Door Vault');
const IS_MAC = process.platform === 'darwin', IS_LINUX = process.platform === 'linux';
// Platform wording for dialogs and errors. The UI reads the same values from status().
const DEVICE = IS_MAC ? 'this Mac' : 'this computer';
const BIOMETRIC_LABEL = IS_MAC ? 'Touch ID' : 'Biometric unlock';
// macOS reports a hidden login-item launch; the Linux autostart entry passes --hidden instead.
const OPENED_HIDDEN = IS_MAC ? null : process.argv.includes('--hidden');
function openedHidden() { return IS_MAC ? Boolean(app.getLoginItemSettings().wasOpenedAsHidden) : OPENED_HIDDEN; }
if (IS_LINUX) app.setDesktopName(linuxIntegration.DESKTOP_FILE);
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');
// This is intentionally not a web browser. No remote page ever enters the renderer.
const UI_PATH = path.join(__dirname, 'ui', 'index.html');
const UI_URL = pathToFileURL(UI_PATH).href;
let win, tray, auth, vault, store, bridgeServer, sshAgentServer, importing = 0, lastProgress = 0, settings = {}, quitting = false, lastActivity = Date.now(), clipboardDigest = null, clipboardTimer, startupBusy = false;
async function ownedClipboard(expectedDigest = clipboardDigest) {
  if (!expectedDigest) return false;
  try {
    const current = await clipboard.readText();
    return typeof current === 'string' && crypto.createHash('sha256').update(current).digest('hex') === expectedDigest;
  } catch (_) { return false; }
}
async function clearOwnedClipboard(expectedDigest = clipboardDigest) {
  clearTimeout(clipboardTimer);
  if (!expectedDigest) return;
  if (clipboardDigest === expectedDigest) clipboardDigest = null;
  if (await ownedClipboard(expectedDigest) && !clipboardDigest) {
    try { await clipboard.clear(); } catch (_) {}
  }
}
async function copyText(value, concealed = true) {
  if (typeof value !== 'string' || !value || value.length > 50000) throw new Error('Nothing valid to copy.');
  clearTimeout(clipboardTimer);
  const digest = crypto.createHash('sha256').update(value).digest('hex');
  clipboardDigest = digest;
  let wroteConcealed = false;
  if (concealed !== false && typeof ClipboardItem === 'function' && typeof clipboard.write === 'function' && typeof Blob === 'function') {
    try {
      const marker = new Blob([Buffer.from('1')]);
      // macOS: NSPasteboard concealed/transient markers honoured by clipboard managers.
      // Linux: the KDE Klipper hint (x-kde-passwordManagerHint=secret); GNOME has no equivalent.
      const markers = IS_MAC
        ? { 'electron application/osclipboard;format="org.nspasteboard.ConcealedType"': marker, 'electron application/osclipboard;format="org.nspasteboard.TransientType"': marker }
        : IS_LINUX ? { 'electron application/osclipboard;format="x-kde-passwordManagerHint"': new Blob([Buffer.from('secret')]) } : null;
      if (!markers) throw new Error('No concealment markers on this platform.');
      const item = new ClipboardItem({ 'text/plain': value, ...markers });
      await clipboard.write([item]);
      wroteConcealed = true;
    } catch (_) { wroteConcealed = false; }
  }
  if (!wroteConcealed) await clipboard.writeText(value);
  clipboardTimer = setTimeout(() => { clearOwnedClipboard(digest).catch(() => {}); }, 30000);
  return { expiresIn: 30, concealed: wroteConcealed };
}
let touchIdPromptActive = false, lastTouchIdEndAt = 0, windowBlurredWhileLocked = false, sessionWatcher = null;
function onSystemResume() {
  if (!vault?.unlocked && win && !win.isDestroyed()) {
    win.webContents.send('hdv:locked');
    if (win.isVisible() && win.isFocused()) setTimeout(requestAutoTouchId, 200);
    else windowBlurredWhileLocked = true;
  }
}
function lockVault() {
  vault?.lock(); clearOwnedClipboard().catch(() => {});
  windowBlurredWhileLocked = !Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused());
  if (win && !win.isDestroyed()) win.webContents.send('hdv:locked');
}
// The Touch ID sheet takes keyboard focus from the window; take it back once it closes.
let bringToFrontTimer = null;
function bringWindowToFront() {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.show(); } catch (_) {}
  }
  if (win.isMinimized?.()) win.restore();
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  try { win.setAlwaysOnTop(true, 'floating'); } catch (_) {}
  app.focus?.({ steal: true });
  win.show();
  win.moveTop?.();
  win.focus();
  win.webContents?.focus?.();
  clearTimeout(bringToFrontTimer);
  bringToFrontTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    try { win.setAlwaysOnTop(false); } catch (_) {}
    try { win.setVisibleOnAllWorkspaces(false); } catch (_) {}
    app.focus?.({ steal: true });
    win.moveTop?.();
    win.focus();
    win.webContents?.focus?.();
  }, 180);
}
function refocus() { if (win && !win.isDestroyed() && win.isVisible()) { app.focus({ steal: true }); win.show(); win.moveTop?.(); win.focus(); win.webContents.focus(); } }
async function promptTouchID(reason) {
  touchIdPromptActive = true;
  try { await systemPreferences.promptTouchID(reason); }
  finally { touchIdPromptActive = false; lastTouchIdEndAt = Date.now(); refocus(); }
}
function requestAutoTouchId() {
  if (!win || win.isDestroyed() || vault?.unlocked || touchIdPromptActive || startupBusy) return;
  if (Date.now() - lastTouchIdEndAt < 1500) return;
  win.webContents.send('hdv:auto-touchid');
}
function showWindow() {
  const wasVisibleAndFocused = Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused());
  if (!win || win.isDestroyed()) makeWindow();
  bringWindowToFront();
  if (!wasVisibleAndFocused && !vault?.unlocked) {
    windowBlurredWhileLocked = false;
    setTimeout(requestAutoTouchId, 120);
  }
}
function trusted(event) {
  // senderFrame can be null for a disposed frame; never dereference it before checking.
  const frame = event.senderFrame;
  return Boolean(win && !win.isDestroyed() && event.sender === win.webContents && frame && frame === win.webContents.mainFrame && frame.url === UI_URL);
}
function handle(name, fn, activity = true) {
  ipcMain.handle(`hdv:${name}`, async (event, payload) => {
    if (!trusted(event)) return { ok: false, error: 'Untrusted caller.' };
    if (activity) lastActivity = Date.now();
    try { return { ok: true, data: await fn(payload || {}) }; }
    catch (error) {
      // No payloads, request bodies, master passwords or tokens are logged.
      const message = typeof error.message === 'string' ? error.message.slice(0, 500) : 'Operation failed.';
      return { ok: false, error: message };
    }
  });
}
// After a cache-first unlock, reconcile with Google without blocking the UI. The renderer gets
// one 'hdv:synced' event with the outcome; epoch checks inside refresh() make a lock mid-sync safe.
function syncInBackground() {
  const v = vault; if (!v || !v.unlocked || v.offline) return;
  v.refresh().then(r => { if (win && !win.isDestroyed() && vault === v) win.webContents.send('hdv:synced', { ok: true, count: r.count, fetched: r.fetched, warnings: v.warnings }); recountInBackground(); })
    .catch(error => { if (win && !win.isDestroyed() && vault === v) win.webContents.send('hdv:synced', { ok: false, error: String(error.message || error).slice(0, 300) }); });
}
function requireVault() { if (!vault) throw new Error('Configure a project and vault first.'); return vault; }
function requireUnlocked() { requireVault().requireUnlocked(); }
async function persistSettings() { await atomicWrite(path.join(app.getPath('userData'), 'settings.json'), Buffer.from(JSON.stringify(settings))); }
// Version pruning settings: keep 0 (off) or 2–10 ENABLED versions per secret; grace 24 h–30 d.
function pruneKeepOf(v) { const n = Number(v); return Number.isInteger(n) && n >= 2 && n <= 10 ? n : 0; }
function pruneGraceOf(v) { const n = Number(v); return [24, 72, 168, 720].includes(n) ? n : 72; }
// Cost snapshot (counts only, no secret material): last full version count plus the number of
// saves since. Versions scheduled for destruction stop counting once their time has passed.
const PRICE_PER_VERSION_MONTH = 0.06, FREE_VERSIONS = 6;
function costView() {
  const snap = settings.costSnapshot; if (!snap || snap.project !== settings.project || snap.vault !== settings.vault) return { known: false };
  const now = Date.now(), gone = (snap.scheduled || []).filter(t => Date.parse(t) <= now).length;
  const billable = Math.max(0, snap.billable + (snap.savesSince || 0) - gone);
  return { known: true, at: snap.at, secrets: snap.secrets + (snap.secretsSince || 0), billable, pending: (snap.scheduled || []).length - gone, savesSince: snap.savesSince || 0, monthly: Math.max(0, billable - FREE_VERSIONS) * PRICE_PER_VERSION_MONTH, pricePerVersion: PRICE_PER_VERSION_MONTH, freeVersions: FREE_VERSIONS, stale: now - Date.parse(snap.at) > 24 * 3600 * 1000 };
}
async function recordCost(count) { settings.costSnapshot = { project: settings.project, vault: settings.vault, savesSince: 0, secretsSince: 0, ...count }; await persistSettings(); }
let costTimer = null;
function noteSave(isNew) { const snap = settings.costSnapshot; if (!snap) return; snap.savesSince = (snap.savesSince || 0) + 1; if (isNew) snap.secretsSince = (snap.secretsSince || 0) + 1; clearTimeout(costTimer); costTimer = setTimeout(() => { persistSettings().catch(() => {}); }, 2000); costTimer.unref?.(); }
function recountInBackground() {
  const v = vault; if (!v || !v.unlocked || v.offline) return; const view = costView(); if (view.known && !view.stale) return;
  v.countVersions().then(async count => { if (vault === v) { await recordCost(count); if (win && !win.isDestroyed()) win.webContents.send('hdv:synced', { ok: true, cost: true }); } }).catch(() => {});
}
function applyPruneSettings() { if (vault) { vault.pruneKeep = settings.pruneKeep || 0; vault.pruneGraceSeconds = (settings.pruneGraceHours || 72) * 3600; } }
function configureVault() {
  vault?.lock();
  if (!settings.project || !settings.vault) { vault = null; return; }
  const cache = new CipherCache(path.join(app.getPath('userData'), 'cache'), settings.project, settings.vault);
  const cloud = new SecretManager({ project: settings.project, vault: settings.vault, auth });
  vault = new Vault({ project: settings.project, vault: settings.vault, cloud, cache }); applyPruneSettings();
  vault.documents = new Documents(vault, validBucket(settings.attachmentBucket) ? new GcsAttachments({ bucket: settings.attachmentBucket, project: settings.project, auth }) : null);
}
async function ensureUnlockedFromBridge(reason, opts = {}) {
  if (vault?.unlocked) { lastActivity = Date.now(); return true; }
  if (!vault) throw new Error('Configure a project and vault in the desktop app first.');
  const avail = biometricAvailable();
  if (avail.available) {
    let material = null;
    try { material = await biometricMaterial(); } catch (_) {}
    if (material) {
      try {
        await promptTouchID(`unlock Hidden Door Vault (${reason || 'CLI / Browser'})`);
        const result = await vault.unlockWithKeyMaterial(material, false);
        lastActivity = Date.now();
        if (result.fromCache) syncInBackground(); else recountInBackground();
        if (win && !win.isDestroyed()) win.webContents.send('hdv:synced', { ok: true, unlocked: true, count: result.count });
        return true;
      } catch (err) {
        if (opts.biometricOnly) throw new Error(err?.message || 'Touch ID unlock was cancelled.');
      }
    } else if (opts.biometricOnly) {
      throw new Error('Touch ID unlock is not enabled for this vault yet. Enable it in Hidden Door Vault → Settings → Security.');
    }
  } else if (opts.biometricOnly) {
    throw new Error(avail.reason || `${BIOMETRIC_LABEL} is not available on ${DEVICE}.`);
  }
  showWindow();
  return Boolean(vault?.unlocked);
}
async function syncLocalServers() {
  const userDir = app.getPath('userData');
  const bridgeEnabled = settings.bridgeEnabled !== false;
  const sshAgentEnabled = settings.sshAgentEnabled !== false;
  if (bridgeEnabled) {
    if (!bridgeServer) {
      bridgeServer = new BridgeServer({
        socketPath: path.join(userDir, 'hdv.sock'),
        sshSocketPath: path.join(userDir, 'ssh-agent.sock'),
        getVault: () => vault,
        getSettings: () => settings,
        getBiometricStatus: async () => {
          const avail = biometricAvailable();
          let enabled = false;
          try { enabled = Boolean(await biometricMaterial()); } catch (_) {}
          return { available: avail.available, enabled, reason: avail.reason || '' };
        },
        ensureUnlocked: ensureUnlockedFromBridge,
        onActivity: () => { lastActivity = Date.now(); },
        onUnlock: async result => {
          lastActivity = Date.now();
          if (result?.fromCache) syncInBackground(); else recountInBackground();
          if (win && !win.isDestroyed()) win.webContents.send('hdv:synced', { ok: true, unlocked: true, count: result?.count });
        },
        onVaultMutated: () => { lastActivity = Date.now(); noteSave(false); if (win && !win.isDestroyed()) win.webContents.send('hdv:synced', { ok: true }); },
        onOpenInApp: async ({ id, mode }) => {
          lastActivity = Date.now();
          showWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('hdv:synced', {
              ok: true,
              unlocked: Boolean(vault?.unlocked),
              openItemId: id || '',
              openMode: mode || 'browse'
            });
          }
        },
        onLock: () => lockVault()
      });
    }
    await bridgeServer.start();
  } else if (bridgeServer) {
    await bridgeServer.stop();
  }
  if (sshAgentEnabled) {
    if (!sshAgentServer) {
      sshAgentServer = new SshAgentServer({
        socketPath: path.join(userDir, 'ssh-agent.sock'),
        getVault: () => vault,
        ensureUnlocked: ensureUnlockedFromBridge
      });
    }
    await sshAgentServer.start();
  } else if (sshAgentServer) {
    await sshAgentServer.stop();
  }
}
async function status() {
  // If the OS-protected store cannot be read (Keychain denied, signature changed), still boot:
  // the setup screen must stay reachable so the user can re-import the OAuth client.
  let oauthConfigured = false, signedIn = false, email = '', authUnreadable = false, biometricEnabled = false;
  try { oauthConfigured = await auth.configured(); signedIn = await auth.signedIn(); email = await auth.email(); biometricEnabled = Boolean(await biometricMaterial()); }
  catch (_) { authUnreadable = true; }
  const userDir = app.getPath('userData');
  const bh = await browserIntegrationStatus({ userDataDir: userDir, repoRoot: path.join(__dirname, '..') });
  const startup = await startupEnabled();
  return { appVersion: app.getVersion(), platform: process.platform, syncing: Boolean(vault?.stale), settings: { project: settings.project || '', vault: settings.vault || 'personal', attachmentBucket: validBucket(settings.attachmentBucket) ? settings.attachmentBucket : '', idleSeconds: settings.idleSeconds || 300, lockOnHide: Boolean(settings.lockOnHide), pruneKeep: settings.pruneKeep || 0, pruneGraceHours: settings.pruneGraceHours || 72, bridgeEnabled: settings.bridgeEnabled !== false, sshAgentEnabled: settings.sshAgentEnabled !== false }, bridge: { enabled: settings.bridgeEnabled !== false, sshAgentEnabled: settings.sshAgentEnabled !== false, socketPath: path.join(userDir, 'hdv.sock'), sshSocketPath: path.join(userDir, 'ssh-agent.sock'), extensionId: DEFAULT_EXTENSION_ID, extensionDir: bh.extensionDir, hostInstalled: bh.hostInstalled, cliLinkPath: bh.cliLinkPath }, prune: { denied: Boolean(vault?.pruneDenied), last: vault?.lastPrune || null }, cost: costView(), oauthConfigured, signedIn, email, authUnreadable, unlocked: Boolean(vault?.unlocked), offline: vault?.offline || false, warnings: vault?.warnings || [], startup, packaged: app.isPackaged, biometric: { ...biometricAvailable(), enabled: biometricEnabled, label: BIOMETRIC_LABEL } };
}
async function startupEnabled() {
  try {
    if (IS_MAC) return Boolean(app.getLoginItemSettings().openAtLogin);
    if (IS_LINUX) return (await linuxIntegration.autostartStatus()).enabled;
  } catch (_) {}
  return false;
}
function biometricAvailable() {
  if (IS_LINUX) return { available: false, reason: 'Biometric unlock is not available on Linux yet. Unlock with the master password; the CLI and browser extension open this window when the vault is locked.' };
  if (!IS_MAC) return { available: false, reason: 'Touch ID is only available on macOS.' };
  try { return systemPreferences.canPromptTouchID() ? { available: true, reason: '' } : { available: false, reason: 'macOS reports no usable Touch ID sensor or no enrolled fingerprint for this user (lid closed or external keyboard without Touch ID also causes this).' }; }
  catch (error) { return { available: false, reason: `Touch ID check failed: ${String(error.message || error).slice(0, 160)}` }; }
}
async function biometricMaterial() {
  if (!settings.project || !settings.vault) return null;
  const material = await store.get('biometric-vault-key');
  return material && material.project === settings.project && material.vault === settings.vault ? material : null;
}
function parseJSON(text, what) { try { return JSON.parse(text); } catch (_) { throw new Error(`${what} is not valid JSON.`); } }
async function confirm(message, detail, button = 'Continue') {
  const result = await dialog.showMessageBox(win, { type: 'warning', message, detail, buttons: ['Cancel', button], defaultId: 0, cancelId: 0, noLink: true });
  return result.response === 1;
}
async function selectFile(filters) {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return result.canceled ? null : result.filePaths[0];
}
function wireIPC() {
  handle('status', status, false);
  handle('configure', async input => {
    const idleSeconds = Number(input.idleSeconds || settings.idleSeconds || 300);
    if (!Number.isInteger(idleSeconds) || idleSeconds < 60 || idleSeconds > 1800) throw new Error('Auto-lock must be between 1 and 30 minutes.');
    const nextProject = input.project !== undefined ? input.project : settings.project;
    const attachmentBucket = input.attachmentBucket !== undefined ? String(input.attachmentBucket).trim() : (settings.attachmentBucket || '');
    if (attachmentBucket && !validBucket(attachmentBucket)) throw new Error('Use a valid GCS attachment bucket name, without gs:// or a path.');
    if (vault?.unlocked && attachmentBucket !== (settings.attachmentBucket || '')) throw new Error('Lock the vault before changing the attachment bucket.');
    const nextVault = input.vault !== undefined ? input.vault : settings.vault;
    const sameCloud = nextProject === settings.project && nextVault === settings.vault;
    if (vault?.unlocked && !sameCloud) throw new Error('Lock the vault before changing cloud settings.');
    if (!input.idleOnly || nextProject) contextOf(nextProject, nextVault);
    const lockOnHide = input.lockOnHide !== undefined ? Boolean(input.lockOnHide) : Boolean(settings.lockOnHide);
    settings = { ...settings, project: nextProject || '', vault: nextVault || 'personal', attachmentBucket, idleSeconds, lockOnHide, pruneKeep: settings.pruneKeep || 0, pruneGraceHours: settings.pruneGraceHours || 72, bridgeEnabled: settings.bridgeEnabled !== false, sshAgentEnabled: settings.sshAgentEnabled !== false };
    lastActivity = Date.now();
    await persistSettings();
    if (!vault?.unlocked) configureVault();
    return status();
  });
  handle('import-oauth', async () => {
    if (vault?.unlocked) throw new Error('Lock the vault before replacing OAuth configuration.');
    const filename = await selectFile([{ name: 'Google Desktop OAuth client', extensions: ['json'] }]); if (!filename) return { cancelled: true };
    const json = parseJSON((await readLimited(filename, 128 * 1024)).toString('utf8'), 'The selected file');
    if (!json.installed) throw new Error('This is not a Desktop app OAuth client JSON. Web application credentials are not supported.');
    await auth.configure(json); return status();
  });
  handle('google-login', async () => { if (startupBusy) throw new Error('A sign-in is already in progress.'); startupBusy = true; try { lockVault(); await auth.login(); showWindow(); return status(); } finally { startupBusy = false; } });
  handle('google-cancel', () => { auth.cancel(); return {}; });
  handle('google-logout', async () => {
    if (!await confirm('Sign out and remove this vault\'s local cache?', 'Cloud secrets and exported backups will remain. You will need Google sign-in and your master password or recovery code to open the vault again.', 'Sign out')) return { cancelled: true };
    lockVault(); await auth.logout(); await store.delete('biometric-vault-key'); await vault?.cache.clear(); return status();
  });
  handle('vault-probe', input => requireVault().probe(input.offline === true));
  handle('vault-create', async input => { const result = await requireVault().create(input.password); lastActivity = Date.now(); return result; });
  handle('vault-rekey', async input => { const v = requireVault(); const result = await v.rekey(input.currentPassword, input.newPassword, input.recovery === true); lastActivity = Date.now(); noteSave(false); return result; });
  handle('vault-unlock', async input => { const result = await requireVault().unlock(input.credential, input.recovery === true, input.offline === true); lastActivity = Date.now(); if (result.fromCache) syncInBackground(); else recountInBackground(); return result; });
  handle('vault-lock', () => { lockVault(); return {}; }, false);
  // Touch ID: the vault key is wrapped by Electron safeStorage (macOS Keychain-backed key,
  // bound to this app's code identity) and only read after a successful Touch ID prompt.
  // Same protection class as the Google refresh token; not Secure Enclave key release.
  handle('biometric-enable', async () => {
    if (!biometricAvailable().available) throw new Error(biometricAvailable().reason || `${BIOMETRIC_LABEL} is not available on ${DEVICE}.`);
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online before enabling Touch ID.');
    if (!await confirm('Enable Touch ID unlock on this Mac?', 'The vault key will be kept in macOS-protected storage for this app and released after Touch ID. Anyone who can pass Touch ID on this Mac, or run code as this app, can open the vault without the master password. Sign out or disable Touch ID to remove it.', 'Enable Touch ID')) return { cancelled: true };
    await promptTouchID('enable Touch ID unlock for Hidden Door Vault');
    if (v !== vault || !v.unlocked) throw new Error('The vault was locked.');
    await store.set('biometric-vault-key', v.exportKeyMaterial()); return { enabled: true };
  });
  handle('biometric-disable', async () => { await store.delete('biometric-vault-key'); return { enabled: false }; });
  handle('biometric-unlock', async input => {
    const v = requireVault(); const material = await biometricMaterial(); if (!material) throw new Error('Touch ID unlock is not set up for this vault.');
    const avail = biometricAvailable(); if (!avail.available) throw new Error(avail.reason || 'Touch ID is not available right now.');
    await promptTouchID('unlock Hidden Door Vault');
    const result = await v.unlockWithKeyMaterial(material, input.offline === true); lastActivity = Date.now(); refocus(); if (result.fromCache) syncInBackground(); else recountInBackground(); return result;
  });
  handle('vault-list', () => requireVault().list(), false);
  handle('vault-get', input => { const item = requireVault().get(input.id); return isDocumentRecord(item) ? summary(item) : item; });
  handle('vault-save', async input => { const isNew = !input.item?.id; const saved = await requireVault().save(input.item); noteSave(isNew); return saved; });
  handle('vault-archive', input => requireVault().archive(input.id, input.archived));
  handle('vault-delete', async input => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to delete items.');
    const item = v.get(input.id), epoch = v.epoch;
    if (!await confirm(`Delete "${item.title}" permanently?`, 'This permanently deletes the encrypted secret from Google Secret Manager and your local cache. If you only want to hide it from active views, use Archive instead.', 'Delete permanently')) return { cancelled: true };
    if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
    const res = await v.delete(item.id);
    if (settings.costSnapshot && settings.costSnapshot.secrets > 1) {
      settings.costSnapshot.secrets--;
      settings.costSnapshot.billable = Math.max(0, (settings.costSnapshot.billable || 1) - 1);
      persistSettings().catch(() => {});
    }
    return res;
  });
  handle('vault-refresh', () => requireVault().refresh());
  handle('generate-password', input => generators.password(input));
  handle('generate-token', input => generators.token(input));
  handle('generate-ssh', input => generators.ssh(input.comment || 'hidden-door-vault'));
  handle('totp', input => { const item = requireVault().get(input.id); return generators.totp(item.totpSecret); }, false);
  handle('copy', input => { requireUnlocked(); return copyText(input.value); });
  handle('open-website', async input => {
    const item = requireVault().get(input.id); let url; try { url = new URL(item.url); } catch { throw new Error('No valid website is saved.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe website URL.');
    if (url.protocol === 'http:' && !await confirm('This website is not using HTTPS.', 'A plain HTTP connection may expose anything you enter. Do not submit credentials without verifying the connection.', 'Open anyway')) return { cancelled: true };
    await shell.openExternal(url.href); return {};
  });
  // Dialog-spanning handlers pin the Vault instance they started with. `configure` can replace
  // the global `vault` with a fresh instance whose epoch restarts at 0, so checking the global
  // after an await could pass against the wrong vault.
  handle('backup-export', async () => {
    const v = requireVault(); v.requireUnlocked(); const epoch = v.epoch;
    const backup = v.exportBackup();
    const result = await dialog.showSaveDialog(win, { title: 'Export encrypted vault backup', message: 'Attachment manifests and their keys are backed up encrypted, but file bytes remain in GCS. Keep the referenced buckets and object generations; this backup alone is not a complete attachment backup.', defaultPath: `hidden-door-${settings.vault}-${new Date().toISOString().slice(0, 10)}.hdvault`, filters: [{ name: 'Encrypted vault backup', extensions: ['hdvault'] }] });
    if (result.canceled) return { cancelled: true }; if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
    await atomicWrite(result.filePath, Buffer.from(JSON.stringify(backup))); return { saved: true };
  });
  handle('backup-restore', async input => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to restore items.'); const epoch = v.epoch;
    const filename = await selectFile([{ name: 'Encrypted vault backup', extensions: ['hdvault'] }]); if (!filename) return { cancelled: true };
    const json = parseJSON((await readLimited(filename, 96 * 1024 * 1024)).toString('utf8'), 'The selected backup');
    const items = await readBackup(json, input.credential, input.recovery === true); if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
    if (!await confirm(`Import ${items.length} items from this encrypted backup?`, 'Items are re-encrypted into the currently open vault as new records. Existing records are not overwritten. Repeated imports can create duplicates.', 'Import items')) return { cancelled: true };
    if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch); return whileImporting(() => v.importItems(items, sendProgress));
  });
  handle('csv-import', async () => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to import items.'); const epoch = v.epoch;
    const filename = await selectFile([{ name: 'Login CSV export', extensions: ['csv'] }]); if (!filename) return { cancelled: true };
    const items = importCSV((await readLimited(filename, 10 * 1024 * 1024)).toString('utf8')); if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
    if (!await confirm(`Import ${items.length} login items?`, 'CSV files contain plaintext credentials. This app does not make another plaintext copy, but the original export remains on disk. Cards, SSH keys and passkeys are not imported by this CSV importer.', 'Import logins')) return { cancelled: true };
    if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch); return whileImporting(() => v.importItems(items, sendProgress));
  });
  // Import wizard: preview parses and stages the file in the main process; run imports it with progress.
  let pendingImport = null;
  const sendProgress = payload => { lastProgress = Date.now(); if (win && !win.isDestroyed()) win.webContents.send('hdv:progress', payload); };
  // A long import is one IPC call; without this the idle timer fires mid-import and the lock
  // aborts it (observed 2026-10-14 at item 116 of 128). The exemption is bounded: it holds only
  // while progress arrived within the last 60 s (every cloud call times out at 20 s), progress
  // is not user activity, and sleep / screen lock still lock immediately.
  async function whileImporting(task) { importing++; lastProgress = Date.now(); try { return await task(); } finally { importing--; if (win && !win.isDestroyed() && win.isFocused()) lastActivity = Date.now(); } }
  handle('import-preview', async input => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to import items.');
    const kind = input.kind === 'card' ? 'card' : 'login';
    const filename = await selectFile([{ name: kind === 'card' ? 'Card CSV export' : 'Login CSV export', extensions: ['csv'] }]); if (!filename) return { cancelled: true };
    const text = (await readLimited(filename, 10 * 1024 * 1024)).toString('utf8');
    const items = kind === 'card' ? importCardsCSV(text) : importCSV(text);
    const existing = new Set(v.list().map(s => `${s.title}\u0000${s.subtitle || ''}`.toLowerCase()));
    const seen = new Set(); let duplicateInFile = 0, duplicateInVault = 0, noSecret = 0, noUrl = 0;
    const flags = items.map(item => {
      const key = `${item.title}\u0000${item.kind === 'card' ? (item.number ? `Ending ${item.number.slice(-4)}` : item.holder) : (item.username || item.url || 'Encrypted credential')}`.toLowerCase();
      const f = { inFile: seen.has(key), inVault: existing.has(key), noSecret: item.kind === 'card' ? !item.number : !item.password, noUrl: item.kind === 'login' && !item.url };
      seen.add(key); if (f.inFile) duplicateInFile++; if (f.inVault) duplicateInVault++; if (f.noSecret) noSecret++; if (f.noUrl) noUrl++; return f;
    });
    pendingImport = { token: crypto.randomUUID(), kind, filename, items, flags, vault: v };
    return { token: pendingImport.token, kind, file: path.basename(filename), total: items.length, sample: items.slice(0, 6).map(i => i.title), duplicateInFile, duplicateInVault, noSecret, noUrl, vaultCount: v.records.size };
  });
  handle('import-run', async input => {
    const p = pendingImport; if (!p || p.token !== input.token) throw new Error('Start the import again; the preview expired.');
    const v = requireVault(); if (v !== p.vault || !v.unlocked || v.offline) throw new Error('The vault was locked. Unlock online and start again.');
    const chosen = p.items.filter((item, i) => !(input.skipDuplicates && (p.flags[i].inVault || p.flags[i].inFile)) && !(input.skipNoSecret && p.flags[i].noSecret));
    const skipped = p.items.length - chosen.length; pendingImport = null;
    const result = chosen.length ? await whileImporting(() => v.importItems(chosen, sendProgress)) : { saved: 0, total: 0, stopped: false };
    for (let i = 0; i < result.saved; i++) noteSave(true);
    let deleted = false;
    if (input.deleteSource === true && !result.stopped) { try { await fs.unlink(p.filename); deleted = true; } catch (_) { deleted = false; } }
    return { ...result, skipped, deleted, file: path.basename(p.filename) };
  });
  handle('import-stop', () => { requireVault().requestStopImport(); return {}; }, false);
  handle('import-cancel', () => { pendingImport = null; return {}; }, false);
  handle('cards-csv-import', async () => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to import items.'); const epoch = v.epoch;
    const filename = await selectFile([{ name: 'Card CSV export', extensions: ['csv'] }]); if (!filename) return { cancelled: true };
    const items = importCardsCSV((await readLimited(filename, 10 * 1024 * 1024)).toString('utf8')); if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
    if (!await confirm(`Import ${items.length} payment card(s)?`, 'CSV files contain plaintext card numbers. This app does not make another plaintext copy, but the original export remains on disk until you remove it.', 'Import cards')) return { cancelled: true };
    if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch); return whileImporting(() => v.importItems(items, sendProgress));
  });
  handle('ssh-export', async input => {
    const v = requireVault(); const item = v.get(input.id), epoch = v.epoch;
    if (item.kind !== 'ssh' || !item.privateKey) throw new Error('No SSH private key is saved.');
    if (!await confirm('Export this SSH private key to disk?', 'The exported file may have NO passphrase. It will be readable by your OS user account and processes running as you. The app writes it with owner-only permissions. Add a passphrase with ssh-keygen -p before using it outside the vault.', 'Export private key')) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, { title: 'Export SSH private key', defaultPath: 'id_ed25519' }); if (result.canceled) return { cancelled: true };
    if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch); await atomicWrite(result.filePath, Buffer.from(item.privateKey)); return { saved: true };
  });
  // Version pruning: opt-in. Changing it is not a cloud-location change, so it is allowed while
  // unlocked. The sweep runs under whileImporting so the idle timer cannot abort it mid-way.
  handle('prune-config', async input => {
    settings.pruneKeep = pruneKeepOf(input.keep); settings.pruneGraceHours = pruneGraceOf(input.graceHours);
    await persistSettings(); applyPruneSettings(); return status();
  });
  handle('prune-run', async input => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to prune versions.');
    const keep = pruneKeepOf(input.keep) || settings.pruneKeep; if (!keep) throw new Error('Choose how many versions to keep first.');
    const total = v.packets.size + 1, grace = settings.pruneGraceHours || 72;
    if (!await confirm(`Prune old versions across ${total} secrets?`, `Each secret keeps its newest ${keep} versions, always including the one in use. Older versions are disabled now and destroyed by Google after ${grace >= 48 ? `${grace / 24} days` : `${grace} hours`}; until then they are still billed and can be re-enabled with gcloud. Nothing in use is touched.`, 'Prune versions')) return { cancelled: true };
    if (v !== vault || !v.unlocked) throw new Error('The vault was locked.');
    const result = await whileImporting(() => v.pruneAll(keep, sendProgress));
    if (vault === v && v.unlocked && settings.costSnapshot) { settings.costSnapshot.at = '1970-01-01T00:00:00.000Z'; recountInBackground(); }
    return result;
  });
  handle('prune-stop', () => { requireVault().requestStopPrune(); return {}; }, false);
  handle('cost-recount', async () => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to count versions.');
    const count = await whileImporting(() => v.countVersions(sendProgress)); if (v !== vault) throw new Error('The vault configuration changed.');
    await recordCost(count); return costView();
  });
  handle('set-startup', async input => {
    if (!app.isPackaged || !(IS_MAC || IS_LINUX)) throw new Error('Launch at login is available from the packaged app.');
    const enabled = input.enabled === true;
    if (IS_MAC) app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    else await linuxIntegration.setAutostart({ execPath: process.execPath, enabled });
    return { enabled };
  });
  handle('bridge-config', async input => {
    if (typeof input.bridgeEnabled === 'boolean') settings.bridgeEnabled = input.bridgeEnabled;
    if (typeof input.sshAgentEnabled === 'boolean') settings.sshAgentEnabled = input.sshAgentEnabled;
    await persistSettings(); await syncLocalServers(); return status();
  });
  handle('install-browser', async input => {
    if (input.revealOnly) {
      const bh = await browserIntegrationStatus({ userDataDir: app.getPath('userData'), repoRoot: path.join(__dirname, '..') });
      if (bh.extensionDir) shell.showItemInFolder(path.join(bh.extensionDir, 'manifest.json'));
      return bh;
    }
    const res = await installBrowserIntegration({ userDataDir: app.getPath('userData'), repoRoot: path.join(__dirname, '..'), extensionId: input.extensionId || DEFAULT_EXTENSION_ID });
    if (input.reveal && res.extensionDir) shell.showItemInFolder(path.join(res.extensionDir, 'manifest.json'));
    return res;
  });
  handle('passkey-create', async input => {
    const v = requireVault(); v.requireUnlocked(); if (v.offline) throw new Error('Unlock online to register a passkey.');
    const reg = createPasskey({
      rpId: input.rpId,
      rpName: input.rpName || input.title || input.rpId,
      origin: input.origin || `https://${input.rpId}`,
      userName: input.userName || input.username || 'user',
      userDisplayName: input.userDisplayName || input.userName || input.username || 'User',
      algorithm: Number(input.algorithm) === -8 ? -8 : -7
    });
    if (input.itemId) {
      const existing = v.get(input.itemId);
      const saved = await v.save({ ...existing, url: existing.url || `https://${reg.recordFields.passkeyRpId}`, username: existing.username || reg.recordFields.passkeyUserName, ...reg.recordFields });
      noteSave(false); return { item: saved, credentialId: reg.credentialId };
    }
    const saved = await v.save({
      kind: 'login',
      title: input.title || reg.recordFields.passkeyRpName || reg.recordFields.passkeyRpId,
      username: input.username || input.userName || reg.recordFields.passkeyUserName,
      password: input.password || '',
      url: input.url || `https://${reg.recordFields.passkeyRpId}`,
      tags: input.tags || 'passkey',
      notes: input.notes || '',
      ...reg.recordFields
    });
    noteSave(true); return { item: saved, credentialId: reg.credentialId };
  });
  handle('ssh-local', () => { requireUnlocked(); return inspectLocalSsh(); }, false);
  handle('ssh-local-key', input => { requireUnlocked(); return readLocalSshPrivateKey(input.name); });
  handle('ssh-local-remove', async input => {
    const v = requireVault(); v.requireUnlocked(); const epoch = v.epoch;
    const target = String(input?.target || '');
    if (target === 'known-host') {
      if (!await confirm(`Remove "${input.host || 'entry'}" from ~/.ssh/known_hosts?`, `Line ${input.line || ''} (${input.fingerprint || 'host key'}) will be removed. A backup is saved automatically to ~/.ssh/known_hosts.bak.`, 'Remove known host')) return { cancelled: true };
      if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
      return removeKnownHostEntry({ line: input.line, rawHostField: input.rawHostField, fingerprint: input.fingerprint });
    }
    if (target === 'authorized-key') {
      if (!await confirm(`Remove authorized key "${input.comment || 'key'}" from ~/.ssh/authorized_keys?`, `Line ${input.line || ''} (${input.fingerprint || ''}) will no longer be authorized to log into ${DEVICE} over SSH. A backup is saved automatically to ~/.ssh/authorized_keys.bak.`, 'Remove authorized key')) return { cancelled: true };
      if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
      return removeAuthorizedKeyEntry({ line: input.line, fingerprint: input.fingerprint, publicKey: input.publicKey });
    }
    if (target === 'config-host') {
      if (!await confirm(`Remove Host "${input.host}" from ~/.ssh/config?`, `The Host ${input.host} block will be removed from ~/.ssh/config. A backup is saved automatically to ~/.ssh/config.bak.`, 'Remove Host block')) return { cancelled: true };
      if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
      return removeSshConfigHost({ host: input.host });
    }
    if (target === 'local-key') {
      const warn = input.inVault
        ? `This key is backed up in your Vault. Deleting the local file removes ~/.ssh/${input.name} (and .pub) from disk on ${DEVICE}.`
        : `WARNING: This key is NOT backed up in your Vault yet! Deleting ~/.ssh/${input.name} from disk cannot be undone.`;
      if (!await confirm(`Delete ~/.ssh/${input.name} from disk?`, warn, 'Delete local files')) return { cancelled: true };
      if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
      return removeLocalSshKey({ name: input.name });
    }
    throw new Error('Unknown SSH removal target.');
  });
  handle('config-local', () => { requireUnlocked(); return inspectLocalConfig(); }, false);
  handle('config-local-file', input => { requireUnlocked(); return readLocalConfigFile(input.relPath); });
  handle('config-local-remove', async input => {
    const v = requireVault(); v.requireUnlocked(); const epoch = v.epoch;
    const relPath = String(input?.relPath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!relPath || relPath.includes('..')) throw new Error('Invalid ~/.config path.');
    const isDir = input?.kind === 'dir';
    const message = isDir
      ? `Delete directory "~/.config/${relPath}" from disk?`
      : `Delete "~/.config/${relPath}" from disk?`;
    const detail = isDir
      ? `This permanently deletes ~/.config/${relPath} and all files inside it from ${DEVICE}. Save any needed config or tokens to your Vault first.`
      : `This permanently deletes ~/.config/${relPath} from ${DEVICE}. This action cannot be undone.`;
    if (!await confirm(message, detail, isDir ? 'Delete directory' : 'Delete file')) return { cancelled: true };
    if (v !== vault) throw new Error('The vault configuration changed.'); v.current(epoch);
    return removeLocalConfigEntry({ relPath });
  });
  ipcMain.on('hdv:activity', event => { if (trusted(event)) lastActivity = Date.now(); });
}
function makeWindow() {
  // macOS: inset traffic lights over the in-app title bar. Linux: frameless window with the Window Controls
  // Overlay (close/minimize/maximize drawn by Chromium) and the GTK menu bar hidden; the in-app title bar stays the drag region.
  const chrome = IS_MAC
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 } }
    : IS_LINUX ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0a0d1a', symbolColor: '#dfe6ff', height: 50 }, autoHideMenuBar: true } : {};
  win = new BrowserWindow({ width: 1240, height: 820, minWidth: 980, minHeight: 680, show: false, title: 'Hidden Door Vault', backgroundColor: '#06070e', ...chrome, icon: path.join(__dirname, '..', 'assets', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged, spellcheck: false, partition: 'hdv-ephemeral' } });
  win.setContentProtection(true); // macOS/Windows only; Linux compositors have no equivalent (documented in SECURITY.md).
  if (IS_LINUX) win.setMenuBarVisibility(false); // accelerators keep working with the bar hidden
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => { let allowed = false; try { const url = new URL(details.url); allowed = url.protocol === 'file:' && url.pathname.startsWith(pathToFileURL(path.join(__dirname, 'ui') + path.sep).pathname); } catch (_) {} callback({ cancel: !allowed }); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown') lastActivity = Date.now(); });
  win.webContents.on('render-process-gone', () => { lockVault(); });
  win.on('blur', () => { if (!touchIdPromptActive && !vault?.unlocked) windowBlurredWhileLocked = true; });
  win.on('focus', () => {
    if (!vault?.unlocked && !touchIdPromptActive && Date.now() - lastTouchIdEndAt >= 1500 && windowBlurredWhileLocked) {
      windowBlurredWhileLocked = false;
      setTimeout(requestAutoTouchId, 80);
    }
  });
  win.on('hide', () => { windowBlurredWhileLocked = true; if (settings.lockOnHide) lockVault(); });
  win.on('close', event => { if (!quitting) { event.preventDefault(); windowBlurredWhileLocked = true; lockVault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.loadFile(UI_PATH);
  win.once('ready-to-show', () => { if (!openedHidden()) showWindow(); });
}
function makeTray() {
  // macOS gets a template image (recoloured by the system). Linux panels do not invert template images,
  // so a gold keyhole that reads on both dark and light panels is used instead.
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', IS_LINUX ? 'linux/tray.png' : 'trayTemplate.png'));
  if (IS_MAC) icon.setTemplateImage(true);
  tray = new Tray(icon); tray.setToolTip('Hidden Door Vault');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open vault', click: () => setTimeout(showWindow, 30) },
    { label: 'Lock vault', click: lockVault },
    { type: 'separator' },
    { label: 'Quit Hidden Door Vault', click: () => app.quit() }
  ]);
  tray.on('click', (event) => {
    if (event && (event.ctrlKey || event.altKey)) tray.popUpContextMenu(contextMenu);
    else showWindow();
  });
  tray.on('right-click', () => tray.popUpContextMenu(contextMenu));
  // StatusNotifier/AppIndicator panels (GNOME, KDE) only deliver a menu, never click events.
  if (IS_LINUX) tray.setContextMenu(contextMenu);
}
function appMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Hidden Door Vault', submenu: [{ label: 'Open vault', accelerator: 'CmdOrCtrl+Shift+V', click: showWindow }, { label: 'Lock vault', accelerator: 'CmdOrCtrl+Shift+L', click: lockVault }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    const directory = app.getPath('userData'); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try { settings = JSON.parse((await readLimited(path.join(directory, 'settings.json'), 16384)).toString('utf8')); contextOf(settings.project, settings.vault); if (!Number.isInteger(settings.idleSeconds) || settings.idleSeconds < 60 || settings.idleSeconds > 1800) settings.idleSeconds = 300; settings.pruneKeep = pruneKeepOf(settings.pruneKeep); settings.pruneGraceHours = pruneGraceOf(settings.pruneGraceHours); } catch (_) { settings = {}; }
    store = new ProtectedStore(path.join(directory, 'auth'), safeStorage);
    auth = new GoogleAuth({ store, openExternal: url => shell.openExternal(url) });
    configureVault(); await syncLocalServers().catch(() => {}); wireIPC(); appMenu(); makeWindow(); makeTray();
    if (IS_MAC && openedHidden()) app.dock.hide();
    globalShortcut.register('Control+Alt+Space', showWindow); // not delivered on Wayland sessions; the tray and relaunch still open the window
    for (const event of ['suspend', 'lock-screen', 'shutdown']) powerMonitor.on(event, lockVault);
    for (const event of ['resume', 'unlock-screen']) powerMonitor.on(event, onSystemResume);
    // Electron does not emit lock-screen/unlock-screen on Linux; watch the session bus screensaver signals instead.
    if (IS_LINUX) sessionWatcher = linuxIntegration.watchScreenLock({ onLock: lockVault, onUnlock: onSystemResume });
    setInterval(() => { if (importing && Date.now() - lastProgress < 60000) return; if (vault?.unlocked && (Date.now() - lastActivity > (settings.idleSeconds || 300) * 1000 || powerMonitor.getSystemIdleTime() >= (settings.idleSeconds || 300))) lockVault(); }, 1000).unref();
  }).catch(() => { dialog.showErrorBox('Hidden Door Vault could not start', 'The app could not initialize its local storage or interface. Check permissions and rebuild the app. No vault credentials have been logged.'); app.quit(); });
}
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; lockVault(); bridgeServer?.stop().catch(() => {}); sshAgentServer?.stop().catch(() => {}); sessionWatcher?.stop(); auth?.cancel(); globalShortcut.unregisterAll(); });
