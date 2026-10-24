'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const KDF = Object.freeze({ name: 'scrypt', N: 131072, r: 8, p: 1 });
const fail = (message) => { throw new Error(message); };

function b64decode(value, size, max = 100000) {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('Invalid encrypted data.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (size !== undefined && bytes.length !== size)) fail('Invalid encrypted data length.');
  return bytes;
}
function seal(key, plaintext, aad) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('A 256-bit key is required.');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { v: 1, alg: 'AES-256-GCM', nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function unseal(key, envelope, aad, maxBytes = 65536) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'AES-256-GCM') fail('Unsupported encryption format.');
  const nonce = b64decode(envelope.nonce, 12);
  const tag = b64decode(envelope.tag, 16);
  const ciphertext = b64decode(envelope.ciphertext, undefined, Math.ceil(maxBytes / 3) * 4 + 4);
  if (ciphertext.length > maxBytes) fail('Encrypted record is too large.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function contextOf(project, vault) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) fail('Use the Google Cloud project ID, not its display name.');
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(vault)) fail('Vault name must be 1-20 lowercase letters, digits or hyphens, starting with a letter.');
  return `hdvault:v1:${project}:${vault}`;
}
function validateHeader(header) {
  if (!header || header.schema !== 1 || !/^[0-9a-f-]{36}$/.test(header.vaultId || '')) fail('Unsupported vault header.');
  if (header.generation !== undefined && (!Number.isInteger(header.generation) || header.generation < 1)) fail('Unsupported vault header generation.');
  if (!header.kdf || Object.entries(KDF).some(([k, v]) => header.kdf[k] !== v)) fail('Unsupported password derivation parameters.');
  b64decode(header.kdf.salt, 32);
  return header;
}
async function passwordKey(password, kdf) {
  if (typeof password !== 'string' || password.length > 1024) fail('Invalid master password.');
  // Parameters are pinned, not accepted from an untrusted cloud payload.
  // NFC so the same visible password typed on another keyboard/OS derives the same key.
  const bytes = Buffer.from(password.normalize('NFC'), 'utf8');
  try { return await scrypt(bytes, b64decode(kdf.salt, 32), 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 }); }
  finally { bytes.fill(0); }
}
function parseRecovery(code) {
  if (typeof code !== 'string' || !/^HDV1-[A-Za-z0-9_-]{43}$/.test(code.trim())) fail('Recovery codes begin HDV1- and are case-sensitive.');
  const text = code.trim().slice(5), key = Buffer.from(text, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== text) fail('Invalid recovery code.');
  return key;
}
function headerAad(context, header) {
  const gen = header.generation || 1;
  return gen > 1 ? `${context}:${header.vaultId}:g${gen}` : `${context}:${header.vaultId}`;
}
async function createHeader(password, context) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 1024) fail('Use a unique master password of at least 16 characters.');
  const key = crypto.randomBytes(32), recovery = crypto.randomBytes(32);
  const header = { schema: 1, generation: 1, vaultId: crypto.randomUUID(), createdAt: new Date().toISOString(), kdf: { ...KDF, salt: crypto.randomBytes(32).toString('base64') } };
  let derived;
  try {
    derived = await passwordKey(password, header.kdf);
    const aad = headerAad(context, header);
    header.passwordWrapped = seal(derived, key, `${aad}:password`);
    header.recoveryWrapped = seal(recovery, key, `${aad}:recovery`);
    return { header, key, recoveryCode: `HDV1-${recovery.toString('base64url')}` };
  } catch (error) { key.fill(0); throw error; }
  finally { derived?.fill(0); recovery.fill(0); }
}
async function rekeyHeader(existingHeader, key, newPassword, context) {
  validateHeader(existingHeader);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('A 256-bit vault key is required.');
  if (typeof newPassword !== 'string' || newPassword.length < 16 || newPassword.length > 1024) fail('Use a unique master password of at least 16 characters.');
  const recovery = crypto.randomBytes(32);
  const generation = (existingHeader.generation || 1) + 1;
  const header = {
    schema: 1,
    generation,
    vaultId: existingHeader.vaultId,
    createdAt: existingHeader.createdAt,
    rekeyedAt: new Date().toISOString(),
    kdf: { ...KDF, salt: crypto.randomBytes(32).toString('base64') }
  };
  let derived;
  try {
    derived = await passwordKey(newPassword, header.kdf);
    const aad = headerAad(context, header);
    header.passwordWrapped = seal(derived, key, `${aad}:password`);
    header.recoveryWrapped = seal(recovery, key, `${aad}:recovery`);
    return { header, recoveryCode: `HDV1-${recovery.toString('base64url')}` };
  } finally { derived?.fill(0); recovery.fill(0); }
}
async function unlockHeader(header, credential, context, recovery = false) {
  validateHeader(header);
  let derived;
  try {
    derived = recovery ? parseRecovery(credential) : await passwordKey(credential, header.kdf);
    const method = recovery ? 'recovery' : 'password';
    const key = unseal(derived, header[`${method}Wrapped`], `${headerAad(context, header)}:${method}`, 32);
    if (key.length !== 32) fail('Invalid vault key.');
    return key;
  } catch (_) { fail('Unable to unlock. Check the master password or recovery code and the selected project/vault.'); }
  finally { derived?.fill(0); }
}
function itemKey(master, vaultId, id) {
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from(vaultId), Buffer.from(`hdvault:item:${id}`), 32));
}
function encryptItem(master, header, context, item) {
  const key = itemKey(master, header.vaultId, item.id), plaintext = Buffer.from(JSON.stringify(item));
  try {
    const envelope = seal(key, plaintext, `${context}:${header.vaultId}:item:${item.id}`);
    if (Buffer.byteLength(JSON.stringify(envelope)) > 65536) fail('This item exceeds Secret Manager\'s 64 KiB encrypted-payload limit.');
    return envelope;
  } finally { key.fill(0); plaintext.fill(0); }
}
function decryptItem(master, header, context, id, envelope) {
  const key = itemKey(master, header.vaultId, id); let plaintext;
  try {
    plaintext = unseal(key, envelope, `${context}:${header.vaultId}:item:${id}`);
    const item = JSON.parse(plaintext.toString('utf8'));
    if (item.id !== id) fail('Credential identity mismatch.');
    return item;
  } finally { key.fill(0); plaintext?.fill(0); }
}
function encryptBackup(master, header, context, records) {
  const payload = Buffer.from(JSON.stringify(records));
  try { return seal(master, payload, `${context}:${header.vaultId}:backup`); }
  finally { payload.fill(0); }
}
function decryptBackup(master, header, context, envelope) {
  const plaintext = unseal(master, envelope, `${context}:${header.vaultId}:backup`, 64 * 1024 * 1024);
  try { return JSON.parse(plaintext.toString('utf8')); } finally { plaintext.fill(0); }
}
module.exports = { KDF, seal, unseal, contextOf, createHeader, rekeyHeader, unlockHeader, validateHeader, encryptItem, decryptItem, encryptBackup, decryptBackup, parseRecovery };
