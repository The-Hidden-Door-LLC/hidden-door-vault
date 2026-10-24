'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../src/core/crypto.cjs');
const { normalize } = require('../src/core/records.cjs');
const context = C.contextOf('sample-vault-123', 'personal');
let header, master, recovery;
test.before(async () => { const result = await C.createHeader('A unique master password for tests only!', context); header = result.header; master = result.key; recovery = result.recoveryCode; });
test.after(() => master?.fill(0));
test('AES-256-GCM matches the NIST empty-message vector with a zero key/IV (decryption)', () => {
  const envelope = { v: 1, alg: 'AES-256-GCM', nonce: Buffer.alloc(12).toString('base64'), ciphertext: '', tag: Buffer.from('530f8afbc74536b9a963b4f1c4cb738b', 'hex').toString('base64') };
  assert.deepEqual(C.unseal(Buffer.alloc(32), envelope, ''), Buffer.alloc(0));
});
test('AES-GCM authenticates ciphertext, associated context and tag', () => {
  const data = C.seal(master, Buffer.from('test-secret'), context);
  assert.equal(C.unseal(master, data, context).toString(), 'test-secret');
  const bad = { ...data, tag: Buffer.alloc(16).toString('base64') };
  assert.throws(() => C.unseal(master, bad, context));
  assert.throws(() => C.unseal(master, data, 'different-vault'));
  assert.throws(() => C.unseal(crypto.randomBytes(32), data, context));
});
test('encryption uses independent 96-bit nonces', () => { const set = new Set(Array.from({ length: 100 }, () => C.seal(master, Buffer.from('same'), context).nonce)); assert.equal(set.size, 100); });
test('master password and recovery code both unwrap the same vault key', async () => {
  const p = await C.unlockHeader(header, 'A unique master password for tests only!', context);
  const r = await C.unlockHeader(header, recovery, context, true);
  assert.deepEqual(p, master); assert.deepEqual(r, master); p.fill(0); r.fill(0);
});
test('wrong master password fails closed', async () => { await assert.rejects(C.unlockHeader(header, 'Wrong master password entirely', context), /Unable to unlock/); });
test('recovery is context-bound', async () => { await assert.rejects(C.unlockHeader(header, recovery, `${context}:other`, true)); });
test('untrusted KDF cost is rejected rather than executed', async () => { const bad = structuredClone(header); bad.kdf.N = 2147483648; await assert.rejects(C.unlockHeader(bad, 'anything', context), /parameters/); });
test('invalid format, nonce, tag and oversized envelope are rejected', () => {
  const sealed = C.seal(master, Buffer.from('ok'), context);
  assert.throws(() => C.unseal(master, { ...sealed, alg: 'AES-CBC' }, context));
  assert.throws(() => C.unseal(master, { ...sealed, nonce: '!' }, context));
  assert.throws(() => C.unseal(master, { ...sealed, tag: '' }, context));
  assert.throws(() => C.unseal(master, sealed, context, 1));
});
test('item encryption hides title, card number and private material', () => {
  const item = normalize({ title: 'PRIVATE SECRET TITLE', kind: 'card', number: '4111111111111111', securityCode: '123', notes: 'sensitive note' });
  const envelope = C.encryptItem(master, header, context, item);
  const text = JSON.stringify(envelope); assert.ok(!text.includes(item.title)); assert.ok(!text.includes(item.number));
  assert.deepEqual(C.decryptItem(master, header, context, item.id, envelope), item);
  assert.throws(() => C.decryptItem(master, header, context, crypto.randomUUID(), envelope));
});
test('authenticated backup rejects tampering', () => {
  const items = [{ title: 'Example', id: 'example' }], envelope = C.encryptBackup(master, header, context, items);
  assert.deepEqual(C.decryptBackup(master, header, context, envelope), items);
  envelope.ciphertext = Buffer.from('tampered').toString('base64'); assert.throws(() => C.decryptBackup(master, header, context, envelope));
});
test('short master passwords and malformed recovery codes are rejected', async () => {
  await assert.rejects(C.createHeader('short', context), /16/);
  assert.throws(() => C.parseRecovery('not-a-code'));
});
test('project and vault identifiers reject traversal and URL injection', () => {
  for (const bad of ['../../vault', 'a?x=1', 'PROJECT', 'http://evil.test']) assert.throws(() => C.contextOf(bad, 'personal'));
  assert.throws(() => C.contextOf('sample-vault-123', '../personal'));
});
test('master passwords are NFC-normalized so composed and decomposed input derive the same key', async () => {
  const { createHeader, unlockHeader, contextOf } = require('../src/core/crypto.cjs');
  const context = contextOf('test-project-123', 'personal');
  const composed = 'café pass phrase that is long'; const decomposed = 'café pass phrase that is long';
  assert.notEqual(composed, decomposed);
  const { header, key } = await createHeader(composed, context);
  const again = await unlockHeader(header, decomposed, context);
  assert.deepEqual(again, key); key.fill(0); again.fill(0);
});
