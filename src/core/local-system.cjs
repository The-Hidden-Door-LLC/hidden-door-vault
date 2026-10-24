'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IGNORED_SSH_FILES = new Set([
  'config',
  'known_hosts',
  'known_hosts.old',
  'authorized_keys',
  'authorized_keys2',
  'environment',
  'rc',
  '.DS_Store'
]);

const SKIP_CONFIG_DIRS = new Set([
  '.git',
  'node_modules',
  'Cache',
  'CachedData',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'ShaderCache',
  'blob_storage',
  'Session Storage',
  'Local Storage',
  'IndexedDB',
  'Crashpad',
  'logs',
  'tmp',
  '__pycache__'
]);

const BINARY_EXT = /\.(db|sqlite|sqlite3|wal|shm|png|jpg|jpeg|gif|webp|ico|icns|woff|woff2|ttf|otf|dylib|so|dll|exe|bin|dat|pack|idx|tar|gz|zip|tgz|zst|pdf|mp3|mp4|mov)$/i;
const SENSITIVE_NAME = /(token|secret|key|cred|auth|pass|env|oauth|jwt|private|wireguard|id_rsa|id_ed25519|\.pem$|\.key$|\.p12$|\.pfx$)/i;

function formatMode(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

function algoLabel(type = '') {
  const t = String(type).toLowerCase();
  if (t.includes('ed25519')) return 'ED25519';
  if (t.includes('rsa')) return 'RSA';
  if (t.includes('ecdsa')) return 'ECDSA';
  if (t.includes('dss') || t.includes('dsa')) return 'DSA';
  return t ? t.toUpperCase() : 'SSH';
}

function fingerprintFromBlob(blobBuffer) {
  try {
    const digest = crypto.createHash('sha256').update(blobBuffer).digest('base64').replace(/=+$/, '');
    return `SHA256:${digest}`;
  } catch {
    return '';
  }
}

function parsePublicKeyLine(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const parts = trimmed.split(/\s+/);
  let idx = parts.findIndex(p => /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-\S+|sk-(ssh-ed25519|ecdsa-sha2-\S+))$/i.test(p));
  let options = '';
  if (idx > 0) {
    options = parts.slice(0, idx).join(' ');
  } else if (idx < 0) {
    return null;
  }
  const type = parts[idx] || '';
  const b64 = parts[idx + 1] || '';
  const comment = parts.slice(idx + 2).join(' ');
  if (!type || !b64) return null;
  let blob;
  try {
    blob = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (!blob || blob.length < 16) return null;
  return {
    options,
    type,
    algorithm: algoLabel(type),
    base64: b64,
    comment,
    fingerprint: fingerprintFromBlob(blob),
    publicKey: `${type} ${b64}${comment ? ` ${comment}` : ''}`
  };
}

function readUInt32(buf, offset) {
  if (offset + 4 > buf.length) return null;
  return buf.readUInt32BE(offset);
}

function readSshString(buf, offset) {
  const len = readUInt32(buf, offset);
  if (len === null || offset + 4 + len > buf.length) return null;
  return { value: buf.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
}

function inspectOpenSshPrivateKeyText(raw = '') {
  const text = String(raw || '');
  const isOpenSsh = text.includes('-----BEGIN OPENSSH PRIVATE KEY-----');
  const isPemPrivate = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text);
  if (!isOpenSsh && !isPemPrivate) return null;
  const info = {
    algorithm: 'SSH',
    type: '',
    encrypted: /ENCRYPTED/i.test(text),
    fingerprint: '',
    publicKey: '',
    comment: ''
  };
  if (text.includes('RSA PRIVATE KEY')) info.algorithm = 'RSA';
  if (text.includes('EC PRIVATE KEY')) info.algorithm = 'ECDSA';
  if (!isOpenSsh) return info;

  try {
    const body = text
      .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/, '')
      .replace(/-----END OPENSSH PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const buf = Buffer.from(body, 'base64');
    const magic = 'openssh-key-v1\0';
    if (buf.subarray(0, magic.length).toString('utf8') !== magic) return info;
    let offset = magic.length;
    const cipher = readSshString(buf, offset); if (!cipher) return info; offset = cipher.next;
    const kdf = readSshString(buf, offset); if (!kdf) return info; offset = kdf.next;
    const kdfOpts = readSshString(buf, offset); if (!kdfOpts) return info; offset = kdfOpts.next;
    const numKeys = readUInt32(buf, offset); if (numKeys === null) return info; offset += 4;
    const pubBlob = readSshString(buf, offset); if (!pubBlob) return info; offset = pubBlob.next;

    const cipherName = cipher.value.toString('utf8');
    info.encrypted = cipherName !== 'none';
    info.fingerprint = fingerprintFromBlob(pubBlob.value);

    const kType = readSshString(pubBlob.value, 0);
    if (kType) {
      info.type = kType.value.toString('utf8');
      info.algorithm = algoLabel(info.type);
      info.publicKey = `${info.type} ${pubBlob.value.toString('base64')}`;
    }

    if (!info.encrypted) {
      const privBlob = readSshString(buf, offset);
      if (privBlob && privBlob.value.length > 8) {
        // Parse comment if Ed25519 unencrypted private blob
        let pOff = 8; // two uint32 checkints
        const privType = readSshString(privBlob.value, pOff);
        if (privType) {
          pOff = privType.next;
          const tStr = privType.value.toString('utf8');
          if (tStr === 'ssh-ed25519') {
            const pk = readSshString(privBlob.value, pOff);
            const sk = pk ? readSshString(privBlob.value, pk.next) : null;
            const cmt = sk ? readSshString(privBlob.value, sk.next) : null;
            if (cmt) {
              info.comment = cmt.value.toString('utf8');
              if (info.comment && info.publicKey) info.publicKey = `${info.publicKey} ${info.comment}`;
            }
          }
        }
      }
    }
  } catch {
    // Ignore binary parse errors
  }
  return info;
}

function readTextSafe(filePath, maxBytes = 256 * 1024) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > maxBytes) return null;
    const buf = fs.readFileSync(filePath);
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    if (sample.includes(0)) return null; // binary
    return { text: buf.toString('utf8'), stat: st };
  } catch {
    return null;
  }
}

