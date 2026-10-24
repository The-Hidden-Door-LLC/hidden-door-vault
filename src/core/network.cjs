'use strict';
const HOSTS = new Set(['oauth2.googleapis.com', 'openidconnect.googleapis.com', 'secretmanager.googleapis.com']);
class HTTPError extends Error { constructor(status, message, code = '') { super(message); this.status = status; this.code = code; } }
async function readJSON(response, maxBytes = 2 * 1024 * 1024, checkCurrent = null) {
  if (!response.body) throw new Error('The server returned an empty response.');
  const reader = response.body.getReader(); let length = 0; const chunks = [];
  try {
    for (;;) { const { done, value } = await reader.read(); checkCurrent?.(); if (done) break; length += value.byteLength; if (length > maxBytes) throw new Error('Server response exceeds the safety limit.'); chunks.push(Buffer.from(value)); }
    const text = Buffer.concat(chunks).toString('utf8');
    // V8 parse errors quote the input; a token or payload must never reach an error message.
    try { return text ? JSON.parse(text) : {}; } catch (_) { throw new Error('The server returned an unreadable response.'); }
  } finally { await reader.cancel().catch(() => {}); }
}
async function fetchJSON(url, options = {}, fetcher = globalThis.fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error('Blocked unexpected network endpoint.');
  const response = await fetcher(parsed, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(20000) });
  let data;
  try { data = await readJSON(response); }
  catch (error) { if (!response.ok) throw new HTTPError(response.status, `Google request failed (HTTP ${response.status}).`); throw error; }
  if (!response.ok) {
    // Never forward raw upstream messages: they can reflect credentials or payloads.
    const messages = { 400: 'Google rejected the request. Check desktop OAuth configuration, billing and API setup.', 401: 'Google sign-in has expired. Sign in again.', 403: 'Google denied access. Check Secret Manager IAM permissions, the consent screen and API enablement.', 404: 'The requested vault or version was not found.', 409: 'Another writer changed this record. Refresh before saving again.', 412: 'Another writer changed this record. Refresh before saving again.', 429: 'Google rate limit reached. Try again shortly.' };
    const code = typeof data.error === 'string' && /^[a-z_]{1,50}$/.test(data.error) ? data.error : '';
    throw new HTTPError(response.status, messages[response.status] || `Google request failed (HTTP ${response.status}).`, code);
  }
  return data;
}
module.exports = { HOSTS, HTTPError, fetchJSON, readJSON };
