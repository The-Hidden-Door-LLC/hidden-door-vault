'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Vault, readBackup } = require('../src/core/vault.cjs');
const { Documents } = require('../src/core/documents.cjs');
const { BridgeServer, readItemField } = require('../src/core/bridge.cjs');
const { MAX_BYTES, MAX_FRAME_BYTES, manifestOf, isDocumentRecord } = require('../src/core/document-format.cjs');
const { fixture, master, write } = require('./helpers/document-fixture.cjs');
test('documents round-trip bytes while cloud transport and cache contain no plaintext or title', async () => {
  const { vault, google, storage, cache } = await fixture();
  const body = 'PRIVATE-DOCUMENT-CANARY-' + crypto.randomUUID();
  const metadata = await vault.documents.write(write(body));
  assert.deepEqual(Object.keys(metadata).sort(), ['filename','id','mediaType','revision','sha256','size','title']);
  assert.equal(metadata.id, manifestOf(vault.get(metadata.id)).originDocumentId);
  const result = await vault.documents.read({ id: metadata.id, autoUnlock: false });
  assert.equal(Buffer.from(result.contentBase64, 'base64').toString(), body);
  assert.equal(result.sha256, crypto.createHash('sha256').update(body).digest('hex'));
  assert.ok(!JSON.stringify(google.calls).includes(body)); assert.ok(!JSON.stringify(google.calls).includes('A private document'));
  assert.ok(!JSON.stringify(cache.value).includes(body));
  assert.ok(!Buffer.concat(storage.calls.filter(call => call.body).map(call => call.body)).includes(Buffer.from(body)));
  assert.ok(!Buffer.concat(storage.calls.filter(call => call.body).map(call => call.body)).includes(Buffer.from('document.md')));
  const raw = vault.get(metadata.id), seed = manifestOf(raw).seed;
  assert.ok(!JSON.stringify(vault.list()).includes(seed)); assert.ok(!JSON.stringify(vault.list()).includes(raw.notes));
  assert.equal(vault.list()[0].documentInfo.filename, 'document.md'); vault.lock();
});

test('document list excludes credential records and returns safe searchable metadata only', async () => {
  const { vault } = await fixture();
  await vault.save({ kind: 'login', title: 'A credential', password: 'synthetic-password' });
  const saved = await vault.documents.write(write());
  assert.deepEqual(vault.documents.list().map(item => item.id), [saved.id]);
  assert.equal(vault.documents.list({ search: 'DOCUMENT.MD' }).length, 1);
  assert.equal(vault.documents.list({ search: 'credential' }).length, 0);
  assert.throws(() => vault.documents.list({ search: 'x'.repeat(201) }), /200/); vault.lock();
});

test('updates require explicit revision and never upsert an unknown ID', async () => {
  const { vault } = await fixture(); const first = await vault.documents.write(write('first'));
  await assert.rejects(vault.documents.write(write('second', { id: first.id })), error => error.code === 'revision_conflict');
  await assert.rejects(vault.documents.write(write('second', { id: first.id, expectedRevision: 'stale' })), error => error.code === 'revision_conflict');
  await assert.rejects(vault.documents.write(write('second', { id: crypto.randomUUID(), expectedRevision: first.revision })), error => error.code === 'document_not_found');
  await assert.rejects(vault.documents.write(write('second', { expectedRevision: first.revision })), error => error.code === 'invalid_document');
  const next = await vault.documents.write(write('second', { id: first.id, expectedRevision: first.revision }));
  assert.equal(next.id, first.id); assert.notEqual(next.revision, first.revision);
  assert.equal(Buffer.from((await vault.documents.read({ id: next.id })).contentBase64, 'base64').toString(), 'second'); vault.lock();
});

test('unconfigured or locked document APIs fail without triggering unlock or touching storage', async () => {
  const { vault, storage } = await fixture(); const original = storage.calls.length;
  const unconfigured = new Documents(vault); assert.equal(unconfigured.capability().supported, false);
  assert.throws(() => unconfigured.list(), error => error.code === 'storage_not_configured');
  vault.lock(); let unlocks = 0;
  const bridge = new BridgeServer({ getVault: () => vault, ensureUnlocked: async () => { unlocks++; } });
  await assert.rejects(bridge.dispatch('documents-list', { autoUnlock: true }), error => error.code === 'vault_locked');
  await assert.rejects(vault.documents.read({ id: crypto.randomUUID() }), error => error.code === 'vault_locked');
  await assert.rejects(vault.documents.write(write()), error => error.code === 'vault_locked');
  assert.equal(unlocks, 0); assert.equal(storage.calls.length, original);
});

