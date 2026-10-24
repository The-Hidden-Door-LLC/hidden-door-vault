'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/core/passkeys.cjs');

test('WebAuthn ES256 passkey registration and assertion signature verification succeed', () => {
  const created = P.createPasskey({
    rpId: 'github.com',
    rpName: 'GitHub',
    origin: 'https://api.github.com',
    userName: 'octocat',
    challenge: Buffer.from('reg-challenge-123').toString('base64url'),
    algorithm: 'ES256'
  });
  assert.equal(created.recordFields.passkeyRpId, 'github.com');
  assert.equal(created.recordFields.passkeyAlgorithm, 'ES256');
  assert.ok(created.credentialId.length >= 20);
  assert.ok(created.response.attestationObject.length > 40);

  const challenge = Buffer.from('login-challenge-456').toString('base64url');
  const signed = P.signPasskeyAssertion(created.recordFields, {
    rpId: 'github.com',
    origin: 'https://github.com',
    challenge
  });
  assert.equal(signed.nextSignCount, 1);
  assert.equal(signed.credentialId, created.credentialId);

  const verified = P.verifyPasskeyAssertion({
    publicKeyPem: created.recordFields.passkeyPublicKey,
    algorithm: created.recordFields.passkeyAlgorithm,
    authenticatorData: signed.response.authenticatorData,
    clientDataJSON: signed.response.clientDataJSON,
    signature: signed.response.signature,
    expectedRpId: 'github.com',
    expectedChallenge: challenge,
    expectedOrigin: 'https://github.com'
  });
  assert.equal(verified, true);
});

test('WebAuthn EdDSA (Ed25519) passkey registration and assertion verification succeed and reject origin mismatch', () => {
  const created = P.createPasskey({
    rpId: 'example.com',
    origin: 'https://app.example.com',
    userName: 'alice@example.com',
    pubKeyCredParams: [{ type: 'public-key', alg: -8 }]
  });
  assert.equal(created.recordFields.passkeyAlgorithm, 'EdDSA');

  const challenge = Buffer.from('eddsa-challenge').toString('base64url');
  const signed = P.signPasskeyAssertion(created.recordFields, {
    rpId: 'example.com',
    origin: 'https://app.example.com',
    challenge
  });
  assert.equal(P.verifyPasskeyAssertion({
    publicKeyPem: created.recordFields.passkeyPublicKey,
    algorithm: 'EdDSA',
    authenticatorData: signed.response.authenticatorData,
    clientDataJSON: signed.response.clientDataJSON,
    signature: signed.response.signature,
    expectedRpId: 'example.com',
    expectedChallenge: challenge,
    expectedOrigin: 'https://app.example.com'
  }), true);

  assert.throws(() => P.createPasskey({
    rpId: 'evil.com',
    origin: 'https://example.com',
    userName: 'alice'
  }), /does not match origin/);
});
