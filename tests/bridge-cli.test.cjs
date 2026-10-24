'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const R = require('../src/core/records.cjs');
const B = require('../src/core/bridge.cjs');
const BH = require('../src/core/browser-host.cjs');

test('BridgeServer, hdv CLI, Native Messaging host, autofill, auto-create, and passkey ceremonies work end-to-end', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdv-bridge-'));
  const socketPath = path.join(dir, 'hdv.sock');
  const sshSocketPath = path.join(dir, 'ssh.sock');
  const store = new Map();
  let unlocked = true;

  const mockVault = {
    get unlocked() { return unlocked; },
    offline: false,
    project: 'demo-proj',
    vault: 'personal',
    records: store,
    requireUnlocked() {
      if (!unlocked) throw new Error('Vault is locked');
    },
    lock() {
      unlocked = false;
    },
    async unlock(credential) {
      if (credential !== 'correct-horse') throw new Error('Invalid master password');
      unlocked = true;
      return { count: store.size, offline: false };
    },
    list() {
      return Array.from(store.values(), item => R.summary(item));
    },
    get(id) {
      const item = store.get(id);
      if (!item) throw new Error('Not found');
      return item;
    },
    async save(input) {
      this.requireUnlocked();
      const existing = input.id ? store.get(input.id) : null;
      const item = R.normalize(input, existing);
      store.set(item.id, item);
      return item;
    }
  };

  const bridge = new B.BridgeServer({
    socketPath,
    sshSocketPath,
    getVault: () => mockVault
  });

  await bridge.start();

  try {
    const cliPath = path.resolve(__dirname, '../bin/hdv.cjs');
    const env = { ...process.env, HDV_SOCKET: socketPath };

    // 1. CLI create & read hdv:// reference
    const { stdout: createdRaw } = await execFileAsync(process.execPath, [
      cliPath, 'create', '--kind', 'api', '--title', 'Stripe Prod', '--username', 'acct_1', '--token', 'sk_live_secret_999', '--json'
    ], { env, encoding: 'utf8' });
    const createdApi = JSON.parse(createdRaw);
    assert.equal(createdApi.title, 'Stripe Prod');

    const { stdout: readValRaw } = await execFileAsync(process.execPath, [
      cliPath, 'read', 'hdv://personal/Stripe Prod/token'
    ], { env, encoding: 'utf8' });
    assert.equal(readValRaw.trim(), 'sk_live_secret_999');

    // 2. CLI run -- injects secret into child process environment
    const { stdout: injectedOut } = await execFileAsync(process.execPath, [
      cliPath, 'run', '--', process.execPath, '-e', 'process.stdout.write(process.env.STRIPE_KEY)'
    ], {
      env: { ...env, STRIPE_KEY: 'hdv://personal/Stripe Prod/token' },
      encoding: 'utf8'
    });
    assert.equal(injectedOut, 'sk_live_secret_999');

    // 3. Browser auto-create login & domain matching autofill
    const autoCreated = await B.sendBridgeRequest('autocreate-login', {
      url: 'https://dashboard.stripe.com/register',
      username: 'sampleuser@example.com',
      length: 32
    }, socketPath);
    assert.equal(autoCreated.username, 'sampleuser@example.com');
    assert.equal(autoCreated.password.length, 32);

    const matched = await B.sendBridgeRequest('match-logins', {
      url: 'https://dashboard.stripe.com/login'
    }, socketPath);
    assert.equal(matched.items.length, 1);
    assert.equal(matched.items[0].id, autoCreated.id);

    const autofill = await B.sendBridgeRequest('autofill-get', {
      id: autoCreated.id,
      url: 'https://dashboard.stripe.com/login'
    }, socketPath);
    assert.equal(autofill.password, autoCreated.password);

    // Cross-domain autofill must be rejected
    await assert.rejects(
      () => B.sendBridgeRequest('autofill-get', { id: autoCreated.id, url: 'https://phishing.evil.com' }, socketPath),
      /Domain mismatch/
    );

    // 4. WebAuthn Passkey registration & assertion over bridge
    const pkReg = await B.sendBridgeRequest('passkey-create', {
      rpId: 'stripe.com',
      rpName: 'Stripe',
      origin: 'https://dashboard.stripe.com',
      userName: 'sampleuser@example.com',
      challenge: Buffer.from('challenge-1').toString('base64url')
    }, socketPath);
    assert.equal(pkReg.itemId, autoCreated.id); // attached to existing Stripe login!

    const pkCandidates = await B.sendBridgeRequest('passkey-candidates', {
      rpId: 'stripe.com',
      origin: 'https://dashboard.stripe.com'
    }, socketPath);
    assert.equal(pkCandidates.items.length, 1);

    // Exclude credential ID check for registration duplicate detection
    const pkExcluded = await B.sendBridgeRequest('passkey-candidates', {
      rpId: 'stripe.com',
      origin: 'https://dashboard.stripe.com',
      excludeCredentialIds: [pkReg.credentialId]
    }, socketPath);
    assert.equal(pkExcluded.excludedMatches.length, 1);
    assert.equal(pkExcluded.excludedMatches[0].id, autoCreated.id);

    const pkGet = await B.sendBridgeRequest('passkey-get', {
      rpId: 'stripe.com',
      origin: 'https://dashboard.stripe.com',
      challenge: Buffer.from('challenge-2').toString('base64url'),
      itemId: autoCreated.id
    }, socketPath);
    assert.equal(pkGet.credentialId, pkReg.credentialId);

    // 4b. Browser Auto-Save detection (already-saved, update-password, new-login, and locked state)
    const checkSame = await B.sendBridgeRequest('check-autosave', {
      url: 'https://dashboard.stripe.com/login',
      username: 'sampleuser@example.com',
      password: autoCreated.password
    }, socketPath);
    assert.equal(checkSame.status, 'already-saved');

    const checkUpdate = await B.sendBridgeRequest('check-autosave', {
      url: 'https://dashboard.stripe.com/settings/password',
      username: 'sampleuser@example.com',
      password: 'new-rotated-stripe-password-2026!'
    }, socketPath);
    assert.equal(checkUpdate.status, 'update-password');
    assert.equal(checkUpdate.existingId, autoCreated.id);

    const savedUpdate = await B.sendBridgeRequest('save-login', {
      id: checkUpdate.existingId,
      url: 'https://dashboard.stripe.com/settings/password',
      username: 'sampleuser@example.com',
      password: 'new-rotated-stripe-password-2026!'
    }, socketPath);
    assert.equal(savedUpdate.action, 'updated');
    assert.equal(mockVault.get(autoCreated.id).password, 'new-rotated-stripe-password-2026!');

    const checkNew = await B.sendBridgeRequest('check-autosave', {
      url: 'https://app.linear.app/login',
      username: 'sampleuser@linear.example',
      password: 'linear-secret-password-999'
    }, socketPath);
    assert.equal(checkNew.status, 'new-login');

    const savedNew = await B.sendBridgeRequest('save-login', {
      url: 'https://app.linear.app/login',
      title: 'Linear',
      username: 'sampleuser@linear.example',
      password: 'linear-secret-password-999'
    }, socketPath);
    assert.equal(savedNew.action, 'created');
    assert.equal(savedNew.title, 'Linear');

    // Graceful locked mode for match-logins and passkey-candidates
    mockVault.lock();
    const lockedMatch = await B.sendBridgeRequest('match-logins', {
      url: 'https://dashboard.stripe.com/login',
      gracefulLocked: true
    }, socketPath);
    assert.equal(lockedMatch.unlocked, false);
    assert.deepEqual(lockedMatch.items, []);

    const lockedPk = await B.sendBridgeRequest('passkey-candidates', {
      rpId: 'stripe.com',
      origin: 'https://dashboard.stripe.com',
      gracefulLocked: true
    }, socketPath);
    assert.equal(lockedPk.unlocked, false);
    assert.deepEqual(lockedPk.items, []);

    await mockVault.unlock('correct-horse');

    // 5. Native Messaging binary framing via src/native-host.cjs
    const nativeHostPath = path.resolve(__dirname, '../src/native-host.cjs');
    const nativeReply = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [nativeHostPath], { env });
      let out = Buffer.alloc(0);
      child.stdout.on('data', (chunk) => {
        out = Buffer.concat([out, chunk]);
        if (out.length >= 4) {
          const len = out.readUInt32LE(0);
          if (out.length >= 4 + len) {
            resolve(JSON.parse(out.subarray(4, 4 + len).toString('utf8')));
          }
        }
      });
      child.on('error', reject);
      const body = Buffer.from(JSON.stringify({ action: 'status', payload: {} }), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      child.stdin.write(Buffer.concat([header, body]));
      child.stdin.end();
    });
    assert.equal(nativeReply.ok, true);
    assert.equal(nativeReply.result.vault, 'personal');

    // 6. Browser integration manifest installer
    const homeDir = path.join(dir, 'home');
    const installRes = await BH.installBrowserIntegration({
      homeDir,
      userDataDir: path.join(dir, 'userdata'),
      repoRoot: path.resolve(__dirname, '..'),
      nodePath: process.execPath
    });
    assert.equal(installRes.extensionId, BH.DEFAULT_EXTENSION_ID);
    assert.ok(fs.existsSync(installRes.wrapperPath));
    assert.ok(installRes.cliLinkPath);
    assert.ok(fs.existsSync(installRes.cliLinkPath));
    assert.ok(fs.existsSync(path.join(installRes.extensionDir, 'manifest.json')));
    assert.ok(fs.existsSync(installRes.manifests[0].manifestPath));
    const manifestJson = JSON.parse(fs.readFileSync(installRes.manifests[0].manifestPath, 'utf8'));
    assert.equal(manifestJson.name, BH.HOST_NAME);
    assert.deepEqual(manifestJson.allowed_origins, [`chrome-extension://${BH.DEFAULT_EXTENSION_ID}/`]);
  } finally {
    await bridge.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
