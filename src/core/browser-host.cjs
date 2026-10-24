'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { defaultUserDataDir } = require('./bridge.cjs');

const HOST_NAME = 'ai.thehiddendoor.vault';
const EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5Qd2dyt6KS/xYZNldeAwDgvoc6gc/r4j/7Y86gNTGSGbo/XdmL6B9+YQttPgKtW65xn4L6jeEiiSVrwmjeWc9PqDoqpXEuaz2DX9EHrXJ6avzp/nPJFzpcsNyLqZdIVQKkr+HgPRMmZ+2Qyums0J4SVC4e2pXFOtRPFLR/p005g9XT+mCKYSRkIEmzHRIPek1Auf7zre28UwOl6rB0AsJY+rNVmqDRSiDPFRhSZAV0KjbmXVFV0BmiPLzqZii0gGo9nAe7TDbLRU6yUS+/d4N+mLwCGUQSwlSBaoOFdBtaoYNo3m4Gd2j9U2cKezwHBpIPOuVBWRQrm/T4pug/7UvQIDAQAB';

function extensionIdFromPublicKey(b64 = EXTENSION_PUBLIC_KEY) {
  const der = Buffer.from(b64, 'base64');
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + Number.parseInt(c, 16))).join('');
}

const DEFAULT_EXTENSION_ID = extensionIdFromPublicKey(EXTENSION_PUBLIC_KEY);

