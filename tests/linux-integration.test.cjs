'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const L = require('../src/core/linux-integration.cjs');
const { defaultUserDataDir } = require('../src/core/bridge.cjs');
const { chromiumHostDirs, cliLinkCandidates } = require('../src/core/browser-host.cjs');
const execFileAsync = promisify(execFile);

test('CLI and native host look for the socket where Electron puts userData on every platform', () => {
  const home = '/home/sampleuser', env = {};
  assert.equal(defaultUserDataDir('linux', env, home), '/home/sampleuser/.config/Hidden Door Vault');
  assert.equal(defaultUserDataDir('linux', { XDG_CONFIG_HOME: '/xdg/cfg' }, home), '/xdg/cfg/Hidden Door Vault');
  assert.equal(defaultUserDataDir('darwin', env, home), '/home/sampleuser/Library/Application Support/Hidden Door Vault');
  assert.equal(defaultUserDataDir('linux', { HDV_USER_DATA: '/custom' }, home), '/custom');
});

test('Linux Native Messaging directories cover the native Chromium browsers and the CLI links into ~/.local/bin only', () => {
  const dirs = chromiumHostDirs('/home/sampleuser', 'linux', {});
  const browsers = dirs.map(d => d.browser);
  for (const name of ['Google Chrome', 'Brave', 'Microsoft Edge', 'Vivaldi', 'Chromium']) assert.ok(browsers.includes(name), name);
  for (const d of dirs) assert.ok(d.dir.startsWith('/home/sampleuser/.config/') && d.dir.endsWith('/NativeMessagingHosts'), d.dir);
  assert.equal(chromiumHostDirs('/home/sampleuser', 'linux', { XDG_CONFIG_HOME: '/xdg' })[0].dir, '/xdg/google-chrome/NativeMessagingHosts');
  assert.deepEqual(cliLinkCandidates('/home/sampleuser', 'linux'), ['/home/sampleuser/.local/bin']);
  assert.deepEqual(cliLinkCandidates('/Users/sampleuser', 'darwin'), ['/opt/homebrew/bin', '/Users/sampleuser/.local/bin', '/usr/local/bin']);
});

test('desktop entry quotes the executable, marks autostart entries hidden and rejects unsafe paths', () => {
  const entry = L.desktopEntry({ execPath: '/opt/hidden door/vault "x" $y' });
  assert.match(entry, /^\[Desktop Entry\]\n/);
  assert.ok(entry.includes('Exec="/opt/hidden door/vault \\"x\\" \\$y"\n'), entry);
  assert.ok(entry.includes('StartupWMClass=hidden-door-vault\n'));
  assert.ok(!entry.includes('--hidden') && !entry.includes('X-GNOME-Autostart-enabled'));
  const auto = L.desktopEntry({ execPath: '/opt/hdv/hidden-door-vault', hidden: true, autostart: true });
  assert.ok(auto.includes('Exec="/opt/hdv/hidden-door-vault" --hidden\n'));
  assert.ok(auto.includes('X-GNOME-Autostart-enabled=true\n'));
  assert.throws(() => L.desktopEntry({ execPath: 'relative/path' }), /absolute/);
  assert.throws(() => L.desktopEntry({ execPath: '/opt/x\nExec=evil' }), /absolute/);
});

