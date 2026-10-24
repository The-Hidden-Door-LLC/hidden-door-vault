'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGoogle, MemoryCache, fakeAuth } = require('./mock-gcp.cjs');
const { SecretManager } = require('../src/core/gcp.cjs');
const { Vault, readBackup } = require('../src/core/vault.cjs');
function fixture(server = new FakeGoogle(), project = 'test-project-123', name = 'personal') {
  const cache = new MemoryCache(), cloud = new SecretManager({ project, vault: name, auth: fakeAuth(), fetcher: server.fetch });
  const vault = new Vault({ project, vault: name, cloud, cache }); return { server, cloud, cache, vault };
}
const master = 'Test-only master password with many characters';
test('create, save, read, archive, recover and offline-open work through the REST adapter', async () => {
  const { vault, cloud, cache, server } = fixture(); assert.equal((await vault.probe()).exists, false);
  const created = await vault.create(master); assert.match(created.recoveryCode, /^HDV1-/);
  const item = await vault.save({ kind: 'login', title: 'PRIVATE_TITLE_VALUE', username: 'sampleuser@example.test', password: 'PRIVATE_PASSWORD_VALUE', url: 'https://example.test' });
  assert.equal(vault.get(item.id).password, 'PRIVATE_PASSWORD_VALUE');
  assert.equal(vault.list()[0].title, 'PRIVATE_TITLE_VALUE'); assert.ok(!('password' in vault.list()[0]));
  assert.ok(!JSON.stringify(cache.value).includes('PRIVATE_TITLE_VALUE')); assert.ok(!JSON.stringify(server.calls).includes('PRIVATE_PASSWORD_VALUE'));
  await vault.archive(item.id, true); assert.equal(vault.get(item.id).archived, true);
  vault.lock(); assert.throws(() => vault.get(item.id), /locked/);
  await vault.unlock(created.recoveryCode, true, true); assert.equal(vault.offline, true); assert.equal(vault.get(item.id).password, 'PRIVATE_PASSWORD_VALUE');
  await assert.rejects(vault.save({ kind: 'note', title: 'No offline writes' }), /read-only/);
  vault.lock(); await vault.unlock(master); assert.equal(vault.offline, false);
  assert.equal((await cloud.list()).length, 2); vault.lock();
});
test('paginated Secret Manager listing includes every committed item', async () => {
  const { vault, cloud } = fixture(); const created = await vault.create(master);
  for (let i = 0; i < 5; i++) await vault.save({ kind: 'note', title: `Note ${i}`, notes: `Value ${i}` });
  assert.equal((await cloud.list()).length, 6); vault.lock(); await vault.unlock(created.recoveryCode, true); assert.equal(vault.list().length, 5); vault.lock();
});
test('concurrent stale saves cannot replace the active item version', async () => {
  const server = new FakeGoogle(), a = fixture(server), b = fixture(server);
  const created = await a.vault.create(master), original = await a.vault.save({ kind: 'note', title: 'Original', notes: 'Version one' });
  await b.vault.unlock(created.recoveryCode, true);
  const saved = await a.vault.save({ ...original, title: 'Writer A wins', notes: 'Version two' });
  await assert.rejects(b.vault.save({ ...original, title: 'Writer B stale', notes: 'Stale version' }), /Another writer/);
  await b.vault.refresh(); assert.equal(b.vault.get(original.id).title, saved.title);
  const secret = server.secrets.get(`projects/553237645697/secrets/hdv1-personal-${original.id}`);
  assert.equal(secret.versions.length, 3); assert.equal(String(secret.aliases.active), '2');
  a.vault.lock(); b.vault.lock();
});
test('ciphertext checksum failures abort unlock', async () => {
  const { vault, server } = fixture(); const created = await vault.create(master); vault.lock(); server.corruptAccess = true;
  await assert.rejects(vault.unlock(created.recoveryCode, true), /integrity/); assert.equal(vault.unlocked, false);
});
test('write checksum must be acknowledged before version activation', async () => {
  const { vault, server } = fixture(); await vault.create(master); server.failChecksum = true;
  await assert.rejects(vault.save({ kind: 'note', title: 'Not committed' }), /checksum/); assert.equal(vault.list().length, 0); vault.lock();
});
test('a tampered item is skipped loudly and does not block the rest of the vault (offline)', async () => {
  const { vault, cache } = fixture(); const created = await vault.create(master);
  const bad = await vault.save({ kind: 'api', title: 'Token', token: 'secret' }), good = await vault.save({ kind: 'note', title: 'Still here', notes: 'intact' }); vault.lock();
  const packet = cache.value.packets.find(p => p.id === bad.id); packet.envelope.tag = Buffer.alloc(16).toString('base64');
  const result = await vault.unlock(created.recoveryCode, true, true);
  assert.equal(vault.unlocked, true); assert.equal(result.count, 1); assert.equal(vault.get(good.id).notes, 'intact');
  assert.throws(() => vault.get(bad.id), /not found/); assert.deepEqual(vault.skipped, [bad.id]);
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /1 encrypted item/); assert.ok(result.warnings[0].includes(bad.id));
  assert.ok(!JSON.stringify(vault.exportBackup()).includes(bad.id));
  vault.lock(); assert.deepEqual(vault.skipped, []); assert.deepEqual(vault.warnings, []);
});
test('a tampered or foreign item in the cloud namespace is skipped loudly (online)', async () => {
  const { vault, server } = fixture(); const created = await vault.create(master);
  const bad = await vault.save({ kind: 'login', title: 'Bad', password: 'x' }), good = await vault.save({ kind: 'login', title: 'Good', password: 'y' }); vault.lock();
  const secret = server.secrets.get(`projects/553237645697/secrets/hdv1-personal-${bad.id}`), version = secret.versions[secret.versions.length - 1];
  const envelope = JSON.parse(Buffer.from(version.data, 'base64').toString('utf8')); envelope.ciphertext = envelope.ciphertext.slice(0, -4) + 'AAAA';
  const bytes = Buffer.from(JSON.stringify(envelope)); version.data = bytes.toString('base64'); version.dataCrc32c = require('../src/core/crc32c.cjs')(bytes);
  secret.etag = '"tampered"'; // Secret Manager versions are immutable; any real rewrite is a new version + alias PATCH, which changes the etag.
  const opened = await vault.unlock(created.recoveryCode, true); assert.equal(opened.fromCache, true); assert.equal(opened.count, 2); // snapshot first
  const result = await vault.refresh(); // background sync reconciles with the tampered cloud copy
  assert.equal(result.count, 1); assert.equal(vault.get(good.id).password, 'y'); assert.deepEqual(vault.skipped, [bad.id]);
  assert.equal(vault.warnings.length, 1); assert.ok(vault.warnings[0].includes(bad.id));
  await vault.refresh(); assert.equal(vault.warnings.length, 1); // refresh does not duplicate the warning
  vault.lock();
});
test('a wrong master password still fails closed before any item is considered', async () => {
  const { vault } = fixture(); await vault.create(master); await vault.save({ kind: 'note', title: 'n' }); vault.lock();
  await assert.rejects(vault.unlock('Wrong-password-that-is-long-enough!!'), /Unable to unlock/); assert.equal(vault.unlocked, false); assert.deepEqual(vault.skipped, []);
});
test('manual lock during asynchronous password derivation cannot resurrect the session', async () => {
  const { vault } = fixture(); await vault.create(master); vault.lock();
  const pending = vault.unlock(master); setTimeout(() => vault.lock(), 5);
  await assert.rejects(pending, /locked/); assert.equal(vault.unlocked, false);
});
test('encrypted backups restore across projects using the source recovery code', async () => {
  const source = fixture(), destination = fixture(new FakeGoogle(), 'another-project-123');
  const created = await source.vault.create(master); await source.vault.save({ kind: 'card', title: 'Personal card', holder: 'Test User', number: '4111111111111111' });
  const backup = source.vault.exportBackup(); assert.ok(!JSON.stringify(backup).includes('4111111111111111'));
  const items = await readBackup(backup, created.recoveryCode, true); assert.equal(items.length, 1);
  await destination.vault.create('A second unique test master password'); const result = await destination.vault.importItems(items); assert.equal(result.saved, 1);
  const id = destination.vault.list()[0].id; assert.equal(destination.vault.get(id).number, '4111111111111111'); assert.notEqual(id, source.vault.list()[0].id);
  source.vault.lock(); destination.vault.lock();
});
test('imports validate the entire batch before performing cloud writes', async () => {
  const { vault } = fixture(); await vault.create(master);
  await assert.rejects(vault.importItems([{ kind: 'note', title: 'Fine' }, { kind: 'passkey', title: 'Not supported' }])); assert.equal(vault.list().length, 0); vault.lock();
});
test('missing offline caches and wrong namespaces are not treated as empty vaults', async () => {
  const { vault } = fixture(); await assert.rejects(vault.unlock(master, false, true), /No compatible/); assert.equal(vault.unlocked, false);
});
test('REST adapter rejects secrets outside the application namespace', async () => {
  const { cloud } = fixture(); await assert.rejects(cloud.create('unrelated-secret')); await assert.rejects(cloud.get('hdv1-other-header'));
});
test('resource names returned with the project number are accepted and pinned', async () => {
  const { vault, cloud, server } = fixture(); const created = await vault.create(master);
  const item = await vault.save({ kind: 'note', title: 'Numbered', notes: 'ok' });
  assert.ok([...server.secrets.keys()].every(name => name.startsWith('projects/553237645697/secrets/hdv1-personal-')));
  assert.equal(cloud.projectNumber, '553237645697');
  vault.lock(); await vault.unlock(created.recoveryCode, true); assert.equal(vault.get(item.id).notes, 'ok');
  // A name from a different numeric project is rejected once the number is pinned; a different ID is rejected always.
  assert.equal(cloud.secretId('projects/999999999999/secrets/hdv1-personal-header'), null);
  assert.equal(cloud.secretId('projects/other-project-1/secrets/hdv1-personal-header'), null);
  assert.equal(cloud.secretId('projects/test-project-123/secrets/hdv1-personal-header'), 'hdv1-personal-header');
  assert.equal(cloud.secretId('projects/553237645697/secrets/hdv1-work-header'), null);
  await assert.rejects(cloud.request('projects/999999999999/secrets/hdv1-personal-header'), /Unexpected resource/);
  vault.lock();
});
test('biometric key material unlocks only the vault it was exported from', async () => {
  const server = new FakeGoogle(), a = fixture(server), created = await a.vault.create(master);
  const item = await a.vault.save({ kind: 'note', title: 'Bio', notes: 'ok' });
  const material = a.vault.exportKeyMaterial(); assert.equal(material.vaultId, a.vault.header.vaultId); a.vault.lock();
  const r = await a.vault.unlockWithKeyMaterial(material); assert.equal(r.count, 1); assert.equal(a.vault.get(item.id).notes, 'ok'); a.vault.lock();
  await a.vault.unlockWithKeyMaterial(material, true); assert.equal(a.vault.offline, true); a.vault.lock();
  // Wrong vault / tampered key / re-created vault are all rejected before any item is touched.
  const other = fixture(new FakeGoogle(), 'test-project-123', 'work'); await other.vault.create(master); other.vault.lock();
  await assert.rejects(other.vault.unlockWithKeyMaterial(material), /not set up/);
  const bad = { ...material, key: Buffer.alloc(32, 7).toString('base64') };
  await assert.rejects(a.vault.unlockWithKeyMaterial(bad), /does not match/); assert.equal(a.vault.unlocked, false);
  const stale = { ...material, vaultId: '00000000-0000-4000-8000-000000000000' };
  await assert.rejects(a.vault.unlockWithKeyMaterial(stale), /re-created/);
  void created;
});
test('importItems reports progress and can be stopped between items', async () => {
  const { vault } = fixture(); await vault.create(master);
  const events = []; const r = await vault.importItems([{ kind: 'note', title: 'a' }, { kind: 'note', title: 'b' }], e => events.push(e));
  assert.deepEqual(r, { saved: 2, total: 2, stopped: false }); assert.equal(events[0].done, 0); assert.equal(events.at(-1).done, 2); assert.equal(events.at(-1).title, 'b');
  let calls = 0; const r2 = await vault.importItems([{ kind: 'note', title: 'c' }, { kind: 'note', title: 'd' }, { kind: 'note', title: 'e' }], e => { if (++calls === 2) vault.requestStopImport(); });
  assert.equal(r2.stopped, true); assert.equal(r2.saved, 1); assert.equal(vault.list().length, 3); vault.lock();
});

