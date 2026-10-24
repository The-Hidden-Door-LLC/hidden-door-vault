'use strict';
const net = require('node:net');
const { LineFrames } = require('./line-frames.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validId, summary } = require('./records.cjs');
const generators = require('./core/generators.cjs'.replace('./core/', './'));
const { createPasskey, signPasskeyAssertion, normalizeRpId } = require('./passkeys.cjs');
const { MAX_FRAME_BYTES, failure, isDocumentRecord } = require('./document-format.cjs');

// Must match Electron's app.getPath('userData') for app.setName('Hidden Door Vault') on every platform,
// otherwise the CLI and Native Messaging host look for hdv.sock in the wrong directory.
function defaultUserDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.HDV_USER_DATA) return env.HDV_USER_DATA;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Hidden Door Vault');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Hidden Door Vault');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Hidden Door Vault');
}

function defaultSocketPath(userDataDir = defaultUserDataDir()) {
  return process.env.HDV_SOCKET || path.join(userDataDir, 'hdv.sock');
}

function defaultSshSocketPath(userDataDir = defaultUserDataDir()) {
  return process.env.HDV_SSH_AUTH_SOCK || path.join(userDataDir, 'ssh-agent.sock');
}

function extractHostname(urlOrHost) {
  if (!urlOrHost || typeof urlOrHost !== 'string') return '';
  const trimmed = urlOrHost.trim();
  if (!trimmed) return '';
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).hostname.toLowerCase();
    return new URL(`https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function registrableTail(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

function hostMatches(candidateHost, targetHost) {
  if (!candidateHost || !targetHost) return 0;
  const a = candidateHost.toLowerCase();
  const b = targetHost.toLowerCase();
  if (a === b) return 3;
  if (a.endsWith(`.${b}`) || b.endsWith(`.${a}`)) return 2;
  if (registrableTail(a) === registrableTail(b) && registrableTail(a).includes('.')) return 1;
  return 0;
}

// Parse hdv://<vault>/<item>/<field> or hdv://<item>/<field>
function parseSecretRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('hdv://')) throw new Error('Secret reference must start with hdv://');
  const rest = ref.slice('hdv://'.length);
  const parts = rest.split('/').map(p => decodeURIComponent(p.trim())).filter(Boolean);
  if (parts.length === 2) {
    return { vault: null, item: parts[0], field: parts[1] };
  }
  if (parts.length === 3) {
    return { vault: parts[0], item: parts[1], field: parts[2] };
  }
  throw new Error('Use hdv://<vault>/<item>/<field> or hdv://<item>/<field>.');
}

function findItem(vault, idOrTitle) {
  if (!idOrTitle || typeof idOrTitle !== 'string') throw new Error('Specify an item ID or title.');
  const q = idOrTitle.trim();
  if (validId(q)) return vault.get(q);
  const summaries = vault.list();
  const exact = summaries.find(s => !s.archived && s.title === q) || summaries.find(s => s.title === q);
  if (exact) return vault.get(exact.id);
  const lower = q.toLowerCase();
  const matches = summaries.filter(s => !s.archived && s.title.toLowerCase() === lower);
  if (matches.length === 1) return vault.get(matches[0].id);
  if (matches.length > 1) throw new Error(`Multiple items match "${q}". Use the item ID (${matches.map(m => m.id.slice(0, 8)).join(', ')}).`);
  const anyArchived = summaries.find(s => s.title.toLowerCase() === lower);
  if (anyArchived) return vault.get(anyArchived.id);
  throw new Error(`No item found matching "${q}".`);
}

function readItemField(item, fieldName) {
  if (isDocumentRecord(item)) throw failure('document_read_only', 'Document internals are unavailable through credential fields. Use documents-read.');
  const f = String(fieldName || 'password').trim();
  if (f === 'totp' || f === 'otp') {
    if (!item.totpSecret) throw new Error(`Item "${item.title}" has no TOTP secret.`);
    return generators.totp(item.totpSecret).value;
  }
  const aliases = {
    user: 'username',
    email: 'username',
    pass: 'password',
    website: 'url',
    cvv: 'securityCode',
    cvc: 'securityCode',
    card: 'number',
    recovery: 'recoveryCodes',
    recoverycodes: 'recoveryCodes',
    backupcodes: 'recoveryCodes',
    secret: item.kind === 'api' ? 'token' : (item.kind === 'recovery' ? 'recoveryCodes' : 'password')
  };
  const key = aliases[f.toLowerCase()] || f;
  if (!(key in item)) throw new Error(`Unknown field "${fieldName}" on item "${item.title}".`);
  return String(item[key] ?? '');
}

class BridgeServer {
  constructor({ socketPath, sshSocketPath, getVault, getBiometricStatus, getRuntimeStatus, ensureUnlocked, onLock, onVaultLocked, onUnlock, onVaultMutated, onActivity, onOpenInApp, confirmAction }) {
    this.socketPath = socketPath || defaultSocketPath();
    this.sshSocketPath = sshSocketPath || defaultSshSocketPath();
    this.getVault = getVault;
    this.getBiometricStatus = getBiometricStatus;
    this.getRuntimeStatus = getRuntimeStatus;
    this.ensureUnlocked = ensureUnlocked;
    this.onLock = onLock || onVaultLocked;
    this.onUnlock = onUnlock;
    this.onVaultMutated = onVaultMutated;
    this.onActivity = onActivity;
    this.onOpenInApp = onOpenInApp;
    this.confirmAction = confirmAction;
    this.server = null;
    this.enabled = false;
  }

  async start() {
    if (this.server) return;
    // sun_path is 108 bytes on Linux and 104 on macOS; a longer path silently fails or truncates.
    if (Buffer.byteLength(this.socketPath) > 100) throw new Error(`Socket path is too long for a Unix domain socket: ${this.socketPath}`);
    await fs.mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    try { await fs.unlink(this.socketPath); } catch (_) {}
    this.server = net.createServer(socket => this.handleConnection(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    await fs.chmod(this.socketPath, 0o600);
    this.enabled = true;
  }

  async stop() {
    this.enabled = false;
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise(resolve => s.close(() => resolve()));
    try { await fs.unlink(this.socketPath); } catch (_) {}
  }

  handleConnection(socket) {
    const frames = new LineFrames(MAX_FRAME_BYTES);
    socket.on('data', chunk => {
      try {
        frames.push(chunk, line => {
          if (!line) return;
          this.processLine(line).then(reply => {
            if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n');
          }).catch(err => {
            if (!socket.destroyed) socket.write(JSON.stringify({ ok: false, error: String(err?.message || 'Bridge error') }) + '\n');
          });
        });
      } catch { socket.destroy(); }
    });
    socket.on('error', () => {});
  }

  async processLine(line) {
    let req;
    try { req = JSON.parse(line); } catch { return { ok: false, error: 'Malformed JSON request.' }; }
    if (!req || typeof req !== 'object' || Array.isArray(req)) return { id: null, ok: false, error: 'A bridge request must be an object.' };
    const id = req.id ?? null;
    try {
      const data = await this.dispatch(req.action, req.payload || {});
      return { id, ok: true, data };
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message.slice(0, 500) : 'Operation failed.';
      return { id, ok: false, error: message, ...(typeof error.code === 'string' && /^[a-z_]{1,50}$/.test(error.code) ? { code: error.code } : {}) };
    }
  }

  async requireUnlockedVault(reason, autoUnlock = true) {
    const v = this.getVault?.();
    if (!v) throw new Error('Hidden Door Vault is not configured yet. Open the desktop app to configure your project and vault.');
    if (!v.unlocked && autoUnlock && this.ensureUnlocked) {
      await this.ensureUnlocked(reason);
    }
    v.requireUnlocked();
    this.onActivity?.();
    return v;
  }

  async dispatch(action, payload = {}) {
    if (action === 'status') {
      const v = this.getVault?.();
      let bio = {};
      try { bio = (await this.getBiometricStatus?.()) || {}; } catch (_) {}
      return {
        running: true,
        ...(this.getRuntimeStatus ? { runtime: this.getRuntimeStatus() } : {}),
        configured: Boolean(v),
        unlocked: Boolean(v?.unlocked),
        offline: Boolean(v?.offline),
        project: v?.project || '',
        vault: v?.vault || '',
        itemCount: v?.unlocked ? v.records.size : 0,
        documents: v?.documents?.capability() || { supported: false },
        biometricEnabled: Boolean(bio.enabled),
        biometricAvailable: Boolean(bio.available),
        biometricReason: bio.reason || '',
        socketPath: this.socketPath,
        sshSocketPath: this.sshSocketPath
      };
    }

    if (action === 'lock') {
      const v = this.getVault?.();
      v?.lock();
      this.onLock?.();
      return { unlocked: false };
    }

    if (['documents-list', 'documents-read', 'documents-write'].includes(action)) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('invalid_document', 'Supply a document request object.');
      const v = this.getVault?.();
      if (!v?.unlocked) throw failure('vault_locked', 'The vault is locked. Unlock Hidden Door Vault before opening or saving files.');
      if (!v.documents) throw failure('storage_not_configured', 'Document storage is not configured in Vault Settings.');
      this.onActivity?.();
      if (action === 'documents-list') return v.documents.list(payload);
      if (action === 'documents-read') return v.documents.read(payload);
      const saved = await v.documents.write(payload);
      this.onVaultMutated?.(saved, !payload.id);
      return saved;
    }

    if (action === 'unlock') {
      const v = this.getVault?.();
      if (!v) throw new Error('Configure a project and vault in the desktop app first.');
      if (v.unlocked) {
        this.onActivity?.();
        return { unlocked: true, count: v.records.size, offline: v.offline };
      }
      const cred = typeof payload.credential === 'string' && payload.credential
        ? payload.credential
        : (typeof payload.masterPassword === 'string' ? payload.masterPassword : '');
      if (cred) {
        const res = await v.unlock(cred, payload.recovery === true, payload.offline === true);
        this.onActivity?.();
        await this.onUnlock?.(res, false);
        this.onVaultMutated?.(null, false);
        return { unlocked: true, ...res };
      }
      if (this.ensureUnlocked) {
        await this.ensureUnlocked('unlock Hidden Door Vault', { biometricOnly: payload.biometric === true });
      }
      v.requireUnlocked();
      return { unlocked: true, count: v.records.size, offline: v.offline };
    }

    if (action === 'open-in-app') {
      const id = String(payload.id || '').trim();
      const mode = String(payload.mode || 'browse').trim();
      if (id && payload.autoUnlock !== false) {
        await this.requireUnlockedVault('open item in Hidden Door Vault', true);
      }
      this.onActivity?.();
      await this.onOpenInApp?.({ id, mode });
      return { opened: true, id, mode };
    }

    if (action === 'generate') {
      const type = payload.type || 'password';
      if (type === 'password') return generators.password(payload.options || {});
      if (type === 'token') return generators.token(payload.options || {});
      if (type === 'ssh') return generators.ssh(payload.options?.comment || 'hidden-door-vault');
      throw new Error(`Unsupported generator type: ${type}`);
    }

    if (action === 'list') {
      const v = await this.requireUnlockedVault('list vault items', payload.autoUnlock !== false);
      const search = String(payload.search || '').toLowerCase().trim();
      const kind = payload.kind || '';
      const includeArchived = payload.includeArchived === true;
      return v.list().filter(item => {
        if (!includeArchived && item.archived) return false;
        if (kind && item.kind !== kind) return false;
        if (search && !`${item.title} ${item.subtitle} ${item.tags} ${item.url || ''} ${item.passkeyRpId || ''}`.toLowerCase().includes(search)) return false;
        return true;
      });
    }

    if (action === 'get') {
      const v = await this.requireUnlockedVault('read credential from vault', payload.autoUnlock !== false);
      const item = findItem(v, payload.id || payload.title);
      if (isDocumentRecord(item)) throw failure('document_read_only', 'Use documents-read to open a file. Internal document keys are not credential fields.');
      if (payload.field) {
        return { id: item.id, title: item.title, field: payload.field, value: readItemField(item, payload.field) };
      }
      return item;
    }

    if (action === 'totp') {
      const v = await this.requireUnlockedVault('generate TOTP code', payload.autoUnlock !== false);
      const item = findItem(v, payload.id || payload.title);
      if (!item.totpSecret) throw new Error(`Item "${item.title}" does not have a TOTP secret.`);
      return { id: item.id, title: item.title, ...generators.totp(item.totpSecret) };
    }

    if (action === 'read-ref') {
      const v = await this.requireUnlockedVault('read secret reference', payload.autoUnlock !== false);
      const parsed = parseSecretRef(payload.ref);
      if (parsed.vault && parsed.vault !== v.vault && parsed.vault !== 'default') {
        throw new Error(`Active vault is "${v.vault}", but reference requested vault "${parsed.vault}".`);
      }
      const item = findItem(v, parsed.item);
      return { ref: payload.ref, value: readItemField(item, parsed.field) };
    }

    if (action === 'resolve-env') {
      const v = await this.requireUnlockedVault('inject secrets into command environment', payload.autoUnlock !== false);
      const refs = payload.refs || {};
      if (typeof refs !== 'object' || Array.isArray(refs)) throw new Error('Invalid refs map.');
      const resolved = {};
      for (const [envKey, ref] of Object.entries(refs)) {
        const parsed = parseSecretRef(ref);
        if (parsed.vault && parsed.vault !== v.vault && parsed.vault !== 'default') {
          throw new Error(`Env ${envKey}: active vault is "${v.vault}", but reference requested "${parsed.vault}".`);
        }
        const item = findItem(v, parsed.item);
        resolved[envKey] = readItemField(item, parsed.field);
      }
      return { resolved };
    }

    if (action === 'save-item') {
      const v = await this.requireUnlockedVault('save credential to vault', payload.autoUnlock !== false);
      const input = { ...(payload.item || {}) };
      if (!input.id && payload.target) {
        const existing = findItem(v, payload.target);
        input.id = existing.id;
        for (const [k, val] of Object.entries(existing)) {
          if (input[k] === undefined) input[k] = val;
        }
      }
      const isNew = !input.id;
      const saved = await v.save(input);
      this.onVaultMutated?.(saved, isNew);
      return saved;
    }

    if (action === 'match-logins') {
      const host = extractHostname(payload.url || payload.rpId);
      const rawVault = this.getVault?.();
      if (payload.gracefulLocked === true && payload.autoUnlock !== true && (!rawVault || !rawVault.unlocked)) {
        let bio = {};
        try { bio = (await this.getBiometricStatus?.()) || {}; } catch (_) {}
        return {
          locked: true,
          unlocked: false,
          biometricEnabled: Boolean(bio.enabled),
          biometricAvailable: Boolean(bio.available),
          host,
          matches: [],
          items: []
        };
      }
      const v = await this.requireUnlockedVault('match logins for browser tab', payload.autoUnlock === true);
      if (!host) return { locked: false, unlocked: true, host: '', matches: [], items: [] };
      const matches = [];
      for (const item of v.records.values()) {
        if (item.archived || item.kind !== 'login') continue;
        const urlScore = hostMatches(extractHostname(item.url), host);
        const rpScore = hostMatches(item.passkeyRpId, host);
        const score = Math.max(urlScore, rpScore);
        if (score > 0) {
          matches.push({
            score,
            id: item.id,
            title: item.title,
            username: item.username || item.passkeyUserName || '',
            url: item.url || '',
            hasPassword: Boolean(item.password),
            hasTotp: Boolean(item.totpSecret),
            hasPasskey: Boolean(item.passkeyId && item.passkeyPrivateKey),
            hasRecoveryCodes: Boolean(item.recoveryCodes && item.recoveryCodes.trim()),
            passkeyId: item.passkeyId || '',
            passkeyRpId: item.passkeyRpId || '',
            passkeyUserName: item.passkeyUserName || item.username || '',
            favorite: item.favorite
          });
        }
      }
      matches.sort((a, b) => (b.score - a.score) || (Number(b.favorite) - Number(a.favorite)) || a.title.localeCompare(b.title));
      return { locked: false, unlocked: true, host, matches, items: matches };
    }

    if (action === 'autofill-get') {
      const v = await this.requireUnlockedVault('autofill login credentials', true);
      const item = findItem(v, payload.id);
      if (item.kind !== 'login') throw new Error('Selected item is not a login.');
      if (payload.url) {
        const reqHost = extractHostname(payload.url);
        const itemHost = extractHostname(item.url) || item.passkeyRpId;
        if (reqHost && itemHost && hostMatches(itemHost, reqHost) === 0 && !payload.allowCrossOrigin) {
          throw new Error(`Domain mismatch: credential "${item.title}" does not match ${reqHost}.`);
        }
      }
      let totpCode = '';
      if (item.totpSecret) {
        try { totpCode = generators.totp(item.totpSecret).value; } catch (_) {}
      }
      return {
        id: item.id,
        title: item.title,
        username: item.username || item.passkeyUserName || '',
        password: item.password || '',
        totp: totpCode,
        url: item.url || ''
      };
    }

    if (action === 'check-autosave') {
      const urlStr = String(payload.url || '').trim();
      const host = extractHostname(urlStr || payload.host);
      const password = String(payload.password || '');
      const username = String(payload.username || '').trim();
      if (!host || !password) return { action: 'ignore', status: 'ignore', host };

      const rawTitle = String(payload.title || '').trim();
      const cleanTitle = (rawTitle && !/^https?:\/\//i.test(rawTitle) ? rawTitle.split(/\s+[-|·•—]\s+/)[0].trim() : '') || host;

      const v = this.getVault?.();
      if (!v || !v.unlocked) {
        let bio = {};
        try { bio = (await this.getBiometricStatus?.()) || {}; } catch (_) {}
        return {
          action: 'prompt',
          status: 'locked',
          mode: 'create',
          locked: true,
          unlocked: false,
          biometricEnabled: Boolean(bio.enabled),
          host,
          suggestedTitle: cleanTitle.slice(0, 120),
          username
        };
      }

      const hostItems = [];
      for (const item of v.records.values()) {
        if (item.archived || item.kind !== 'login') continue;
        const score = hostMatches(extractHostname(item.url), host);
        if (score >= 2) hostItems.push({ item, score });
      }
      hostItems.sort((a, b) => (b.score - a.score) || (Number(b.item.favorite) - Number(a.item.favorite)));

      const userLower = username.toLowerCase();
      // 1. Check if exact same (host, username, password) already exists
      for (const { item } of hostItems) {
        const itemUser = (item.username || '').trim().toLowerCase();
        const sameUser = !userLower || !itemUser || itemUser === userLower;
        if (sameUser && item.password === password) {
          // If the stored item was missing a username and the user just typed one, offer to update username
          if (username && !item.username) {
            return {
              action: 'prompt',
              status: 'update-password',
              mode: 'update',
              locked: false,
              unlocked: true,
              host,
              existingId: item.id,
              existingTitle: item.title,
              existingUsername: item.username || '',
              suggestedTitle: item.title,
              username
            };
          }
          return { action: 'none', status: 'already-saved', reason: 'already-saved', itemId: item.id, host };
        }
      }

      // 2. Check if same (host, username) exists with a different password -> offer Update
      let updateTarget = null;
      if (userLower) {
        updateTarget = hostItems.find(({ item }) => (item.username || '').trim().toLowerCase() === userLower)?.item || null;
      }
      if (!updateTarget && hostItems.length === 1 && (!userLower || !hostItems[0].item.username)) {
        updateTarget = hostItems[0].item;
      }

      if (updateTarget) {
        return {
          action: 'prompt',
          status: 'update-password',
          mode: 'update',
          locked: false,
          unlocked: true,
          host,
          existingId: updateTarget.id,
          existingTitle: updateTarget.title,
          existingUsername: updateTarget.username || '',
          suggestedTitle: updateTarget.title,
          username: username || updateTarget.username || ''
        };
      }

      return {
        action: 'prompt',
        status: 'new-login',
        mode: 'create',
        locked: false,
        unlocked: true,
        host,
        suggestedTitle: cleanTitle.slice(0, 120),
        username
      };
    }

    if (action === 'save-login' || action === 'autocreate-login') {
      const isAutoCreate = action === 'autocreate-login';
      const v = await this.requireUnlockedVault(isAutoCreate ? 'create and save new password in vault' : 'save login to Hidden Door Vault', true);
      const urlStr = String(payload.url || '').trim();
      const host = extractHostname(urlStr || payload.host);
      if (!host) throw new Error('A valid website URL is required to save a login.');
      let cleanOriginUrl = `https://${host}`;
      try {
        const parsedUrl = new URL(urlStr);
        if (['https:', 'http:'].includes(parsedUrl.protocol)) {
          cleanOriginUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`;
        }
      } catch (_) {}

      const reqLength = Number(payload.length);
      const safeLength = Number.isInteger(reqLength) && reqLength >= 8 && reqLength <= 128 ? reqLength : 32;
      const generated = payload.password
        ? { value: String(payload.password), bits: 0 }
        : generators.password({
          length: safeLength,
          allowShort: true,
          symbols: payload.symbols !== false,
          digits: payload.digits !== false,
          upper: payload.upper !== false,
          lower: payload.lower !== false,
          avoidAmbiguous: Boolean(payload.avoidAmbiguous),
          allowedSymbols: typeof payload.allowedSymbols === 'string' ? payload.allowedSymbols : undefined
        });
      const username = String(payload.username || '').trim();
      const explicitTitle = payload.title ? String(payload.title).trim().slice(0, 200) : '';

      let targetItem = null;
      const targetId = payload.overwriteId || payload.id || '';
      if (targetId && validId(targetId) && v.records.has(targetId)) {
        targetItem = v.get(targetId);
      } else if (payload.updateExisting) {
        const userLower = username.toLowerCase();
        for (const item of v.records.values()) {
          if (item.archived || item.kind !== 'login') continue;
          if (hostMatches(extractHostname(item.url), host) < 2) continue;
          const itemUser = (item.username || '').trim().toLowerCase();
          if (!userLower || !itemUser || itemUser === userLower) {
            targetItem = item;
            break;
          }
        }
      }

      const saved = await v.save({
        ...(targetItem || {}),
        kind: 'login',
        title: explicitTitle || targetItem?.title || host,
        username: username || targetItem?.username || '',
        password: generated.value,
        url: targetItem?.url || cleanOriginUrl
      });
      this.onVaultMutated?.(saved, !targetItem);
      return {
        id: saved.id,
        title: saved.title,
        action: targetItem ? 'updated' : 'created',
        updated: Boolean(targetItem),
        item: summary(saved),
        username: saved.username,
        password: saved.password,
        bits: generated.bits
      };
    }

    if (action === 'passkey-candidates') {
      const { rpId } = normalizeRpId(payload.rpId, payload.origin || `https://${payload.rpId}`);
      const rawVault = this.getVault?.();
      if (payload.gracefulLocked === true && payload.autoUnlock !== true && (!rawVault || !rawVault.unlocked)) {
        let bio = {};
        try { bio = (await this.getBiometricStatus?.()) || {}; } catch (_) {}
        return {
          locked: true,
          unlocked: false,
          biometricEnabled: Boolean(bio.enabled),
          biometricAvailable: Boolean(bio.available),
          rpId,
          candidates: [],
          items: [],
          excludedMatches: []
        };
      }
      const v = await this.requireUnlockedVault('check passkeys for website', payload.autoUnlock === true);
      const allowed = Array.isArray(payload.allowCredentialIds) && payload.allowCredentialIds.length
        ? new Set(payload.allowCredentialIds.map(String))
        : null;
      const excluded = Array.isArray(payload.excludeCredentialIds) && payload.excludeCredentialIds.length
        ? new Set(payload.excludeCredentialIds.map(String))
        : null;
      const candidates = [];
      const excludedMatches = [];
      for (const item of v.records.values()) {
        if (item.archived || item.kind !== 'login' || !item.passkeyId || !item.passkeyPrivateKey) continue;
        const itemRp = item.passkeyRpId.toLowerCase();
        if (itemRp !== rpId && hostMatches(itemRp, rpId) < 2) continue;
        const entry = {
          id: item.id,
          title: item.title,
          username: item.username || item.passkeyUserName || '',
          passkeyId: item.passkeyId,
          passkeyRpId: item.passkeyRpId,
          passkeyRpName: item.passkeyRpName || item.passkeyRpId,
          passkeyUserName: item.passkeyUserName || item.username || '',
          passkeyUserHandle: item.passkeyUserHandle || '',
          passkeyAlgorithm: item.passkeyAlgorithm || 'ES256'
        };
        if (excluded && excluded.has(item.passkeyId)) {
          excludedMatches.push(entry);
        }
        if (allowed && !allowed.has(item.passkeyId)) continue;
        candidates.push(entry);
      }
      return { locked: false, rpId, candidates, items: candidates, excludedMatches };
    }

    if (action === 'passkey-create') {
      const v = await this.requireUnlockedVault('register a passkey in Hidden Door Vault', true);
      const { rpId, origin } = normalizeRpId(payload.rpId, payload.origin || `https://${payload.rpId}`);
      if (this.confirmAction && payload.skipConfirm !== true) {
        const ok = await this.confirmAction({
          type: 'passkey-create',
          rpId,
          rpName: payload.rpName || rpId,
          userName: payload.userName || payload.userDisplayName || '',
          origin
        });
        if (!ok) throw new Error('Passkey registration was cancelled.');
      }
      const { recordFields, credential } = createPasskey({
        rpId,
        rpName: payload.rpName || rpId,
        origin,
        challenge: payload.challenge,
        clientDataJSON: payload.clientDataJSON,
        userId: payload.userId,
        userHandle: payload.userHandle,
        userName: payload.userName,
        userDisplayName: payload.userDisplayName,
        alg: payload.algorithm || payload.alg,
        credParams: payload.pubKeyCredParams || payload.credParams
      });

      let existing = null;
      if (payload.itemId && validId(payload.itemId) && v.records.has(payload.itemId)) {
        existing = v.get(payload.itemId);
      } else {
        const userLower = String(payload.userName || '').toLowerCase();
        for (const item of v.records.values()) {
          if (item.archived || item.kind !== 'login') continue;
          const sameHost = hostMatches(extractHostname(item.url), rpId) >= 2 || item.passkeyRpId.toLowerCase() === rpId;
          const sameUser = !userLower || (item.username && item.username.toLowerCase() === userLower) || (item.passkeyUserName && item.passkeyUserName.toLowerCase() === userLower);
          if (sameHost && sameUser && (!item.passkeyId || payload.replaceExisting === true)) {
            existing = item;
            break;
          }
        }
      }

      const saved = await v.save({
        ...(existing || {}),
        kind: 'login',
        title: existing?.title || String(payload.title || payload.rpName || rpId).slice(0, 200),
        username: existing?.username || recordFields.passkeyUserName || '',
        url: existing?.url || origin,
        ...recordFields
      });
      this.onVaultMutated?.(saved, !existing);
      return {
        itemId: saved.id,
        credentialId: credential.id,
        rawId: credential.rawId,
        rpId,
        algorithm: saved.passkeyAlgorithm,
        response: credential.response,
        item: summary(saved),
        credential
      };
    }

    if (action === 'passkey-get') {
      const v = await this.requireUnlockedVault('sign in with a passkey from Hidden Door Vault', true);
      const { rpId, origin } = normalizeRpId(payload.rpId, payload.origin || `https://${payload.rpId}`);
      const allowed = Array.isArray(payload.allowCredentialIds) && payload.allowCredentialIds.length
        ? new Set(payload.allowCredentialIds.map(String))
        : null;

      let target = null;
      if (payload.itemId && validId(payload.itemId) && v.records.has(payload.itemId)) {
        target = v.get(payload.itemId);
      } else if (payload.credentialId) {
        for (const item of v.records.values()) {
          if (!item.archived && item.kind === 'login' && item.passkeyId === payload.credentialId && (item.passkeyRpId.toLowerCase() === rpId || hostMatches(item.passkeyRpId, rpId) >= 2)) {
            target = item;
            break;
          }
        }
      } else {
        for (const item of v.records.values()) {
          if (item.archived || item.kind !== 'login' || !item.passkeyId || !item.passkeyPrivateKey) continue;
          const itemRp = item.passkeyRpId.toLowerCase();
          if (itemRp !== rpId && hostMatches(itemRp, rpId) < 2) continue;
          if (allowed && !allowed.has(item.passkeyId)) continue;
          target = item;
          break;
        }
      }

      if (!target) throw new Error(`No passkey found in vault for ${rpId}.`);
      if (this.confirmAction && payload.skipConfirm !== true) {
        const ok = await this.confirmAction({
          type: 'passkey-get',
          rpId,
          title: target.title,
          userName: target.passkeyUserName || target.username || '',
          origin
        });
        if (!ok) throw new Error('Passkey sign-in was cancelled.');
      }

      const { signCount, credential } = signPasskeyAssertion(target, {
        rpId: target.passkeyRpId || rpId,
        origin,
        challenge: payload.challenge,
        clientDataJSON: payload.clientDataJSON
      });

      const updatedRecord = { ...target, passkeySignCount: signCount, updatedAt: new Date().toISOString() };
      v.records.set(target.id, updatedRecord);
      if (!v.offline && !v.writing && payload.persistCounter === true) {
        try {
          const saved = await v.save(updatedRecord);
          this.onVaultMutated?.(saved, false);
        } catch (_) {}
      }
      return {
        itemId: updatedRecord.id,
        credentialId: credential.id,
        rawId: credential.rawId,
        signCount,
        response: credential.response,
        item: summary(updatedRecord),
        credential
      };
    }

    throw new Error(`Unknown bridge action: ${action}`);
  }
}

