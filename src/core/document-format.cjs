'use strict';
const TAG = 'hdv-document-v1';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 24 * 1024 * 1024;
const MEDIA_TYPES = Object.freeze(['text/markdown', 'text/plain', 'image/png', 'image/jpeg', 'image/webp']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validBucket(bucket) { return typeof bucket === 'string' && /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) && !bucket.includes('..') && !/^\d+\.\d+\.\d+\.\d+$/.test(bucket); }
function isDocumentRecord(item) { return item?.kind === 'note' && (Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(',')).some(tag => String(tag).trim() === TAG); }
function validateIdentity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('invalid_document', 'Supply document metadata.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || /[\x00-\x1f\x7f]/.test(input.title)) throw failure('invalid_document', 'Give the document a title of 1–200 characters.');
  if (typeof input.filename !== 'string' || !input.filename.trim() || input.filename.length > 255 || /^[.]{1,2}$/.test(input.filename.trim()) || /[\\/\x00-\x1f\x7f]/.test(input.filename)) throw failure('invalid_document', 'Use a filename of 1–255 characters without path separators.');
  if (!MEDIA_TYPES.includes(input.mediaType)) throw failure('unsupported_media', 'Use Markdown, plain text, PNG, JPEG, or WebP.');
}
function decodeContent(value) {
  if (typeof value !== 'string') throw failure('invalid_document', 'Supply canonical base64 document bytes.');
  if (value.length > Math.ceil(MAX_BYTES / 3) * 4) throw failure('too_large', 'Documents are limited to 16 MiB.');
  const padding = value.indexOf('=');
  if (value.length % 4 || /[^A-Za-z0-9+/=]/.test(value) || (padding !== -1 && (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding))))) throw failure('invalid_document', 'Document bytes must be canonical base64.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_BYTES) { bytes.fill(0); throw failure('too_large', 'Documents are limited to 16 MiB.'); }
  if (bytes.toString('base64') !== value) { bytes.fill(0); throw failure('invalid_document', 'Document bytes must be canonical base64.'); }
  return bytes;
}
function manifestOf(item) {
  if (!isDocumentRecord(item)) throw failure('document_not_found', 'Document not found in the active vault.');
  let manifest;
  try { manifest = JSON.parse(item.notes); } catch (_) { throw failure('invalid_document', 'The encrypted document manifest is unreadable.'); }
  try {
    validateIdentity({ ...manifest, title: item.title });
    if (manifest.schema !== 1 || !UUID.test(manifest.attachmentId) || !UUID.test(manifest.originDocumentId) || !UUID.test(manifest.revision)
        || typeof manifest.originContext !== 'string' || !/^hdvault:v1:[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z][a-z0-9-]{0,19}:[0-9a-f-]{36}$/.test(manifest.originContext)
        || !Number.isInteger(manifest.size) || manifest.size < 0 || manifest.size > MAX_BYTES || !/^[0-9a-f]{64}$/.test(manifest.sha256)
        || !validBucket(manifest.bucket) || manifest.object !== `hdv1/${manifest.attachmentId}/${manifest.revision}` || typeof manifest.generation !== 'string' || !/^[1-9][0-9]{0,29}$/.test(manifest.generation)
        || typeof manifest.seed !== 'string' || manifest.seed.length !== 44) throw new Error();
    const seed = Buffer.from(manifest.seed, 'base64');
    try { if (seed.length !== 32 || seed.toString('base64') !== manifest.seed) throw new Error(); } finally { seed.fill(0); }
    return manifest;
  } catch (_) { throw failure('invalid_document', 'The encrypted document manifest is invalid.'); }
}
function documentMetadata(item, manifest = manifestOf(item)) {
  return { id: item.id, title: item.title, filename: manifest.filename, mediaType: manifest.mediaType, size: manifest.size, sha256: manifest.sha256, revision: manifest.revision };
}
function aadOf(manifest) { return JSON.stringify(['hdv-attachment-v1', manifest.originContext, manifest.originDocumentId, manifest.attachmentId, manifest.mediaType, manifest.size, manifest.sha256]); }
module.exports = { TAG, MAX_BYTES, MAX_FRAME_BYTES, MEDIA_TYPES, UUID, failure, validBucket, isDocumentRecord, validateIdentity, decodeContent, manifestOf, documentMetadata, aadOf };
