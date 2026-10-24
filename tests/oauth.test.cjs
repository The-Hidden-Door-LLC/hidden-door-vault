'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makePKCE, sameState, startLoopback, validateClient, GoogleAuth } = require('../src/core/oauth.cjs');
const { fetchJSON } = require('../src/core/network.cjs');
test('PKCE uses a random verifier and S256 challenge', () => { const p = makePKCE(); assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/); assert.equal(p.challenge, crypto.createHash('sha256').update(p.verifier).digest('base64url')); assert.notEqual(p.verifier, makePKCE().verifier); });
test('state comparison rejects malformed and multibyte values without throwing', () => { assert.equal(sameState('abc', 'abc'), true); assert.equal(sameState('abd', 'abc'), false); assert.equal(sameState(null, 'abc'), false); assert.equal(sameState('\u00e9bc', 'abc'), false); });
test('loopback callback is localhost-only and ignores wrong state until valid callback', async () => {
  const callback = await startLoopback('correct-state', 5000);
  try {
    assert.match(callback.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    assert.equal((await fetch(`${callback.redirectUri}?state=wrong&code=bad`)).status, 400);
    assert.equal((await fetch(`${callback.redirectUri}?state=correct-state&state=correct-state&code=bad`)).status, 400);
    assert.equal((await fetch(`${callback.redirectUri}?state=correct-state&code=good-code`)).status, 200);
    assert.equal(await callback.response, 'good-code');
  } finally { callback.cancel(); }
});
test('callback rejects POST, unknown paths and duplicate codes', async () => {
  const callback = await startLoopback('state', 5000);
  try {
    assert.equal((await fetch(callback.redirectUri, { method: 'POST' })).status, 400);
    assert.equal((await fetch(callback.redirectUri.replace('/oauth/callback', '/other'))).status, 404);
    assert.equal((await fetch(`${callback.redirectUri}?state=state&code=a&code=b`)).status, 400);
  } finally { callback.cancel(); }
  await assert.rejects(callback.response, /cancelled/);
});
test('OAuth denial and timeout are handled', async () => {
  const denied = await startLoopback('state', 5000); await fetch(`${denied.redirectUri}?state=state&error=access_denied`); await assert.rejects(denied.response, /denied/); denied.cancel();
  const timeout = await startLoopback('state', 30); await assert.rejects(timeout.response, /timed out/); timeout.cancel();
});
test('OAuth client configuration rejects wrong client types and arbitrary endpoints', () => {
  assert.equal(validateClient({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'public-native-client' } }).client_id, '123-abc.apps.googleusercontent.com');
  assert.throws(() => validateClient({ web: { client_id: '123.apps.googleusercontent.com' } }));
  assert.throws(() => validateClient({ client_id: 'https://evil.test/' }));
});
test('network helper blocks credential exfiltration endpoints and redirects', async () => {
  for (const url of ['http://oauth2.googleapis.com/token', 'https://evil.test/', 'https://oauth2.googleapis.com:444/token', 'https://foo@oauth2.googleapis.com/token']) await assert.rejects(fetchJSON(url), /Blocked/);
  let options; await fetchJSON('https://oauth2.googleapis.com/token', {}, async (_url, input) => { options = input; return Response.json({ ok: true }); }); assert.equal(options.redirect, 'error');
});
test('raw upstream messages are not reflected into UI errors', async () => {
  await assert.rejects(fetchJSON('https://oauth2.googleapis.com/token', {}, async () => Response.json({ error: { message: 'LEAK_SECRET_VALUE' } }, { status: 403 })), error => !error.message.includes('LEAK_SECRET_VALUE') && error.status === 403);
});
test('concurrent requests share one token refresh and tokens stay out of public account info', async () => {
  const map = new Map([['oauth-client', { client_id: '123.apps.googleusercontent.com' }], ['google-session', { refreshToken: 'refresh-test', email: 'test@example.com', sub: 'test' }]]);
  const store = { get: async key => map.get(key), set: async (key, value) => map.set(key, value), delete: async key => map.delete(key) }; let requests = 0;
  const auth = new GoogleAuth({ store, openExternal: async () => {}, fetcher: async (_url, opts) => { requests++; assert.ok(opts.body.includes('refresh_token=refresh-test')); await new Promise(r => setTimeout(r, 20)); return Response.json({ access_token: 'access-test', expires_in: 3600 }); } });
  assert.deepEqual(await Promise.all([auth.token(), auth.token(), auth.token()]), ['access-test', 'access-test', 'access-test']); assert.equal(requests, 1); assert.equal(await auth.email(), 'test@example.com');
  await auth.logout(); assert.equal(await auth.signedIn(), false);
});
test('complete simulated Google sign-in binds browser state and PKCE to the token exchange', async () => {
  const map = new Map([['oauth-client', { client_id: '123.apps.googleusercontent.com', client_secret: 'native-client' }]]);
  const store = { get: async key => map.get(key), set: async (key, value) => map.set(key, value), delete: async key => map.delete(key) };
  let browserURL;
  const auth = new GoogleAuth({ store, openExternal: async raw => {
    browserURL = new URL(raw); assert.equal(browserURL.origin, 'https://accounts.google.com');
    assert.equal(browserURL.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(browserURL.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: browserURL.searchParams.get('state'), code: 'approved-test-code' }).toString();
    await fetch(callback);
  }, fetcher: async (url, options) => {
    if (url.hostname === 'oauth2.googleapis.com') {
      const body = new URLSearchParams(options.body); assert.equal(body.get('code'), 'approved-test-code');
      assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), browserURL.searchParams.get('code_challenge'));
      assert.equal(body.get('redirect_uri'), browserURL.searchParams.get('redirect_uri'));
      return Response.json({ access_token: 'approved-test-access', refresh_token: 'approved-test-refresh', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/cloud-platform' });
    }
    assert.equal(url.hostname, 'openidconnect.googleapis.com'); assert.equal(options.headers.Authorization, 'Bearer approved-test-access');
    return Response.json({ sub: 'test-subject', email: 'test@example.com', email_verified: true });
  } });
  assert.deepEqual(await auth.login(), { email: 'test@example.com' });
  assert.equal(map.get('google-session').refreshToken, 'approved-test-refresh');
  assert.equal(await auth.token(), 'approved-test-access'); assert.ok(!('accessToken' in map.get('google-session')));
});
test('invalid_grant deletes the expired Google refresh session', async () => {
  const map = new Map([['oauth-client', { client_id: '123.apps.googleusercontent.com' }], ['google-session', { refreshToken: 'expired' }]]);
  const store = { get: async key => map.get(key), set: async (key, value) => map.set(key, value), delete: async key => map.delete(key) };
  const auth = new GoogleAuth({ store, openExternal: async () => {}, fetcher: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) });
  await assert.rejects(auth.token(), /fresh sign-in/); assert.equal(map.has('google-session'), false);
});
test('logout during refresh-token persistence cannot resurrect the Google session', async () => {
  let entered, release;
  const waiting = new Promise(r => entered = r), gate = new Promise(r => release = r);
  const map = new Map([['oauth-client', { client_id: '123.apps.googleusercontent.com' }], ['google-session', { refreshToken: 'old' }]]);
  const store = { get: async key => map.get(key), set: async (key, value) => { entered(); await gate; map.set(key, value); }, delete: async key => map.delete(key) };
  const auth = new GoogleAuth({ store, openExternal: async () => {}, fetcher: async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) });
  const refresh = auth.token(); await waiting; await auth.logout(); release();
  await assert.rejects(refresh, /Session ended/); assert.equal(map.has('google-session'), false); assert.equal(auth.access, null);
});