function parseSshConfig(text = '') {
  const hosts = [];
  let current = null;
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z0-9]+)\s*(?:=\s*|\s+)(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host') {
      current = {
        host: val,
        patterns: val.split(/\s+/).filter(Boolean),
        hostName: '',
        user: '',
        port: '',
        identityFile: '',
        proxyJump: '',
        identityAgent: '',
        forwardAgent: '',
        options: []
      };
      hosts.push(current);
      continue;
    }
    if (!current) {
      current = {
        host: '*',
        patterns: ['*'],
        hostName: '',
        user: '',
        port: '',
        identityFile: '',
        proxyJump: '',
        identityAgent: '',
        forwardAgent: '',
        options: []
      };
      hosts.push(current);
    }
    if (key === 'hostname') current.hostName = val;
    else if (key === 'user') current.user = val;
    else if (key === 'port') current.port = val;
    else if (key === 'identityfile') current.identityFile = val;
    else if (key === 'proxyjump') current.proxyJump = val;
    else if (key === 'identityagent') current.identityAgent = val;
    else if (key === 'forwardagent') current.forwardAgent = val;
    current.options.push({ key: m[1], value: val });
  }
  return hosts;
}

function parseAuthorizedKeys(text = '') {
  const entries = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parsePublicKeyLine(lines[i]);
    if (!parsed) continue;
    entries.push({
      line: i + 1,
      options: parsed.options,
      type: parsed.type,
      keyType: parsed.algorithm,
      algorithm: parsed.algorithm,
      fingerprint: parsed.fingerprint,
      comment: parsed.comment || `Key #${entries.length + 1}`,
      publicKey: parsed.publicKey,
      raw: parsed.publicKey
    });
  }
  return entries;
}

