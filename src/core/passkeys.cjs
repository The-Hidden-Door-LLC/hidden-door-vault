'use strict';
const crypto = require('node:crypto');

// Minimal RFC 8949 deterministic CBOR encoder for WebAuthn COSE_Key and attestationObject.
function cborHead(major, length) {
  const high = major << 5;
  if (length < 24) return Buffer.from([high | length]);
  if (length < 0x100) return Buffer.from([high | 24, length]);
  if (length < 0x10000) { const b = Buffer.alloc(3); b[0] = high | 25; b.writeUInt16BE(length, 1); return b; }
  const b = Buffer.alloc(5); b[0] = high | 26; b.writeUInt32BE(length, 1); return b;
}

function cborEncode(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    return Buffer.concat([cborHead(2, buf.length), buf]);
  }
  if (typeof value === 'string') {
    const buf = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, buf.length), buf]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(cborEncode)]);
  }
  if (value instanceof Map || (value && typeof value === 'object')) {
    const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
    const encoded = entries.map(([k, v]) => ({ k: cborEncode(k), v: cborEncode(v) }));
    encoded.sort((a, b) => Buffer.compare(a.k, b.k));
    return Buffer.concat([cborHead(5, encoded.length), ...encoded.flatMap(e => [e.k, e.v])]);
  }
  throw new Error('Unsupported CBOR type.');
}

function normalizeRpId(rpId, origin) {
  let originUrl;
  try { originUrl = new URL(origin); } catch { throw new Error('Invalid WebAuthn origin.'); }
  const host = originUrl.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  if (originUrl.protocol !== 'https:' && !(originUrl.protocol === 'http:' && isLocal)) {
    throw new Error('WebAuthn requires an HTTPS origin (or localhost).');
  }
  const effectiveRpId = (rpId ? String(rpId).trim().toLowerCase().replace(/\.$/, '') : host);
  if (!effectiveRpId || effectiveRpId.length > 253 || !/^[a-z0-9.-]+$/.test(effectiveRpId) || effectiveRpId.startsWith('.') || effectiveRpId.endsWith('.')) {
    throw new Error('Invalid Relying Party ID.');
  }
  if (host !== effectiveRpId && !host.endsWith(`.${effectiveRpId}`)) {
    throw new Error(`Relying Party ID ${effectiveRpId} does not match origin ${host}.`);
  }
  return { rpId: effectiveRpId, origin: originUrl.origin };
}

function buildClientDataJSON(type, challenge, origin, providedClientDataJSON) {
  if (providedClientDataJSON) {
    const raw = Buffer.isBuffer(providedClientDataJSON) ? providedClientDataJSON : Buffer.from(String(providedClientDataJSON), 'base64url');
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new Error('Malformed clientDataJSON.'); }
    if (parsed.type !== type) throw new Error(`Unexpected WebAuthn ceremony type: ${parsed.type}`);
    if (origin && parsed.origin !== origin) throw new Error('clientDataJSON origin mismatch.');
    if (challenge && parsed.challenge !== challenge) throw new Error('clientDataJSON challenge mismatch.');
    return raw;
  }
  const effectiveChallenge = (typeof challenge === 'string' && challenge) ? challenge : crypto.randomBytes(32).toString('base64url');
  return Buffer.from(JSON.stringify({ type, challenge: effectiveChallenge, origin, crossOrigin: false }), 'utf8');
}

function selectAlgorithm(alg, credParams) {
  if (alg === 'EdDSA' || alg === -8) return { name: 'EdDSA', coseAlg: -8 };
  if (alg === 'ES256' || alg === -7) return { name: 'ES256', coseAlg: -7 };
  if (Array.isArray(credParams) && credParams.length) {
    for (const p of credParams) {
      const a = typeof p === 'number' ? p : p?.alg;
      if (a === -7) return { name: 'ES256', coseAlg: -7 };
      if (a === -8) return { name: 'EdDSA', coseAlg: -8 };
    }
    throw new Error('Relying party requested unsupported public-key algorithms (ES256 and EdDSA are supported).');
  }
  return { name: 'ES256', coseAlg: -7 };
}