test('autostart entry is written, detected and removed under XDG_CONFIG_HOME', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hdv-autostart-'));
  try {
    const env = { XDG_CONFIG_HOME: dir };
    assert.deepEqual(await L.autostartStatus({ env }), { enabled: false, file: path.join(dir, 'autostart', 'hidden-door-vault.desktop') });
    const on = await L.setAutostart({ execPath: '/opt/hdv/hidden-door-vault', enabled: true, env });
    assert.equal(on.enabled, true);
    const text = await fs.readFile(on.file, 'utf8');
    assert.ok(text.includes('--hidden'));
    assert.equal((await L.autostartStatus({ env })).enabled, true);
    await fs.writeFile(on.file, text + 'Hidden=true\n');
    assert.equal((await L.autostartStatus({ env })).enabled, false, 'Hidden=true disables the entry');
    await fs.writeFile(on.file, text + 'X-GNOME-Autostart-enabled=false\n');
    assert.equal((await L.autostartStatus({ env })).enabled, false, 'GNOME flag disables the entry');
    const off = await L.setAutostart({ enabled: false, env });
    assert.equal(off.enabled, false);
    await assert.rejects(fs.access(off.file));
    await L.setAutostart({ enabled: false, env }); // idempotent
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('AppArmor profile names the binary, grants userns only, and quotes unusual paths', () => {
  const profile = L.appArmorProfile({ execPath: '/home/sampleuser/.local/opt/hidden-door-vault/hidden-door-vault' });
  assert.ok(profile.includes('profile hidden-door-vault /home/sampleuser/.local/opt/hidden-door-vault/hidden-door-vault flags=(unconfined) {'));
  assert.ok(profile.includes('\n  userns,\n'));
  assert.ok(profile.includes('abi <abi/4.0>,'));
  const spaced = L.appArmorProfile({ execPath: '/home/sampleuser/My Apps/hidden-door-vault', name: 'hidden-door-vault-dev' });
  assert.ok(spaced.includes('profile hidden-door-vault-dev "/home/sampleuser/My Apps/hidden-door-vault" flags=(unconfined) {'));
  assert.throws(() => L.appArmorProfile({ execPath: '/x', name: 'bad name' }), /profile name/);
});

test('screensaver signal parser understands GNOME and freedesktop lines from gdbus monitor', () => {
  assert.equal(L.parseScreenSaverSignal('/org/gnome/ScreenSaver: org.gnome.ScreenSaver.ActiveChanged (true,)'), true);
  assert.equal(L.parseScreenSaverSignal('/org/freedesktop/ScreenSaver: org.freedesktop.ScreenSaver.ActiveChanged (false,)'), false);
  assert.equal(L.parseScreenSaverSignal('/org/gnome/ScreenSaver: org.gnome.ScreenSaver.WakeUpScreen ()'), null);
  assert.equal(L.parseScreenSaverSignal('Monitoring signals from all objects owned by org.gnome.ScreenSaver'), null);
});

test('screen-lock watcher locks on ActiveChanged(true), resumes on false, and kills its monitors on stop', () => {
  const spawned = [];
  const fakeSpawn = (cmd, args, opts) => {
    assert.equal(cmd, 'sh'); assert.ok(args[1].startsWith('gdbus monitor --session --dest "$1" --object-path "$2"'), args[1]);
    assert.ok(args[1].includes('trap') && args[1].includes('read -r'), 'wrapper kills gdbus when the parent pipe closes');
    assert.ok(['org.gnome.ScreenSaver', 'org.freedesktop.ScreenSaver'].includes(args[3]), args[3]);
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'ignore']);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = { ended: false, end() { this.ended = true; }, on() {} }; child.killed = false; child.kill = () => { child.killed = true; }; child.unref = () => {};
    spawned.push(child); return child;
  };
  let locks = 0, unlocks = 0;
  const watcher = L.watchScreenLock({ onLock: () => locks++, onUnlock: () => unlocks++, spawnImpl: fakeSpawn });
  assert.equal(watcher.active, true); assert.equal(spawned.length, 2);
  spawned[0].stdout.emit('data', '/org/gnome/ScreenSaver: org.gnome.ScreenSaver.Active');
  spawned[0].stdout.emit('data', 'Changed (true,)\n/org/gnome/ScreenSaver: org.gnome.ScreenSaver.ActiveChanged (false,)\n');
  assert.equal(locks, 1); assert.equal(unlocks, 1);
  watcher.stop();
  assert.ok(spawned.every(c => c.killed && c.stdin.ended));
  const none = L.watchScreenLock({ spawnImpl: () => { throw new Error('ENOENT'); } });
  assert.equal(none.active, false); none.stop();
});

test('linux-integration command line prints the entries used by the installer', async () => {
  const script = path.join(__dirname, '..', 'src', 'core', 'linux-integration.cjs');
  const { stdout } = await execFileAsync(process.execPath, [script, 'desktop-entry', '/opt/hdv/hidden-door-vault']);
  assert.ok(stdout.includes('Exec="/opt/hdv/hidden-door-vault"\n'));
  const auto = await execFileAsync(process.execPath, [script, 'autostart-entry', '/opt/hdv/hidden-door-vault']);
  assert.ok(auto.stdout.includes('--hidden'));
  const aa = await execFileAsync(process.execPath, [script, 'apparmor-profile', '/opt/hdv/hidden-door-vault', 'custom-name']);
  assert.ok(aa.stdout.includes('profile custom-name /opt/hdv/hidden-door-vault'));
  await assert.rejects(execFileAsync(process.execPath, [script, 'desktop-entry', 'relative']), /absolute/);
  await assert.rejects(execFileAsync(process.execPath, [script, 'nonsense']), /Usage/);
});
