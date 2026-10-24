'use strict';
const { HTTPError, readJSON } = require('./network.cjs');
const { MAX_FRAME_BYTES, validBucket, failure } = require('./document-format.cjs');

async function readBytes(response, limit = MAX_FRAME_BYTES, checkCurrent = null) {
  if (!response.body) throw failure('storage_failed', 'The attachment service returned no content.');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    const declared = response.headers.get('content-length');
    if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > limit)) throw failure('too_large', 'The encrypted attachment exceeds the transport limit.');
    for (;;) {
      const { done, value } = await reader.read();
      checkCurrent?.();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw failure('too_large', 'The encrypted attachment exceeds the transport limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { for (const chunk of chunks) chunk.fill(0); await reader.cancel().catch(() => {}); }
}
class GcsAttachments {
  constructor({ bucket, project, auth, fetcher = globalThis.fetch }) {
    if (!validBucket(bucket)) throw failure('storage_not_configured', 'Choose a valid attachment bucket in Vault Settings.');
    this.bucket = bucket; this.project = project; this.auth = auth; this.fetcher = fetcher;
  }
  async request(url, options = {}, expectedEpoch) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'storage.googleapis.com' || endpoint.port || endpoint.username || endpoint.password) throw failure('storage_failed', 'Blocked an unexpected attachment endpoint.');
    const token = await this.auth.token(); expectedEpoch?.();
    let response;
    try { response = await this.fetcher(endpoint, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}`, ...(this.project ? { 'X-Goog-User-Project': this.project } : {}) }, redirect: 'error', signal: AbortSignal.timeout(20000) }); expectedEpoch?.(); }
    catch (error) { if (response?.body) await response.body.cancel().catch(() => {}); if (error.code === 'vault_locked') throw error; throw failure('storage_failed', 'The encrypted attachment service could not be reached.'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {}); expectedEpoch?.();
      const message = response.status === 403 ? 'Google denied attachment access. The selected account needs object read/create access to the configured bucket; no permissions were changed.' : response.status === 401 ? 'Google sign-in needs attention. Reconnect it in Vault.' : response.status === 404 ? 'The encrypted attachment object or bucket was not found.' : response.status === 409 || response.status === 412 ? 'The encrypted attachment object already exists or its generation changed.' : 'The encrypted attachment service rejected the request.';
      const code = { 401: 'auth_required', 403: 'access_denied', 404: 'not_found', 409: 'revision_conflict', 412: 'revision_conflict' }[response.status] || 'storage_failed';
      throw new HTTPError(response.status, message, code);
    }
    return response;
  }
  async upload(object, bytes, expectedEpoch) {
    if (!/^hdv1\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(object) || !Buffer.isBuffer(bytes) || bytes.length > MAX_FRAME_BYTES) throw failure('invalid_document', 'Invalid encrypted attachment upload.');
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?${new URLSearchParams({ uploadType: 'media', name: object, ifGenerationMatch: '0', fields: 'bucket,name,generation,size' })}`;
    const response = await this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }, expectedEpoch); expectedEpoch?.();
    let metadata;
    try { metadata = await readJSON(response, 65536, expectedEpoch); expectedEpoch?.(); }
    catch (error) { if (error.code === 'vault_locked') throw error; throw failure('storage_failed', 'Google returned unreadable attachment metadata.'); }
    if (!metadata || typeof metadata !== 'object' || metadata.bucket !== this.bucket || metadata.name !== object || typeof metadata.generation !== 'string' || !/^[1-9][0-9]{0,29}$/.test(metadata.generation) || Number(metadata.size) !== bytes.length) throw failure('storage_failed', 'Google returned inconsistent attachment metadata.');
    return { bucket: this.bucket, object, generation: metadata.generation };
  }
  async download(manifest, expectedEpoch) {
    if (!validBucket(manifest.bucket) || !/^hdv1\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(manifest.object) || !/^[1-9][0-9]{0,29}$/.test(manifest.generation)) throw failure('invalid_document', 'Invalid encrypted attachment reference.');
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(manifest.bucket)}/o/${encodeURIComponent(manifest.object)}?${new URLSearchParams({ alt: 'media', generation: manifest.generation, ifGenerationMatch: manifest.generation })}`;
    const response = await this.request(url, {}, expectedEpoch); expectedEpoch?.();
    const bytes = await readBytes(response, MAX_FRAME_BYTES, expectedEpoch);
    try { expectedEpoch?.(); return bytes; } catch (error) { bytes.fill(0); throw error; }
  }
}
module.exports = { GcsAttachments, readBytes };
