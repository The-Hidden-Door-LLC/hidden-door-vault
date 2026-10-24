'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { fetchJSON } = require('./network.cjs');
const SCOPES = 'openid email https://www.googleapis.com/auth/cloud-platform';
function makePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
function sameState(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function startLoopback(expectedState, timeoutMs = 180000) {
  let resolveResult, rejectResult, finished = false, timer;
  const response = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  response.catch(() => {});
  let server;
  const finish = (error, code) => {
    if (finished) return;
    finished = true; clearTimeout(timer); server.close(); server.closeIdleConnections?.();
    if (error) rejectResult(error); else resolveResult(code);
  };
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (finished || req.method !== 'GET' || req.headers.host !== `127.0.0.1:${server.address()?.port}` || (req.url || '').length > 12000) { res.writeHead(400); res.end('Invalid request.'); return; }
    let url; try { url = new URL(req.url, `http://127.0.0.1:${server.address().port}`); } catch { res.writeHead(400); res.end('Invalid request.'); return; }
    if (url.pathname !== '/oauth/callback') { res.writeHead(404); res.end('Not found.'); return; }
    const states = url.searchParams.getAll('state');
    if (states.length !== 1 || !sameState(states[0], expectedState)) { res.writeHead(400); res.end('Invalid sign-in state. Return to the app and retry.'); return; }
    if (url.searchParams.has('error')) { res.writeHead(400); res.end('Sign-in was not completed. You may close this tab.'); finish(new Error('Google sign-in was cancelled or denied.')); return; }
    const codes = url.searchParams.getAll('code');
    if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) { res.writeHead(400); res.end('Missing authorization code.'); return; }
    res.writeHead(200); res.end('<!doctype html><meta charset="utf-8"><title>Hidden Door Vault</title><h1>Google sign-in complete.</h1><p>Return to Hidden Door Vault. You can close this tab.</p>');
    finish(null, codes[0]);
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 8;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.on('error', error => finish(error));
  timer = setTimeout(() => finish(new Error('Google sign-in timed out. Try again.')), timeoutMs);
  return { redirectUri: `http://127.0.0.1:${server.address().port}/oauth/callback`, response, cancel: () => { finish(new Error('Sign-in cancelled.')); server.closeAllConnections?.(); } };
}
function validateClient(value) {
  const client = value?.installed || value;
  if (!client || typeof client.client_id !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(client.client_id)) throw new Error('Import an OAuth client JSON created with application type Desktop app.');
  if (client.client_secret !== undefined && (typeof client.client_secret !== 'string' || client.client_secret.length > 200)) throw new Error('Invalid OAuth client configuration.');
  return { client_id: client.client_id, client_secret: client.client_secret || '' };
}
class GoogleAuth {
  constructor({ store, openExternal, fetcher = globalThis.fetch }) { this.store = store; this.openExternal = openExternal; this.fetcher = fetcher; this.access = null; this.refreshing = null; this.callback = null; this.generation = 0; }
  async configured() { return Boolean(await this.store.get('oauth-client')); }
  async signedIn() { return Boolean(await this.store.get('google-session')); }
  async configure(input) { const client = validateClient(input); await this.logout(); await this.store.set('oauth-client', client); }
  async requestToken(values) {
    const client = await this.store.get('oauth-client'); if (!client) throw new Error('Import the Desktop OAuth client JSON first.');
    const body = new URLSearchParams({ ...values, client_id: client.client_id }); if (client.client_secret) body.set('client_secret', client.client_secret);
    const data = await fetchJSON('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, this.fetcher);
    if (typeof data.access_token !== 'string' || data.access_token.length > 16384 || !Number.isFinite(data.expires_in)) throw new Error('Invalid Google token response.');
    if (data.scope && !data.scope.split(' ').includes('https://www.googleapis.com/auth/cloud-platform')) throw new Error('Google Cloud access was not granted. Sign in and approve the requested access.');
    return data;
  }
  async login() {
    if (this.callback) throw new Error('A Google sign-in is already open.');
    const generation = ++this.generation;
    const client = await this.store.get('oauth-client'); if (!client) throw new Error('Import the Desktop OAuth client JSON first.');
    const { verifier, challenge } = makePKCE(), state = crypto.randomBytes(32).toString('base64url');
    const callback = await startLoopback(state); this.callback = callback;
    try {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback.redirectUri, response_type: 'code', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' }).toString();
      await this.openExternal(url.toString());
      const code = await callback.response;
      const data = await this.requestToken({ code, code_verifier: verifier, redirect_uri: callback.redirectUri, grant_type: 'authorization_code' });
      if (!data.refresh_token || typeof data.refresh_token !== 'string') throw new Error('Google did not issue a refresh token. Remove the app grant in Google Account settings and reconnect.');
      const info = await fetchJSON('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` } }, this.fetcher);
      if (typeof info.sub !== 'string' || info.email_verified !== true || typeof info.email !== 'string') throw new Error('Google did not return a verified account.');
      if (generation !== this.generation) throw new Error('Sign-in was cancelled.');
      await this.store.set('google-session', { refreshToken: data.refresh_token, email: info.email, sub: info.sub });
      if (generation !== this.generation) { await this.store.delete('google-session'); throw new Error('Sign-in was cancelled.'); }
      this.access = { token: data.access_token, until: Date.now() + Math.min(data.expires_in, 86400) * 1000 };
      return { email: info.email };
    } finally { callback.cancel(); if (this.callback === callback) this.callback = null; }
  }
  invalidate() { this.access = null; }
  cancel() { this.generation++; this.callback?.cancel(); this.callback = null; }
  async token() {
    if (this.access && this.access.until > Date.now() + 60000) return this.access.token;
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async () => {
      const session = await this.store.get('google-session'); if (!session) throw new Error('Sign in to Google first.');
      try {
        const data = await this.requestToken({ refresh_token: session.refreshToken, grant_type: 'refresh_token' });
        if (generation !== this.generation) throw new Error('Session ended.');
        if (data.refresh_token) await this.store.set('google-session', { ...session, refreshToken: data.refresh_token });
        if (generation !== this.generation) { await this.store.delete('google-session'); throw new Error('Session ended.'); }
        this.access = { token: data.access_token, until: Date.now() + Math.min(data.expires_in, 86400) * 1000 };
        return this.access.token;
      } catch (error) { if (error.code === 'invalid_grant') { if (generation === this.generation) await this.store.delete('google-session'); throw new Error('Google requires a fresh sign-in. Reconnect your account.'); } throw error; }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async email() { return (await this.store.get('google-session'))?.email || ''; }
  async logout() { this.cancel(); this.access = null; await this.store.delete('google-session'); }
}
module.exports = { GoogleAuth, makePKCE, sameState, startLoopback, validateClient, SCOPES };