function parseKnownHosts(text = '') {
  const entries = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    let marker = '';
    let idx = 0;
    if (parts[0]?.startsWith('@')) {
      marker = parts[0];
      idx = 1;
    }
    const hostField = parts[idx] || '';
    const type = parts[idx + 1] || '';
    const b64 = parts[idx + 2] || '';
    const comment = parts.slice(idx + 3).join(' ');
    if (!hostField || !type || !b64) continue;
    let fp = '';
    try {
      const blob = Buffer.from(b64, 'base64');
      if (blob.length >= 16) fp = fingerprintFromBlob(blob);
    } catch {}
    const hashed = hostField.startsWith('|1|');
    const hosts = hashed ? ['(hashed host)'] : hostField.split(',').filter(Boolean);
    const algorithm = algoLabel(type);
    entries.push({
      line: i + 1,
      marker,
      host: hosts.join(', '),
      hosts,
      rawHostField: hostField,
      hashed,
      type,
      keyType: algorithm,
      algorithm,
      fingerprint: fp,
      comment,
      revoked: marker === '@revoked',
      certAuthority: marker === '@cert-authority',
      publicKey: `${type} ${b64}${comment ? ` ${comment}` : ''}`
    });
  }
  return entries;
}

function resolveSshDir(dirOrHome = path.join(os.homedir(), '.ssh')) {
  if (path.basename(dirOrHome) === '.ssh') return dirOrHome;
  const candidate = path.join(dirOrHome, '.ssh');
  return fs.existsSync(candidate) ? candidate : dirOrHome;
}

function resolveConfigDir(dirOrHome = path.join(os.homedir(), '.config')) {
  if (path.basename(dirOrHome) === '.config') return dirOrHome;
  const candidate = path.join(dirOrHome, '.config');
  return fs.existsSync(candidate) ? candidate : dirOrHome;
}

