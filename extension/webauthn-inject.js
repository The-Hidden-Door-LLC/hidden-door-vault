(() => {
  if (!navigator.credentials || window.__hdvWebAuthnInstalled) return;
  window.__hdvWebAuthnInstalled = true;

  const nativeCreate = navigator.credentials.create.bind(navigator.credentials);
  const nativeGet = navigator.credentials.get.bind(navigator.credentials);
  const CHANNEL = 'hdv-webauthn-bridge-v1';
  const pending = new Map();

  function toBase64Url(input) {
    if (!input) return '';
    let bytes;
    if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else if (typeof input === 'string') return input;
    else return '';
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(str) {
    if (!str) return new ArrayBuffer(0);
    const norm = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
    const bin = atob(norm + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.channel !== CHANNEL || event.data.direction !== 'to-page') return;
    const entry = pending.get(event.data.requestId);
    if (!entry) return;
    pending.delete(event.data.requestId);
    clearTimeout(entry.timer);
    if (event.data.ok) entry.resolve(event.data.result);
    else entry.reject(new Error(event.data.error || 'Passkey request declined'));
  });

  function askExtension(type, payload, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const requestId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            pending.delete(requestId);
            reject(new Error('Passkey request timed out'));
          }, timeoutMs)
        : null;
      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({
        channel: CHANNEL,
        direction: 'from-page',
        requestId,
        type,
        payload
      }, window.location.origin);
    });
  }

  function buildRegistrationCredential(res) {
    const rawId = fromBase64Url(res.rawId || res.credentialId);
    const clientDataJSON = fromBase64Url(res.response.clientDataJSON);
    const attestationObject = fromBase64Url(res.response.attestationObject);
    const authenticatorData = fromBase64Url(res.response.authenticatorData);
    const publicKey = res.response.publicKeyDer ? fromBase64Url(res.response.publicKeyDer) : null;
    const response = {
      clientDataJSON,
      attestationObject,
      getTransports: () => res.response.transports || ['internal', 'hybrid'],
      getAuthenticatorData: () => authenticatorData,
      getPublicKey: () => publicKey,
      getPublicKeyAlgorithm: () => res.response.coseAlg || -7
    };
    const cred = {
      id: res.credentialId,
      rawId,
      type: 'public-key',
      authenticatorAttachment: res.authenticatorAttachment || 'platform',
      response,
      getClientExtensionResults: () => ({}),
      toJSON: () => ({
        id: res.credentialId,
        rawId: res.rawId || res.credentialId,
        type: 'public-key',
        authenticatorAttachment: res.authenticatorAttachment || 'platform',
        response: {
          clientDataJSON: res.response.clientDataJSON,
          attestationObject: res.response.attestationObject,
          transports: res.response.transports || ['internal', 'hybrid']
        },
        clientExtensionResults: {}
      })
    };
    if (typeof window.PublicKeyCredential === 'function') {
      try { Object.setPrototypeOf(cred, window.PublicKeyCredential.prototype); } catch {}
    }
    return cred;
  }

  function buildAssertionCredential(res) {
    const rawId = fromBase64Url(res.rawId || res.credentialId);
    const clientDataJSON = fromBase64Url(res.response.clientDataJSON);
    const authenticatorData = fromBase64Url(res.response.authenticatorData);
    const signature = fromBase64Url(res.response.signature);
    const userHandle = res.response.userHandle ? fromBase64Url(res.response.userHandle) : null;
    const response = {
      clientDataJSON,
      authenticatorData,
      signature,
      userHandle
    };
    const cred = {
      id: res.credentialId,
      rawId,
      type: 'public-key',
      authenticatorAttachment: res.authenticatorAttachment || 'platform',
      response,
      getClientExtensionResults: () => ({}),
      toJSON: () => ({
        id: res.credentialId,
        rawId: res.rawId || res.credentialId,
        type: 'public-key',
        authenticatorAttachment: res.authenticatorAttachment || 'platform',
        response: {
          clientDataJSON: res.response.clientDataJSON,
          authenticatorData: res.response.authenticatorData,
          signature: res.response.signature,
          userHandle: res.response.userHandle || null
        },
        clientExtensionResults: {}
      })
    };
    if (typeof window.PublicKeyCredential === 'function') {
      try { Object.setPrototypeOf(cred, window.PublicKeyCredential.prototype); } catch {}
    }
    return cred;
  }

  if (typeof window.PublicKeyCredential === 'function') {
    try {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
      window.PublicKeyCredential.isConditionalMediationAvailable = async () => true;
    } catch {}
  }

  if (typeof navigator.credentials.store === 'function') {
    const nativeStore = navigator.credentials.store.bind(navigator.credentials);
    navigator.credentials.store = async function hdvStore(cred) {
      try {
        if (cred && (cred.type === 'password' || ('password' in cred && 'id' in cred))) {
          window.postMessage({
            channel: CHANNEL,
            direction: 'from-page',
            requestId: 'store-' + Date.now(),
            type: 'credential-store',
            payload: {
              username: String(cred.id || cred.name || ''),
              password: String(cred.password || '')
            }
          }, window.location.origin);
        }
      } catch {}
      return nativeStore(cred);
    };
  }

  navigator.credentials.create = async function hdvCreate(options) {
    const pk = options && options.publicKey;
    if (!pk) return nativeCreate(options);
    try {
      const rpId = (pk.rp && pk.rp.id) || window.location.hostname;
      const rpName = (pk.rp && pk.rp.name) || rpId;
      const userName = (pk.user && (pk.user.name || pk.user.displayName)) || 'user';
      const userDisplayName = (pk.user && (pk.user.displayName || pk.user.name)) || userName;
      const userHandle = pk.user && pk.user.id ? toBase64Url(pk.user.id) : '';
      const challenge = toBase64Url(pk.challenge);
      const pubKeyCredParams = Array.isArray(pk.pubKeyCredParams) ? pk.pubKeyCredParams.map((p) => ({ type: p.type, alg: p.alg })) : [];
      const excludeCredentialIds = Array.isArray(pk.excludeCredentials)
        ? pk.excludeCredentials.map((c) => toBase64Url(c.id)).filter(Boolean)
        : [];
      const res = await askExtension('webauthn-create', {
        rpId,
        rpName,
        userName,
        userDisplayName,
        userHandle,
        challenge,
        pubKeyCredParams,
        excludeCredentialIds
      });
      if (res && res.fallback) return nativeCreate(options);
      return buildRegistrationCredential(res);
    } catch {
      return nativeCreate(options);
    }
  };

  navigator.credentials.get = async function hdvGet(options) {
    const pk = options && options.publicKey;
    if (!pk) return nativeGet(options);
    const rpId = pk.rpId || window.location.hostname;
    const challenge = toBase64Url(pk.challenge);
    const allowCredentialIds = Array.isArray(pk.allowCredentials)
      ? pk.allowCredentials.map((c) => toBase64Url(c.id)).filter(Boolean)
      : [];

    if (options.mediation === 'conditional') {
      try {
        if (options.signal && options.signal.aborted) {
          throw new DOMException('The operation either timed out or was not allowed.', 'AbortError');
        }
        const condPromise = askExtension('webauthn-conditional', {
          rpId,
          challenge,
          allowCredentialIds
        }, 0);
        if (options.signal && typeof options.signal.addEventListener === 'function') {
          options.signal.addEventListener('abort', () => {
            window.postMessage({
              channel: CHANNEL,
              direction: 'from-page',
              requestId: 'abort',
              type: 'webauthn-conditional-abort',
              payload: { rpId }
            }, window.location.origin);
          }, { once: true });
        }
        const res = await condPromise;
        if (res && res.fallback) return nativeGet(options);
        return buildAssertionCredential(res);
      } catch (err) {
        if (options.signal && options.signal.aborted) throw err;
        return nativeGet(options);
      }
    }

    try {
      const res = await askExtension('webauthn-get', {
        rpId,
        challenge,
        allowCredentialIds
      });
      if (res && res.fallback) return nativeGet(options);
      return buildAssertionCredential(res);
    } catch {
      return nativeGet(options);
    }
  };
})();
