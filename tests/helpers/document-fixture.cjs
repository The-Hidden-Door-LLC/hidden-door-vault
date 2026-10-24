'use strict';
const assert = require('node:assert/strict');
const { FakeGoogle, MemoryCache, fakeAuth } = require('../mock-gcp.cjs');
const { Vault } = require('../../src/core/vault.cjs');
const { SecretManager } = require('../../src/core/gcp.cjs');
const { Documents } = require('../../src/core/documents.cjs');
const { GcsAttachments } = require('../../src/core/gcs-attachments.cjs');
const master = 'Synthetic attachment test password only';
class FakeStorage {
  constructor() { this.objects = new Map(); this.calls = []; this.serial = 100; this.failUpload = false; this.onUpload = null; this.onDownload = null; this.corrupt = false; }
  fetch = async (input, options = {}) => {
    const url = new URL(input), method = options.method || 'GET';
    assert.equal(url.hostname, 'storage.googleapis.com'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    this.calls.push({ url: url.toString(), method, body: options.body ? Buffer.from(options.body) : null });
    if (method === 'POST') {
      if (this.failUpload) return Response.json({ error: { message: 'Do not forward this server detail' } }, { status: 503 });
      const bucket = decodeURIComponent(/\/b\/([^/]+)\/o/.exec(url.pathname)[1]), object = url.searchParams.get('name');
      assert.equal(url.searchParams.get('ifGenerationMatch'), '0');
      const generation = String(++this.serial), bytes = Buffer.from(options.body);
      this.objects.set(`${bucket}/${object}/${generation}`, bytes);
      await this.onUpload?.();
      return Response.json({ bucket, name: object, generation, size: String(bytes.length) });
    }
    const match = /\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    const bucket = decodeURIComponent(match[1]), object = decodeURIComponent(match[2]), generation = url.searchParams.get('generation');
    assert.equal(url.searchParams.get('ifGenerationMatch'), generation);
    const bytes = this.objects.get(`${bucket}/${object}/${generation}`);
    if (!bytes) return Response.json({ error: {} }, { status: 404 });
    await this.onDownload?.();
    const result = Buffer.from(bytes);
    if (this.corrupt) result[Math.floor(result.length / 2)] ^= 1;
    return new Response(result, { headers: { 'Content-Length': String(result.length) } });
  };
}
async function fixture({ google = new FakeGoogle(), storage = new FakeStorage(), project = 'test-project-123', name = 'personal', existing = false } = {}) {
  const cache = new MemoryCache(), cloud = new SecretManager({ project, vault: name, auth: fakeAuth(), fetcher: google.fetch });
  const vault = new Vault({ project, vault: name, cloud, cache });
  if (existing) await vault.unlock(master); else await vault.create(master);
  const objects = new GcsAttachments({ bucket: 'example-attachment-bucket', project, auth: fakeAuth(), fetcher: storage.fetch });
  vault.documents = new Documents(vault, objects);
  return { vault, google, storage, cache };
}
const write = (value = '# A private document\n', extra = {}) => ({ title: 'A private document', filename: 'document.md', mediaType: 'text/markdown', contentBase64: Buffer.from(value).toString('base64'), autoUnlock: false, ...extra });

module.exports = { FakeStorage, fixture, master, write };
