'use strict';
// All fixture identities, credentials, and payment-card numbers are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/core/records.cjs');
test('all supported item types normalize with stable IDs when updated', () => {
  for (const kind of R.KINDS) { const a = R.normalize({ title: '  Test item  ', kind }); assert.equal(a.title, 'Test item'); assert.ok(R.validId(a.id)); const b = R.normalize({ ...a, title: 'Changed' }, a); assert.equal(a.id, b.id); assert.equal(a.createdAt, b.createdAt); }
});
test('summaries never contain password, token, private key, card number or CVV', () => {
  const a = R.normalize({ title: 'Card', kind: 'card', number: '4111111111111234', securityCode: '789', password: 'hidden', token: 'hidden2', privateKey: 'hidden3' });
  const summary = R.summary(a); assert.equal(summary.subtitle, 'Ending 1234'); for (const key of ['password', 'token', 'privateKey', 'securityCode', 'number']) assert.ok(!(key in summary));
});
test('unknown credential types, oversized fields and active URLs fail', () => {
  assert.throws(() => R.normalize({ kind: 'passkey', title: 'Not implemented' }));
  assert.throws(() => R.normalize({ kind: 'login', title: '' }));
  assert.throws(() => R.normalize({ kind: 'login', title: 'A', password: 'x'.repeat(5000) }));
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com', 'data:text/plain,foo']) assert.throws(() => R.normalize({ kind: 'login', title: 'A', url }));
});
test('CSV parser handles quoted commas, embedded newlines and escaped quotes', () => {
  const csv = 'Title,Url,Username,Password,Notes\r\n"Mail, work",https://example.com,sampleuser,"a""b","line 1\nline 2"\r\n';
  const [item] = R.importCSV(csv); assert.equal(item.title, 'Mail, work'); assert.equal(item.password, 'a"b'); assert.equal(item.notes, 'line 1\nline 2');
});
test('CSV importer accepts 1Password-style headers and keeps OTPAuth for review', () => {
  const [item] = R.importCSV('\uFEFFTitle,Url,Username,Password,OTPAuth,Favorite,Tags,Notes\nExample,https://example.com,sampleuser,secret,otpauth://totp/test,TRUE,work,note');
  assert.equal(item.favorite, true); assert.ok(item.notes.includes('otpauth://totp/test')); assert.equal(item.tags, 'work');
});
test('malformed CSV fails before import', () => { assert.throws(() => R.parseCSV('Title,Password\n"unclosed')); assert.throws(() => R.parseCSV('Title,Password\n"a"x,b')); assert.throws(() => R.importCSV('unrelated,columns\na,b')); });
test('card CSV importer accepts app and 1Password header styles and normalizes number/expiry', () => {
  const items = R.importCardsCSV('Title,Card Holder,Card Number,Expiry Date,Verification Number,Notes\nTravel,"sample sample","4111 1111 1111 1111",09/29,123,"personal"\nBiz,K sample,378282246310005,2027-05,1234,');
  assert.equal(items.length, 2); assert.equal(items[0].kind, 'card'); assert.equal(items[0].number, '4111111111111111'); assert.equal(items[0].expiry, '09 / 29'); assert.equal(items[0].securityCode, '123'); assert.equal(items[0].holder, 'sample sample');
  assert.equal(items[1].expiry, '05 / 27');
  assert.equal(R.importCardsCSV('Title,Number,Expiry\nOnePw,4111111111111111,203005')[0].expiry, '05 / 30');
  assert.throws(() => R.importCardsCSV('Title,Password\na,b'), /Title and Number/);
});
test('login records preserve passkey fields and summaries hide passkeyPrivateKey', () => {
  const login = R.normalize({
    kind: 'login',
    title: 'GitHub',
    username: 'octocat',
    url: 'https://github.com/login',
    passkeyId: 'cred-123',
    passkeyRpId: 'GitHub.COM.',
    passkeyRpName: 'GitHub',
    passkeyUserHandle: 'dXNlci0x',
    passkeyUserName: 'octocat',
    passkeyAlgorithm: 'ES256',
    passkeyPrivateKey: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    passkeyPublicKey: '-----BEGIN PUBLIC KEY-----\npub\n-----END PRIVATE KEY-----',
    passkeySignCount: 4
  });
  assert.equal(login.passkeyRpId, 'github.com');
  assert.equal(login.passkeySignCount, '4');
  const sum = R.summary(login);
  assert.equal(sum.hasPasskey, true);
  assert.equal(sum.passkeyRpId, 'github.com');
  assert.ok(!('passkeyPrivateKey' in sum));
});
test('tags normalize arrays, phrases, and recover character-split tag strings into whole words/phrases', () => {
  const fromArray = R.normalize({ kind: 'note', title: 'Array tags', tags: ['sampletag', 'cloudflare'] });
  assert.equal(fromArray.tags, 'sampletag, cloudflare');
  assert.deepEqual(R.summary(fromArray).tagList, ['sampletag', 'cloudflare']);

  const fromCharSplitPhrase = R.normalize({ kind: 'login', title: 'Split phrase', tags: 'i,m,p,o,r,t,e,d, ,3,/,1,4,/,2,0,1,8, ,2,:,5,7, ,P,M' });
  assert.equal(fromCharSplitPhrase.tags, 'imported 3/14/2018 2:57 PM');
  assert.deepEqual(R.summary(fromCharSplitPhrase).tagList, ['imported 3/14/2018 2:57 PM']);

  const fromCharSplitMulti = R.normalize({ kind: 'note', title: 'Split multi', tags: 's,a,m,p,l,e,t,a,g,,, ,c,l,o,u,d,f,l,a,r,e' });
  assert.equal(fromCharSplitMulti.tags, 'sampletag, cloudflare');
  assert.deepEqual(R.summary(fromCharSplitMulti).tagList, ['sampletag', 'cloudflare']);

  const fromCharArray = R.normalize({ kind: 'note', title: 'Char array', tags: ['w', 'o', 'r', 'k'] });
  assert.equal(fromCharArray.tags, 'work');
});
test('recovery kind and recoveryCodes parse used/unused states and never leak codes in summary', () => {
  const raw = [
    '# GitHub Backup Codes',
    '1. [x] ABCD-1111-EFGH',
    '2. [ ] IJKL-2222-MNOP',
    'USED: QRST-3333-UVWX',
    'YZAB-4444-CDEF (used)',
    '~GHIJ-5555-KLMN~',
    'OPQR-6666-STUV'
  ].join('\n');
  const parsed = R.parseRecoveryCodes(raw);
  assert.equal(parsed.length, 6);
  assert.deepEqual(parsed.map(e => ({ code: e.code, used: e.used })), [
    { code: 'ABCD-1111-EFGH', used: true },
    { code: 'IJKL-2222-MNOP', used: false },
    { code: 'QRST-3333-UVWX', used: true },
    { code: 'YZAB-4444-CDEF', used: true },
    { code: 'GHIJ-5555-KLMN', used: true },
    { code: 'OPQR-6666-STUV', used: false }
  ]);
  const formatted = R.formatRecoveryCodes(parsed);
  const reparsed = R.parseRecoveryCodes(formatted);
  assert.deepEqual(reparsed, parsed);

  const rec = R.normalize({
    kind: 'recovery',
    title: 'GitHub Recovery Codes',
    username: 'octocat',
    url: 'https://github.com',
    recoveryCodes: formatted
  });
  const sum = R.summary(rec);
  assert.equal(sum.kind, 'recovery');
  assert.equal(sum.hasRecoveryCodes, true);
  assert.equal(sum.recoveryTotal, 6);
  assert.equal(sum.recoveryRemaining, 2);
  assert.match(sum.subtitle, /2 of 6 unused/);
  assert.ok(!('recoveryCodes' in sum));
  assert.ok(!JSON.stringify(sum).includes('ABCD-1111-EFGH'));
});

