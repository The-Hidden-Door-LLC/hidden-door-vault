'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const hasOpenSSH = spawnSync('ssh-keygen', ['-?']).error?.code !== 'ENOENT';
const G = require('../src/core/generators.cjs');
const crc32c = require('../src/core/crc32c.cjs');
test('password generator respects selected classes over 200 outputs', () => {
  const values = new Set();
  for (let i = 0; i < 200; i++) { const p = G.password(); assert.equal(p.value.length, 32); assert.ok(p.bits >= 200); for (const chars of Object.values(G.CLASSES)) assert.ok([...p.value].some(c => chars.includes(c))); values.add(p.value); }
  assert.equal(values.size, 200);
});
test('digits-only passwords preserve policy and entropy estimate', () => { const p = G.password({ length: 16, upper: false, lower: false, symbols: false }); assert.match(p.value, /^\d{16}$/); assert.equal(p.bits, Math.floor(16 * Math.log2(10))); });
test('ambiguous-character exclusion works', () => { for (let i = 0; i < 30; i++) assert.doesNotMatch(G.password({ avoidAmbiguous: true }).value, /[Il1O0o]/); });
test('unsafe password lengths and an empty alphabet fail', () => { for (const length of [0, 15, 129, 16.5, '32']) assert.throws(() => G.password({ length })); assert.throws(() => G.password({ upper: false, lower: false, digits: false, symbols: false })); });
test('tokens have their declared entropy and encoding', () => { const a = G.token(); assert.equal(Buffer.from(a.value, 'base64url').length, 32); assert.equal(a.bits, 256); const b = G.token({ bytes: 64, format: 'hex' }); assert.equal(b.value.length, 128); assert.equal(b.bits, 512); assert.throws(() => G.token({ bytes: 1 })); });
test('Ed25519 private key is accepted by the installed OpenSSH parser', { skip: !hasOpenSSH }, () => {
  const pair = G.ssh('vault-test'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hdv-key-test-'));
  try {
    const filename = path.join(directory, 'key'); fs.writeFileSync(filename, pair.privateKey, { mode: 0o600 });
    const parsed = execFileSync('ssh-keygen', ['-y', '-f', filename], { encoding: 'utf8' }).trim();
    assert.equal(parsed.split(' ').slice(0, 2).join(' '), pair.publicKey.split(' ').slice(0, 2).join(' ')); assert.match(pair.fingerprint, /^SHA256:/);
    const fp = execFileSync('ssh-keygen', ['-lf', filename], { encoding: 'utf8' }); assert.ok(fp.includes(pair.fingerprint));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('generated key pairs are independent and reject newline comments', () => { assert.notEqual(G.ssh().publicKey, G.ssh().publicKey); assert.throws(() => G.ssh('evil\ncomment')); });
test('TOTP matches RFC 6238 SHA-1 test vectors', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [seconds, value] of vectors) assert.equal(G.totp(secret, seconds * 1000, 8).value, value);
});
test('TOTP rejects malformed secrets and unsupported parameters', () => { assert.throws(() => G.totp('INVALID!!!!')); assert.throws(() => G.totp('GEZDGNBVGY3TQOJQ', 1, 7)); assert.throws(() => G.totp('otpauth://hotp/Test?secret=GEZDGNBVGY3TQOJQ')); });
test('TOTP parses otpauth://totp/ URIs with custom SHA-256/512, 8 digits, and 60s period', () => {
  const uri = 'otpauth://totp/TheHiddenDoor:sampleuser@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=TheHiddenDoor&algorithm=SHA256&digits=8&period=60';
  const r = G.totp(uri, 1111111109 * 1000);
  const direct = G.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1111111109 * 1000, 8, 60, 'sha256');
  assert.equal(r.value, direct.value);
  assert.equal(r.value.length, 8);
  assert.equal(r.digits, 8);
  assert.equal(r.period, 60);
  assert.equal(r.algorithm, 'SHA256');
});
test('CRC32C uses Castagnoli, not standard CRC32', () => { assert.equal(crc32c(Buffer.from('123456789')), String(0xe3069283)); assert.equal(crc32c(Buffer.alloc(0)), '0'); });
test('OpenSSH private key padding is omitted when the block is already aligned', () => {
  const { ssh } = require('../src/core/generators.cjs');
  for (const comment of ['abcde', 'abcdefghijklm', 'x', 'hidden-door-vault']) {
    const key = ssh(comment);
    const blob = Buffer.from(key.privateKey.split('\n').slice(1, -2).join(''), 'base64');
    // Walk the openssh-key-v1 structure to the private block and check its length is a multiple of 8 with padding 1,2,3...
    let offset = 'openssh-key-v1\0'.length; const str = () => { const n = blob.readUInt32BE(offset); offset += 4; const v = blob.subarray(offset, offset + n); offset += n; return v; };
    str(); str(); str(); offset += 4; str(); const priv = str();
    assert.equal(priv.length % 8, 0, `comment ${JSON.stringify(comment)}`);
    const pad = priv.length - (8 + 4 + 11 + 4 + 32 + 4 + 64 + 4 + Buffer.byteLength(comment));
    assert.ok(pad >= 0 && pad < 8, `padding ${pad} for ${JSON.stringify(comment)}`);
    for (let i = 0; i < pad; i++) assert.equal(priv[priv.length - pad + i], i + 1);
  }
});