test('media, basename, canonical base64, and raw-size limits reject before upload', async () => {
  const { vault, storage } = await fixture();
  for (const patch of [{ mediaType:'application/octet-stream' }, { filename:'../escape.md' }, { filename:'a\\b.png' }, { filename:'\0bad' }, { title:'' }, { contentBase64:'bad!' }, { contentBase64:'Zh==' }]) await assert.rejects(vault.documents.write(write('x', patch)));
  await assert.rejects(vault.documents.write(write('x', { contentBase64: Buffer.alloc(MAX_BYTES + 1).toString('base64') })), error => error.code === 'too_large');
  assert.equal(storage.calls.length, 0); vault.lock();
});

test('binary images and empty text round-trip with the same typed interface', async () => {
  const { vault } = await fixture();
  for (const [mediaType, filename, bytes] of [['image/png','a.png',Buffer.from([0,255,137,80,78,71])],['image/jpeg','a.jpg',crypto.randomBytes(4096)],['image/webp','a.webp',crypto.randomBytes(4096)],['text/plain','empty.txt',Buffer.alloc(0)]]) {
    const saved = await vault.documents.write(write('', { mediaType, filename, contentBase64:bytes.toString('base64') }));
    assert.deepEqual(Buffer.from((await vault.documents.read({ id:saved.id })).contentBase64,'base64'),bytes);
  }
  vault.lock();
});

test('tampered ciphertext, manifest hash, MIME and origin context fail authentication', async () => {
  const { vault, storage } = await fixture(); const saved = await vault.documents.write(write());
  storage.corrupt = true;
  await assert.rejects(vault.documents.read({ id:saved.id }), error => error.code === 'integrity_failed'); storage.corrupt = false;
  const original = vault.get(saved.id), manifest = manifestOf(original);
  for (const patch of [{ sha256:'0'.repeat(64) },{ mediaType:'text/plain' },{ originContext:manifest.originContext.replace('personal','another') }]) {
    vault.records.set(saved.id,{...original,notes:JSON.stringify({...manifest,...patch})});
    await assert.rejects(vault.documents.read({ id:saved.id }), error => error.code === 'integrity_failed');
  }
  vault.records.set(saved.id,original); vault.lock();
});

test('locking during upload or download returns no plaintext or committed metadata', async () => {
  const uploaded = await fixture(); uploaded.storage.onUpload = () => uploaded.vault.lock();
  await assert.rejects(uploaded.vault.documents.write(write()), error => error.code === 'vault_locked');
  assert.equal(uploaded.vault.records.size,0); assert.equal(uploaded.storage.objects.size,1);
  const reading = await fixture(); const saved = await reading.vault.documents.write(write());
  reading.storage.onDownload = () => reading.vault.lock();
  await assert.rejects(reading.vault.documents.read({ id:saved.id }), error => error.code === 'vault_locked');
});

test('upload or metadata failures keep the previous file and never delete ciphertext objects', async () => {
  const { vault, google, storage } = await fixture(); const before = await vault.documents.write(write('keep old'));
  storage.failUpload = true;
  await assert.rejects(vault.documents.write(write('fail upload',{id:before.id,expectedRevision:before.revision})), /could not be confirmed/);
  assert.equal(vault.documents.list()[0].revision,before.revision); storage.failUpload = false;
  google.failChecksum = true;
  await assert.rejects(vault.documents.write(write('fail metadata',{id:before.id,expectedRevision:before.revision})), /metadata was not confirmed/);
  google.failChecksum = false;
  assert.equal(vault.documents.list()[0].revision,before.revision);
  assert.equal(Buffer.from((await vault.documents.read({id:before.id})).contentBase64,'base64').toString(),'keep old');
  assert.equal(storage.objects.size,2); assert.ok(storage.calls.every(call => call.method !== 'DELETE')); vault.lock();
});

