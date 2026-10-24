'use strict';
const { randomUUID } = require('node:crypto');
const { isDocumentRecord, documentMetadata } = require('./document-format.cjs');
const KINDS = ['login', 'card', 'ssh', 'api', 'recovery', 'note'];
const FIELDS = ['username', 'url', 'password', 'totpSecret', 'recoveryCodes', 'passkeyId', 'passkeyRpId', 'passkeyRpName', 'passkeyUserHandle', 'passkeyUserName', 'passkeyAlgorithm', 'passkeyPrivateKey', 'passkeyPublicKey', 'passkeySignCount', 'passkeyCreatedAt', 'holder', 'number', 'expiry', 'securityCode', 'privateKey', 'publicKey', 'fingerprint', 'token', 'notes', 'tags'];
function validId(id) { return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id); }
function parseRecoveryCodes(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (/^#|^\/\//.test(line)) continue;
    let used = false;
    let body = line.replace(/^(?:\d+[\.\)]|[-*•])\s+/, '').trim();
    if (/^(\[x\]|\[used\]|✓|✔|used\s*:)/i.test(body)) {
      used = true;
      body = body.replace(/^(\[x\]|\[used\]|✓|✔|used\s*:)\s*/i, '').trim();
    } else if (/^(\[\s*\]|unused\s*:)/i.test(body)) {
      body = body.replace(/^(\[\s*\]|unused\s*:)\s*/i, '').trim();
    } else if (/^~.+~$/.test(body)) {
      used = true;
      body = body.slice(1, -1).trim();
    } else if (/\((used|consumed)\)$/i.test(body)) {
      used = true;
      body = body.replace(/\s*\((used|consumed)\)$/i, '').trim();
    }
    body = body.replace(/^\d+[\.\)]\s+/, '').trim();
    if (!body) continue;
    out.push({ code: body, used });
  }
  return out;
}
function formatRecoveryCodes(entries) {
  if (!Array.isArray(entries)) return '';
  return entries
    .filter(e => e && typeof e.code === 'string' && e.code.trim())
    .map(e => `${e.used ? '[x] ' : ''}${e.code.trim()}`)
    .join('\n');
}
function parseTags(val) {
  if (val === undefined || val === null || val === '') return [];
  if (Array.isArray(val)) {
    if (val.length >= 3 && val.every(x => typeof x === 'string' && x.length <= 1)) val = val.join('');
    else return val.map(x => String(x ?? '').trim()).filter(Boolean);
  }
  if (typeof val !== 'string') throw new Error('Invalid tags field.');
  if (val.length >= 5 && val.length % 2 === 1) {
    let oddAllCommas = true;
    for (let i = 1; i < val.length; i += 2) {
      if (val[i] !== ',') { oddAllCommas = false; break; }
    }
    if (oddAllCommas) {
      let joined = '';
      for (let i = 0; i < val.length; i += 2) joined += val[i];
      val = joined;
    }
  }
  return val.split(',').map(s => s.trim()).filter(Boolean);
}
function normalizeTags(val) { return parseTags(val).join(', '); }
function normalize(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid credential.');
  if (!KINDS.includes(input.kind)) throw new Error('Unknown credential type.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) throw new Error('Give the item a title (up to 200 characters).');
  const out = { id: existing?.id || randomUUID(), kind: input.kind, title: input.title.trim(), favorite: input.favorite === true, archived: input.archived === true, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  for (const field of FIELDS) {
    let val = input[field];
    if (field === 'passkeySignCount' && typeof val === 'number' && Number.isInteger(val) && val >= 0) val = String(val);
    if (field === 'tags' && val !== undefined) val = normalizeTags(val);
    if (val !== undefined && typeof val !== 'string') throw new Error(`Invalid ${field} field.`);
    out[field] = val || '';
    if (out[field].length > (['privateKey', 'passkeyPrivateKey', 'recoveryCodes', 'notes'].includes(field) ? 24000 : 4096)) throw new Error(`${field} is too long.`);
  }
  if (out.url) { let url; try { url = new URL(out.url); } catch { throw new Error('Website must be a full https:// or http:// URL.'); } if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) websites without embedded credentials are allowed.'); }
  if (out.passkeyRpId) {
    out.passkeyRpId = out.passkeyRpId.trim().toLowerCase().replace(/\.$/, '');
    if (!out.passkeyRpId || out.passkeyRpId.length > 253 || !/^[a-z0-9.-]+$/i.test(out.passkeyRpId) || out.passkeyRpId.startsWith('.') || out.passkeyRpId.endsWith('.')) throw new Error('Invalid passkey relying party ID.');
  }
  if (out.passkeySignCount && !/^\d{1,10}$/.test(out.passkeySignCount)) throw new Error('Invalid passkey sign count.');
  if (Buffer.byteLength(JSON.stringify(out)) > 45000) throw new Error('Item is too large. Use smaller notes or keys.');
  return out;
}
function summary(item) {
  if (isDocumentRecord(item)) {
    let documentInfo;
    try { documentInfo = documentMetadata(item); } catch (_) {}
    return { id: item.id, kind: 'note', title: item.title, subtitle: documentInfo ? `${documentInfo.filename} · ${documentInfo.mediaType} · ${documentInfo.size} bytes` : 'Unreadable document manifest', favorite: false, archived: item.archived, tags: '', tagList: [], document: true, documentInfo, updatedAt: item.updatedAt };
  }
  const hasPasskey = Boolean(item.kind === 'login' && item.passkeyId && item.passkeyPrivateKey);
  const hasPassword = Boolean(item.kind === 'login' && item.password);
  const hasTotp = Boolean(item.kind === 'login' && item.totpSecret);
  const parsedRecovery = parseRecoveryCodes(item.recoveryCodes);
  const recoveryTotal = parsedRecovery.length;
  const recoveryRemaining = parsedRecovery.filter(c => !c.used).length;
  const hasRecoveryCodes = Boolean(item.kind === 'recovery' || recoveryTotal > 0);
  const loginSub = item.username || item.passkeyUserName || item.passkeyRpId || item.url || (hasPasskey ? 'Passkey credential' : 'Encrypted credential');
  const recoverySub = recoveryTotal > 0
    ? `${recoveryRemaining} of ${recoveryTotal} unused${item.username ? ` · ${item.username}` : ''}`
    : (item.username || item.url || 'Recovery backup codes');
  const subtitle = item.kind === 'card'
    ? (item.number ? `Ending ${item.number.replace(/\D/g, '').slice(-4)}` : item.holder)
    : item.kind === 'ssh'
      ? (item.username || item.url || 'Ed25519 / SSH credential')
      : item.kind === 'recovery'
        ? recoverySub
        : loginSub;
  const tagList = parseTags(item.tags);
  return { id: item.id, kind: item.kind, title: item.title, subtitle, favorite: item.favorite, archived: item.archived, tags: tagList.join(', '), tagList, hasPasskey, hasPassword, hasTotp, hasRecoveryCodes, recoveryTotal, recoveryRemaining, passkeyRpId: item.passkeyRpId || '', url: item.url || '', username: item.username || '', updatedAt: item.updatedAt };
}
function parseCSV(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('CSV exceeds 10 MiB.');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; }
    else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x !== '')) rows.push(row); row = []; cell = ''; closed = false; }
    else { if (closed) throw new Error('Malformed CSV after closing quote.'); cell += c; }
    if (rows.length > 1001) throw new Error('Import at most 1,000 items at a time.');
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) throw new Error('CSV is empty.');
  return rows;
}
function importCSV(text) {
  const rows = parseCSV(text), names = rows.shift().map(x => x.trim().toLowerCase());
  if (!names.includes('title') || !names.includes('password')) throw new Error('Use a login CSV with Title and Password headers.');
  return rows.map((row, i) => {
    const data = Object.fromEntries(names.map((name, j) => [name, row[j] || '']));
    const notes = [data.notes, data.otpauth ? `Imported OTPAuth (review before setting TOTP): ${data.otpauth}` : ''].filter(Boolean).join('\n');
    try { return normalize({ kind: 'login', title: data.title || `Imported login ${i + 1}`, username: data.username || '', password: data.password || '', url: data.url || data.website || '', notes, tags: data.tags || '', favorite: /^(true|1|yes)$/i.test(data.favorite || '') }); }
    catch (error) { throw new Error(`CSV row ${i + 2}: ${error.message}`); }
  });
}
// Card CSV: Title, Cardholder, Number, Expiry, SecurityCode (or CVV), Notes, Tags, Favorite.
// 1Password's export labels ("Card Holder", "Card Number", "Expiry Date", "Verification Number") are accepted too.
function importCardsCSV(text) {
  const rows = parseCSV(text), names = rows.shift().map(x => x.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const col = (data, ...keys) => { for (const key of keys) if (data[key]) return data[key]; return ''; };
  if (!names.includes('title') || !(names.includes('number') || names.includes('cardnumber'))) throw new Error('Use a card CSV with Title and Number headers.');
  return rows.map((row, i) => {
    const data = Object.fromEntries(names.map((name, j) => [name, row[j] || '']));
    const number = col(data, 'number', 'cardnumber').replace(/\D/g, '');
    let expiry = col(data, 'expiry', 'expirydate', 'expiration', 'expires').trim();
    // Accept MM/YY, MM/YYYY, YYYY-MM and MMYY; store as "MM / YY".
    let m = /^(\d{1,2})\s*[\/\-\s.]\s*(\d{2}|\d{4})$/.exec(expiry);
    if (m) expiry = `${m[1].padStart(2, '0')} / ${m[2].slice(-2)}`;
    else if ((m = /^(\d{4})\s*[\/\-\s.]\s*(\d{1,2})$/.exec(expiry))) expiry = `${m[2].padStart(2, '0')} / ${m[1].slice(-2)}`;
    else if (/^\d{4}$/.test(expiry)) expiry = `${expiry.slice(0, 2)} / ${expiry.slice(2)}`;
    else if (/^(19|20)\d{4}$/.test(expiry)) expiry = `${expiry.slice(4)} / ${expiry.slice(2, 4)}`; // 1Password exports YYYYMM
    try { return normalize({ kind: 'card', title: data.title || `Imported card ${i + 1}`, holder: col(data, 'cardholder', 'holder', 'name', 'nameoncard'), number, expiry, securityCode: col(data, 'securitycode', 'cvv', 'cvc', 'verificationnumber'), notes: col(data, 'notes'), tags: col(data, 'tags'), favorite: /^(true|1|yes)$/i.test(col(data, 'favorite')) }); }
    catch (error) { throw new Error(`CSV row ${i + 2}: ${error.message}`); }
  });
}
module.exports = { KINDS, FIELDS, validId, parseRecoveryCodes, formatRecoveryCodes, parseTags, normalizeTags, normalize, summary, parseCSV, importCSV, importCardsCSV };