function encodeCosePublicKey(publicKey, algName) {
  const jwk = publicKey.export({ format: 'jwk' });
  if (algName === 'EdDSA') {
    const x = Buffer.from(jwk.x, 'base64url');
    return cborEncode(new Map([[1, 1], [3, -8], [-1, 6], [-2, x]]));
  }
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return cborEncode(new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
}

// Flags: UP (0x01) | UV (0x04) | BE (0x08) | BS (0x10) = 0x1d; + AT (0x40) on registration = 0x5d.
const FLAGS_ASSERTION = 0x1d;
const FLAGS_ATTESTED = 0x5d;
const AAGUID = Buffer.alloc(16, 0);

function createPasskey(options = {}) {
  const { rpId, origin } = normalizeRpId(options.rpId, options.origin || `https://${options.rpId}`);
  const clientDataBytes = buildClientDataJSON('webauthn.create', options.challenge, origin, options.clientDataJSON);
  const { name: algName, coseAlg } = selectAlgorithm(options.algorithm || options.alg, options.pubKeyCredParams || options.credParams);
  const pair = algName === 'EdDSA'
    ? crypto.generateKeyPairSync('ed25519')
    : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicSpki = pair.publicKey.export({ type: 'spki', format: 'der' });
  const cosePublicKey = encodeCosePublicKey(pair.publicKey, algName);

  const credentialIdBytes = crypto.randomBytes(32);
  const credentialId = credentialIdBytes.toString('base64url');
  const rpIdHash = crypto.createHash('sha256').update(rpId, 'utf8').digest();
  const flags = Buffer.from([FLAGS_ATTESTED]);
  const signCount = Buffer.alloc(4, 0);
  const credLen = Buffer.alloc(2);
  credLen.writeUInt16BE(credentialIdBytes.length, 0);

  const authData = Buffer.concat([rpIdHash, flags, signCount, AAGUID, credLen, credentialIdBytes, cosePublicKey]);
  const attestationObject = cborEncode(new Map([
    ['fmt', 'none'],
    ['attStmt', new Map()],
    ['authData', authData]
  ]));

  const userHandle = options.userHandle
    ? String(options.userHandle)
    : (options.userId ? (Buffer.isBuffer(options.userId) ? options.userId.toString('base64url') : Buffer.from(String(options.userId), 'utf8').toString('base64url')) : crypto.randomBytes(16).toString('base64url'));
  const userName = String(options.userName || options.userDisplayName || '').slice(0, 200);
  const rpName = String(options.rpName || rpId).slice(0, 200);
  const createdAt = new Date().toISOString();

  const response = {
    clientDataJSON: clientDataBytes.toString('base64url'),
    attestationObject: attestationObject.toString('base64url'),
    authenticatorData: authData.toString('base64url'),
    publicKey: publicSpki.toString('base64url'),
    publicKeyDer: publicSpki.toString('base64url'),
    publicKeyAlgorithm: coseAlg,
    coseAlg,
    transports: ['internal', 'hybrid']
  };
  const credential = {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response
  };

  return {
    credentialId,
    rawId: credentialId,
    rpId,
    algorithm: algName,
    response,
    recordFields: {
      passkeyId: credentialId,
      passkeyRpId: rpId,
      passkeyRpName: rpName,
      passkeyUserHandle: userHandle,
      passkeyUserName: userName,
      passkeyAlgorithm: algName,
      passkeyPrivateKey: privatePem,
      passkeyPublicKey: publicSpki.toString('base64url'),
      passkeySignCount: '0',
      passkeyCreatedAt: createdAt
    },
    credential
  };
}

function signPasskeyAssertion(item, options = {}) {
  if (!item || !item.passkeyId || !item.passkeyPrivateKey || !item.passkeyRpId) {
    throw new Error('This item does not contain a registered passkey.');
  }
  const { rpId, origin } = normalizeRpId(options.rpId || item.passkeyRpId, options.origin || `https://${item.passkeyRpId}`);
  if (rpId !== item.passkeyRpId.toLowerCase()) {
    throw new Error(`Passkey RP ID mismatch: item is bound to ${item.passkeyRpId}, requested ${rpId}.`);
  }
  const clientDataBytes = buildClientDataJSON('webauthn.get', options.challenge, origin, options.clientDataJSON);
  const clientDataHash = crypto.createHash('sha256').update(clientDataBytes).digest();
  const rpIdHash = crypto.createHash('sha256').update(rpId, 'utf8').digest();
  const nextCount = (Number.parseInt(item.passkeySignCount || '0', 10) || 0) + 1;
  const signCountBuf = Buffer.alloc(4);
  signCountBuf.writeUInt32BE(nextCount >>> 0, 0);
  const authData = Buffer.concat([rpIdHash, Buffer.from([FLAGS_ASSERTION]), signCountBuf]);
  const signedData = Buffer.concat([authData, clientDataHash]);

  const privateKey = crypto.createPrivateKey({ key: item.passkeyPrivateKey, format: 'pem', type: 'pkcs8' });
  const algName = item.passkeyAlgorithm === 'EdDSA' ? 'EdDSA' : 'ES256';
  const signature = algName === 'EdDSA'
    ? crypto.sign(null, signedData, privateKey)
    : crypto.sign('sha256', signedData, privateKey);

  const response = {
    clientDataJSON: clientDataBytes.toString('base64url'),
    authenticatorData: authData.toString('base64url'),
    signature: signature.toString('base64url'),
    userHandle: item.passkeyUserHandle || ''
  };
  const credential = {
    id: item.passkeyId,
    rawId: item.passkeyId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response
  };

  return {
    credentialId: item.passkeyId,
    rawId: item.passkeyId,
    signCount: String(nextCount),
    nextSignCount: nextCount,
    response,
    credential
  };
}

function verifyPasskeyAssertion(itemOrOpts, credential, expectedChallenge, expectedOrigin) {
  let pubKeyStr, algName, rpId, clientDataB64, authDataB64, sigB64, expChallenge, expOrigin;
  if (credential && credential.response) {
    pubKeyStr = itemOrOpts.passkeyPublicKey;
    algName = itemOrOpts.passkeyAlgorithm === 'EdDSA' ? 'EdDSA' : 'ES256';
    rpId = itemOrOpts.passkeyRpId;
    clientDataB64 = credential.response.clientDataJSON;
    authDataB64 = credential.response.authenticatorData;
    sigB64 = credential.response.signature;
    expChallenge = expectedChallenge;
    expOrigin = expectedOrigin;
  } else {
    pubKeyStr = itemOrOpts.publicKeyPem || itemOrOpts.publicKey || itemOrOpts.passkeyPublicKey;
    algName = (itemOrOpts.algorithm || itemOrOpts.passkeyAlgorithm) === 'EdDSA' ? 'EdDSA' : 'ES256';
    rpId = itemOrOpts.expectedRpId || itemOrOpts.passkeyRpId;
    clientDataB64 = itemOrOpts.clientDataJSON;
    authDataB64 = itemOrOpts.authenticatorData;
    sigB64 = itemOrOpts.signature;
    expChallenge = itemOrOpts.expectedChallenge;
    expOrigin = itemOrOpts.expectedOrigin;
  }
  const clientDataBytes = Buffer.from(clientDataB64, 'base64url');
  const clientData = JSON.parse(clientDataBytes.toString('utf8'));
  if (clientData.type !== 'webauthn.get') throw new Error('Invalid clientData type.');
  if (expChallenge && clientData.challenge !== expChallenge) throw new Error('Challenge mismatch.');
  if (expOrigin && clientData.origin !== expOrigin) throw new Error('Origin mismatch.');
  const authData = Buffer.from(authDataB64, 'base64url');
  const expectedRpHash = crypto.createHash('sha256').update(rpId.toLowerCase(), 'utf8').digest();
  if (!authData.subarray(0, 32).equals(expectedRpHash)) throw new Error('RP ID hash mismatch.');
  if ((authData[32] & 0x01) === 0) throw new Error('User Present flag not set.');
  const clientDataHash = crypto.createHash('sha256').update(clientDataBytes).digest();
  const signedData = Buffer.concat([authData, clientDataHash]);
  const publicKey = pubKeyStr.includes('BEGIN PUBLIC KEY')
    ? crypto.createPublicKey(pubKeyStr)
    : crypto.createPublicKey({ key: Buffer.from(pubKeyStr, 'base64url'), format: 'der', type: 'spki' });
  const signature = Buffer.from(sigB64, 'base64url');
  return algName === 'EdDSA'
    ? crypto.verify(null, signedData, publicKey, signature)
    : crypto.verify('sha256', signedData, publicKey, signature);
}

module.exports = { cborEncode, normalizeRpId, createPasskey, signPasskeyAssertion, verifyPasskeyAssertion };
