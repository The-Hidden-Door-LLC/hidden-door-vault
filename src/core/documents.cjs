'use strict';
const crypto = require('node:crypto');
const { seal, unseal } = require('./crypto.cjs');
const { TAG, MAX_BYTES, MAX_FRAME_BYTES, MEDIA_TYPES, UUID, failure, isDocumentRecord, validateIdentity, decodeContent, manifestOf, documentMetadata, aadOf } = require('./document-format.cjs');

function attachmentKey(seed, manifest) { return Buffer.from(crypto.hkdfSync('sha256', seed, Buffer.from(manifest.attachmentId), Buffer.from(aadOf(manifest)), 32)); }
class Documents {
  constructor(vault, storage = null) { this.vault = vault; this.storage = storage; this.writing = false; }
  capability() { return { supported: Boolean(this.storage), maxBytes: MAX_BYTES, maxFrameBytes: MAX_FRAME_BYTES, mediaTypes: [...MEDIA_TYPES] }; }
  ready(write = false) {
    if (!this.vault.unlocked) throw failure('vault_locked', 'The vault is locked. Unlock Hidden Door Vault before opening or saving files.');
    if (!this.storage) throw failure('storage_not_configured', 'Choose an encrypted attachment bucket in Vault Settings first.');
    if (write && this.vault.offline) throw failure('offline', 'Unlock Vault online before saving a file.');
  }
  current(epoch) { if (this.vault.epoch !== epoch || !this.vault.unlocked) throw failure('vault_locked', 'The vault was locked while the document operation was in progress.'); }
  find(id) {
    if (!UUID.test(id || '')) throw failure('invalid_document', 'Use a document UUID.');
    const item = this.vault.records.get(id);
    if (!item || !isDocumentRecord(item)) throw failure('document_not_found', 'Document not found in the active vault.');
    return item;
  }
  list(input = {}) {
    this.ready();
    if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) throw failure('invalid_document', 'Search must be 200 characters or fewer.');
    const needle = (input.search || '').toLowerCase();
    return [...this.vault.records.values()].filter(item => !item.archived && isDocumentRecord(item)).map(item => documentMetadata(item)).filter(item => `${item.title} ${item.filename}`.toLowerCase().includes(needle)).sort((a, b) => a.title.localeCompare(b.title));
  }
  async read(input) {
    this.ready(); const epoch = this.vault.epoch;
    if (this.vault.offline) throw failure('offline', 'Attachment bytes are stored in GCS. Unlock Vault online to open a file.');
    const item = this.find(input.id), manifest = manifestOf(item);
    let wire, seed, key, plaintext;
    try {
      wire = await this.storage.download(manifest, () => this.current(epoch)); this.current(epoch);
      if (!Buffer.isBuffer(wire) || wire.length > MAX_FRAME_BYTES) throw failure('too_large', 'Encrypted attachment exceeds the transport limit.');
      let envelope;
      try { envelope = JSON.parse(wire.toString('utf8')); } catch (_) { throw failure('integrity_failed', 'The encrypted attachment is unreadable.'); }
      seed = Buffer.from(manifest.seed, 'base64'); key = attachmentKey(seed, manifest);
      try { plaintext = unseal(key, envelope, aadOf(manifest), MAX_BYTES); }
      catch (_) { throw failure('integrity_failed', 'The encrypted attachment failed authentication.'); }
      this.current(epoch);
      if (plaintext.length !== manifest.size || crypto.createHash('sha256').update(plaintext).digest('hex') !== manifest.sha256) throw failure('integrity_failed', 'The attachment bytes do not match their authenticated manifest.');
      return { ...documentMetadata(item, manifest), contentBase64: plaintext.toString('base64') };
    } finally { wire?.fill(0); seed?.fill(0); key?.fill(0); plaintext?.fill(0); }
  }
  async write(input) {
    this.ready(true); validateIdentity(input);
    if (this.writing || this.vault.writing) throw failure('busy', 'A vault write is already in progress.');
    const updating = input.id !== undefined;
    const previous = updating ? this.find(input.id) : null;
    const previousManifest = previous ? manifestOf(previous) : null;
    if (updating && (typeof input.expectedRevision !== 'string' || input.expectedRevision !== previousManifest.revision)) throw failure('revision_conflict', 'The document changed. Open its current revision before saving again.');
    if (!updating && input.expectedRevision !== undefined) throw failure('invalid_document', 'New documents must not specify a previous revision.');
    const epoch = this.vault.epoch, id = previous?.id || crypto.randomUUID();
    let plaintext, seed, key, wire, uploadAttempted = false, uploaded = false, metadataAttempted = false;
    this.writing = true;
    try {
      plaintext = decodeContent(input.contentBase64);
      const manifest = { schema: 1, attachmentId: crypto.randomUUID(), originDocumentId: id, originContext: `${this.vault.context}:${this.vault.header.vaultId}`, filename: input.filename.trim(), mediaType: input.mediaType, size: plaintext.length, sha256: crypto.createHash('sha256').update(plaintext).digest('hex'), revision: crypto.randomUUID() };
      seed = crypto.randomBytes(32); manifest.seed = seed.toString('base64'); key = attachmentKey(seed, manifest);
      wire = Buffer.from(JSON.stringify(seal(key, plaintext, aadOf(manifest))));
      plaintext.fill(0); key.fill(0); seed.fill(0);
      const object = `hdv1/${manifest.attachmentId}/${manifest.revision}`;
      uploadAttempted = true;
      const location = await this.storage.upload(object, wire, () => this.current(epoch)); uploaded = true; this.current(epoch);
      Object.assign(manifest, location);
      // Recheck the in-process revision after upload; cloud etags remain the final CAS gate.
      if (previous && manifestOf(this.find(id)).revision !== input.expectedRevision) throw failure('revision_conflict', 'The document changed while its upload was in progress.');
      const item = { ...(previous || {}), ...(previous ? { id } : {}), kind: 'note', title: input.title.trim(), notes: JSON.stringify(manifest), tags: TAG };
      metadataAttempted = true;
      const saved = await this.vault.save(item, { documentWrite: true, documentId: id }); this.current(epoch);
      return documentMetadata(saved, manifest);
    } catch (error) {
      if (uploadAttempted) {
        const code = error.code || ({ 401: 'auth_required', 403: 'access_denied', 404: 'not_found', 409: 'revision_conflict', 412: 'revision_conflict' }[error.status]) || (metadataAttempted ? 'commit_unconfirmed' : 'storage_failed');
        const accessHint = [401, 403, 404].includes(error.status) ? `${error.message} ` : '';
        const reported = failure(code, accessHint + (uploaded ? 'An encrypted attachment was uploaded, but its metadata was not confirmed. ' : 'The encrypted upload could not be confirmed. ') + 'Existing encrypted objects were retained; an orphan object may remain. Refresh Vault before retrying.');
        throw reported;
      }
      throw error;
    } finally { plaintext?.fill(0); seed?.fill(0); key?.fill(0); wire?.fill(0); this.writing = false; }
  }
}
module.exports = { Documents, attachmentKey };
