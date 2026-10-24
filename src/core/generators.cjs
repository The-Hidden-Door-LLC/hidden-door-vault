'use strict';
const crypto = require('node:crypto');
const CLASSES = Object.freeze({ lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{}:,.?' });
function password(options = {}) {
  const length = options.length ?? 32;
  const minLength = options.allowShort ? 8 : 16;
  if (!Number.isInteger(length) || length < minLength || length > 128) throw new Error(`Password length must be ${minLength}-128.`);
  const customSymbols = typeof options.allowedSymbols === 'string' && options.allowedSymbols.trim().length > 0
    ? options.allowedSymbols.trim()
    : CLASSES.symbols;
  const classMap = { ...CLASSES, symbols: customSymbols };
  let classes = Object.entries(classMap).filter(([k]) => options[k] !== false).map(([, v]) => v);
  if (options.avoidAmbiguous) classes = classes.map(x => x.replace(/[Il1O0o]/g, ''));
  if (!classes.length) throw new Error('Choose at least one character set.');
  const alphabet = classes.join('');
  let value;
  // Whole-string rejection preserves uniformity over all strings meeting the policy.
  do { value = Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
  while (!classes.every(chars => [...value].some(c => chars.includes(c))));
  let coverage = 0;
  for (let mask = 0; mask < (1 << classes.length); mask++) {
    let excluded = 0, count = 0;
    for (let j = 0; j < classes.length; j++) if (mask & (1 << j)) { excluded += classes[j].length; count++; }
    coverage += (count % 2 ? -1 : 1) * Math.pow((alphabet.length - excluded) / alphabet.length, length);
  }
  return { value, bits: Math.floor(length * Math.log2(alphabet.length) + Math.log2(coverage)), alphabetSize: alphabet.length };
}
function token(options = {}) {
  const bytes = options.bytes ?? 32, format = options.format ?? 'base64url';
  if (![32, 48, 64].includes(bytes) || !['base64url', 'hex'].includes(format)) throw new Error('Unsupported token settings.');
  return { value: crypto.randomBytes(bytes).toString(format), bits: bytes * 8 };
}
function uint32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function sshString(value) { const b = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([uint32(b.length), b]); }
function ssh(comment = 'hidden-door-vault') {
  if (typeof comment !== 'string' || comment.length > 100 || /[\r\n\0]/.test(comment)) throw new Error('Invalid SSH comment.');
  const pair = crypto.generateKeyPairSync('ed25519');
  const privateJwk = pair.privateKey.export({ format: 'jwk' });
  const pub = Buffer.from(privateJwk.x, 'base64url'), seed = Buffer.from(privateJwk.d, 'base64url');
  const privateBytes = Buffer.concat([seed, pub]);
  const publicBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)]);
  const check = crypto.randomBytes(4);
  let inner = Buffer.concat([check, check, sshString('ssh-ed25519'), sshString(pub), sshString(privateBytes), sshString(comment)]);
  const padding = (8 - (inner.length % 8)) % 8;
  inner = Buffer.concat([inner, Buffer.from(Array.from({ length: padding }, (_, i) => i + 1))]);
  const blob = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshString('none'), sshString('none'), sshString(Buffer.alloc(0)), uint32(1), sshString(publicBlob), sshString(inner)]);
  const b64 = blob.toString('base64');
  const result = { publicKey: `ssh-ed25519 ${publicBlob.toString('base64')} ${comment}`.trim(), privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64.match(/.{1,70}/g).join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`, fingerprint: `SHA256:${crypto.createHash('sha256').update(publicBlob).digest('base64').replace(/=+$/, '')}` };
  seed.fill(0); privateBytes.fill(0); inner.fill(0); blob.fill(0);
  return result;
}
function decodeBase32(value) {
  if (typeof value !== 'string') throw new Error('Invalid TOTP secret.');
  const clean = value.toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]{16,256}$/.test(clean)) throw new Error('Use a base32 TOTP secret (at least 16 characters).');
  let bits = 0, acc = 0; const out = [];
  for (const c of clean) { acc = (acc << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 255); } }
  return Buffer.from(out);
}
function parseTotpSpec(input, overrides = {}) {
  let secret = input, digits = overrides.digits, period = overrides.period, algorithm = overrides.algorithm;
  if (input && typeof input === 'object' && !Buffer.isBuffer(input)) {
    secret = input.secret;
    if (digits === undefined && input.digits !== undefined) digits = Number(input.digits);
    if (period === undefined && input.period !== undefined) period = Number(input.period);
    if (algorithm === undefined && input.algorithm !== undefined) algorithm = input.algorithm;
  } else if (typeof input === 'string' && /^otpauth:\/\//i.test(input.trim())) {
    let url;
    try { url = new URL(input.trim()); } catch { throw new Error('Invalid otpauth:// TOTP URI.'); }
    const host = (url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
    if (url.protocol.toLowerCase() !== 'otpauth:' || host !== 'totp') throw new Error('Only otpauth://totp/ URIs are supported.');
    secret = url.searchParams.get('secret') || '';
    if (digits === undefined && url.searchParams.has('digits')) digits = Number(url.searchParams.get('digits'));
    if (period === undefined && url.searchParams.has('period')) period = Number(url.searchParams.get('period'));
    if (algorithm === undefined && url.searchParams.has('algorithm')) algorithm = url.searchParams.get('algorithm');
  }
  digits = digits ?? 6;
  period = period ?? 30;
  algorithm = typeof algorithm === 'string' ? algorithm.trim().toLowerCase().replace(/^hmac-?/, '').replace(/-/g, '') : 'sha1';
  if (![6, 8].includes(digits) || !Number.isInteger(period) || period < 15 || period > 120 || !['sha1', 'sha256', 'sha512'].includes(algorithm)) throw new Error('Unsupported TOTP parameters.');
  return { secret, digits, period, algorithm };
}
function totp(secret, now = Date.now(), digits = undefined, period = undefined, algorithm = undefined) {
  const spec = parseTotpSpec(secret, { digits, period, algorithm });
  const key = decodeBase32(spec.secret), counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / spec.period)));
  try {
    const hash = crypto.createHmac(spec.algorithm, key).update(counter).digest(), offset = hash[hash.length - 1] & 15;
    return { value: String((hash.readUInt32BE(offset) & 0x7fffffff) % (10 ** spec.digits)).padStart(spec.digits, '0'), remaining: spec.period - (Math.floor(now / 1000) % spec.period), digits: spec.digits, period: spec.period, algorithm: spec.algorithm.toUpperCase() };
  } finally { key.fill(0); }
}
module.exports = { password, token, ssh, totp, parseTotpSpec, decodeBase32, CLASSES };
