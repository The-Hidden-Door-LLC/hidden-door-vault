'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
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
} = require('../src/core/local-system.cjs');

test('local-system inspector parses ~/.ssh keys, config, authorized_keys, known_hosts, and ~/.config safely', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hdv-local-sys-'));
  try {
    const sshDir = path.join(tmpHome, '.ssh');
    fs.mkdirSync(sshDir, { mode: 0o700 });

    const pair = require('../src/core/generators.cjs').ssh('fixture@example.test');
    const pubLine = pair.publicKey;
    const privPem = pair.privateKey;

    fs.writeFileSync(path.join(sshDir, 'id_ed25519'), privPem, { mode: 0o600 });
    fs.writeFileSync(path.join(sshDir, 'id_ed25519.pub'), pubLine + '\n', { mode: 0o644 });
    fs.writeFileSync(path.join(sshDir, 'config'), [
      'Host code.example.test',
      '  HostName 192.0.2.42',
      '  User git',
      '  Port 2222',
      '  IdentityFile ~/.ssh/id_ed25519',
      '',
      'Host backup.example.test',
      '  HostName 192.0.2.43',
      '  User root',
      ''
    ].join('\n'), { mode: 0o600 });
    fs.writeFileSync(path.join(sshDir, 'authorized_keys'), [
      '# Workstation key',
      `command="/bin/true" ${pubLine}`,
      ''
    ].join('\n'), { mode: 0o600 });
    fs.writeFileSync(path.join(sshDir, 'known_hosts'), [
      `code.example.test,192.0.2.42 ${pubLine.split(' ').slice(0, 2).join(' ')}`,
      `|1|hashedhost=|hashedsalt= ${pubLine.split(' ').slice(0, 2).join(' ')}`,
      ''
    ].join('\n'), { mode: 0o644 });

    const sshInfo = inspectLocalSsh(tmpHome);
    assert.equal(sshInfo.exists, true);
    assert.equal(sshInfo.keys.length, 1);
    assert.equal(sshInfo.keys[0].name, 'id_ed25519');
    assert.equal(sshInfo.keys[0].algorithm, 'ED25519');
    assert.equal(sshInfo.keys[0].comment, 'fixture@example.test');
    assert.match(sshInfo.keys[0].fingerprint, /^SHA256:/);
    assert.deepEqual(sshInfo.keys[0].linkedHosts, ['code.example.test']);

    assert.equal(sshInfo.config.hosts.length, 2);
    assert.equal(sshInfo.config.hosts[0].hostName, '192.0.2.42');
    assert.equal(sshInfo.authorizedKeys.keys.length, 1);
    assert.equal(sshInfo.authorizedKeys.keys[0].fingerprint, computeSshFingerprint(pubLine));
    assert.equal(sshInfo.knownHosts.hosts.length, 2);
    assert.equal(sshInfo.knownHosts.hosts[1].hashed, true);

    const readPriv = readLocalSshPrivateKey('id_ed25519', tmpHome);
    assert.equal(readPriv.privateKey, privPem.trim());
    assert.throws(() => readLocalSshPrivateKey('../etc/passwd', tmpHome), /Invalid SSH key filename/);

    // Test removal of known_hosts entry
    removeKnownHostEntry({ line: sshInfo.knownHosts.hosts[0].line, fingerprint: sshInfo.knownHosts.hosts[0].fingerprint }, tmpHome);
    assert.equal(fs.existsSync(path.join(sshDir, 'known_hosts.bak')), true);
    assert.equal(inspectLocalSsh(tmpHome).knownHosts.hosts.length, 1);

    // Test removal of authorized_keys entry
    removeAuthorizedKeyEntry({ line: sshInfo.authorizedKeys.keys[0].line, fingerprint: sshInfo.authorizedKeys.keys[0].fingerprint }, tmpHome);
    assert.equal(fs.existsSync(path.join(sshDir, 'authorized_keys.bak')), true);
    assert.equal(inspectLocalSsh(tmpHome).authorizedKeys.keys.length, 0);

    // Test removal of SSH config host block
    removeSshConfigHost({ host: 'code.example.test' }, tmpHome);
    assert.equal(fs.existsSync(path.join(sshDir, 'config.bak')), true);
    const afterConfig = inspectLocalSsh(tmpHome).config.hosts;
    assert.equal(afterConfig.length, 1);
    assert.equal(afterConfig[0].host, 'backup.example.test');

    // Test removal of local SSH key files
    const removedKey = removeLocalSshKey({ name: 'id_ed25519' }, tmpHome);
    assert.deepEqual(removedKey.removedFiles, ['~/.ssh/id_ed25519', '~/.ssh/id_ed25519.pub']);
    assert.equal(inspectLocalSsh(tmpHome).keys.length, 0);

    const cfgDir = path.join(tmpHome, '.config');
    fs.mkdirSync(path.join(cfgDir, 'gh'), { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'gh', 'config.yml'), 'git_protocol: ssh\n');
    fs.writeFileSync(path.join(cfgDir, 'gh', 'hosts.yml'), 'github.com:\n  oauth_token: secret\n');

    const cfgInfo = inspectLocalConfig(tmpHome);
    assert.equal(cfgInfo.exists, true);
    assert.equal(cfgInfo.entries.length, 1);
    assert.equal(cfgInfo.entries[0].name, 'gh');
    assert.equal(cfgInfo.entries[0].fileCount, 2);

    const normalFile = readLocalConfigFile('gh/config.yml', tmpHome);
    assert.equal(normalFile.sensitive, false);
    const sensitiveFile = readLocalConfigFile('gh/hosts.yml', tmpHome);
    assert.equal(sensitiveFile.sensitive, true);
    assert.throws(() => readLocalConfigFile('../.ssh/id_ed25519', tmpHome), /Invalid ~\/\.config file path/);

    // Test removal of single ~/.config file and entire directory
    assert.throws(() => removeLocalConfigEntry({ relPath: '../.ssh' }, tmpHome), /Invalid ~\/\.config path/);
    assert.throws(() => removeLocalConfigEntry({ relPath: '' }, tmpHome), /Invalid ~\/\.config path/);
    const rmFile = removeLocalConfigEntry({ relPath: 'gh/hosts.yml' }, tmpHome);
    assert.equal(rmFile.kind, 'file');
    assert.equal(inspectLocalConfig(tmpHome).entries[0].fileCount, 1);

    const rmDir = removeLocalConfigEntry({ relPath: 'gh' }, tmpHome);
    assert.equal(rmDir.kind, 'dir');
    assert.equal(inspectLocalConfig(tmpHome).entries.length, 0);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