test('unlock opens from the encrypted snapshot and refresh fetches only changed items', async () => {
  const server = new FakeGoogle(), a = fixture(server), created = await a.vault.create(master);
  const items = []; for (let i = 0; i < 6; i++) items.push(await a.vault.save({ kind: 'note', title: `n${i}`, notes: String(i) }));
  a.vault.lock();
  const before = server.calls.length; const opened = await a.vault.unlock(created.recoveryCode, true);
  assert.equal(opened.fromCache, true); assert.equal(opened.count, 6); assert.equal(a.vault.stale, true);
  assert.ok(!server.calls.slice(before).some(c => /:access$/.test(c.url) && !/header/.test(c.url)), 'no item access calls during a cache-first unlock');
  const r1 = await a.vault.refresh(); assert.equal(r1.fetched, 0); assert.equal(a.vault.stale, false);
  // another device edits one item; the next refresh fetches exactly that one
  const b = fixture(server); await b.vault.unlock(created.recoveryCode, true); await b.vault.refresh(); await b.vault.save({ ...b.vault.get(items[2].id), notes: 'changed elsewhere' }); b.vault.lock();
  const r2 = await a.vault.refresh(); assert.equal(r2.fetched, 1); assert.equal(a.vault.get(items[2].id).notes, 'changed elsewhere');
  // a fresh device with no snapshot does a full fetch
  const c = fixture(server); const fresh = await c.vault.unlock(created.recoveryCode, true); assert.equal(fresh.fromCache, false); assert.equal(fresh.count, 6);
  a.vault.lock(); c.vault.lock();
});
// --- Version pruning (review item L4) ---
function versionsOf(server, prefix, id) { return server.secrets.get(`projects/553237645697/secrets/${prefix}${id}`).versions; }
test('pruning after a save keeps the newest N versions and never the active one', async () => {
  const { vault, server } = fixture(); await vault.create(master); vault.pruneKeep = 2;
  const item = await vault.save({ kind: 'note', title: 'Prune me', notes: 'v1' });
  await vault.save({ ...item, notes: 'v2' }); await vault.save({ ...item, notes: 'v3' });
  const versions = versionsOf(server, 'hdv1-personal-', item.id), secret = server.secrets.get(`projects/553237645697/secrets/hdv1-personal-${item.id}`);
  assert.equal(versions.length, 3); assert.equal(String(secret.aliases.active), '3');
  assert.deepEqual(versions.map(v => v.state), ['DISABLED', 'ENABLED', 'ENABLED']);
  assert.ok(versions[0].scheduledDestroyTime, 'destruction is scheduled, not immediate'); assert.equal(secret.destroyTtl, `${3 * 86400}s`);
  assert.ok(!server.calls.some(c => c.url.endsWith('/versions/3:destroy')), 'the active version is never destroyed');
  assert.equal(vault.get(item.id).notes, 'v3'); assert.deepEqual(vault.warnings, []);
  vault.lock();
});
test('keep=1 leaves only the active version enabled', async () => {
  const { vault, server } = fixture(); await vault.create(master); vault.pruneKeep = 1;
  const item = await vault.save({ kind: 'note', title: 'One', notes: 'a' });
  for (const n of ['b', 'c', 'd']) await vault.save({ ...item, notes: n });
  assert.deepEqual(versionsOf(server, 'hdv1-personal-', item.id).map(v => v.state), ['DISABLED', 'DISABLED', 'DISABLED', 'ENABLED']); vault.lock();
});
test('a stale writer\'s higher-numbered candidate version is pruned; the active version is not', async () => {
  const server = new FakeGoogle(), a = fixture(server), b = fixture(server);
  const created = await a.vault.create(master), original = await a.vault.save({ kind: 'note', title: 'Original', notes: 'one' });
  await b.vault.unlock(created.recoveryCode, true);
  await a.vault.save({ ...original, notes: 'two' });
  await assert.rejects(b.vault.save({ ...original, notes: 'stale' }), /Another writer/);
  const versions = versionsOf(server, 'hdv1-personal-', original.id); assert.equal(versions.length, 3); assert.equal(versions[2].state, 'ENABLED');
  const r = await a.vault.pruneSecret(original.id, 1);
  assert.equal(r.destroyed, 2); assert.deepEqual(versions.map(v => v.state), ['DISABLED', 'ENABLED', 'DISABLED']);
  assert.equal(a.vault.get(original.id).notes, 'two'); a.vault.lock(); b.vault.lock();
});
test('header pruning never destroys the active header version and the adapter refuses if asked', async () => {
  const { vault, cloud, server } = fixture(); await vault.create(master);
  const r = await vault.pruneSecret('hdv1-personal-header', 1); assert.equal(r.destroyed, 0); assert.equal(r.kept, 1);
  const meta = await cloud.get('hdv1-personal-header');
  await assert.rejects(cloud.destroyVersion(meta, '1', ''), /active version/);
  assert.equal(versionsOf(server, 'hdv1-personal-', 'header')[0].state, 'ENABLED'); vault.lock();
});
test('a 403 on destroy leaves the save intact, warns once and flags the missing permission', async () => {
  const { vault, server } = fixture(); await vault.create(master); vault.pruneKeep = 1; server.denyDestroy = true;
  const item = await vault.save({ kind: 'note', title: 'Denied', notes: 'a' });
  const saved = await vault.save({ ...item, notes: 'b' }); assert.equal(saved.notes, 'b'); assert.equal(vault.get(item.id).notes, 'b');
  assert.equal(vault.pruneDenied, true); assert.equal(vault.warnings.filter(w => w.startsWith('Pruning:')).length, 1); assert.match(vault.warnings[0], /setup-gcp/);
  await vault.save({ ...item, notes: 'c' }); assert.equal(vault.warnings.filter(w => w.startsWith('Pruning:')).length, 1);
  assert.deepEqual(versionsOf(server, 'hdv1-personal-', item.id).map(v => v.state), ['ENABLED', 'ENABLED', 'ENABLED']); vault.lock();
});
test('pruneAll sweeps the header and every item, reports totals and honours stop', async () => {
  const { vault, server } = fixture(); await vault.create(master);
  const items = []; for (let i = 0; i < 5; i++) items.push(await vault.save({ kind: 'note', title: `N${i}`, notes: 'a' }));
  for (const it of items) { await vault.save({ ...it, notes: 'b' }); await vault.save({ ...it, notes: 'c' }); }
  const progress = []; const totals = await vault.pruneAll(2, p => progress.push(p));
  assert.deepEqual({ scanned: totals.scanned, destroyed: totals.destroyed, failed: totals.failed, total: totals.total, stopped: totals.stopped }, { scanned: 6, destroyed: 5, failed: 0, total: 6, stopped: false });
  assert.equal(progress.at(-1).done, 6); assert.ok(vault.lastPrune.at);
  for (const it of items) assert.deepEqual(versionsOf(server, 'hdv1-personal-', it.id).map(v => v.state), ['DISABLED', 'ENABLED', 'ENABLED']);
  // Second sweep: nothing left to do, and destroying an already-scheduled version is tolerated.
  const again = await vault.pruneAll(2); assert.equal(again.destroyed, 0); assert.equal(again.failed, 0);
  // Stop mid-sweep: lanes already in flight finish, nothing else starts.
  const stopped = await vault.pruneAll(1, () => vault.requestStopPrune()); assert.equal(stopped.stopped, true); assert.ok(stopped.scanned < 6, `scanned ${stopped.scanned}`);
  vault.lock();
});
test('pruning refuses offline, locked and mid-save', async () => {
  const { vault } = fixture(); const created = await vault.create(master); vault.lock();
  await assert.rejects(vault.pruneAll(2), /locked/);
  await vault.unlock(created.recoveryCode, true, true); await assert.rejects(vault.pruneAll(2), /online/); vault.lock();
  await vault.unlock(master); vault.writing = true; await assert.rejects(vault.pruneAll(2), /save is in progress/); vault.writing = false;
  await assert.rejects(vault.pruneSecret('hdv1-personal-header', 0), /between 1 and 100/); vault.lock();
});
// --- Cost estimate ---
test('countVersions counts ENABLED and DISABLED versions, never DESTROYED, and reports scheduled times', async () => {
  const { vault, server } = fixture(); await vault.create(master);
  const a = await vault.save({ kind: 'note', title: 'A', notes: '1' }); await vault.save({ ...a, notes: '2' }); await vault.save({ ...a, notes: '3' });
  await vault.save({ kind: 'note', title: 'B', notes: '1' });
  let c = await vault.countVersions(); assert.deepEqual({ secrets: c.secrets, billable: c.billable, scheduled: c.scheduled }, { secrets: 3, billable: 5, scheduled: [] });
  await vault.pruneSecret(a.id, 1); // v1 and v2 scheduled (TTL set): still billable
  const progress = []; c = await vault.countVersions(p => progress.push(p));
  assert.equal(c.billable, 5); assert.equal(c.scheduled.length, 2); assert.equal(progress.at(-1).done, 3);
  // Once Google actually destroys them they stop counting.
  for (const v of versionsOf(server, 'hdv1-personal-', a.id).slice(0, 2)) { v.state = 'DESTROYED'; delete v.scheduledDestroyTime; }
  c = await vault.countVersions(); assert.equal(c.billable, 3); assert.deepEqual(c.scheduled, []);
  assert.ok(!server.calls.some(call => call.url.includes(':access') && call.url.includes(a.id) && server.calls.indexOf(call) > server.calls.length - 8), 'counting never reads payloads');
  vault.lock(); await assert.rejects(vault.countVersions(), /locked/);
});
test('vault.delete removes secret from Secret Manager and local cache, with 403 tombstoning fallback', async () => {
  const { vault, server, cache } = fixture(); const created = await vault.create(master);
  const a = await vault.save({ kind: 'note', title: 'Delete Direct', notes: 'bye' });
  const b = await vault.save({ kind: 'note', title: 'Delete Tombstone', notes: 'fallback' });
  assert.equal(vault.list().length, 2);

  // 1. Direct DELETE
  const r1 = await vault.delete(a.id);
  assert.equal(r1.deleted, true);
  assert.equal(vault.list().length, 1);
  assert.throws(() => vault.get(a.id), /not found/);
  assert.equal(server.secrets.has(`projects/553237645697/secrets/hdv1-personal-${a.id}`), false);
  assert.equal(cache.value.packets.some(p => p.id === a.id), false);

  // 2. 403 Tombstoning fallback (for custom roles missing secretmanager.secrets.delete)
  server.denyDelete = true;
  const r2 = await vault.delete(b.id);
  assert.equal(r2.deleted, true);
  assert.equal(vault.list().length, 0);
  const tombstoned = server.secrets.get(`projects/553237645697/secrets/hdv1-personal-${b.id}`);
  assert.equal(tombstoned.labels.hdv_deleted, 'true');
  assert.deepEqual(tombstoned.aliases, {});

  // 3. Re-unlocking and refreshing ignores tombstoned secrets
  vault.lock();
  await vault.unlock(created.recoveryCode, true);
  await vault.refresh();
  assert.equal(vault.list().length, 0);
  vault.lock();
});
test('vault.rekey accepts the recovery code in place of a forgotten master password', async () => {
  const { vault } = fixture();
  const created = await vault.create(master);
  await assert.rejects(vault.rekey('HDV1-' + 'A'.repeat(43), 'brand-new-master-password-9876', true), /Recovery code is incorrect/);
  await assert.rejects(vault.rekey(created.recoveryCode, 'brand-new-master-password-9876', false), /Current master password is incorrect/, 'a recovery code is not accepted as a password');
  const rekeyed = await vault.rekey(created.recoveryCode, 'brand-new-master-password-9876', true);
  assert.match(rekeyed.recoveryCode, /^HDV1-/); assert.notEqual(rekeyed.recoveryCode, created.recoveryCode);
  vault.lock();
  await assert.rejects(vault.unlock(master), /password|credential|incorrect|Invalid/i, 'old password no longer unlocks');
  await assert.rejects(vault.unlock(created.recoveryCode, true), /recovery|credential|incorrect|Invalid/i, 'old recovery code no longer unlocks');
  await vault.unlock('brand-new-master-password-9876'); assert.equal(vault.unlocked, true); vault.lock();
  await vault.unlock(rekeyed.recoveryCode, true); assert.equal(vault.unlocked, true);
});