function sendBridgeRequest(action, payload = {}, options = {}) {
  const opts = typeof options === 'string' ? { socketPath: options } : (options || {});
  const socketPath = opts.socketPath || defaultSocketPath();
  const timeoutMs = opts.timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    const requestLine = JSON.stringify({ id: 1, action, payload }) + '\n';
    if (Buffer.byteLength(requestLine) > MAX_FRAME_BYTES) { reject(new Error('Vault request exceeds the 24 MiB transport limit.')); return; }
    const socket = net.createConnection(socketPath);
    const frames = new LineFrames(MAX_FRAME_BYTES);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('Timed out waiting for Hidden Door Vault desktop agent.'));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(requestLine);
    });
    socket.on('data', chunk => {
      if (settled) return;
      try {
        frames.push(chunk, line => {
          settled = true;
          clearTimeout(timer);
          socket.end();
          try {
            const res = JSON.parse(line);
            if (!res.ok) reject(new Error(res.error || 'Operation failed.'));
            else resolve(res.data);
          } catch {
            reject(new Error('Invalid response from Hidden Door Vault agent.'));
          }
          return false;
        });
      } catch {
        settled = true; clearTimeout(timer); socket.destroy();
        reject(new Error('Vault response exceeds the 24 MiB transport limit.'));
      }
    });
    socket.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('Hidden Door Vault desktop app is not running or local CLI/browser bridge is disabled in Settings.'));
      } else {
        reject(err);
      }
    });
  });
}

module.exports = {
  BridgeServer,
  sendBridgeRequest,
  defaultUserDataDir,
  defaultSocketPath,
  defaultSshSocketPath,
  extractHostname,
  hostMatches,
  parseSecretRef,
  findItem,
  readItemField
};