function inspectLocalSsh(dirOrHome = path.join(os.homedir(), '.ssh')) {
  const sshDir = resolveSshDir(dirOrHome);
  const result = {
    sshDir,
    exists: false,
    keys: [],
    config: { exists: false, path: '~/.ssh/config', raw: '', hosts: [] },
    configHosts: [],
    configRaw: '',
    configMeta: { exists: false, path: '~/.ssh/config' },
    authorizedKeys: { exists: false, path: '~/.ssh/authorized_keys', raw: '', keys: [] },
    authorizedMeta: { exists: false, path: '~/.ssh/authorized_keys' },
    knownHosts: { exists: false, path: '~/.ssh/known_hosts', raw: '', totalLines: 0, hosts: [] },
    knownMeta: { exists: false, path: '~/.ssh/known_hosts', totalEntries: 0 }
  };

  let entries = [];
  try {
    if (!fs.existsSync(sshDir)) return result;
    result.exists = true;
    entries = fs.readdirSync(sshDir, { withFileTypes: true });
  } catch {
    return result;
  }

  // 1. Parse ~/.ssh/config
  const cfgFile = readTextSafe(path.join(sshDir, 'config'), 128 * 1024);
  if (cfgFile) {
    result.configRaw = cfgFile.text;
    result.configHosts = parseSshConfig(cfgFile.text);
    result.configMeta = {
      exists: true,
      path: '~/.ssh/config',
      mode: formatMode(cfgFile.stat.mode),
      updatedAt: cfgFile.stat.mtime.toISOString(),
      size: cfgFile.stat.size
    };
    result.config = {
      ...result.configMeta,
      raw: result.configRaw,
      hosts: result.configHosts
    };
  }

  // 2. Parse ~/.ssh/authorized_keys
  const authFile = readTextSafe(path.join(sshDir, 'authorized_keys'), 256 * 1024);
  if (authFile) {
    const authEntries = parseAuthorizedKeys(authFile.text);
    result.authorizedMeta = {
      exists: true,
      path: '~/.ssh/authorized_keys',
      mode: formatMode(authFile.stat.mode),
      updatedAt: authFile.stat.mtime.toISOString(),
      size: authFile.stat.size
    };
    result.authorizedKeys = {
      ...result.authorizedMeta,
      raw: authFile.text,
      keys: authEntries
    };
  }

  // 3. Parse ~/.ssh/known_hosts
  const knownFile = readTextSafe(path.join(sshDir, 'known_hosts'), 512 * 1024);
  if (knownFile) {
    const allKnown = parseKnownHosts(knownFile.text);
    result.knownMeta = {
      exists: true,
      path: '~/.ssh/known_hosts',
      mode: formatMode(knownFile.stat.mode),
      updatedAt: knownFile.stat.mtime.toISOString(),
      size: knownFile.stat.size,
      totalEntries: allKnown.length
    };
    result.knownHosts = {
      ...result.knownMeta,
      raw: knownFile.text,
      totalLines: allKnown.length,
      hosts: allKnown.slice(0, 300)
    };
  }

  // 4. Discover local SSH keys
  const keyNames = new Set();
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const name = entry.name;
    if (IGNORED_SSH_FILES.has(name) || name.startsWith('.') || /\.(old|bak|swp|tmp|cert)$/i.test(name)) continue;
    if (name.endsWith('.pub')) {
      keyNames.add(name.slice(0, -4));
    } else {
      keyNames.add(name);
    }
  }

  for (const name of [...keyNames].sort()) {
    const privPath = path.join(sshDir, name);
    const pubPath = path.join(sshDir, `${name}.pub`);
    const privFile = readTextSafe(privPath, 64 * 1024);
    const pubFile = readTextSafe(pubPath, 32 * 1024);

    const parsedPub = pubFile ? parsePublicKeyLine(pubFile.text.split(/\r?\n/)[0]) : null;
    const parsedPriv = privFile ? inspectOpenSshPrivateKeyText(privFile.text) : null;

    if (!parsedPub && !parsedPriv) continue;

    const stat = privFile?.stat || pubFile?.stat;
    const modeNum = stat ? stat.mode : 0o600;
    const mode = formatMode(modeNum);
    const privateMode = privFile ? formatMode(privFile.stat.mode) : '';
    const publicMode = pubFile ? formatMode(pubFile.stat.mode) : '';
    const modeOk = privFile ? (modeNum & 0o077) === 0 : true;

    const usedByHosts = result.configHosts
      .filter(h => {
        if (!h.identityFile) return false;
        const base = path.basename(h.identityFile.replace(/\.pub$/, ''));
        return base === name;
      })
      .map(h => h.host);

    const algorithm = parsedPub?.algorithm || parsedPriv?.algorithm || 'SSH';
    result.keys.push({
      name,
      algorithm,
      keyType: algorithm,
      type: parsedPub?.type || parsedPriv?.type || '',
      fingerprint: parsedPub?.fingerprint || parsedPriv?.fingerprint || '',
      comment: parsedPub?.comment || parsedPriv?.comment || name,
      publicKey: parsedPub?.publicKey || parsedPriv?.publicKey || '',
      hasPrivate: Boolean(parsedPriv),
      hasPublic: Boolean(parsedPub),
      encrypted: Boolean(parsedPriv?.encrypted),
      mode,
      privateMode,
      publicMode,
      modeOk,
      updatedAt: stat ? stat.mtime.toISOString() : '',
      privatePath: `~/.ssh/${name}`,
      publicPath: `~/.ssh/${name}.pub`,
      hosts: usedByHosts,
      linkedHosts: usedByHosts,
      usedByHosts
    });
  }

  return result;
}

function readLocalSshPrivateKey(name, dirOrHome = path.join(os.homedir(), '.ssh')) {
  const sshDir = resolveSshDir(dirOrHome);
  const clean = String(name || '').trim();
  if (!clean || path.basename(clean) !== clean || clean.includes('..') || IGNORED_SSH_FILES.has(clean)) {
    throw new Error('Invalid SSH key filename.');
  }
  const privPath = path.join(sshDir, clean);
  const pubPath = path.join(sshDir, `${clean}.pub`);
  const privFile = readTextSafe(privPath, 64 * 1024);
  if (!privFile) throw new Error(`Private key ~/.ssh/${clean} could not be read.`);
  const parsedPriv = inspectOpenSshPrivateKeyText(privFile.text);
  if (!parsedPriv) throw new Error(`~/.ssh/${clean} is not a recognized SSH private key.`);
  const pubFile = readTextSafe(pubPath, 32 * 1024);
  const parsedPub = pubFile ? parsePublicKeyLine(pubFile.text.split(/\r?\n/)[0]) : null;
  return {
    name: clean,
    algorithm: parsedPub?.algorithm || parsedPriv.algorithm || 'SSH',
    fingerprint: parsedPub?.fingerprint || parsedPriv.fingerprint || '',
    comment: parsedPub?.comment || parsedPriv.comment || clean,
    publicKey: parsedPub?.publicKey || parsedPriv.publicKey || '',
    privateKey: privFile.text.trim(),
    encrypted: Boolean(parsedPriv.encrypted),
    mode: formatMode(privFile.stat.mode)
  };
}

