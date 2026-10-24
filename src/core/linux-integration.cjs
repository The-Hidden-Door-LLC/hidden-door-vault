'use strict';
// Linux desktop integration helpers: XDG desktop entry and autostart, the AppArmor profile that lets the
// Chromium sandbox create user namespaces on Ubuntu 24.04+ kernels, and a D-Bus screen-lock watcher.
// Everything here is plain Node so it can be unit-tested and reused by scripts/install-linux.sh.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const APP_ID = 'hidden-door-vault';
const APP_NAME = 'Hidden Door Vault';
const DESKTOP_FILE = `${APP_ID}.desktop`;

function configHome(env = process.env, home = os.homedir()) { return env.XDG_CONFIG_HOME || path.join(home, '.config'); }
function dataHome(env = process.env, home = os.homedir()) { return env.XDG_DATA_HOME || path.join(home, '.local', 'share'); }

function assertExecPath(execPath) {
  if (typeof execPath !== 'string' || !path.isAbsolute(execPath) || /[\r\n\0]/.test(execPath)) throw new Error('An absolute executable path is required.');
  return execPath;
}
// Desktop Entry Specification quoting for Exec=: double quotes, with backslash escapes for the reserved characters.
function quoteExecArg(value) { return `"${String(value).replace(/[\\"`$]/g, c => `\\${c}`)}"`; }

function desktopEntry({ execPath, hidden = false, icon = APP_ID, autostart = false } = {}) {
  assertExecPath(execPath);
  const exec = [quoteExecArg(execPath), hidden ? '--hidden' : ''].filter(Boolean).join(' ');
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.5',
    `Name=${APP_NAME}`,
    'Comment=Client-encrypted credential vault in your own Google Secret Manager project',
    `Exec=${exec}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Utility;Security;',
    'Keywords=password;vault;secrets;ssh;passkey;totp;',
    'StartupNotify=true',
    `StartupWMClass=${APP_ID}`,
    'SingleMainWindow=true'
  ];
  if (autostart) lines.push('X-GNOME-Autostart-enabled=true', 'X-KDE-autostart-after=panel');
  return lines.join('\n') + '\n';
}

function autostartPath(env = process.env, home = os.homedir()) { return path.join(configHome(env, home), 'autostart', DESKTOP_FILE); }

async function autostartStatus({ env = process.env, home = os.homedir() } = {}) {
  const file = autostartPath(env, home);
  try {
    const text = await fs.readFile(file, 'utf8');
    // Either key disables an autostart entry (Desktop Entry spec: Hidden=true; GNOME: X-GNOME-Autostart-enabled=false).
    const hidden = /^\s*Hidden\s*=\s*true\s*$/im.test(text);
    const gnomeOff = /^\s*X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(text);
    return { enabled: !hidden && !gnomeOff, file };
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, file };
    throw error;
  }
}

async function setAutostart({ execPath, enabled, env = process.env, home = os.homedir() } = {}) {
  const file = autostartPath(env, home);
  if (!enabled) { await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); return { enabled: false, file }; }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, desktopEntry({ execPath, hidden: true, autostart: true }), { mode: 0o644 });
  return { enabled: true, file };
}

// AppArmor profile in the same shape Ubuntu ships for Chrome, Brave, VS Code and 1Password: it only names the
// binary and grants it user namespaces, which the Chromium sandbox needs. It does not confine anything.
function appArmorProfile({ execPath, name = APP_ID } = {}) {
  assertExecPath(execPath);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error('Invalid AppArmor profile name.');
  const attachment = /^[A-Za-z0-9/._+-]+$/.test(execPath) ? execPath : `"${execPath.replace(/["\\]/g, c => `\\${c}`)}"`;
  return [
    `# ${APP_NAME}: let the Chromium sandbox create user namespaces on kernels with`,
    '# kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 24.04 and newer).',
    '# This profile allows everything and only exists to give the application a name',
    '# instead of the label "unconfined", exactly like the profiles Ubuntu ships for Chrome.',
    '',
    'abi <abi/4.0>,',
    'include <tunables/global>',
    '',
    `profile ${name} ${attachment} flags=(unconfined) {`,
    '  userns,',
    '',
    '  # Site-specific additions and overrides. See local/README for details.',
    `  include if exists <local/${name}>`,
    '}',
    ''
  ].join('\n');
}

// gdbus monitor prints one signal per line, e.g.
//   /org/gnome/ScreenSaver: org.gnome.ScreenSaver.ActiveChanged (true,)
function parseScreenSaverSignal(line) {
  const match = /ScreenSaver\.ActiveChanged\s*\((true|false),?\)/.exec(String(line));
  return match ? match[1] === 'true' : null;
}

const SCREENSAVER_BUSES = [
  ['org.gnome.ScreenSaver', '/org/gnome/ScreenSaver'],
  ['org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver']
];

// Electron's powerMonitor does not emit lock-screen/unlock-screen on Linux. Watch the GNOME and
// freedesktop screensaver interfaces on the session bus instead. Best effort: when gdbus is missing
// or the desktop does not signal, the idle timer and suspend hooks still lock the vault.
// Each monitor runs under a tiny sh wrapper that holds the parent's stdin pipe: if the app exits for any
// reason (including a crash) the pipe closes, read returns EOF and the wrapper kills its gdbus child.
const MONITOR_WRAPPER = 'gdbus monitor --session --dest "$1" --object-path "$2" & p=$!; trap \'kill "$p" 2>/dev/null\' EXIT TERM INT HUP; while IFS= read -r _; do :; done';
function watchScreenLock({ onLock, onUnlock, spawnImpl = spawn, buses = SCREENSAVER_BUSES } = {}) {
  const children = [];
  for (const [dest, objectPath] of buses) {
    let child;
    try { child = spawnImpl('sh', ['-c', MONITOR_WRAPPER, 'hdv-screensaver-monitor', dest, objectPath], { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch (_) { continue; }
    if (!child || !child.stdout) continue;
    child.on('error', () => {});
    child.stdin?.on?.('error', () => {});
    let buffer = '';
    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        const active = parseScreenSaverSignal(line);
        if (active === true) onLock?.(); else if (active === false) onUnlock?.();
      }
      if (buffer.length > 65536) buffer = '';
    });
    child.unref?.();
    children.push(child);
  }
  return {
    active: children.length > 0,
    stop() { for (const child of children) { try { child.stdin?.end?.(); } catch (_) {} try { child.kill(); } catch (_) {} } }
  };
}

module.exports = { APP_ID, APP_NAME, DESKTOP_FILE, configHome, dataHome, desktopEntry, autostartPath, autostartStatus, setAutostart, appArmorProfile, parseScreenSaverSignal, watchScreenLock };

if (require.main === module) {
  const [command, execPath, name] = process.argv.slice(2);
  try {
    if (command === 'desktop-entry') process.stdout.write(desktopEntry({ execPath }));
    else if (command === 'autostart-entry') process.stdout.write(desktopEntry({ execPath, hidden: true, autostart: true }));
    else if (command === 'apparmor-profile') process.stdout.write(appArmorProfile({ execPath, name: name || APP_ID }));
    else { process.stderr.write('Usage: node linux-integration.cjs <desktop-entry|autostart-entry|apparmor-profile> <absolute-exec-path> [profile-name]\n'); process.exitCode = 2; }
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