test('vault.rekey rotates master password and recovery code without re-uploading items, and detects header rollback', async () => {
  const { vault, server, cache } = fixture();
  const created = await vault.create(master);
  const saved = await vault.save({ kind: 'login', title: 'Rekey Survives', username: 'sampleuser', password: 'secret-value-123456' });
  const itemCallsBefore = server.calls.filter(c => c.url.includes(saved.id)).length;

  await assert.rejects(vault.rekey('wrong-current-password-1234', 'new-master-password-567890'), /Current master password is incorrect/);
  const nextMaster = 'new-correct-horse-battery-staple-99';
  const rekeyed = await vault.rekey(master, nextMaster);
  assert.equal(rekeyed.generation, 2);
  assert.match(rekeyed.recoveryCode, /^HDV1-/);
  assert.notEqual(rekeyed.recoveryCode, created.recoveryCode);

  const itemCallsAfter = server.calls.filter(c => c.url.includes(saved.id)).length;
  assert.equal(itemCallsAfter, itemCallsBefore, 'rekey must not re-upload item secrets');

  vault.lock();
  await assert.rejects(vault.unlock(master), /Unable to unlock/);
  await assert.rejects(vault.unlock(created.recoveryCode, true), /Unable to unlock/);

  await vault.unlock(nextMaster);
  assert.equal(vault.get(saved.id).password, 'secret-value-123456');
  vault.lock();

  await vault.unlock(rekeyed.recoveryCode, true);
  assert.equal(vault.get(saved.id).password, 'secret-value-123456');
  vault.lock();

  // Simulate cloud rollback to generation 1 while local cache knows generation 2
  const headerSecret = server.secrets.get('projects/553237645697/secrets/hdv1-personal-header');
  headerSecret.aliases.active = '1';
  headerSecret.etag = '"rolled-back"';
  await assert.rejects(vault.unlock(master), /rollback detected/);
  assert.equal(cache.value.header.generation, 2);
});

