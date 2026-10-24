'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { atomicWrite, readLimited, ProtectedStore, CipherCache } = require('../src/core/storage.cjs');
test('atomic files and cache are owner-only and reads are bounded', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hdv-files-'));
  try { const file = path.join(dir, 'nested', 'file'); await atomicWrite(file, Buffer.from('test')); assert.equal((await fs.stat(file)).mode & 0o777, 0o600); assert.equal((await readLimited(file)).toString(), 'test'); await assert.rejects(readLimited(file, 2)); const cache = new CipherCache(dir, 'project-123', 'personal'); await cache.write({ ciphertext: 'example' }); assert.deepEqual(await cache.read(), { ciphertext: 'example' }); await cache.clear(); assert.equal(await cache.read(), null); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('protected auth store refuses unavailable encryption and Linux basic_text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hdv-protection-'));
  try {
    const unavailable = new ProtectedStore(dir, { isEncryptionAvailable: () => false }, 'darwin'); await assert.rejects(unavailable.set('google-session', { token: 'secret' }), /Refusing/);
    const basic = new ProtectedStore(dir, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }, 'linux'); await assert.rejects(basic.set('google-session', { token: 'secret' }), /Refusing/);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('protected store delegates encryption to safeStorage and never writes its plaintext input', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hdv-protected-')); let stored;
  const safe = { isEncryptionAvailable: () => true, encryptString: text => { stored = text; return Buffer.from('SIMULATED_OS_CIPHERTEXT'); }, decryptString: () => stored };
  try { const store = new ProtectedStore(dir, safe, 'darwin'); await store.set('google-session', { token: 'NOT_FOR_DISK' }); const bytes = await fs.readFile(path.join(dir, 'google-session.bin')); assert.ok(!bytes.includes('NOT_FOR_DISK')); assert.deepEqual(await store.get('google-session'), { token: 'NOT_FOR_DISK' }); await store.delete('google-session'); assert.equal(await store.get('google-session'), null); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});