function chromiumHostDirs(homeDir = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === 'darwin') {
    const base = path.join(homeDir, 'Library', 'Application Support');
    return [
      { browser: 'Google Chrome', dir: path.join(base, 'Google', 'Chrome', 'NativeMessagingHosts') },
      { browser: 'Perplexity Comet', dir: path.join(base, 'Comet', 'NativeMessagingHosts') },
      { browser: 'Brave', dir: path.join(base, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
      { browser: 'Arc', dir: path.join(base, 'Arc', 'User Data', 'NativeMessagingHosts') },
      { browser: 'Microsoft Edge', dir: path.join(base, 'Microsoft Edge', 'NativeMessagingHosts') },
      { browser: 'Chromium', dir: path.join(base, 'Chromium', 'NativeMessagingHosts') }
    ];
  }
  // Linux: native (deb/rpm/tarball) browsers read ~/.config/<browser>/NativeMessagingHosts. Snap and Flatpak
  // browsers run confined and cannot execute a host outside their sandbox, so they are intentionally not listed.
  const cfg = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return [
    { browser: 'Google Chrome', dir: path.join(cfg, 'google-chrome', 'NativeMessagingHosts') },
    { browser: 'Google Chrome Beta', dir: path.join(cfg, 'google-chrome-beta', 'NativeMessagingHosts') },
    { browser: 'Brave', dir: path.join(cfg, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
    { browser: 'Microsoft Edge', dir: path.join(cfg, 'microsoft-edge', 'NativeMessagingHosts') },
    { browser: 'Vivaldi', dir: path.join(cfg, 'vivaldi', 'NativeMessagingHosts') },
    { browser: 'Chromium', dir: path.join(cfg, 'chromium', 'NativeMessagingHosts') }
  ];
}

function cliLinkCandidates(homeDir = os.homedir(), platform = process.platform) {
  const localBin = path.join(homeDir, '.local', 'bin');
  return platform === 'darwin' ? ['/opt/homebrew/bin', localBin, '/usr/local/bin'] : [localBin];
}

async function linkCliBinary(cliWrapper, options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const localBin = path.join(homeDir, '.local', 'bin');
  const candidates = options.homeDir
    ? [localBin]
    : cliLinkCandidates(homeDir);

  let linkedPath = null;
  for (const dir of candidates) {
    try {
      if (dir === localBin) await fs.mkdir(dir, { recursive: true });
      else await fs.access(dir);
      const target = path.join(dir, 'hdv');
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink() || stat.isFile()) await fs.unlink(target);
      } catch (_) {}
      await fs.symlink(cliWrapper, target);
      if (!linkedPath) linkedPath = target;
    } catch (_) {}
  }
  return linkedPath || cliWrapper;
}

async function installBrowserIntegration(options = {}) {
  const userDataDir = options.userDataDir || defaultUserDataDir();
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
  const nativeHostScript = path.join(repoRoot, 'src', 'native-host.cjs');
  const cliScript = path.join(repoRoot, 'bin', 'hdv.cjs');
  const sourceExtensionDir = path.join(repoRoot, 'extension');
  let extensionDir = sourceExtensionDir;

  const binDir = path.join(userDataDir, 'bin');
  await fs.mkdir(binDir, { recursive: true, mode: 0o700 });

  // Copy unpacked extension out of the .app bundle into userDataDir/extension so Chrome/Brave/Arc file pickers can select it.
  const userExtensionDir = path.join(userDataDir, 'extension');
  if (path.resolve(sourceExtensionDir) !== path.resolve(userExtensionDir)) {
    try {
      await fs.access(path.join(sourceExtensionDir, 'manifest.json'));
      await fs.mkdir(userExtensionDir, { recursive: true });
      await fs.cp(sourceExtensionDir, userExtensionDir, { recursive: true, force: true });
      extensionDir = userExtensionDir;
    } catch (_) {}
  }

  const hostWrapper = path.join(binDir, 'hdv-native-host');
  const cliWrapper = path.join(binDir, 'hdv');

  const nodeHint = options.nodePath || (!process.versions.electron ? process.execPath : '');
  const wrapperHeader = [
    '#!/bin/sh',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.nvm/current/bin:$HOME/.volta/bin:$HOME/.local/share/fnm/aliases/default/bin:/usr/bin:/bin:$PATH"',
    nodeHint ? `if [ -x "${nodeHint}" ]; then NODE_BIN="${nodeHint}"; else NODE_BIN="$(command -v node)"; fi` : 'NODE_BIN="$(command -v node)"',
    'if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -n 1)"; fi',
    'if [ -z "$NODE_BIN" ]; then echo "Node.js >= 22 is required for Hidden Door Vault CLI/Native Host." >&2; exit 1; fi'
  ].join('\n');

  await fs.writeFile(hostWrapper, `${wrapperHeader}\nexec "$NODE_BIN" "${nativeHostScript}" "$@"\n`, { mode: 0o755 });
  await fs.chmod(hostWrapper, 0o755);

  await fs.writeFile(cliWrapper, `${wrapperHeader}\nexec "$NODE_BIN" "${cliScript}" "$@"\n`, { mode: 0o755 });
  await fs.chmod(cliWrapper, 0o755);

  const cliLinkPath = await linkCliBinary(cliWrapper, options);

  const ids = new Set([DEFAULT_EXTENSION_ID]);
  if (Array.isArray(options.extensionIds)) {
    for (const id of options.extensionIds) {
      if (typeof id === 'string' && /^[a-p]{32}$/.test(id.trim())) ids.add(id.trim());
    }
  }
  if (typeof options.extensionId === 'string' && /^[a-p]{32}$/.test(options.extensionId.trim())) {
    ids.add(options.extensionId.trim());
  }
  const manifest = {
    name: HOST_NAME,
    description: 'Hidden Door Vault Native Messaging Host',
    path: hostWrapper,
    type: 'stdio',
    allowed_origins: [...ids].map(id => `chrome-extension://${id}/`)
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

  const targets = options.targetDirs
    ? options.targetDirs.map(d => ({ browser: path.basename(d), dir: d }))
    : chromiumHostDirs(options.homeDir);

  const installed = [];
  for (const target of targets) {
    try {
      await fs.mkdir(target.dir, { recursive: true });
      const file = path.join(target.dir, `${HOST_NAME}.json`);
      await fs.writeFile(file, manifestJson, { mode: 0o644 });
      installed.push({ browser: target.browser, manifestPath: file });
    } catch (_) {}
  }

  return {
    hostName: HOST_NAME,
    extensionId: DEFAULT_EXTENSION_ID,
    allowedIds: [...ids],
    extensionDir,
    hostWrapper,
    wrapperPath: hostWrapper,
    cliWrapper,
    cliLinkPath,
    installed,
    manifests: installed
  };
}

async function browserIntegrationStatus(options = {}) {
  const userDataDir = options.userDataDir || defaultUserDataDir();
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
  const hostWrapper = path.join(userDataDir, 'bin', 'hdv-native-host');
  const cliWrapper = path.join(userDataDir, 'bin', 'hdv');
  const userExt = path.join(userDataDir, 'extension');
  let hostInstalled = false;
  try { await fs.access(hostWrapper); await fs.access(cliWrapper); hostInstalled = true; } catch (_) {}
  let extensionDir = path.join(repoRoot, 'extension');
  try { await fs.access(path.join(userExt, 'manifest.json')); extensionDir = userExt; } catch (_) {}
  let cliLinkPath = cliWrapper;
  for (const cand of cliLinkCandidates().map(dir => path.join(dir, 'hdv'))) {
    try { await fs.access(cand); cliLinkPath = cand; break; } catch (_) {}
  }
  return { hostInstalled, cliLinkPath: hostInstalled ? cliLinkPath : null, extensionDir };
}

module.exports = {
  HOST_NAME,
  EXTENSION_PUBLIC_KEY,
  DEFAULT_EXTENSION_ID,
  extensionIdFromPublicKey,
  chromiumHostDirs,
  cliLinkCandidates,
  installBrowserIntegration,
  browserIntegrationStatus
};