test('stale cloud writer loses metadata CAS and cannot replace a newer file', async () => {
  const a = await fixture(); const first = await a.vault.documents.write(write('first'));
  const b = await fixture({ google:a.google, storage:a.storage, existing:true });
  const second = await a.vault.documents.write(write('newer',{id:first.id,expectedRevision:first.revision}));
  await assert.rejects(b.vault.documents.write(write('stale',{id:first.id,expectedRevision:first.revision})), error => error.code === 'revision_conflict');
  assert.equal(Buffer.from((await a.vault.documents.read({id:second.id})).contentBase64,'base64').toString(),'newer');
  assert.equal(a.storage.objects.size,3); a.vault.lock(); b.vault.lock();
});

test('encrypted backup/import preserves file access after new record IDs, vault name and root key', async () => {
  const source = await fixture(); const saved = await source.vault.documents.write(write('restorable bytes'));
  const seed = manifestOf(source.vault.get(saved.id)).seed, backup = source.vault.exportBackup();
  assert.ok(!JSON.stringify(backup).includes(seed));
  const items = await readBackup(backup,master); source.vault.lock();
  const destination = await fixture({ storage:source.storage, name:'restored' });
  await destination.vault.importItems(items);
  const restored = destination.vault.documents.list()[0]; assert.notEqual(restored.id,saved.id);
  assert.equal(Buffer.from((await destination.vault.documents.read({id:restored.id})).contentBase64,'base64').toString(),'restorable bytes');
  destination.vault.lock();
});

test('generic credential field APIs and edits cannot reveal or mutate manifest keys', async () => {
  const { vault } = await fixture(); const saved = await vault.documents.write(write());
  const raw = vault.get(saved.id), seed = manifestOf(raw).seed;
  const bridge = new BridgeServer({getVault:()=>vault});
  await assert.rejects(bridge.dispatch('get',{id:saved.id}), /documents-read/);
  await assert.rejects(bridge.dispatch('read-ref',{ref:`hdv://personal/${saved.id}/notes`}), /documents-read/);
  await assert.rejects(bridge.dispatch('resolve-env',{refs:{VALUE:`hdv://personal/${saved.id}/notes`}}), /documents-read/);
  assert.throws(()=>readItemField(raw,'notes'),/documents-read/);
  await assert.rejects(bridge.dispatch('save-item',{target:saved.id,item:{notes:'overwrite'}}), /cannot be edited/);
  await assert.rejects(vault.save({...raw,tags:''}), /cannot be edited/);
  assert.ok(!JSON.stringify(await bridge.dispatch('documents-list')).includes(seed));
  const read = await bridge.dispatch('documents-read',{id:saved.id}); assert.ok(!JSON.stringify(read).includes(seed));
  assert.equal(isDocumentRecord(vault.get(saved.id)),true); vault.lock();
});

test('offline vault snapshots expose document metadata but never initiate attachment network reads', async () => {
  const { vault, storage } = await fixture(); const saved = await vault.documents.write(write());
  const calls = storage.calls.length; vault.offline = true;
  assert.equal(vault.documents.list()[0].id,saved.id);
  await assert.rejects(vault.documents.read({id:saved.id}),error=>error.code==='offline');
  await assert.rejects(vault.documents.write(write()),error=>error.code==='offline');
  assert.equal(storage.calls.length,calls); vault.lock();
});

test('another active vault cannot read a document UUID without an imported manifest', async () => {
  const a=await fixture(),b=await fixture(); const saved=await a.vault.documents.write(write());
  await assert.rejects(b.vault.documents.read({id:saved.id}),error=>error.code==='document_not_found'); a.vault.lock();b.vault.lock();
});

test('the full 16 MiB binary limit round-trips within the 24 MiB encrypted transport cap', async () => {
  const { vault, storage } = await fixture(); const bytes=Buffer.alloc(MAX_BYTES,173);
  const saved=await vault.documents.write(write('',{mediaType:'image/png',filename:'large.png',contentBase64:bytes.toString('base64')}));
  assert.equal(saved.size,MAX_BYTES); assert.ok([...storage.objects.values()][0].length < MAX_FRAME_BYTES);
  const result=await vault.documents.read({id:saved.id}); assert.deepEqual(Buffer.from(result.contentBase64,'base64'),bytes); vault.lock();
});