function collectConfigFiles(dirPath, baseDir, depth = 0, out = []) {
  if (depth > 3 || out.length >= 250) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= 250) break;
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dirPath, entry.name);
    const relPath = path.relative(baseDir, full);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_CONFIG_DIRS.has(entry.name)) continue;
      collectConfigFiles(full, baseDir, depth + 1, out);
    } else if (st.isFile()) {
      if (BINARY_EXT.test(entry.name) || st.size > 256 * 1024) continue;
      const sensitive = SENSITIVE_NAME.test(relPath) || (st.mode & 0o077) === 0;
      out.push({
        name: entry.name,
        relPath,
        size: st.size,
        mode: formatMode(st.mode),
        updatedAt: st.mtime.toISOString(),
        sensitive
      });
    }
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

function inspectLocalConfig(dirOrHome = path.join(os.homedir(), '.config')) {
  const configDir = resolveConfigDir(dirOrHome);
  const result = {
    configDir,
    exists: false,
    entries: []
  };
  let topEntries = [];
  try {
    if (!fs.existsSync(configDir)) return result;
    result.exists = true;
    topEntries = fs.readdirSync(configDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of topEntries) {
    if (entry.name === '.DS_Store' || SKIP_CONFIG_DIRS.has(entry.name)) continue;
    const full = path.join(configDir, entry.name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const files = collectConfigFiles(full, configDir, 1, []);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      const latestMs = files.reduce((max, f) => Math.max(max, Date.parse(f.updatedAt) || 0), st.mtimeMs);
      const sensitiveCount = files.filter(f => f.sensitive).length;
      result.entries.push({
        name: entry.name,
        relPath: entry.name,
        kind: 'dir',
        isDirectory: true,
        fileCount: files.length,
        totalBytes,
        updatedAt: new Date(latestMs).toISOString(),
        sensitiveCount,
        files
      });
    } else if (st.isFile() && !BINARY_EXT.test(entry.name) && st.size <= 256 * 1024) {
      const sensitive = SENSITIVE_NAME.test(entry.name) || (st.mode & 0o077) === 0;
      const fileItem = {
        name: entry.name,
        relPath: entry.name,
        size: st.size,
        mode: formatMode(st.mode),
        updatedAt: st.mtime.toISOString(),
        sensitive
      };
      result.entries.push({
        name: entry.name,
        relPath: entry.name,
        kind: 'file',
        isDirectory: false,
        fileCount: 1,
        totalBytes: st.size,
        updatedAt: st.mtime.toISOString(),
        sensitiveCount: sensitive ? 1 : 0,
        files: [fileItem]
      });
    }
  }

  result.entries.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function readLocalConfigFile(relPath, dirOrHome = path.join(os.homedir(), '.config')) {
  const configDir = resolveConfigDir(dirOrHome);
  const clean = String(relPath || '').trim().replace(/^\/+/, '');
  if (!clean || clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error('Invalid ~/.config file path.');
  }
  const baseResolved = path.resolve(configDir);
  const full = path.resolve(baseResolved, clean);
  if (full !== baseResolved && !full.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error('Invalid ~/.config file path.');
  }
  const fileData = readTextSafe(full, 256 * 1024);
  if (!fileData) {
    throw new Error(`Unable to read ~/.config/${clean} as a text configuration file (<= 256 KB).`);
  }
  const sensitive = SENSITIVE_NAME.test(clean) || (fileData.stat.mode & 0o077) === 0 || SENSITIVE_NAME.test(fileData.text);
  return {
    relPath: clean,
    name: path.basename(clean),
    path: `~/.config/${clean}`,
    size: fileData.stat.size,
    mode: formatMode(fileData.stat.mode),
    updatedAt: fileData.stat.mtime.toISOString(),
    sensitive,
    content: fileData.text
  };
}

function computeSshFingerprint(pubLine) {
  const parsed = parsePublicKeyLine(pubLine);
  return parsed ? parsed.fingerprint : '';
}

function writeSshFileWithBackup(filePath, nextContent) {
  let mode = 0o600;
  try {
    const st = fs.statSync(filePath);
    mode = st.mode & 0o777;
    const prev = fs.readFileSync(filePath);
    fs.writeFileSync(`${filePath}.bak`, prev, { mode: 0o600 });
  } catch {
    // Ignore if no prior file
  }
  const tmpPath = `${filePath}.hdv-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, nextContent, { encoding: 'utf8', mode });
  fs.renameSync(tmpPath, filePath);
}

function removeKnownHostEntry({ line, rawHostField, fingerprint } = {}, dirOrHome = path.join(os.homedir(), '.ssh')) {
  const sshDir = resolveSshDir(dirOrHome);
  const filePath = path.join(sshDir, 'known_hosts');
  const fileData = readTextSafe(filePath, 512 * 1024);
  if (!fileData) throw new Error('~/.ssh/known_hosts could not be read.');
  const eol = fileData.text.includes('\r\n') ? '\r\n' : '\n';
  const lines = fileData.text.split(/\r?\n/);
  let targetIdx = -1;

  if (Number.isInteger(line) && line >= 1 && line <= lines.length) {
    const candidate = lines[line - 1].trim();
    if (candidate && !candidate.startsWith('#') && (!rawHostField || candidate.includes(rawHostField))) {
      targetIdx = line - 1;
    }
  }
  if (targetIdx < 0 && (rawHostField || fingerprint)) {
    const parsed = parseKnownHosts(fileData.text);
    const match = parsed.find(e =>
      (rawHostField ? e.rawHostField === rawHostField : true) &&
      (fingerprint ? e.fingerprint === fingerprint : true)
    );
    if (match) targetIdx = match.line - 1;
  }
  if (targetIdx < 0 || targetIdx >= lines.length) {
    throw new Error('Matching entry was not found in ~/.ssh/known_hosts.');
  }
  lines.splice(targetIdx, 1);
  writeSshFileWithBackup(filePath, lines.join(eol));
  return { removed: true, line: targetIdx + 1, backupPath: '~/.ssh/known_hosts.bak' };
}

function removeAuthorizedKeyEntry({ line, fingerprint, publicKey } = {}, dirOrHome = path.join(os.homedir(), '.ssh')) {
  const sshDir = resolveSshDir(dirOrHome);
  const filePath = path.join(sshDir, 'authorized_keys');
  const fileData = readTextSafe(filePath, 256 * 1024);
  if (!fileData) throw new Error('~/.ssh/authorized_keys could not be read.');
  const eol = fileData.text.includes('\r\n') ? '\r\n' : '\n';
  const lines = fileData.text.split(/\r?\n/);
  let targetIdx = -1;

  if (Number.isInteger(line) && line >= 1 && line <= lines.length) {
    const parsedLine = parsePublicKeyLine(lines[line - 1]);
    if (parsedLine && (!fingerprint || parsedLine.fingerprint === fingerprint)) {
      targetIdx = line - 1;
    }
  }
  if (targetIdx < 0 && (fingerprint || publicKey)) {
    for (let i = 0; i < lines.length; i++) {
      const parsedLine = parsePublicKeyLine(lines[i]);
      if (!parsedLine) continue;
      if ((fingerprint && parsedLine.fingerprint === fingerprint) || (publicKey && parsedLine.publicKey === publicKey)) {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx < 0 || targetIdx >= lines.length) {
    throw new Error('Matching key was not found in ~/.ssh/authorized_keys.');
  }
  lines.splice(targetIdx, 1);
  writeSshFileWithBackup(filePath, lines.join(eol));
  return { removed: true, line: targetIdx + 1, backupPath: '~/.ssh/authorized_keys.bak' };
}

function removeSshConfigHost({ host, alias } = {}, dirOrHome = path.join(os.homedir(), '.ssh')) {
  const targetHost = String(host || alias || '').trim();
  if (!targetHost) throw new Error('Specify a Host block to remove.');
  const sshDir = resolveSshDir(dirOrHome);
  const filePath = path.join(sshDir, 'config');
  const fileData = readTextSafe(filePath, 128 * 1024);
  if (!fileData) throw new Error('~/.ssh/config could not be read.');
  const eol = fileData.text.includes('\r\n') ? '\r\n' : '\n';
  const lines = fileData.text.split(/\r?\n/);

  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z0-9]+)\s*(?:=\s*|\s+)(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host' || key === 'match') {
      if (startIdx >= 0) {
        endIdx = i;
        break;
      }
      if (key === 'host' && val === targetHost) {
        startIdx = i;
      }
    }
  }
  if (startIdx < 0) {
    throw new Error(`Host "${targetHost}" was not found in ~/.ssh/config.`);
  }
  // Remove trailing blank line if present to keep formatting tidy
  if (endIdx < lines.length && lines[endIdx - 1]?.trim() === '' && startIdx > 0 && lines[startIdx - 1]?.trim() === '') {
    endIdx--;
  }
  lines.splice(startIdx, endIdx - startIdx);
  writeSshFileWithBackup(filePath, lines.join(eol));
  return { removed: true, host: targetHost, backupPath: '~/.ssh/config.bak' };
}

function removeLocalSshKey({ name } = {}, dirOrHome = path.join(os.homedir(), '.ssh')) {
  const sshDir = resolveSshDir(dirOrHome);
  const clean = String(name || '').trim();
  if (!clean || path.basename(clean) !== clean || clean.includes('..') || IGNORED_SSH_FILES.has(clean)) {
    throw new Error('Invalid SSH key filename.');
  }
  const privPath = path.join(sshDir, clean);
  const pubPath = path.join(sshDir, `${clean}.pub`);
  const removedFiles = [];
  if (fs.existsSync(privPath)) {
    fs.unlinkSync(privPath);
    removedFiles.push(`~/.ssh/${clean}`);
  }
  if (fs.existsSync(pubPath)) {
    fs.unlinkSync(pubPath);
    removedFiles.push(`~/.ssh/${clean}.pub`);
  }
  if (!removedFiles.length) {
    throw new Error(`No key files found for ~/.ssh/${clean}.`);
  }
  return { removed: true, name: clean, removedFiles };
}

function removeLocalConfigEntry({ relPath } = {}, dirOrHome = path.join(os.homedir(), '.config')) {
  const configDir = resolveConfigDir(dirOrHome);
  const clean = String(relPath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean || clean === '.' || clean === '..' || clean.includes('..') || path.isAbsolute(clean) || clean === '.DS_Store') {
    throw new Error('Invalid ~/.config path.');
  }
  const baseResolved = path.resolve(configDir);
  const targetPath = path.resolve(baseResolved, clean);
  if (targetPath === baseResolved || !targetPath.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error('Invalid ~/.config path.');
  }
  let st;
  try {
    st = fs.lstatSync(targetPath);
  } catch {
    throw new Error(`~/.config/${clean} does not exist.`);
  }
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(targetPath);
    return { removed: true, relPath: clean, kind: 'file', path: `~/.config/${clean}` };
  }
  if (st.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: false });
    return { removed: true, relPath: clean, kind: 'dir', path: `~/.config/${clean}` };
  }
  throw new Error(`Unsupported entry type at ~/.config/${clean}.`);
}

module.exports = {
  inspectLocalSsh,
  readLocalSshPrivateKey,
  inspectLocalConfig,
  readLocalConfigFile,
  computeSshFingerprint,
  removeKnownHostEntry,
  removeAuthorizedKeyEntry,
  removeSshConfigHost,
  removeLocalSshKey,
  removeLocalConfigEntry
};

